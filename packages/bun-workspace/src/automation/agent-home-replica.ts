// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Private snapshot files are uploaded and verified in sequence. */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ReplicaConfig {
  incoming: string;
  contract: string;
  homeDocuments?: string[];
  directory: string;
  stateRoot: string;
  extraStateRoot?: string;
  intervalSeconds: number;
}
type Run = (argv: string[], environment?: Record<string, string>) => Promise<string>;
const remoteBun = (source: string) => "/home/ubuntu/.bun/bin/bun -e '" + source.replaceAll("'", "'\\''") + "'";
const remoteCheck = [
  'import { lstat } from "node:fs/promises";',
  'import { join } from "node:path";',
  "const regular = async p => { try { const s = await lstat(p); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } };",
  'const hash = async p => new Bun.CryptoHasher("sha256").update(await Bun.file(p).bytes()).digest("hex");',
];
export interface SnapshotFile {
  relative: string;
  sha256: string;
  bytes: number;
  local: string;
}
const roles = new Set([
  "remote.candidate.md",
  "local.md",
  "reviewed-baseline.md",
  "remote.native.json",
  "evidence.json",
]);

/** Snapshot only contracted home documents and the native connector's staged evidence. */
export async function snapshotFiles(home: string, incoming: string, names: string[], destination: string) {
  const sources: { source: string; relative: string }[] = [];
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_-]*\.md$/.test(name)) throw new Error("Unsafe home document name");
    sources.push({ source: join(home, name), relative: `active/${name}` });
  }
  const folders = await readdir(incoming, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  for (const folder of folders) {
    if (!folder.isDirectory() || !names.some(name => folder.name.startsWith(name + "-"))) continue;
    const document = names.find(name => folder.name.startsWith(name + "-"))!;
    const suffix = folder.name.slice(document.length + 1);
    if (!/^[a-f0-9]{16}-[a-f0-9]{16}$/.test(suffix)) continue;
    for (const role of roles)
      sources.push({
        source: join(incoming, folder.name, role),
        relative: `incoming/${folder.name}/${role}`,
      });
  }
  const files: SnapshotFile[] = [];
  for (const { source, relative } of sources) {
    const info = await lstat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      throw new Error("Unsafe snapshot source");
    const bytes = await Bun.file(source).bytes();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const local = join(destination, relative);
    await mkdir(join(local, ".."), { recursive: true, mode: 0o700 });
    await Bun.write(local, bytes, { mode: 0o600 });
    await chmod(local, 0o600);
    files.push({ relative, sha256, bytes: bytes.length, local });
  }
  if (!files.length) throw new Error("No contracted snapshot documents found");
  return files;
}

export async function replicateHome(
  config: ReplicaConfig,
  home: string,
  receiptRoot: string,
  aphrody: string,
  run: Run,
) {
  const names = [
    ...new Set([...((await Bun.file(config.contract).json()) as string[]), ...(config.homeDocuments ?? [])]),
  ];
  const files = await snapshotFiles(home, config.incoming, names, join(receiptRoot, "replica-outgoing"));
  const manifest = files.map(({ local: _local, ...file }) => file);
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const root = `${config.directory}/${digest}`;
  const environment = { APHRODY_DBFR_HOST: "10.200.77.3" };
  const exec = (command: string) =>
    run([aphrody, "infra", "ssh", "exec", "--host", "dbfr", "--cmd", command], environment);
  const path64 = Buffer.from(root).toString("base64");
  const manifest64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
  const input = [
    `const root = Buffer.from("${path64}", "base64").toString();`,
    `const files = JSON.parse(Buffer.from("${manifest64}", "base64").toString());`,
  ];
  const ready = await exec(
    remoteBun(
      [
        ...remoteCheck,
        ...input,
        'const marker = join(root, "verified.json");',
        "let valid = false;",
        "try { valid = await regular(marker) && JSON.stringify(await Bun.file(marker).json()) === JSON.stringify(files); } catch {}",
        "if (valid) for (const file of files) { const p = join(root, file.relative); if (!await regular(p) || await hash(p) !== file.sha256) { valid = false; break; } }",
        'console.log(valid ? "verified" : "missing");',
      ].join("\n"),
    ),
  );
  let copied = 0;
  if (ready.trim() !== "verified") {
    const prepare = [
      'import { mkdir } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      ...input,
      "for (const file of files) await mkdir(dirname(join(root, file.relative)), { recursive: true, mode: 0o700 });",
    ].join("\n");
    await exec(remoteBun(prepare));
    for (const file of files) {
      await run(
        [aphrody, "infra", "ssh", "sftp", "--host", "dbfr", "--path", `${root}/${file.relative}`, "--put", file.local],
        environment,
      );
      copied++;
    }
    const verify = [
      'import { chmod, rename } from "node:fs/promises";',
      ...remoteCheck,
      ...input,
      'for (const file of files) { const p = join(root, file.relative); if (!await regular(p) || await hash(p) !== file.sha256) throw Error("Snapshot checksum mismatch"); await chmod(p, 0o600); }',
      'const marker = join(root, "verified.json"), temp = marker + "." + crypto.randomUUID() + ".tmp";',
      "await Bun.write(temp, JSON.stringify(files), { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, marker);",
      'console.log("snapshot-verified");',
    ].join("\n");
    if ((await exec(remoteBun(verify))).trim() !== "snapshot-verified")
      throw new Error("Remote snapshot verification failed");
  }
  const args = [
    ["--state", config.stateRoot, "--profile", "dbfr"],
    ...(config.extraStateRoot ? [["--state", config.extraStateRoot]] : []),
  ];
  let indexed = 0;
  for (const flags of args) {
    const argv = ["/home/ubuntu/.local/bin/aphrody", "home", "index", root, "--label", "drive-dbfr-replica", ...flags];
    const command = argv.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
    const report = JSON.parse(await exec(command));
    if (!Array.isArray(report.errors) || report.errors.length) throw new Error("Remote home index failed");
    if (Number.isSafeInteger(report.indexed) && report.indexed >= 0) indexed += report.indexed;
  }
  return { files_copied: copied, homes_indexed: 2, indexed };
}
