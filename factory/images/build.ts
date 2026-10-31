// SPDX-License-Identifier: MIT
// `bun factory image plan|fetch|build|status <name> [--target T] [--host HOST] [--job ID]`
// Images build on a Linux Docker host (never WSL); tags stay on that host, nothing is pushed.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { planUsr, type UsrLock } from "../usr/build.ts";
import type { DesktopSession } from "../arch/index.ts";
import { stageAlpineRuntime } from "./runtime.ts";
import type { RuntimePin } from "@aphrody/bun-workspace";
import { planOmarchyCandidate } from "./bunos-omarchy/stage.ts";

const here = import.meta.dir;
const sshOptions = ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"];
type Kind = "image" | "rootfs";
interface AgentTooling {
  packages: string[];
  skills: {
    name: string;
    source?: string;
    repo?: string;
    commit?: string;
    path?: string;
  }[];
  mcpServers: {
    name: string;
    command: string[];
    source?: string;
    env?: Record<string, string>;
  }[];
}
interface ImageSpec {
  prepare?: "omarchy-rootfs";
  usrComposition?: "server" | "desktop" | "gaming";
  desktopSession?: DesktopSession;
  agentTooling?: AgentTooling;
  platforms: string[];
  targets: Record<string, Kind>;
  blockedTargets?: Record<string, string>;
  /** Repository paths copied into the build context (relative to the workspace root). */
  repoInputs?: { from: string; to: string }[];
  /** Files or directories on the Docker host copied into the context before the build. */
  hostInputs?: { from: string; to: string; optional?: boolean; checksum?: "sibling-sha256" }[];
}
interface Pin {
  version: string;
  file?: string;
  url?: string;
  sha256?: string;
  [key: string]: unknown;
}
interface ImagesManifest {
  host: string;
  remoteRoot: string;
  remoteTimeoutSeconds: number;
  sources: string;
  pins: Record<string, Pin>;
  images: Record<string, ImageSpec>;
}

const manifest: ImagesManifest = await Bun.file(join(here, "manifest.json")).json();
const archProfile = (await Bun.file(join(here, "../profile.json")).json()) as {
  bootstrapImage: string;
};
const sourcesDir = manifest.sources.replace(/^~/, homedir());
const factoryConfig = (await Bun.file(
  Bun.env.APHRODY_FACTORY_CONFIG ?? join(here, "../../tools/aphrody/config/build-factory.json"),
).json()) as { lockPath: string };
if (!/^\/[A-Za-z0-9/_.-]+$/.test(factoryConfig.lockPath))
  throw new Error("The image factory requires an absolute VPS factory lock path.");

function spec(name: string) {
  const image = manifest.images[name];
  if (!image) throw new Error(`Unknown image ${name}; expected ${Object.keys(manifest.images).join("|")}`);
  return image;
}

