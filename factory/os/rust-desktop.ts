#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * Bun OS Rust desktop factory: Redox and COSMIC built from ONE set of aphrody-labs forks (factory/os/rust-desktop/forks.json)
 * through ONE [patch] table (factory/os/rust-desktop/cargo-patch.toml). VPS only; four compiler jobs per lane.
 *
 *   bun factory/os/rust-desktop.ts check              pins agree: forks.json, cargo-patch.toml, root crates, cosmic-epoch, Redox recipes
 *   bun factory/os/rust-desktop.ts redox              cookbook build of config bunos-desktop (podman, REPO_BINARY=1, patched recipes from source)
 *   bun factory/os/rust-desktop.ts cosmic [app...]    Linux COSMIC apps through aphrody-native-apps (container lane), then the apt index
 *   bun factory/os/rust-desktop.ts publish            Redox pkgar repo -> /repo/redox/, image -> /downloads/os/redox/, apt/pacman via the Store
 *   bun factory/os/rust-desktop.ts qualify            boot the Redox image in QEMU (KVM when /dev/kvm is usable), screendump Orbital,
 *                                                     open COSMIC Files from the launcher (Super+F) and screendump again
 *   bun factory/os/rust-desktop.ts all                check, redox, cosmic, publish, qualify
 *
 * Environment: BUNOS_REDOX_TREE (default vendor/redox/redox), STORE_ROOT (default ~/apps/webos/store),
 * BUNOS_RUST_DESKTOP_OUT (default ~/work/rust-desktop).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  lstatSync,
  accessSync,
  constants,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const here = join(root, "factory/os/rust-desktop");
const forks = JSON.parse(readFileSync(join(here, "forks.json"), "utf8")) as {
  redox: Record<string, { rev: string; recipe?: string; branch: string }>;
  shared: Record<string, { rev?: string; recipe?: string }>;
  apps: Record<string, { rev: string; recipe: string }>;
};
const patchFile = join(here, "cargo-patch.toml");
const tree = resolve(root, Bun.env.BUNOS_REDOX_TREE ?? "vendor/redox/redox");
const store = Bun.env.STORE_ROOT ?? join(homedir(), "apps/webos/store");
const out = Bun.env.BUNOS_RUST_DESKTOP_OUT ?? join(homedir(), "work/rust-desktop");
const CONFIG = "bunos-desktop";
const ARCH = "x86_64";
const TARGET = `${ARCH}-unknown-redox`;
const image = () => join(tree, "build", ARCH, CONFIG, "harddrive.img");
const IMAGE_NAME = `bunos-redox-${ARCH}-desktop.img`;

