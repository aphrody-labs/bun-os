#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun OS Rust base factory (docs/RUST-BASE.md). One command builds, publishes and qualifies the Rust replacements
// that every Bun OS image installs by default. Builds run on the VPS only, through cargo-serial with four jobs.
//   bun factory/rustbase/rust-base.ts status              gitlinks and .gitmodules against forks.json
//   bun factory/rustbase/rust-base.ts build [name...]     fetch each pinned fork commit, cargo-serial build, stage
//   bun factory/rustbase/rust-base.ts debs                Ubuntu 26.04 debs (same names as the archive) into ~/native-apps/debs
//   bun factory/rustbase/rust-base.ts publish             build, debs, then the pacman and apt repositories on aphrody.com/repo
//   bun factory/rustbase/rust-base.ts qualify             session containers (Arch, Ubuntu 26.04) and a crosvm KVM boot
//   bun factory/rustbase/rust-base.ts all                 build, publish, qualify
// Package names root `bun run factory:rust-base <command>`.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface Component {
  path: string | null;
  fork: string;
  upstream: string;
  ref: string;
  sha?: string;
  tag?: string;
  version?: string;
  replaces: string;
  consumers: string[];
  package?: string;
  submodules?: string[];
  state?: string;
  build?: { cargo: string[]; bins: string[]; licenses: string[]; files?: string[]; pkgbuild: string };
}

export const ROOT = resolve(import.meta.dir, "../..");
export const FORKS = (await Bun.file(join(import.meta.dir, "forks.json")).json()) as {
  components: Record<string, Component>;
};
export const WORK = Bun.env.RUST_BASE_WORK ?? join(Bun.env.HOME ?? "/home/ubuntu", "build/rust-base");
/** Packages published by this factory, in install order. bunos-utils is the root-workspace multicall. */
export const PACKAGES = ["bunos-utils", "bunos-sudo-rs", "bunos-ntpd-rs", "bunos-crosvm"];
const HOURS = 3_600_000;