function buildArgs(name: string): Record<string, string> {
  const { pins } = manifest;
  const bun = pins.bun!;
  const common = { BUN_VERSION: bun.version };
  if (name === "bunos-gaming") {
    return {
      ...common,
      ARCH_BOOTSTRAP_IMAGE: archProfile.bootstrapImage,
    };
  }
  if (name === "bunos-alpine") {
    return { ALPINE_VERSION: pins.alpine.version };
  }
  if (name === "bunos-ubuntu") {
    const kernel = pins["ubuntu-kernel"] as Pin & Record<"image" | "modules", { file: string; sha256: string }>;
    return {
      ...common,
      BUN_URL: bun.url!,
      BUN_SHA256_AMD64: bun.sha256!,
      BUN_LICENSE_URL: bun.licenseUrl as string,
      BUN_LICENSE_SHA256: bun.licenseSha256 as string,
      UBUNTU_VERSION: pins.ubuntu.version,
      UBUNTU_BASE_SHA256: pins.ubuntu.sha256!,
      COSMIC_APT_SERVER: (pins.cosmic.apt as Record<string, string>).server!,
      COSMIC_APT_SUITE: (pins.cosmic.apt as Record<string, string>).suite!,
      COSMIC_APT_KEY: (pins.cosmic.apt as Record<string, string>).key!,
      KERNEL_BASE_URL: kernel.baseUrl as string,
      KERNEL_IMAGE_DEB: kernel.image.file,
      KERNEL_IMAGE_SHA256: kernel.image.sha256,
      KERNEL_MODULES_DEB: kernel.modules.file,
      KERNEL_MODULES_SHA256: kernel.modules.sha256,
    };
  }
  if (name === "bunos-unified") {
    const pop = pins.cosmic.apt as Record<string, string>;
    return {
      ...common,
      UBUNTU_IMAGE: String(pins["ubuntu-lts"]!.image),
      BUN_URL: bun.url!,
      BUN_SHA256_AMD64: bun.sha256!,
      BUN_LICENSE_URL: bun.licenseUrl as string,
      BUN_LICENSE_SHA256: bun.licenseSha256 as string,
      HELIUM_URL: pins.helium!.url!,
      HELIUM_SHA256: pins.helium!.sha256!,
      POP_APT_SERVER: pop.server!,
      POP_APT_SUITE: pop.suite!,
      POP_APT_KEY: pop.key!,
      WAYDROID_APT_KEY: String(pins["waydroid-apt"]!.key),
    };
  }
  return common;
}

/** Generated inputs reused from the /usr factory: its pacman.conf, keys and composition package set. */
async function generated(name: string, requestedDesktopSession?: DesktopSession) {
  const image = spec(name);
  if (image.prepare === "omarchy-rootfs")
    return {
      desktopSession: "omarchy-hyprland",
      desktopSessionOwner: "factory/images/bunos-omarchy/guest-inputs.json",
      desktopSessionState: "unqualified",
    };
  if (name === "bunos-omarchy") {
    if (requestedDesktopSession && requestedDesktopSession !== "omarchy-hyprland")
      throw new Error("The Omarchy candidate requires its Hyprland session.");
    return {
      repo: undefined,
      missingRepo: undefined,
      ...planOmarchyCandidate(
        archProfile,
        await Bun.file(join(here, "../usr/manifest.json")).json(),
        await Bun.file(join(here, "../arch/omarchy/integration.json")).json(),
      ),
    };
  }
  const composition = image.usrComposition;
  if (!composition) {
    if (requestedDesktopSession)
      throw new Error("A desktop session requires an image with a desktop /usr composition.");
    return {};
  }
  if (image.desktopSession && requestedDesktopSession && image.desktopSession !== requestedDesktopSession)
    throw new Error(`Image ${name} fixes desktop session ${image.desktopSession}.`);
  const selectedSession = requestedDesktopSession ?? image.desktopSession;
  const initialUsr = await planUsr(composition, undefined, selectedSession);
  const lockName =
    composition === "desktop" ? `desktop-${selectedSession ?? initialUsr.desktopSession}.json` : `${composition}.json`;
  const lockPath = join(workspace, initialUsr.manifest.lockDirectory, lockName);
  if (!(await Bun.file(lockPath).exists()))
    return {
      missingRepo: `No ${composition} /usr package lock at ${lockPath}; build and qualify the /usr composition first.`,
    };
  const usrLock = (await Bun.file(lockPath).json()) as UsrLock;
  if (
    usrLock.schemaVersion !== 3 ||
    usrLock.kind !== "bun-os-usr-lock" ||
    usrLock.composition !== composition ||
    usrLock.desktopSession !== initialUsr.desktopSession ||
    usrLock.desktopSessionState !== initialUsr.desktopSessionState ||
    usrLock.builderImage !== initialUsr.manifest.builderImage ||
    !new RegExp(`^${composition}-[0-9]{8}T[0-9]{6}$`).test(usrLock.job) ||
    !Array.isArray(usrLock.packages)
  )
    throw new Error(
      `The ${composition} /usr package lock does not match the current factory profile. Rebuild and qualify /usr.`,
    );
  const usr = usrLock.snapshot === null ? initialUsr : await planUsr(composition, usrLock.snapshot, selectedSession);
  const bootOnly = new Set(["linux-cachyos", "linux-firmware", usr.manifest.kernelFallback].filter(Boolean));
  const keys = usr.manifest.repositories.flatMap(repo =>
    (repo.keys ?? []).map(key => `${key}@${(repo.keyserver ?? "keyserver.ubuntu.com").replace(/^hkps:\/\//, "")}`),
  );
  // The source-bound /usr lock selects the exact local package artifact job.
  const artifactRoot = usr.manifest.localArtifacts.replace(/^~/, homedir());
  const artifacts = join(artifactRoot, composition, usrLock.job);
  const repo = join(artifacts, "repo");
  const localPackages = usrLock.packages.filter(pkg => pkg.repository === usr.manifest.localRepository.name);
  if (!localPackages.length) throw new Error(`The ${composition} /usr lock has no local Bun OS packages.`);
  for (const pkg of localPackages) {
    if (!/^[A-Za-z0-9@._+-]+\.pkg\.tar\.zst$/.test(pkg.file))
      throw new Error(`Invalid local package filename in /usr lock: ${pkg.file}`);
    const path = join(repo, pkg.file);
    const file = Bun.file(path);
    if (!(await file.exists()) || file.size !== pkg.bytes || (await sha256(path)) !== pkg.sha256)
      throw new Error(
        `Local package ${pkg.name} does not match the ${composition} /usr lock; rebuild and qualify /usr.`,
      );
  }
  return {
    repo,
    files: {
      "pacman.conf": usr.pacmanConf.replace("file:///job/repo", "file:///var/lib/bun-os/repo"),
      "usr.packages": usr.packages.filter(pkg => !bootOnly.has(pkg)).join("\n") + "\n",
    },
    args: { PACMAN_KEYS: keys.join(" ") },
    desktopSession: usr.desktopSession,
    desktopSessionOwner: usr.desktopSessionOwner,
    desktopSessionState: usr.desktopSessionState,
  };
}

