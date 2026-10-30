// SPDX-License-Identifier: MIT
// `bun factory usr plan|build|fetch [--composition server|desktop|gaming] [--desktop-session cosmic|omarchy-hyprland] [--snapshot YYYY-MM-DD | --lock FILE]
//   [--verity] [--no-boot] [--host HOST] [--job ID]`
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Glob } from "bun";
import type { DesktopSession } from "../arch/index.ts";

const here = import.meta.dir;
const workspace = resolve(here, "../..");
type UsrComposition = "server" | "desktop" | "gaming";
interface Repository {
  name: string;
  server: string;
  keys?: string[];
  keyserver?: string;
}
interface UsrManifest {
  host: string;
  builderImage: string;
  builderPackages: string[];
  remoteRoot: string;
  remoteTimeoutSeconds: number;
  localArtifacts: string;
  repositories: Repository[];
  basePackages: string[];
  /** Rust base packages fetched from the signed aphrody repository (docs/RUST-BASE.md). */
  rustBase?: { repository: string; key: string; packages: string[] };
  kernelFallback: string | null;
  kernelSelection: {
    source: string | null;
    state: "blocked" | "unqualified" | "qualified";
    reason?: string;
  };
  compositions: Record<UsrComposition, { profile: string; packages: string[] }>;
  hierarchy: {
    rootLinks: Record<string, string>;
    usrLinks: Record<string, string>;
    usrDirectories: string[];
    required: string[];
  };
  overlay: string;
  localRepository: { name: string; packages: string; sourceDateEpoch: number };
  bunos: {
    manifest: string;
    pkgbuilds: string;
    unpublished?: Record<string, string>;
  };
  multicall: { crate: string; features: string[] };
  archive: { server: string; repositories: string[] };
  lockDirectory: string;
  boot: { definitions: string; timeoutSeconds: number };
  images: { erofsCompression: string; squashfsCompression: string };
}

const sshOptions = ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"];

