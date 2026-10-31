// SPDX-License-Identifier: Apache-2.0
// Verify the existing WSL profile's published runtime asset before staging its
// narrow package-owned overlay. This does not install or qualify a WSL guest.
import { chmod, mkdir, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";

if (process.platform !== "linux") throw new Error("Stage WSL artifacts on the VPS factory.");
const [archiveArgument, outputArgument, configArgument, runtimeSourceArgument] = Bun.argv.slice(2);
if (!archiveArgument || !outputArgument)
  throw new Error(
    "Usage: bun stage-wsl-runtime.ts <release.tar.gz> <new-output-directory> [wsl-build.json] [runtime-source-git]",
  );
const repoRoot = resolve(import.meta.dir, "../../../..");
const configuration = await Bun.file(configArgument || join(repoRoot, "tools/aphrody/config/os/wsl-build.json")).json();
const pin = configuration.arch.targets["omarchy-preview"] as {
  bunRuntimeVersion: string;
  bunRuntimeSourceRevision: string;
  bunRuntimeReleaseAsset: string;
  bunRuntimeReleaseAssetSha256: string;
};
if (
  !/^\d+\.\d+\.\d+$/.test(pin.bunRuntimeVersion) ||
  !/^[0-9a-f]{40}$/.test(pin.bunRuntimeSourceRevision) ||
  pin.bunRuntimeReleaseAsset !== "bun-linux-x64.tar.gz" ||
  !/^[0-9a-f]{64}$/.test(pin.bunRuntimeReleaseAssetSha256)
)
  throw new Error("The WSL profile must pin a complete immutable runtime release.");
const archive = Bun.file(resolve(archiveArgument));
if (archive.size <= 0 || archive.size > 512 * 1024 * 1024)
  throw new Error("Runtime archive size is outside the bounded release input.");
const bytes = await archive.bytes();
const archiveHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (archiveHash !== pin.bunRuntimeReleaseAssetSha256)
  throw new Error("Runtime archive does not match the official release asset digest.");
const output = resolve(outputArgument);
await mkdir(output); // Refuse to reuse or overwrite another build's staging.
const extracted = join(output, "release");
await new Bun.Archive(bytes).extract(extracted);
const source = join(extracted, "bun-linux-x64");
const rootfs = join(output, "rootfs");
// The release archive may carry only the binary; notices then come from the pinned source revision
// of the runtime (a local clone given as the fourth argument). Mullvad notices exist only in
// revisions that vendor it and are staged when present.
const candidates = [
  ["bun", "usr/bin/bun", true],
  ["LICENSE.md", "usr/share/licenses/bun-aphrody/LICENSE.md", true],
  ["MULLVAD-LICENSE.md", "usr/share/licenses/bun-aphrody/MULLVAD-LICENSE.md", false],
  ["MULLVAD-THIRD-PARTY.md", "usr/share/licenses/bun-aphrody/MULLVAD-THIRD-PARTY.md", false],
] as const;
async function pinnedSourceFile(name: string): Promise<Uint8Array | undefined> {
  if (!runtimeSourceArgument || name === "bun") return undefined;
  const show = Bun.spawnSync(["git", "-C", resolve(runtimeSourceArgument), "show", `${pin.bunRuntimeSourceRevision}:${name}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return show.exitCode === 0 && show.stdout.length > 0 ? show.stdout : undefined;
}
const files: (readonly [string, string])[] = [];
const noticeOrigins: Record<string, string> = {};
for (const [name, path, required] of candidates) {
  const file = Bun.file(join(source, name));
  let bytes = (await file.exists()) && file.size > 0 ? await file.bytes() : undefined;
  noticeOrigins[name] = "release-archive";
  if (!bytes && (bytes = await pinnedSourceFile(name))) noticeOrigins[name] = `source:${pin.bunRuntimeSourceRevision}`;
  if (!bytes) {
    delete noticeOrigins[name];
    if (required) throw new Error(`Release and pinned runtime source omit required file: ${name}`);
    continue;
  }
  await Bun.write(join(rootfs, path), bytes);
  await chmod(join(rootfs, path), path === "usr/bin/bun" ? 0o755 : 0o644);
  files.push([name, path]);
}
await symlink("bun", join(rootfs, "usr/bin/bunx"));
const smoke = `
if(Bun.version!==${JSON.stringify(pin.bunRuntimeVersion)}||Bun.revision!==${JSON.stringify(pin.bunRuntimeSourceRevision)})throw new Error("Runtime identity mismatch");
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response("bun-os-wsl-runtime");}});
try {if(await(await fetch(server.url)).text()!=="bun-os-wsl-runtime")throw new Error("HTTP smoke mismatch");}
finally {await server.stop(true);}
console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl,httpSmoke:"passed"}));`;
const processResult = Bun.spawn([join(rootfs, "usr/bin/bun"), "-e", smoke], {
  cwd: output,
  stdout: "pipe",
  stderr: "pipe",
  timeout: 15000,
});
const [stdout, stderr, code] = await Promise.all([
  new Response(processResult.stdout).text(),
  new Response(processResult.stderr).text(),
  processResult.exited,
]);
if (code !== 0) throw new Error(`Pinned runtime smoke failed: ${stderr}`);
const identity = JSON.parse(stdout.trim());
const sums: string[] = [];
for (const path of [...files.map(([, path]) => path), "usr/bin/bunx"]) {
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(rootfs, path)).bytes()).digest("hex");
  sums.push(`${hash}  ${path}`);
}
await Bun.write(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`);
await Bun.write(
  join(output, "bun-runtime.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "aphrody-bun-runtime-payload",
      qualified: true,
      qualificationScope:
        "official release archive integrity, native runtime identity and Linux loopback HTTP smoke; WSL import remains unqualified",
      packageName: "bun-aphrody",
      version: pin.bunRuntimeVersion,
      sourceRevision: pin.bunRuntimeSourceRevision,
      releaseAsset: pin.bunRuntimeReleaseAsset,
      releaseAssetSha256: archiveHash,
      releaseAssetUrl: `https://github.com/aphrody-labs/bun/releases/download/bun-v${pin.bunRuntimeVersion}/${pin.bunRuntimeReleaseAsset}`,
      binarySha256: sums[0]!.split("  ")[0],
      noticeOrigins,
      identity,
    },
    null,
    2,
  )}\n`,
);
console.log(`Verified runtime payload staged at ${output}`);