export async function planImage(name: string, desktopSession?: DesktopSession) {
  const image = spec(name);
  const extra = await generated(name, desktopSession);
  const blockedTargets = image.blockedTargets ?? {};
  return {
    name,
    ...image,
    targetBlockers: blockedTargets,
    desktopSession: extra.desktopSession ?? image.desktopSession ?? null,
    desktopSessionOwner: extra.desktopSessionOwner ?? null,
    desktopSessionState: extra.desktopSessionState ?? "not-applicable",
    buildArgs: { ...buildArgs(name), ...extra.args },
    generated: Object.keys(extra.files ?? {}),
    missingRepo: extra.missingRepo,
  };
}

const workspace = join(here, "../..");
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Stage agentTooling: local skills and MCP sources, pinned clones, Claude Code and Codex configs for /etc/skel. */
async function stageAgentTooling(dir: string, tooling: AgentTooling) {
  await mkdir(join(dir, "skills"), { recursive: true });
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "a=/usr/share/bun-os/agent",
    "s=/usr/share/bun-os/skills",
    'install -d "$s"',
  ];
  for (const skill of tooling.skills) {
    if (skill.source) {
      await cp(join(workspace, skill.source), join(dir, "skills", skill.name), {
        recursive: true,
      });
      script.push(`cp -a "$a/skills/${skill.name}" "$s/${skill.name}"`);
    } else if (skill.repo && skill.commit) {
      const tmp = `/tmp/skill-${skill.name}`;
      script.push(
        `git init -q ${tmp} && git -C ${tmp} fetch -q --depth 1 ${quote(skill.repo)} ${skill.commit} && git -C ${tmp} checkout -q FETCH_HEAD`,
        `install -d "$s/${skill.name}" && cp -a ${tmp}/${skill.path ?? "."}/. "$s/${skill.name}/"`,
        `rm -rf "$s/${skill.name}/.git" ${tmp}`,
      );
    }
  }
  for (const server of tooling.mcpServers)
    if (server.source) {
      await cp(join(workspace, server.source), join(dir, server.name), {
        recursive: true,
        filter: src => !/node_modules/.test(src),
      });
      script.push(`cp -a "$a/${server.name}" /usr/share/bun-os/${server.source.split("/").pop()}`);
    }
  const mcpServers = Object.fromEntries(
    tooling.mcpServers.map(({ name, command: [command, ...args], env }) => [
      name,
      { command, args, ...(env ? { env } : {}) },
    ]),
  );
  await Bun.write(join(dir, "claude.json"), JSON.stringify({ mcpServers }, null, 2) + "\n");
  const toml = (value: string) => JSON.stringify(value);
  const codex = tooling.mcpServers.flatMap(({ name, command: [command, ...args], env }) => [
    `[mcp_servers.${toml(name)}]`,
    `command = ${toml(command!)}`,
    `args = [${args.map(toml).join(", ")}]`,
    ...(env
      ? [
          `env = { ${Object.entries(env)
            .map(([k, v]) => `${k} = ${toml(v)}`)
            .join(", ")} }`,
        ]
      : []),
    "",
  ]);
  await Bun.write(join(dir, "codex.toml"), codex.join("\n"));
  await Bun.write(join(dir, "agent.packages"), tooling.packages.join("\n") + "\nuv\n");
  script.push(
    'bunos-install-packages "$a/agent.packages"',
    "install -d /etc/skel/.claude /etc/skel/.codex",
    'cp -a "$s" /etc/skel/.claude/skills && cp -a "$s" /etc/skel/.codex/skills',
    'install -m644 "$a/claude.json" /etc/skel/.claude.json && install -m644 "$a/claude.json" /etc/skel/.claude/mcp.json',
    'install -m644 "$a/codex.toml" /etc/skel/.codex/config.toml',
  );
  await Bun.write(join(dir, "install.sh"), script.join("\n") + "\n");
}

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