async function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}) {
  const p = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: { ...Bun.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeout ?? HOURS,
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}
async function must(label: string, cmd: string[], opts: Parameters<typeof sh>[1] = {}) {
  const r = await sh(cmd, opts);
  if (r.code !== 0) throw new Error(`${label} failed (${r.code}): ${r.out.trim().split("\n").slice(-12).join("\n")}`);
  return r.out;
}

/** Pinned commit of a component: forks.json sha, else the gitlink of its submodule path. */
export async function pin(name: string): Promise<string> {
  const c = FORKS.components[name];
  if (!c) throw new Error(`unknown component ${name}`);
  if (c.sha) return c.sha;
  if (!c.path) throw new Error(`${name} has no path and no sha`);
  const line = await must("git ls-tree", ["git", "ls-tree", "HEAD", c.path]);
  const sha = /^160000 commit ([0-9a-f]{40})/.exec(line)?.[1];
  if (!sha) throw new Error(`${c.path} is not a gitlink`);
  return sha;
}

/** cargo-serial with four jobs. The shared factory lease gives up after 30 minutes; a busy factory is waited for again. */
async function cargoSerial(label: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  let r = { code: 1, out: "" };
  for (let attempt = 0; attempt < 24; attempt++) {
    r = await sh(["bash", join(ROOT, "scripts/aphrody/build/rust/cargo-serial.sh"), ...args], {
      cwd,
      timeout: 6 * HOURS,
      env: { APHRODY_BUILD_HOST: "vps", APHRODY_CARGO_JOBS: "4", CARGO_BUILD_JOBS: "4", APHRODY_CARGO_LOCK_TIMEOUT_SECS: "10800", MAKEFLAGS: "-j4", ...env },
    });
    if (r.code === 0 || !/lease was not acquired|Timed out waiting|failed to get lock|flock|timeout/i.test(r.out.split("\n").slice(-5).join("\n"))) break;
    console.log(`rust-base: ${label}: factory busy, waiting again (${attempt + 1}/24)`);
  }
  if (r.code !== 0) throw new Error(`cargo ${label}: ${r.out.trim().split("\n").slice(-15).join("\n")}`);
}

/** Fetch, build with cargo-serial (4 jobs) and stage target/release/<bin> plus licences under WORK/out/<name>. */
export async function buildComponent(name: string): Promise<string> {
  if (process.platform !== "linux") throw new Error("The Rust base builds on the VPS");
  const c = FORKS.components[name]!;
  if (!c.build) throw new Error(`${name} has no build recipe`);
  const sha = await pin(name);
  const src = join(WORK, "src", name);
  await mkdir(src, { recursive: true });
  const fetch = `set -e; cd "$1"; [ -d .git ] || git init -q; git remote add origin "https://github.com/$2.git" 2>/dev/null || git remote set-url origin "https://github.com/$2.git"
if [ "$(git rev-parse HEAD 2>/dev/null)" != "$3" ]; then git fetch -q --depth 1 origin "$3"; git checkout -q --force FETCH_HEAD; fi
${c.submodules?.length ? `git submodule update -q --init --recursive --depth 1 ${c.submodules.join(" ")} || git submodule update -q --init --recursive ${c.submodules.join(" ")}` : ":"}`;
  await must(`fetch ${name}`, ["bash", "-c", fetch, "_", src, c.fork, sha], { timeout: 2 * HOURS });
  const target = join(WORK, "target", name);
  const t = Date.now();
  await cargoSerial(name, c.build.cargo, src, { CARGO_TARGET_DIR: target });
  const out = join(WORK, "out", name);
  await rm(out, { recursive: true, force: true });
  for (const bin of c.build.bins) {
    await mkdir(join(out, "target/release"), { recursive: true });
    await cp(join(target, "release", bin), join(out, "target/release", bin));
  }
  for (const f of [...c.build.licenses, ...(c.build.files ?? [])]) {
    await mkdir(dirname(join(out, name, f)), { recursive: true });
    await cp(join(src, f), join(out, name, f), { recursive: true });
  }
  await Bun.write(
    join(out, "receipt.json"),
    JSON.stringify(
      {
        component: name,
        fork: c.fork,
        sha,
        cargo: c.build.cargo,
        jobs: 4,
        seconds: Math.round((Date.now() - t) / 1000),
        builtAt: new Date().toISOString(),
        bins: c.build.bins,
      },
      null,
      2,
    ),
  );
  await Bun.write(join(out, "sha"), sha);
  await Bun.write(join(out, "version"), c.version ?? `0~git${sha.slice(0, 12)}`);
  console.log(`rust-base: ${name} ${sha.slice(0, 12)} built in ${Math.round((Date.now() - t) / 1000)} s`);
  return out;
}

/** The uutils multicall (crates/bunos-utils, root workspace) staged like a component for the deb form and the guest. */
export async function buildUtils(): Promise<string> {
  const m = (await Bun.file(join(ROOT, "factory/usr/manifest.json")).json()) as {
    multicall: { features: string[]; target: string };
  };
  const t = Date.now();
  await cargoSerial("bunos-utils", ["build", "--release", "--locked", "-p", "bunos-utils", "--target", m.multicall.target, "--features", m.multicall.features.join(",")], ROOT);
  const out = join(WORK, "out", "bunos-utils");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "target/release"), { recursive: true });
  await mkdir(join(out, "licenses"), { recursive: true });
  await cp(join(ROOT, "target", m.multicall.target, "release/bunos-utils"), join(out, "target/release/bunos-utils"));
  for (const suite of ["coreutils", "findutils", "diffutils", "procps", "util-linux"])
    for (const f of new Bun.Glob("LICENSE*").scanSync(join(ROOT, "vendor/uutils", suite)))
      await cp(join(ROOT, "vendor/uutils", suite, f), join(out, "licenses", `${suite}-${f}`));
  const version =
    /^version\s*=\s*"([^"]+)"/m.exec(await Bun.file(join(ROOT, "vendor/uutils/coreutils/Cargo.toml")).text())?.[1] ??
    "0";
  await Bun.write(join(out, "version"), version);
  await Bun.write(join(out, "sha"), await pin("uutils-coreutils"));
  console.log(`rust-base: bunos-utils (uutils ${version}) built in ${Math.round((Date.now() - t) / 1000)} s`);
  return out;
}