const log = (...a: unknown[]) => console.log(`[rust-desktop]`, ...a);
function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; allowFail?: boolean } = {}) {
  log("$", cmd.join(" "));
  const p = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (p.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd[0]} exited ${p.exitCode}`);
  return p.exitCode ?? 1;
}
const capture = (cmd: string[], cwd = root) => Bun.spawnSync(cmd, { cwd }).stdout.toString().trim();

// ------------------------------------------------------------------------------------------------ check
function check(): boolean {
  const problems: string[] = [];
  const patch = readFileSync(patchFile, "utf8");
  const lc = forks.shared.libcosmic.rev!;
  for (const line of patch.split("\n").filter(l => l.includes('git = "https://github.com/aphrody-labs/libcosmic"')))
    if (!line.includes(lc)) problems.push(`cargo-patch.toml libcosmic entry is not ${lc}: ${line}`);
  for (const crate of ["aphrody-chat", "aphrody-search", "aphrody-webos-client"]) {
    const toml = readFileSync(join(root, "crates", crate, "Cargo.toml"), "utf8");
    const m = toml.match(/libcosmic\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]+)"/);
    if (m && m[1] !== lc) problems.push(`crates/${crate} libcosmic rev ${m[1]} != shared ${lc}`);
  }
  const epoch = capture(["git", "ls-tree", "HEAD"], join(root, "vendor/cosmic-epoch"));
  if (epoch) {
    for (const [app, { rev }] of Object.entries(forks.apps)) {
      const line = epoch.split("\n").find(l => l.endsWith(`\t${app}`));
      if (line && !line.includes(rev)) problems.push(`cosmic-epoch ${app} gitlink ${line.split(/\s+/)[2]} != ${rev}`);
    }
  }
  if (existsSync(join(tree, "recipes"))) {
    const recipes = [
      ...Object.entries(forks.redox),
      ...Object.entries(forks.apps),
      ...Object.entries(forks.shared),
    ].filter(([, f]) => f.recipe && f.rev);
    for (const [name, f] of recipes) {
      const file = join(tree, "recipes", f.recipe!, "recipe.toml");
      if (!existsSync(file)) {
        problems.push(`missing recipe ${f.recipe}`);
        continue;
      }
      const s = readFileSync(file, "utf8");
      if (!s.includes(`github.com/aphrody-labs/${name}`))
        problems.push(`recipe ${f.recipe} does not use aphrody-labs/${name}`);
      if (!s.includes(`rev = "${f.rev}"`)) problems.push(`recipe ${f.recipe} rev is not ${f.rev}`);
    }
  } else log(`Redox tree ${tree} not checked out (git submodule update --init vendor/redox/redox)`);
  for (const p of problems) console.error("  drift:", p);
  log(problems.length ? `check: ${problems.length} problem(s)` : "check: pins agree");
  return problems.length === 0;
}

// ------------------------------------------------------------------------------------------------ redox
function redox() {
  if (!existsSync(join(tree, "Makefile"))) run(["git", "submodule", "update", "--init", "vendor/redox/redox"]);
  mkdirSync(join(tree, "bunos"), { recursive: true });
  copyFileSync(patchFile, join(tree, "bunos/cargo-patch.toml"));
  const make = [
    "make",
    "all",
    `CONFIG_NAME=${CONFIG}`,
    `ARCH=${ARCH}`,
    "PODMAN_BUILD=1",
    "REPO_BINARY=1",
    "COOKBOOK_MAKE_JOBS=4",
    "-j1",
  ];
  run(make, { cwd: tree });
  log("image", image(), `${(statSync(image()).size / 2 ** 20).toFixed(0)} MiB`);
}

// ------------------------------------------------------------------------------------------------ cosmic
const COSMIC_APPS = ["cosmic-edit", "cosmic-files", "cosmic-term"];
function cosmic(apps: string[]) {
  // The native-apps lane (ubuntu:26.04 container, export of origin/main) builds every COSMIC app with
  // --config factory/os/rust-desktop/cargo-patch.toml into ~/native-apps/debs. Reuse its debs; build only what is missing.
  const debs = Bun.env.APHRODY_NATIVE_DEBS ?? join(homedir(), "native-apps/debs");
  const index = existsSync(join(debs, "index.tsv")) ? readFileSync(join(debs, "index.tsv"), "utf8") : "";
  const missing = (apps.length ? apps : COSMIC_APPS).filter(a => !index.split("\n").some(l => l.startsWith(`${a}\t`)));
  if (missing.length)
    run([join(root, "infra/config/host/libexec/aphrody-native-apps"), "container", "cosmic", ...missing]);
  else log("COSMIC debs already built by the native-apps lane:", COSMIC_APPS.join(", "));
  run(["bun", join(root, "apps/webos/store/cli.ts"), "build", "apt"]);
}

// ------------------------------------------------------------------------------------------------ publish
function publish() {
  const repo = join(tree, "repo", TARGET);
  if (!existsSync(repo)) throw new Error(`no cookbook repo at ${repo}; run redox first`);
  const dest = join(store, "repo/redox");
  mkdirSync(join(dest, TARGET), { recursive: true });
  // pkg reads <url>/<target>/repo.toml and <url>/id_ed25519.pub.toml; /repo/redox/x86_64 is the short alias.
  run(["rsync", "-a", "--delete", `${repo}/`, `${join(dest, TARGET)}/`]);
  const pub = join(tree, "build/id_ed25519.pub.toml");
  if (existsSync(pub)) copyFileSync(pub, join(dest, "id_ed25519.pub.toml"));
  const alias = join(dest, ARCH);
  if (!existsSync(alias)) symlinkSync(TARGET, alias);
  const pkgs = readdirSync(join(dest, TARGET)).filter(f => f.endsWith(".pkgar")).length;
  log(`redox repo: ${pkgs} pkgar packages -> https://aphrody.com/repo/redox/${ARCH}/`);

  const dl = join(store, "downloads/os/redox");
  mkdirSync(dl, { recursive: true });
  const zst = join(dl, `${IMAGE_NAME}.zst`);
  run(["zstd", "-q", "-f", "-T4", "-10", image(), "-o", zst]);
  for (const f of [zst]) {
    const sum = capture(["sha256sum", f]).split(/\s+/)[0];
    writeFileSync(`${f}.sha256`, `${sum}  ${f.split("/").pop()}\n`);
  }
  writeFileSync(
    join(dl, "latest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        image: `${IMAGE_NAME}.zst`,
        config: CONFIG,
        arch: ARCH,
        redox: capture(["git", "rev-parse", "HEAD"], tree),
        libcosmic: forks.shared.libcosmic.rev,
        built: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  log(`image -> https://aphrody.com/downloads/os/redox/${IMAGE_NAME}.zst`);
  // deb + pacman for the COSMIC session: the Store indexes the native-apps debs and its pacman builds.
  run(["bun", join(root, "apps/webos/store/cli.ts"), "build", "apt"], { allowFail: true });
}

// ------------------------------------------------------------------------------------------------ qualify
async function qualify(): Promise<boolean> {
  const dir = join(out, "qualify");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const disk = join(dir, "disk.img");
  copyFileSync(image(), disk);
  let kvm = false;
  try {
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    kvm = true;
  } catch {}
  const mon = join(dir, "monitor.sock");
  const qemu = Bun.spawn(
    [
      "qemu-system-x86_64",
      "-machine",
      "q35",
      "-m",
      "4096",
      "-smp",
      "4",
      ...(kvm ? ["-enable-kvm", "-cpu", "host"] : ["-cpu", "max"]),
      "-drive",
      `file=${disk},format=raw,if=none,id=d0`,
      "-device",
      "nvme,drive=d0,serial=BUNOS",
      "-vga",
      "std",
      "-display",
      "none",
      "-serial",
      `file:${join(dir, "serial.log")}`,
      "-monitor",
      `unix:${mon},server,nowait`,
      "-netdev",
      "user,id=n0",
      "-device",
      "e1000,netdev=n0",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const sleep = (s: number) => Bun.sleep(s * 1000);
  const monitor = async (cmd: string) => {
    const p = Bun.spawnSync(["sh", "-c", `printf '%s\\n' "$1" | socat - UNIX-CONNECT:"$2"`, "sh", cmd, mon]);
    await sleep(0.3);
    return p.exitCode === 0;
  };
  const shot = async (name: string) => {
    const ppm = join(dir, `${name}.ppm`);
    await monitor(`screendump ${ppm}`);
    await sleep(1);
    const png = join(dir, `${name}.png`);
    Bun.spawnSync(["convert", ppm, png]);
    return { ppm, png: existsSync(png) ? png : ppm, stats: ppmStats(ppm) };
  };
  try {
    log(`QEMU ${kvm ? "KVM" : "TCG"} boot; waiting for Orbital`);
    let orbital = false;
    for (let i = 0; i < (kvm ? 24 : 72) && !orbital; i++) {
      await sleep(5);
      const serial = existsSync(join(dir, "serial.log")) ? readFileSync(join(dir, "serial.log"), "utf8") : "";
      orbital = /orblogin|orbital:|launcher/.test(serial) && i > 3;
    }
    await sleep(10);
    const login = await shot("orbital-login");
    log("orbital login screen", login.png, JSON.stringify(login.stats));
    // Default Redox user `user` has an empty password.
    for (const k of ["u", "s", "e", "r", "ret"]) await monitor(`sendkey ${k}`);
    await sleep(2);
    await monitor("sendkey ret");
    await sleep(kvm ? 15 : 45);
    const desktop = await shot("orbital-desktop");
    log("orbital desktop", desktop.png, JSON.stringify(desktop.stats));
    await monitor("sendkey meta_l-f"); // launcher: Super+F -> cosmic-files (libcosmic, Aphrody theme)
    await sleep(kvm ? 30 : 90);
    const files = await shot("cosmic-files");
    log("cosmic-files", files.png, JSON.stringify(files.stats));
    const ok = login.stats.distinct > 8 && desktop.stats.distinct > 8;
    const appOpened = files.stats.diffFrom(desktop.stats) > 0.02;
    writeFileSync(
      join(dir, "qualification.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          accel: kvm ? "kvm" : "tcg",
          orbital: ok,
          cosmicFiles: appOpened,
          shots: [login.png, desktop.png, files.png],
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    log(`qualify: orbital=${ok} cosmic-files=${appOpened}`);
    return ok;
  } finally {
    await monitor("quit");
    qemu.kill();
  }
}

/** Colour statistics of a binary PPM (P6): distinct colours over a sample grid and a coarse histogram for diffs. */
function ppmStats(file: string) {
  const empty = { distinct: 0, aphrodyBar: false, hist: new Map<number, number>(), diffFrom: (_: any) => 0 };
  if (!existsSync(file)) return empty;
  const buf = readFileSync(file);
  const header = buf.subarray(0, 64).toString("latin1").split(/\s+/);
  if (header[0] !== "P6") return empty;
  const w = Number(header[1]),
    h = Number(header[2]);
  let off = 0,
    fields = 0;
  while (fields < 4) {
    while (/\s/.test(String.fromCharCode(buf[off]))) off++;
    while (!/\s/.test(String.fromCharCode(buf[off]))) off++;
    fields++;
  }
  off++;
  const hist = new Map<number, number>();
  let samples = 0,
    bar = false;
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4) {
      const i = off + (y * w + x) * 3;
      const key = ((buf[i] >> 3) << 10) | ((buf[i + 1] >> 3) << 5) | (buf[i + 2] >> 3);
      hist.set(key, (hist.get(key) ?? 0) + 1);
      samples++;
      // Aphrody bar (0x11131D over the background at alpha 224) or primary-container highlight.
      if (Math.abs(buf[i] - 0x11) < 6 && Math.abs(buf[i + 1] - 0x13) < 6 && Math.abs(buf[i + 2] - 0x1d) < 8) bar = true;
    }
  return {
    distinct: hist.size,
    aphrodyBar: bar,
    hist,
    diffFrom(other: { hist: Map<number, number> }) {
      let d = 0;
      for (const k of new Set([...hist.keys(), ...other.hist.keys()]))
        d += Math.abs((hist.get(k) ?? 0) - (other.hist.get(k) ?? 0));
      return d / (2 * samples);
    },
  };
}

// ------------------------------------------------------------------------------------------------ main
const [cmd = "check", ...rest] = Bun.argv.slice(2);
if (cmd !== "check" && process.platform !== "linux") throw new Error("rust-desktop builds run on the VPS only");
switch (cmd) {
  case "check":
    process.exit(check() ? 0 : 1);
  case "redox":
    redox();
    break;
  case "cosmic":
    cosmic(rest);
    break;
  case "publish":
    publish();
    break;
  case "qualify":
    process.exit((await qualify()) ? 0 : 1);
  case "all":
    if (!check()) process.exit(1);
    redox();
    cosmic([]);
    publish();
    process.exit((await qualify()) ? 0 : 1);
  default:
    console.error("usage: rust-desktop.ts check|redox|cosmic [app...]|publish|qualify|all");
    process.exit(2);
}