export async function fetchSources() {
  await mkdir(sourcesDir, { recursive: true });
  const results: Record<string, string> = {};
  for (const [id, pin] of Object.entries(manifest.pins)) {
    const entries: [string, string, string][] = [];
    if (pin.file && pin.url && pin.sha256) entries.push([pin.file, pin.url, pin.sha256]);
    for (const part of ["image", "modules"] as const) {
      const deb = pin[part] as { file: string; sha256: string } | undefined;
      if (deb) entries.push([deb.file, `${pin.baseUrl}/${deb.file}`, deb.sha256]);
    }
    for (const [asset, digest] of Object.entries((pin.assets as Record<string, string>) ?? {}))
      entries.push([`bun-${pin.version}-${asset}`, `${pin.url}${asset}`, digest]);
    for (const [file, url, digest] of entries) {
      const path = join(sourcesDir, file);
      if (!(await Bun.file(path).exists())) {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(900_000),
        });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        await Bun.write(path, response);
      }
      const actual = await sha256(path);
      if (actual !== digest) throw new Error(`${id} ${file}: sha256 ${actual} != ${digest}`);
      results[file] = digest;
    }
  }
  return { sources: sourcesDir, verified: results };
}

async function run(argv: string[], timeoutMs: number, capture = false, cwd?: string) {
  const proc = Bun.spawn(argv, {
    cwd,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    timeout: timeoutMs,
  });
  const out = capture ? await new Response(proc.stdout as ReadableStream).text() : "";
  if ((await proc.exited) !== 0) throw new Error(`${argv[0]} exited with ${proc.exitCode}`);
  return out;
}