/** Ubuntu 26.04 debs (factory/rustbase/deb-build.sh) into ~/native-apps/debs, which the unified image installs. */
export async function buildDebs() {
  const debs = Bun.env.APHRODY_NATIVE_DEBS ?? join(Bun.env.HOME ?? "/home/ubuntu", "native-apps/debs");
  await mkdir(debs, { recursive: true });
  const out = await must(
    "deb-build",
    [
      "docker",
      "run",
      "--rm",
      "-v",
      `${join(WORK, "out")}:/out:ro`,
      "-v",
      `${debs}:/debs`,
      "-v",
      `${join(import.meta.dir, "deb-build.sh")}:/deb-build.sh:ro`,
      "ubuntu:26.04",
      "bash",
      "/deb-build.sh",
    ],
    { timeout: HOURS },
  );
  console.log(out.trim());
}

/** Store pacman prebuild hooks (apps/webos/store/pacman.ts): the staged tree stands in for the git checkout. */
export const PREBUILD = Object.fromEntries(
  Object.entries(FORKS.components)
    .filter(([, c]) => c.build && c.package)
    .map(([name, c]) => [
      c.package!,
      {
        compile: async () => void (await buildComponent(name)),
        tree: {
          name,
          files: () => [] as string[],
          async extra(_ctx: unknown, dir: string) {
            const out = join(WORK, "out", name);
            await cp(join(out, name), dir, { recursive: true });
            await cp(join(out, "target"), join(dir, "..", "target"), { recursive: true });
          },
        },
      },
    ]),
);
export const PKGBUILDS = Object.values(FORKS.components).flatMap(c => (c.build && c.package ? [c.build.pkgbuild] : []));

async function status() {
  const modules = await sh(["git", "config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.(path|url)$"]);
  let bad = 0;
  for (const [name, c] of Object.entries(FORKS.components)) {
    if (!c.path || c.path.includes("cosmic-epoch/")) continue;
    const line = (await sh(["git", "ls-tree", "HEAD", c.path])).out;
    const link = /^160000 commit ([0-9a-f]{40})/.exec(line)?.[1];
    const url = new RegExp(`submodule\\.${c.path.replace(/[/.]/g, "\\$&")}\\.url (\\S+)`).exec(modules.out)?.[1];
    const ok = !!link && (!c.sha || c.sha === link) && !!url && url.includes(c.fork.split(" ")[0]!);
    if (!ok) bad++;
    console.log(
      `${ok ? "ok  " : "BAD "} ${name.padEnd(22)} ${c.path.padEnd(30)} ${link?.slice(0, 12) ?? "no gitlink"} ${url ?? "no .gitmodules entry"}`,
    );
  }
  if (bad) process.exitCode = 1;
}

async function publish() {
  await buildUtils();
  for (const [n, c] of Object.entries(FORKS.components)) if (c.build) await buildComponent(n);
  await buildDebs();
  const env = { PACMAN_ONLY: PACKAGES.join(",") };
  await must("store pacman", ["bun", "apps/webos/store/cli.ts", "build", "pacman"], { env, timeout: 12 * HOURS }).then(
    o => console.log(o.trim().split("\n").slice(-12).join("\n")),
  );
  await must("store apt", ["bun", "apps/webos/store/cli.ts", "build", "apt"], { timeout: 2 * HOURS }).then(o =>
    console.log(o.trim().split("\n").slice(-6).join("\n")),
  );
}