export interface UsrLockPackage {
  repository: string;
  name: string;
  version: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface UsrLock {
  schemaVersion: 3;
  kind: "bun-os-usr-lock";
  composition: UsrComposition;
  desktopSession: DesktopSession | null;
  desktopSessionOwner: string | null;
  desktopSessionState: "not-applicable" | "unqualified";
  snapshot: string | null;
  builderImage: string;
  kernelSelection: UsrManifest["kernelSelection"];
  job: string;
  packages: UsrLockPackage[];
}

/** Standalone copy of the multicall crate: workspace-inherited keys resolved from the root Cargo.toml. */
export async function stageMulticall(manifest: UsrManifest, dir: string) {
  const crate = join(workspace, manifest.multicall.crate);
  const root = Bun.TOML.parse(await Bun.file(join(workspace, "Cargo.toml")).text()) as {
    workspace: {
      package: Record<string, unknown>;
      dependencies: Record<string, unknown>;
    };
  };
  const toml = (await Bun.file(join(crate, "Cargo.toml")).text())
    .replace(
      /^([\w-]+)\.workspace = true$/gm,
      (_, key: string) => `${key} = ${JSON.stringify(root.workspace.package[key])}`,
    )
    .replace(/^([\w-]+) = \{ workspace = true(.*)\}$/gm, (_, name: string, rest: string) => {
      const dep = root.workspace.dependencies[name];
      const base = typeof dep === "string" ? { version: dep } : (dep as Record<string, unknown>);
      const fields = Object.entries(base)
        .filter(([key]) => key !== "features")
        .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`);
      const features = [
        ...((base.features as string[] | undefined) ?? []),
        ...[...rest.matchAll(/"([^"]+)"/g)].map(m => m[1]!),
      ];
      const optional = rest.includes("optional = true") ? ", optional = true" : "";
      return `${name} = { ${fields.join(", ")}, features = ${JSON.stringify(features)}${optional} }`;
    })
    .replace(/^rust-version = .*\n/m, "")
    .replace(/\n\[lints\]\nworkspace = true\n?/, "\n");
  // Same relative layout as the checkout so `path = "../../vendor/..."` dependencies resolve.
  const out = join(dir, manifest.multicall.crate);
  await cp(join(crate, "src"), join(out, "src"), { recursive: true });
  await Bun.write(join(out, "Cargo.toml"), `${toml}\n[workspace]\n`);
  await Bun.write(join(out, "Cargo.lock"), Bun.file(join(workspace, "Cargo.lock")));
  await Bun.write(join(dir, "features"), manifest.multicall.features.join(","));
  await Bun.write(join(dir, "crate"), manifest.multicall.crate);
  const vendored = new Set([...toml.matchAll(/path = "\.\.\/\.\.\/(vendor\/[^/"]+\/[^/"]+)/g)].map(m => m[1]!));
  for (const tree of vendored)
    await cp(join(workspace, tree), join(dir, tree), {
      recursive: true,
      filter: source => !/[/\\](\.git|target)$/.test(source),
    });
}

export async function planUsr(
  composition: UsrComposition,
  snapshot?: string,
  requestedDesktopSession?: DesktopSession,
) {
  if (snapshot && !/^\d{4}-\d{2}-\d{2}$/.test(snapshot)) throw new Error("Expected --snapshot YYYY-MM-DD");
  const manifest: UsrManifest = await Bun.file(join(here, "manifest.json")).json();
  const profile = await Bun.file(join(workspace, "factory/profile.json")).json();
  const selected = manifest.compositions[composition];
  if (!selected) throw new Error(`Unknown usr composition: ${composition}`);
  if (
    requestedDesktopSession !== undefined &&
    requestedDesktopSession !== "cosmic" &&
    requestedDesktopSession !== "omarchy-hyprland"
  )
    throw new Error("Unknown desktop session.");
  if (requestedDesktopSession && composition !== "desktop")
    throw new Error("A desktop session can only be selected for the desktop composition.");
  const defaultDesktopSession = profile.compositions.desktop.defaultSession as DesktopSession;
  const desktopSession = composition === "desktop" ? (requestedDesktopSession ?? defaultDesktopSession) : null;
  const session = desktopSession ? profile.desktopSessions[desktopSession] : undefined;
  if (composition === "desktop" && !session)
    throw new Error("The desktop composition requires a known desktop session.");
  if (session?.state === "blocked")
    throw new Error(`Desktop session ${desktopSession} is blocked: ${session.blockers.join(" ")}`);
  const components = await Bun.file(join(workspace, manifest.bunos.manifest)).json();
  const bunosComposition: string[] = (components.compositionPackages?.[composition] ?? []).filter(
    (name: string) => !manifest.bunos.unpublished?.[name],
  );
  const chain: string[] = [];
  for (let id: string | undefined = selected.profile; id; id = profile.compositions[id]?.extends) chain.unshift(id);
  const packages = [
    ...new Set([
      ...manifest.basePackages,
      ...chain.flatMap(id => profile.compositions[id].packages as string[]),
      ...selected.packages,
      ...(session?.packages ?? []),
      ...bunosComposition,
    ]),
  ];
  const ownPackages = [...new Glob("*/PKGBUILD").scanSync(join(workspace, manifest.localRepository.packages))].map(
    path => path.split(/[/\\]/)[0]!,
  );
  const localPackages = [...new Set([...ownPackages, ...bunosComposition])];
  const pacmanConf = [
    "[options]",
    "HoldPkg = pacman glibc",
    "Architecture = auto",
    "ParallelDownloads = 8",
    "SigLevel = Required DatabaseOptional",
    "LocalFileSigLevel = Optional",
    "",
    `[${manifest.localRepository.name}]`,
    "SigLevel = Optional TrustAll",
    `Server = file:///job/repo`,
    "",
    ...manifest.repositories.flatMap(repo => {
      const archived = snapshot && manifest.archive.repositories.includes(repo.name);
      const server = archived ? manifest.archive.server.replace("{date}", snapshot.replaceAll("-", "/")) : repo.server;
      return [`[${repo.name}]`, `Server = ${server}`, ""];
    }),
  ].join("\n");
  return {
    manifest,
    composition,
    desktopSession,
    desktopSessionOwner: session?.owner ?? null,
    desktopSessionState: session?.state ?? "not-applicable",
    packages,
    localPackages,
    pacmanConf,
  };
}

function pairs(map: Record<string, string>) {
  return Object.entries(map)
    .map(([name, target]) => `${name}=${target}`)
    .join(" ");
}

async function run(argv: string[], timeoutMs: number, _quiet = false, cwd?: string) {
  const proc = Bun.spawn(argv, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: timeoutMs,
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${argv[0]} exited with ${code}`);
}

function localArtifacts(manifest: UsrManifest, composition: string, job: string) {
  return join(manifest.localArtifacts.replace(/^~/, homedir()), composition, job);
}

async function fetchArtifacts(manifest: UsrManifest, host: string, composition: string, job: string) {
  const local = localArtifacts(manifest, composition, job);
  await mkdir(local, { recursive: true });
  const out = `${manifest.remoteRoot}/${job}/out`;
  const listing = Bun.spawn(["ssh", ...sshOptions, host, `cd ${out} && find . -type f -printf '%s %P\n'`], {
    stdout: "pipe",
    stderr: "inherit",
    timeout: 30_000,
  });
  const text = await new Response(listing.stdout).text();
  if ((await listing.exited) !== 0) throw new Error("Cannot list remote artifacts");
  // Per-file copies with size checks make an interrupted fetch resumable.
  for (const line of text.trim().split("\n")) {
    const [size, name] = line.split(" ", 2) as [string, string];
    const target = join(local, name);
    await mkdir(dirname(target), { recursive: true });
    for (
      let attempt = 1;
      (await Bun.file(target).exists()) ? Bun.file(target).size !== Number(size) : true;
      attempt++
    ) {
      if (attempt > 3) throw new Error(`Cannot fetch ${name}`);
      await run(["scp", ...sshOptions, `${host}:${out}/${name}`, target], manifest.remoteTimeoutSeconds * 1000).catch(
        error => console.error(String(error)),
      );
    }
  }
  return local;
}

interface BuildOptions {
  verity: boolean;
  boot: boolean;
  desktopSession?: DesktopSession;
  snapshot?: string;
  lock?: UsrLock;
}

async function writeLock(
  manifest: UsrManifest,
  composition: UsrComposition,
  desktopSession: DesktopSession | null,
  desktopSessionOwner: string | null,
  desktopSessionState: UsrLock["desktopSessionState"],
  job: string,
  local: string,
  snapshot?: string,
) {
  const rows = (await Bun.file(join(local, "lock.tsv")).text()).trim().split("\n");
  const packages = rows.map(row => {
    const [repository, name, version, file, url, sha256, bytes] = row.split("\t") as string[];
    return {
      repository,
      name,
      version,
      file,
      url,
      sha256,
      bytes: Number(bytes),
    } as UsrLockPackage;
  });
  const lock: UsrLock = {
    schemaVersion: 3,
    kind: "bun-os-usr-lock",
    composition,
    desktopSession,
    desktopSessionOwner,
    desktopSessionState,
    snapshot: snapshot ?? null,
    builderImage: manifest.builderImage,
    kernelSelection: manifest.kernelSelection,
    job,
    packages,
  };
  const lockName = composition === "desktop" ? `desktop-${desktopSession}.json` : `${composition}.json`;
  const path = join(workspace, manifest.lockDirectory, lockName);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    `${JSON.stringify(lock, null, 2)}
`,
  );
  return path;
}

async function build(composition: UsrComposition, host: string, options: BuildOptions) {
  if (options.boot)
    throw new Error(
      "Bootable /usr builds are blocked: select and qualify an explicit kernel composition before enabling boot qualification",
    );
  const snapshot = options.lock ? (options.lock.snapshot ?? undefined) : options.snapshot;
  const { manifest, packages, localPackages, pacmanConf, desktopSession, desktopSessionOwner, desktopSessionState } =
    await planUsr(composition, snapshot, options.desktopSession);
  if (options.lock) {
    if (
      options.lock.schemaVersion !== 3 ||
      options.lock.kind !== "bun-os-usr-lock" ||
      options.lock.composition !== composition ||
      options.lock.desktopSession !== desktopSession ||
      options.lock.desktopSessionOwner !== desktopSessionOwner ||
      options.lock.desktopSessionState !== desktopSessionState ||
      options.lock.kernelSelection?.source !== manifest.kernelSelection.source ||
      options.lock.kernelSelection?.state !== manifest.kernelSelection.state
    )
      throw new Error("USR lock does not match the current composition and kernel-selection contract.");
    if (!Array.isArray(options.lock.packages)) throw new Error("USR lock has no package inventory.");
    if (
      manifest.kernelSelection.state !== "qualified" &&
      options.lock.packages.some(pkg =>
        ["linux-cachyos", "linux-cachyos-headers", "linux-cachyos-nvidia-open"].includes(pkg.name),
      )
    )
      throw new Error("USR lock contains CachyOS kernel packages without a qualified kernel selection.");
  }
  const job = `${composition}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  const remote = `${manifest.remoteRoot}/${job}`;
  const stage = await mkdtemp(join(tmpdir(), "bun-os-usr-"));
  try {
    const keys = manifest.repositories.flatMap(repo => repo.keys ?? []);
    const keyserver = manifest.repositories.find(repo => repo.keyserver)?.keyserver ?? "hkps://keyserver.ubuntu.com";
    const env = {
      KEYS: keys.join(" "),
      KEYSERVER: keyserver,
      FALLBACK_KERNEL: manifest.kernelFallback ?? "",
      BUILDER_PACKAGES: manifest.builderPackages.join(" "),
      USR_DIRS: manifest.hierarchy.usrDirectories.join(" "),
      ROOT_LINKS: pairs(manifest.hierarchy.rootLinks),
      USR_LINKS: pairs(manifest.hierarchy.usrLinks),
      REQUIRED: manifest.hierarchy.required.join(" "),
      EROFS_COMPRESSION: manifest.images.erofsCompression,
      SQUASHFS_COMPRESSION: manifest.images.squashfsCompression,
      VERITY: options.verity ? "1" : "0",
      BOOT: options.boot ? "1" : "0",
      BOOT_TIMEOUT: String(manifest.boot.timeoutSeconds),
      SOURCE_DATE_EPOCH: String(manifest.localRepository.sourceDateEpoch),
      JOB: job,
      BUNOS_PACKAGES: localPackages.join(" "),
      RUST_BASE_PACKAGES: (manifest.rustBase?.packages ?? []).join(" "),
      RUST_BASE_REPO: manifest.rustBase?.repository ?? "",
      RUST_BASE_KEY: manifest.rustBase?.key ?? "",
    };
    await Bun.write(
      join(stage, "env"),
      Object.entries(env)
        .map(([key, value]) => `${key}='${value.replaceAll("'", "")}'`)
        .join("\n") + "\n",
    );
    await Bun.write(join(stage, "pacman.conf"), pacmanConf);
    await Bun.write(join(stage, "packages.txt"), packages.join("\n") + "\n");
    await Bun.write(join(stage, "builder.sh"), Bun.file(join(here, "builder.sh")));
    const uploads = ["env", "pacman.conf", "packages.txt", "builder.sh"];
    if (localPackages.includes("bunos-utils")) {
      await stageMulticall(manifest, join(stage, "bunos-utils-src"));
      uploads.push("bunos-utils-src");
    }
    if (options.lock) {
      const rows = options.lock.packages.map(p =>
        [p.repository, p.name, p.version, p.file, p.url, p.sha256, p.bytes].join("\t"),
      );
      await Bun.write(join(stage, "lock.tsv"), rows.join("\n") + "\n");
      uploads.push("lock.tsv");
    }
    await run(["ssh", ...sshOptions, host, `mkdir -p ${remote}`], 30_000);
    // One tarball: thousands of vendored files make a recursive scp crawl.
    for (const dir of [
      manifest.overlay,
      manifest.localRepository.packages,
      manifest.boot.definitions,
      manifest.bunos.pkgbuilds,
    ])
      await cp(resolve(workspace, dir), join(stage, dir.split("/").pop()!), {
        recursive: true,
      });
    await run(["tar", "-czf", "../job.tgz", "."], 300_000, false, stage);
    await run(["scp", ...sshOptions, join(stage, "../job.tgz"), `${host}:${remote}/job.tgz`], 900_000);
    await rm(join(stage, "../job.tgz"), { force: true });
    await run(["ssh", ...sshOptions, host, `cd ${remote} && tar -xzf job.tgz && rm job.tgz`], 120_000);
    const seconds = manifest.remoteTimeoutSeconds;
    const script = [
      `set -e; mkdir -p ${manifest.remoteRoot}/pkgcache; cd ${remote}`,
      "mv pkgbuilds bunos-pkgs",
      `timeout ${seconds} docker run --rm --privileged --name bun-os-usr-${job} -v ${remote}:/job -v ${manifest.remoteRoot}/pkgcache:/pkgcache ${manifest.builderImage} bash /job/builder.sh > build.log 2>&1 || { tail -40 build.log; exit 1; }`,
      // The builder writes root-owned files into the job directory.
      `docker run --rm -v ${remote}:/job ${manifest.builderImage} rm -rf /job/overlay /job/pkgs /job/boot /job/bunos-pkgs /job/bunos-utils-src`,
      "tail -12 build.log",
    ].join("; ");
    await run(["ssh", ...sshOptions, host, script], (seconds + 120) * 1000);
    const local = await fetchArtifacts(manifest, host, composition, job);
    const lock = await writeLock(
      manifest,
      composition,
      desktopSession,
      desktopSessionOwner,
      desktopSessionState,
      job,
      local,
      snapshot,
    );
    await run(
      [
        "ssh",
        ...sshOptions,
        host,
        `timeout 120 docker run --rm -v ${manifest.remoteRoot}:/w ${manifest.builderImage} rm -rf /w/${job}`,
      ],
      150_000,
    );
    const boot = (await Bun.file(join(local, "boot-result.txt")).exists())
      ? (await Bun.file(join(local, "boot-result.txt")).text()).trim()
      : "skipped";
    return {
      job,
      host,
      local,
      lock,
      composition,
      desktopSession,
      desktopSessionOwner,
      desktopSessionState,
      boot,
      packages,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      composition: { type: "string", default: "server" },
      "desktop-session": { type: "string" },
      host: { type: "string" },
      job: { type: "string" },
      verity: { type: "boolean", default: false },
      "no-boot": { type: "boolean", default: false },
      snapshot: { type: "string" },
      lock: { type: "string" },
    },
  });
  const composition = values.composition as UsrComposition;
  if (!["server", "desktop", "gaming"].includes(composition))
    throw new Error("Expected --composition server|desktop|gaming");
  const desktopSession = values["desktop-session"] as DesktopSession | undefined;
  const action = positionals[0] ?? "plan";
  const plan = await planUsr(composition, values.snapshot, desktopSession);
  const host = values.host ?? plan.manifest.host;
  if (action === "plan")
    return {
      composition,
      host,
      desktopSession: plan.desktopSession,
      desktopSessionOwner: plan.desktopSessionOwner,
      desktopSessionState: plan.desktopSessionState,
      kernelSelection: plan.manifest.kernelSelection,
      packages: plan.packages,
      pacmanConf: plan.pacmanConf,
    };
  if (action === "build")
    return build(composition, host, {
      verity: values.verity!,
      boot: !values["no-boot"],
      desktopSession,
      snapshot: values.snapshot,
      lock: values.lock ? await Bun.file(resolve(values.lock)).json() : undefined,
    });
  if (action === "fetch") {
    if (!values.job) throw new Error("Missing --job");
    return {
      local: await fetchArtifacts(plan.manifest, host, composition, values.job),
    };
  }
  throw new Error("Expected usr plan|build|fetch");
}

if (import.meta.main) console.log(JSON.stringify(await main(Bun.argv.slice(2)), null, 2));