function remoteScript(name: string, image: ImageSpec, targets: string[], args: Record<string, string>) {
  const flags = Object.entries(args)
    .map(([key, value]) => `--build-arg ${key}='${value.replaceAll("'", "")}'`)
    .join(" ");
  const lines = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'cd "$(dirname "$0")"',
    // Any free factory slot (heavy.lock, heavy.1.lock, heavy.2.lock), else wait for the primary one.
    `slot=; for f in '${factoryConfig.lockPath}' '${factoryConfig.lockPath.replace(/\.lock$/, ".1.lock")}' '${factoryConfig.lockPath.replace(/\.lock$/, ".2.lock")}'; do exec 9>"$f"; if flock -n 9; then slot=$f; break; fi; exec 9>&-; done`,
    `[ -n "$slot" ] || { exec 9>'${factoryConfig.lockPath}'; flock 9; }`,
    "mkdir -p out",
    ": >status",
  ];
  if (image.prepare === "omarchy-rootfs")
    lines.push(`bun context/import.ts prepare "$PWD" '${manifest.remoteRoot}' || exit $?`);
  for (const input of image.hostInputs ?? []) {
    if (!/^\/[A-Za-z0-9/_.-]+$/.test(input.from) || !/^[A-Za-z0-9/_.-]+$/.test(input.to) || input.to.includes(".."))
      throw new Error(`Invalid host input ${input.from} -> ${input.to}`);
    const dest = `context/${input.to}`;
    const missing = input.optional
      ? `mkdir -p '${dest}'`
      : `{ echo "missing host input ${input.from}" >>status; echo done >>status; exit 1; }`;
    lines.push(
      `if [ -e '${input.from}' ]; then mkdir -p "$(dirname '${dest}')"; ` +
        `if [ -d '${input.from}' ]; then mkdir -p '${dest}' && tar -C '${input.from}' --exclude=.git -cf - . | tar -C '${dest}' -xf -; ` +
        `else cp -L '${input.from}' '${dest}'; fi; else ${missing}; fi`,
    );
    if (input.checksum === "sibling-sha256")
      lines.push(
        `real=$(realpath '${input.from}'); [ "$(sha256sum '${dest}' | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$real.sha256")" ] || { echo "checksum mismatch ${input.from}" >>status; echo done >>status; exit 1; }`,
      );
  }
  const containerfile = image.prepare === "omarchy-rootfs" ? "context/import.Containerfile" : "context/Containerfile";
  for (const target of targets) {
    const tag = `${name}:${target}`;
    const base = `docker buildx build --progress=plain --platform ${image.platforms.join(",")} --target ${target} ${flags} -f ${containerfile} context`;
    lines.push(`echo "== ${tag}"`);
    const rootfs =
      image.targets[target] === "rootfs"
        ? ` && { ${base} --output type=tar,dest=out/${name}-${target}-rootfs.tar && zstd -T4 -19 --long --rm -f out/${name}-${target}-rootfs.tar && echo "${name}-${target}-rootfs.tar.zst ok" >>status || echo "${name}-${target}-rootfs failed" >>status; }`
        : "";
    lines.push(
      `${base} --output type=image,name=docker.io/library/${tag},compression=zstd,compression-level=19,force-compression=true,oci-mediatypes=true && echo "${tag} ok" >>status${rootfs} || echo "${tag} failed" >>status`,
    );
  }
  lines.push(
    "docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep '^" + name + ":' >>status",
    "echo done >>status",
  );
  return lines.join("\n") + "\n";
}