async function qualify() {
  const origin = Bun.env.STORE_ORIGIN ?? "https://aphrody.com";
  const checks = `set -e
for c in "ls --version" "cat --version" "find --version" "diff --version" "sudo --version" "ntp-ctl --version" "crosvm version"; do echo "\\$ $c"; $c 2>&1 | head -2; done
ls --version | grep -q uutils
find --version | grep -qi uutils
sudo --version | grep -q sudo-rs
ntp-ctl --version | grep -qi ntp`;
  const arch = `set -eu
curl -fsS ${origin}/repo/os/aphrody.gpg -o /tmp/k.gpg
pacman-key --init >/dev/null 2>&1; pacman-key --populate archlinux >/dev/null 2>&1
FPR=$(gpg --show-keys --with-colons /tmp/k.gpg | awk -F: '/^fpr/{print $10; exit}')
pacman-key --add /tmp/k.gpg >/dev/null 2>&1; pacman-key --lsign-key "$FPR" >/dev/null 2>&1
printf '\\n[aphrody]\\nSigLevel = Required DatabaseRequired\\nServer = ${origin}/repo/os/$arch\\n' >> /etc/pacman.conf
pacman -Sy --noconfirm >/dev/null
yes | pacman -S --ask 4 ${PACKAGES.map(p => `aphrody/${p}`).join(" ")} >/dev/null
pacman -Q ${PACKAGES.join(" ")}
${checks}`;
  const results: { name: string; ok: boolean; log: string }[] = [];
  const run = async (name: string, image: string, script: string) => {
    const r = await sh(["docker", "run", "--rm", image, "bash", "-c", script], { timeout: HOURS });
    results.push({ name, ok: r.code === 0, log: r.out.trim().split("\n").slice(-30).join("\n") });
    console.log(`== ${name}: ${r.code === 0 ? "pass" : "FAIL"}\n${results.at(-1)!.log}`);
  };
  await run("arch session container (pacman, aphrody repo)", "archlinux:latest", arch);
  const ubuntu = `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq ca-certificates curl >/dev/null
curl -fsS ${origin}/repo/apt/aphrody-apt.gpg -o /usr/share/keyrings/aphrody-apt.gpg
echo "deb [signed-by=/usr/share/keyrings/aphrody-apt.gpg] ${origin}/repo/apt resolute main" > /etc/apt/sources.list.d/aphrody.list
apt-get update -qq >/dev/null
apt-get install -y -qq rust-coreutils rust-findutils rust-diffutils sudo-rs ntpd-rs bunos-crosvm >/dev/null
dpkg-query -W rust-coreutils rust-findutils rust-diffutils sudo-rs ntpd-rs bunos-crosvm
ln -sf /usr/lib/cargo/bin/sudo /usr/local/bin/sudo
for c in "ls --version" "coreutils --list" "sudo --version" "ntp-ctl --version" "crosvm version"; do echo "$ $c"; $c 2>&1 | head -2; done
readlink -f /usr/bin/ls
ls --version | grep -q "uutils coreutils"
sudo --version | grep -q sudo-rs`;
  await run("ubuntu 26.04 session container (apt resolute, Pop!_OS + COSMIC base)", "ubuntu:26.04", ubuntu);
  const boot = await sh(
    ["bash", join(import.meta.dir, "crosvm-boot.sh"), join(WORK, "out/crosvm/target/release/crosvm")],
    { timeout: 900_000 },
  );
  results.push({
    name: "crosvm KVM boot (Linux guest, uutils init)",
    ok: boot.code === 0,
    log: boot.out.trim().split("\n").slice(-25).join("\n"),
  });
  console.log(`== crosvm boot: ${boot.code === 0 ? "pass" : "FAIL"}\n${results.at(-1)!.log}`);
  await mkdir(WORK, { recursive: true });
  await Bun.write(
    join(WORK, "qualification.json"),
    JSON.stringify({ at: new Date().toISOString(), ok: results.every(r => r.ok), results }, null, 2),
  );
  if (!results.every(r => r.ok)) process.exitCode = 1;
}

if (import.meta.main) {
  const [command = "status", ...names] = Bun.argv.slice(2);
  const buildable = Object.entries(FORKS.components)
    .filter(([, c]) => c.build)
    .map(([n]) => n);
  if (command === "status") await status();
  else if (command === "build") {
    if (!names.length || names.includes("bunos-utils")) await buildUtils();
    for (const n of names.length ? names.filter(x => x !== "bunos-utils") : buildable) await buildComponent(n);
  } else if (command === "debs") await buildDebs();
  else if (command === "publish") await publish();
  else if (command === "qualify") await qualify();
  else if (command === "all") {
    await publish(); // pacman prebuilds compile every component through buildComponent
    await qualify();
  } else {
    console.error("usage: rust-base.ts status|build [name...]|publish|qualify|all");
    process.exit(2);
  }
}