async function build(
  name: string,
  host: string,
  only?: string,
  runtimes?: string,
  platform?: string,
  desktopSession?: DesktopSession,
) {
  const declared = spec(name);
  const platforms = platform ? platform.split(",") : declared.platforms;
  if (!platforms.length || platforms.some(value => !declared.platforms.includes(value)))
    throw new Error("Image platform must be one of the declared target platforms");
  const image = { ...declared, platforms };
  if (name === "bunos-alpine" && !runtimes)
    throw new Error("Alpine requires --runtimes JSON with qualified Aphrody fork musl binaries; no upstream fallback");
  const targets = only ? [only] : Object.keys(image.targets).filter(target => !image.blockedTargets?.[target]);
  for (const target of targets) if (!image.targets[target]) throw new Error(`Unknown target ${target} for ${name}`);
  for (const target of targets)
    if (image.blockedTargets?.[target])
      throw new Error(`${name}:${target} is blocked: ${image.blockedTargets[target]}`);
  const extra = await generated(name, desktopSession);
  const args = { ...buildArgs(name), ...extra.args };
  const job = `${name}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  const remote = `${manifest.remoteRoot}/${job}`;
  const stage = await mkdtemp(join(tmpdir(), "bun-os-image-"));
  try {
    await cp(join(here, name), join(stage, "context"), { recursive: true });
    for (const input of image.repoInputs ?? [])
      await cp(join(workspace, input.from), join(stage, "context", input.to), { recursive: true });
    if (name === "bunos-alpine") {
      const runtimeFile = resolve(runtimes!);
      const inputs = (await Bun.file(runtimeFile).json()) as {
        schemaVersion: number;
        runtimes: Record<string, { binary: string; receipt: string }>;
      };
      if (inputs.schemaVersion !== 1 || !inputs.runtimes) throw new Error("Invalid Alpine runtime inputs");
      const pin = manifest.pins["bun-musl"]!;
      const expected: RuntimePin = {
        repository: String(pin.repository),
        version: pin.version,
        revision: String(pin.revision),
      };
      for (const target of platforms) {
        const architecture = target === "linux/amd64" ? "amd64" : "arm64";
        const input = inputs.runtimes[architecture];
        if (!input || typeof input.binary !== "string" || typeof input.receipt !== "string")
          throw new Error(`Missing qualified Alpine runtime for ${architecture}`);
        await stageAlpineRuntime(
          join(stage, "context"),
          architecture,
          resolve(dirname(runtimeFile), input.binary),
          resolve(dirname(runtimeFile), input.receipt),
          expected,
        );
      }
    }
    if (image.agentTooling) await stageAgentTooling(join(stage, "context", "agent"), image.agentTooling);
    if (extra.missingRepo) throw new Error(extra.missingRepo);
    if (extra.repo)
      await cp(extra.repo, join(stage, "context", "bunos-repo"), {
        recursive: true,
      });
    for (const [file, content] of Object.entries(extra.files ?? {}))
      await Bun.write(join(stage, "context", file), content);
    await Bun.write(join(stage, "build.sh"), remoteScript(name, image, targets, args));
    await run(["ssh", ...sshOptions, host, `mkdir -p ${remote}`], 30_000);
    await run(["scp", ...sshOptions, "-r", "context", "build.sh", `${host}:${remote}/`], 120_000, false, stage);
    const seconds = manifest.remoteTimeoutSeconds;
    await run(
      [
        "ssh",
        ...sshOptions,
        host,
        `cd ${remote} || exit 1; setsid nohup timeout ${seconds} bash build.sh >build.log 2>&1 </dev/null & echo started`,
      ],
      30_000,
    );
    return {
      name,
      job,
      host,
      remote,
      targets,
      desktopSession: extra.desktopSession ?? null,
      desktopSessionOwner: extra.desktopSessionOwner ?? null,
      desktopSessionState: extra.desktopSessionState ?? "not-applicable",
      status: `bun factory image status ${name} --job ${job}`,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function status(host: string, job: string) {
  const remote = `${manifest.remoteRoot}/${job}`;
  const out = await run(
    ["ssh", ...sshOptions, host, `cd ${remote} && cat status; echo ---; tail -15 build.log; ls -la out`],
    30_000,
    true,
  );
  return { job, host, remote, report: out.split("\n") };
}

export async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      "desktop-session": { type: "string" },
      host: { type: "string" },
      job: { type: "string" },
      runtimes: { type: "string" },
      platform: { type: "string" },
    },
  });
  const [action = "plan", name] = positionals;
  const host = values.host ?? manifest.host;
  if (action === "fetch") return fetchSources();
  if (!name) throw new Error(`Expected image name: ${Object.keys(manifest.images).join("|")}`);
  const desktopSession = values["desktop-session"] as DesktopSession | undefined;
  if (action === "plan") return planImage(name, desktopSession);
  if (action === "build") return build(name, host, values.target, values.runtimes, values.platform, desktopSession);
  if (action === "status") {
    if (!values.job) throw new Error("Missing --job");
    return status(host, values.job);
  }
  throw new Error("Expected image plan|fetch|build|status");
}

if (import.meta.main) console.log(JSON.stringify(await main(Bun.argv.slice(2)), null, 2));
