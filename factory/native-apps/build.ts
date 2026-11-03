#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Native apps of the Bun OS desktop session (Pop!_OS + COSMIC), built from our pinned aphrody-labs forks and packaged
// as real Ubuntu .debs for the apt feed (apps/webos/store/apt.ts, suite resolute, reads <work>/debs/index.tsv).
// No upstream binaries: Ubuntu's apt "rio" is a Diamond Rio MP3 CLI and never ships.
//
//   bun factory/native-apps/build.ts <command> [args]
//     rio                   aphrody-labs/rio
//     aphrody               crates/aphrody-chat and crates/aphrody-search (libcosmic), with desktop/metainfo/icon
//     cosmic-src            aphrody-labs/cosmic-epoch at the gitlink pinned by this repository, with the app submodules
//     cosmic [repo...]      COSMIC desktop and apps (default: the session set, desktop first)
//     calculator            aphrody-labs/cosmic-calculator
//     wordcraft             WordCraft desktop and CLI from this workspace (container only)
//     craft-cli             GridCraft, DeckCraft and FilmCraft CLIs (container only)
//     lu                    LU desktop Debian candidate (container only; not published)
//     spacedrive            aphrody-labs/spacedrive at the apps/spacedrive import (sd-daemon, sd-server, desktop)
//     publish               rebuild and sign the apt feed with the debs built so far
//     container <command>   run <command> inside the ubuntu:26.04 builder (builder.Dockerfile): the debs link against
//                           the session image's glibc, not the 26.10 host's; the builder sees an export of origin/main
// Cargo: scripts/aphrody/build/rust/cargo-serial.sh on the host; plain cargo -j 4 inside the builder (the container,
// --cpus 4, is the serialised lane). Run in tmux; logs go to <work>/log.
import { $ } from "bun";
import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const HOME = Bun.env.HOME ?? "/home/ubuntu";
const ROOT = Bun.env.BUNOS_NATIVE_ROOT ?? join(HOME, "src/bun-os");
const WORK = Bun.env.BUNOS_NATIVE_WORK ?? join(HOME, "native-apps");
const DEBS = join(WORK, "debs");
const IN_BUILDER = existsSync("/.dockerenv");
const CARGO = IN_BUILDER ? ["cargo"] : [join(ROOT, "scripts/aphrody/build/rust/cargo-serial.sh")];
const JOBS = "4";
/** Libraries winit/wgpu load with dlopen at run time (invisible to dpkg-shlibdeps). */
const GUI_DEPS = "libxkbcommon0, libwayland-client0, libwayland-egl1, libegl1, libvulkan1, libfontconfig1";
const EPOCH_DIR = join(WORK, "src/cosmic-epoch");
/** Desktop first (the streamed COSMIC session needs comp, session, panel and settings-daemon), then the apps. */
const COSMIC_SET = [
  "cosmic-comp",
  "cosmic-session",
  "cosmic-panel",
  "cosmic-settings-daemon",
  "cosmic-launcher",
  "cosmic-app-library",
  "cosmic-applets",
  "cosmic-settings",
  "cosmic-greeter",
  "cosmic-icons",
  "cosmic-randr",
  "pop-launcher",
  "cosmic-bg",
  "cosmic-notifications",
  "cosmic-osd",
  "cosmic-workspaces-epoch",
  "xdg-desktop-portal-cosmic",
  "cosmic-files",
  "cosmic-term",
  "cosmic-edit",
  "cosmic-store",
  "cosmic-player",
];
/** Run-time tools a COSMIC package calls (Phone Hub applet: adb and scrcpy; /opt/android-sdk/platform-tools/adb fallback). */
const PACKAGE_RECOMMENDS: Record<string, string> = {
  "cosmic-applets": "adb, scrcpy",
};
/** Repository directory -> Pop package name, where they differ (the debs replace Pop's packages). */
const PACKAGE_NAME: Record<string, string> = {
  "cosmic-workspaces-epoch": "cosmic-workspaces",
};
/** Shared Linux/Redox fork pins (libcosmic, iced, winit, softbuffer, cosmic-protocols, cosmic-settings-daemon). */
const PATCH = join(ROOT, "factory/os/rust-desktop/cargo-patch.toml");
const SPACEDRIVE_REV = Bun.env.SPACEDRIVE_REV ?? "4d41a379f612e23ac43a66ffd67df52ca77f57d4";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function cargo(cwd: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["nice", "-n", "10", ...CARGO, ...args, "-j", JOBS], {
    cwd,
    env: {
      ...Bun.env,
      APHRODY_BUILD_HOST: "vps",
      CARGO_BUILD_JOBS: JOBS,
      ...env,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error(`cargo ${args.join(" ")} failed in ${cwd}`);
}

async function install(source: string, target: string, mode = 0o644) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  await chmod(target, mode);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function isElf(path: string) {
  const head = new Uint8Array(await Bun.file(path).slice(0, 4).arrayBuffer());
  return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
}

/** Package a staged /usr tree; Depends from dpkg-shlibdeps plus the given run-time libraries. */
async function deb(name: string, version: string, stage: string, description: string, extra = "", recommends = "") {
  const elfs: string[] = [];
  for (const file of await walk(stage)) if ((await stat(file)).mode & 0o100 && (await isElf(file))) elfs.push(file);
  let depends = "";
  if (elfs.length) {
    const tmp = join(WORK, `shlibs-${process.pid}`);
    await mkdir(join(tmp, "debian"), { recursive: true });
    await Bun.write(join(tmp, "debian/control"), `Source: ${name}\n\nPackage: ${name}\nArchitecture: amd64\n`);
    const out = await $`dpkg-shlibdeps -O --ignore-missing-info -l${join(stage, "usr/lib")} ${elfs}`
      .cwd(tmp)
      .quiet()
      .nothrow();
    depends = /^shlibs:Depends=(.*)$/m.exec(out.stdout.toString())?.[1] ?? "";
    await rm(tmp, { recursive: true, force: true });
  }
  if (extra) depends = depends ? `${depends}, ${extra}` : extra;
  await mkdir(join(stage, "DEBIAN"), { recursive: true });
  await Bun.write(
    join(stage, "DEBIAN/control"),
    [
      `Package: ${name}`,
      `Version: ${version}`,
      "Architecture: amd64",
      "Maintainer: aphrody-dev <contact@aphrody.com>",
      ...(depends ? [`Depends: ${depends}`] : []),
      ...(recommends ? [`Recommends: ${recommends}`] : []),
      "Section: x11",
      "Priority: optional",
      "Homepage: https://aphrody.com",
      `Description: ${description}`,
      " Built for Bun OS from the aphrody-labs fork.",
      "",
    ].join("\n"),
  );
  const file = `${name}_${version}_amd64.deb`;
  const target = join(DEBS, file);
  await $`dpkg-deb --root-owner-group -Zxz --build ${stage} ${target}`.quiet();
  const sum = new Bun.CryptoHasher("sha256").update(await Bun.file(target).arrayBuffer()).digest("hex");
  const index = join(DEBS, "index.tsv");
  const previous = (await Bun.file(index).exists()) ? await Bun.file(index).text() : "";
  await Bun.write(index, `${previous}${name}\t${version}\t${file}\t${sum}\n`);
  log(`packaged ${target}`);
}

async function clone(dir: string, repo: string, rev?: string) {
  // A builder killed mid-checkout leaves index.lock behind; each source tree has a single lane, so it is stale.
  await rm(join(dir, ".git/index.lock"), { force: true });
  if (!existsSync(join(dir, ".git")))
    await $`git clone --filter=blob:none https://github.com/aphrody-labs/${repo} ${dir}`;
  if (rev) {
    const known = await $`git -C ${dir} cat-file -e ${rev}^{commit}`.quiet().nothrow();
    if (known.exitCode !== 0) await $`git -C ${dir} fetch -q origin`;
    await $`git -C ${dir} checkout -q ${rev}`;
  }
}

const shortRev = async (dir: string) => (await $`git -C ${dir} rev-parse --short HEAD`.text()).trim();

/** `package.version` of a manifest, or its `workspace.package.version`. */
async function versionOf(manifest: string): Promise<string> {
  const toml = Bun.TOML.parse(await readFile(manifest, "utf8")) as {
    package?: { version?: string | { workspace: boolean } };
    workspace?: { package?: { version?: string } };
  };
  const own = toml.package?.version;
  return typeof own === "string" ? own : (toml.workspace?.package?.version ?? "1.0.0");
}

async function stageDir(name: string) {
  const dir = join(WORK, "stage", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

async function rio() {
  const d = join(WORK, "src/rio");
  await clone(d, "rio");
  // No LTO and no debug info: Rio's release profile (fat LTO, one codegen unit, full debuginfo) links in more memory
  // than a shared factory slot has, and earlyoom kills rustc (thin LTO was still killed at the final link).
  await cargo(d, ["build", "--release", "--locked", "-p", "rioterm"], {
    CARGO_PROFILE_RELEASE_LTO: "false",
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
    CARGO_PROFILE_RELEASE_DEBUG: "0",
  });
  const s = await stageDir("rio");
  await install(join(d, "target/release/rio"), join(s, "usr/bin/rio"), 0o755);
  await install(join(d, "misc/rio.desktop"), join(s, "usr/share/applications/rio.desktop"));
  await install(
    join(ROOT, "factory/native-apps/icons/rio/icon.svg"),
    join(s, "usr/share/icons/hicolor/scalable/apps/rio.svg"),
  );
  if (existsSync(join(d, "misc/rio.terminfo")))
    await install(join(d, "misc/rio.terminfo"), join(s, "usr/share/rio/rio.terminfo"));
  await install(join(d, "LICENSE"), join(s, "usr/share/doc/rio/copyright"));
  const version = `${await versionOf(join(d, "frontends/rioterm/Cargo.toml"))}+bunos${await shortRev(d)}`;
  await deb("rio", version, s, "Rio terminal: GPU-accelerated Rust terminal emulator", GUI_DEPS);
}

async function cosmicSrc() {
  const pin = Bun.env.COSMIC_EPOCH_PIN ?? (await $`git -C ${ROOT} rev-parse HEAD:vendor/cosmic-epoch`.text()).trim();
  await clone(EPOCH_DIR, "cosmic-epoch", pin);
  for (const repo of COSMIC_SET)
    await rm(join(EPOCH_DIR, ".git/modules", repo, "index.lock"), {
      force: true,
    });
  await $`git -C ${EPOCH_DIR} submodule update --init --filter=blob:none ${COSMIC_SET}`;
  log(`cosmic-epoch ${pin}`);
}

async function cosmicOne(repo: string) {
  const d = join(EPOCH_DIR, repo);
  if (!existsSync(d)) throw new Error(`${repo} is not a cosmic-epoch member`);
  log(`build ${repo}`);
  const manifest = join(d, "Cargo.toml");
  if (existsSync(manifest)) await cargo(d, ["build", "--release", ...(existsSync(PATCH) ? ["--config", PATCH] : [])]);
  const s = await stageDir(repo);
  // The justfile install recipes copy the release outputs and data files into rootdir/prefix.
  await $`just rootdir=${s} prefix=/usr install`.cwd(d);
  const version = `${existsSync(manifest) ? await versionOf(manifest) : "1.0.0"}+bunos${await shortRev(d)}`;
  await deb(
    PACKAGE_NAME[repo] ?? repo,
    version,
    s,
    `COSMIC ${repo} (Bun OS build)`,
    GUI_DEPS,
    PACKAGE_RECOMMENDS[repo],
  );
}

async function cosmic(repos: string[]) {
  if (!existsSync(join(EPOCH_DIR, "cosmic-comp/Cargo.toml"))) await cosmicSrc();
  const failed: string[] = [];
  for (const repo of repos.length ? repos : COSMIC_SET) {
    try {
      await cosmicOne(repo);
    } catch (error) {
      log(`${repo} failed: ${error instanceof Error ? error.message : String(error)}`);
      failed.push(repo);
    }
  }
  if (failed.length) throw new Error(`failed: ${failed.join(" ")}`);
}

async function calculator() {
  const d = join(WORK, "src/cosmic-calculator");
  await clone(d, "cosmic-calculator");
  await cargo(d, ["build", "--release"]);
  const s = await stageDir("cosmic-calculator");
  await $`just rootdir=${s} prefix=/usr install`.cwd(d);
  await deb(
    "cosmic-calculator",
    `${await versionOf(join(d, "Cargo.toml"))}+bunos${await shortRev(d)}`,
    s,
    "COSMIC Calculator",
    GUI_DEPS,
  );
}

async function spacedrive() {
  const d = join(WORK, "src/spacedrive");
  await clone(d, "spacedrive", SPACEDRIVE_REV);
  await cargo(d, ["build", "--release", "--locked", "--bin", "sd-daemon", "--bin", "sd-server"]);
  await $`bun install`.cwd(d);
  await $`bun run build`.cwd(join(d, "apps/tauri"));
  await cargo(d, ["build", "--release", "--locked", "-p", "spacedrive"]);
  const s = await stageDir("spacedrive");
  for (const bin of ["sd-daemon", "sd-server"])
    await install(join(d, "target/release", bin), join(s, "usr/bin", bin), 0o755);
  await install(join(d, "target/release/Spacedrive"), join(s, "usr/bin/spacedrive"), 0o755);
  await install(
    join(ROOT, "factory/native-apps/icons/spacedrive/icon.png"),
    join(s, "usr/share/icons/hicolor/256x256/apps/spacedrive.png"),
  );
  await Bun.write(
    join(s, "usr/share/applications/spacedrive.desktop"),
    "[Desktop Entry]\nType=Application\nName=Spacedrive\nComment=The virtual distributed file manager\nExec=spacedrive\nIcon=spacedrive\nStartupWMClass=Spacedrive\nCategories=System;FileManager;\n",
  );
  await install(join(d, "LICENSE"), join(s, "usr/share/doc/spacedrive/copyright"));
  const version = `${await versionOf(join(d, "apps/tauri/src-tauri/Cargo.toml"))}+bunos${await shortRev(d)}`;
  await deb(
    "spacedrive",
    version,
    s,
    "Spacedrive file manager (core daemon, headless server, desktop)",
    `${GUI_DEPS}, libwebkit2gtk-4.1-0`,
  );
}

/** Aphrody Chat and Search build in a standalone workspace: the shared checkout and its Cargo.lock stay untouched. */
async function aphrody() {
  const w = join(WORK, "src/aphrody-apps");
  const root = Bun.TOML.parse(await readFile(join(ROOT, "Cargo.toml"), "utf8")) as {
    workspace: { package: { version: string } };
  };
  const version = root.workspace.package.version;
  const deps = ["futures", "reqwest", "rustls", "serde", "serde_json"];
  const rootText = await readFile(join(ROOT, "Cargo.toml"), "utf8");
  const depLines = deps.map(dep => rootText.split("\n").find(line => line.startsWith(`${dep} = `)) ?? "");
  await mkdir(join(w, "crates"), { recursive: true });
  await Bun.write(
    join(w, "Cargo.toml"),
    [
      "[workspace]",
      'resolver = "3"',
      'members = ["crates/*"]',
      "[workspace.package]",
      `version = "${version}"`,
      'edition = "2024"',
      'rust-version = "1.97"',
      'authors = ["aphrody-dev <contact@aphrody.com>"]',
      'homepage = "https://aphrody.app"',
      'repository = "https://github.com/aphrody-labs/bun-os"',
      "[workspace.dependencies]",
      ...depLines,
      "[workspace.lints.rust]",
      "[profile.release]",
      'lto = "thin"',
      "",
    ].join("\n"),
  );
  const rev = (Bun.env.BUNOS_REV ?? (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim()).slice(0, 10);
  for (const [n, N] of [
    ["chat", "Chat"],
    ["search", "Search"],
  ] as const) {
    const c = join(w, "crates", `aphrody-${n}`);
    await rm(c, { recursive: true, force: true });
    await cp(join(ROOT, "crates", `aphrody-${n}`), c, { recursive: true });
    await cargo(w, ["build", "--release", "-p", `aphrody-${n}`]);
    const s = await stageDir(`aphrody-${n}`);
    await install(join(w, "target/release", `aphrody-${n}`), join(s, "usr/bin", `aphrody-${n}`), 0o755);
    await install(
      join(c, "res", `com.aphrody.${N}.desktop`),
      join(s, "usr/share/applications", `com.aphrody.${N}.desktop`),
    );
    await install(
      join(c, "res", `com.aphrody.${N}.metainfo.xml`),
      join(s, "usr/share/metainfo", `com.aphrody.${N}.metainfo.xml`),
    );
    await install(
      join(c, "res", `com.aphrody.${N}.svg`),
      join(s, "usr/share/icons/hicolor/scalable/apps", `com.aphrody.${N}.svg`),
    );
    await deb(`aphrody-${n}`, `${version}+bunos${rev}`, s, `Aphrody ${N} (native COSMIC app)`, GUI_DEPS);
  }
}

/** WordCraft is built against the session image's libc from the published canonical workspace. */
async function wordcraft() {
  if (!IN_BUILDER || !Bun.env.BUNOS_REV) throw new Error("wordcraft requires the native builder container");
  const expected = Bun.env.BUNOS_REV;
  const revision = (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim();
  if (revision !== expected) throw new Error("WordCraft source revision changed during build");
  const clean = await $`git -C ${ROOT} status --porcelain --untracked-files=normal`
    .env({ ...Bun.env, GIT_OPTIONAL_LOCKS: "0" })
    .text();
  if (clean.trim()) throw new Error("WordCraft requires a clean published workspace");
  const target = join(WORK, "target-wordcraft");
  await cargo(ROOT, ["build", "--release", "--locked", "-p", "wordcraft", "-p", "wordcraft-cli"], {
    CARGO_TARGET_DIR: target,
    CRAFT_FONTS_DIR: ROOT,
    CRAFT_FONTS_REQUIRED: "1",
  });
  const after = (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim();
  const dirty = await $`git -C ${ROOT} status --porcelain --untracked-files=normal`
    .env({ ...Bun.env, GIT_OPTIONAL_LOCKS: "0" })
    .text();
  if (after !== expected || dirty.trim()) throw new Error("WordCraft source changed during build; refusing to package");
  const stage = await stageDir("wordcraft");
  for (const binary of ["wordcraft", "wordcraft-cli"])
    await install(join(target, "release", binary), join(stage, "usr/bin", binary), 0o755);
  const appId = "ai.storyteller.wordcraft";
  const linux = join(ROOT, "apps/wordcraft/packaging/linux");
  await install(join(linux, `${appId}.desktop`), join(stage, "usr/share/applications", `${appId}.desktop`));
  await install(join(linux, `${appId}.mime.xml`), join(stage, "usr/share/mime/packages", `${appId}.xml`));
  const appVersion = await versionOf(join(ROOT, "apps/wordcraft/Cargo.toml"));
  const releaseDate = (await $`git -C ${ROOT} show -s --format=%cs ${expected}`.text()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error("Invalid WordCraft source date");
  const metainfoTemplate = await readFile(join(linux, `${appId}.metainfo.xml.in`), "utf8");
  if (!metainfoTemplate.includes("@VERSION@") || !metainfoTemplate.includes("@DATE@"))
    throw new Error("WordCraft metainfo is missing version or date placeholders");
  const metainfo = metainfoTemplate.replaceAll("@VERSION@", appVersion).replaceAll("@DATE@", releaseDate);
  await mkdir(join(stage, "usr/share/metainfo"), { recursive: true });
  await Bun.write(join(stage, "usr/share/metainfo", `${appId}.metainfo.xml`), metainfo);
  await cp(join(ROOT, "assets/wordcraft/app-icon/hicolor"), join(stage, "usr/share/icons/hicolor"), {
    recursive: true,
  });
  const notice = join(ROOT, "docs/libraries/wordcraft");
  const copyright = (
    await Promise.all(
      ["ATTRIBUTION.md", "NOTICE", "LICENSE-MIT", "LICENSE-APACHE"].map(name => readFile(join(notice, name), "utf8")),
    )
  ).join("\n\n");
  const manifest = await readFile(join(ROOT, "fonts/manifest.txt"), "utf8");
  const fontLicenses = new Set(
    manifest
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => {
        const fields = line.split("|").map(field => field.trim());
        if (fields.length !== 8 || !fields[5] || fields[5].startsWith("/") || fields[5].split("/").includes(".."))
          throw new Error("Invalid font licence path in manifest");
        return fields[5];
      }),
  );
  for (const name of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt", "OFL-SourceSans3.txt", "OFL-SourceSerif4.txt"])
    fontLicenses.add(join("assets/wordcraft/fonts", name));
  const fontCopyright = (
    await Promise.all(
      [...fontLicenses].map(async path => `Font notice: ${path}\n${await readFile(join(ROOT, path), "utf8")}`),
    )
  ).join("\n\n");
  await mkdir(join(stage, "usr/share/doc/wordcraft"), { recursive: true });
  await Bun.write(join(stage, "usr/share/doc/wordcraft/copyright"), `${copyright}\n\n${fontCopyright}\n`);
  const version = `${appVersion}+bunos${expected.slice(0, 10)}`;
  await deb(
    "wordcraft",
    version,
    stage,
    "WordCraft desktop document editor and command-line tools",
    GUI_DEPS,
    "libx11-6, libx11-xcb1, libxcursor1, libxi6, libxrandr2, mesa-vulkan-drivers, xdg-desktop-portal",
  );
}

/** Build companion CLI engines against the session image's libc. */
async function craftCli() {
  if (!IN_BUILDER || !Bun.env.BUNOS_REV) throw new Error("craft-cli requires the native builder container");
  const expected = Bun.env.BUNOS_REV;
  const assertSource = async () => {
    const revision = (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim();
    const dirty = await $`git -C ${ROOT} status --porcelain --untracked-files=normal`
      .env({ ...Bun.env, GIT_OPTIONAL_LOCKS: "0" })
      .text();
    if (revision !== expected || dirty.trim())
      throw new Error("craft-cli requires an unchanged clean published workspace");
  };
  await assertSource();
  const target = join(WORK, "target-craft-cli");
  const engines = ["gridcraft", "deckcraft", "filmcraft"];
  await cargo(ROOT, ["build", "--release", "--locked", ...engines.flatMap(id => ["-p", `${id}-cli`])], {
    CARGO_TARGET_DIR: target,
    CRAFT_FONTS_DIR: ROOT,
    CRAFT_FONTS_REQUIRED: "1",
  });
  await assertSource();
  const stage = await stageDir("bunos-craft-cli");
  for (const id of engines) {
    await install(join(target, "release", `${id}-cli`), join(stage, "usr/bin", `${id}-cli`), 0o755);
    const notice = join(ROOT, "docs/libraries", id);
    for (const name of ["ATTRIBUTION.md", "NOTICE", "LICENSE-MIT", "LICENSE-APACHE"])
      await install(join(notice, name), join(stage, "usr/share/doc/bunos-craft-cli", id, name));
  }
  await deb(
    "bunos-craft-cli",
    `1.0.0+bunos${expected.slice(0, 10)}`,
    stage,
    "GridCraft, DeckCraft and FilmCraft command-line tools",
  );
}

/** Build LU from an isolated export. A candidate is not added to the image or apt feed. */
async function lu() {
  const rev = Bun.env.BUNOS_REV;
  const reaRev = Bun.env.BUNOS_LU_REA_REV;
  if (
    !IN_BUILDER ||
    !rev ||
    !/^[0-9a-f]{40}$/.test(rev) ||
    !reaRev ||
    !/^[0-9a-f]{40}$/.test(reaRev) ||
    Bun.env.BUNOS_LU_EXPORT !== "1"
  )
    throw new Error("LU requires an isolated published-source export in the native builder");
  const app = join(ROOT, "apps/lu");
  const target = join(ROOT, ".lu-target");
  const env = { ...Bun.env, CARGO_TARGET_DIR: target };
  await $`bun install --frozen-lockfile --filter @aphrody/lu`.cwd(ROOT);
  await $`bash scripts/build-llama.sh x86_64-unknown-linux-gnu`.cwd(app).env(env);
  await $`bash scripts/build-llama.sh --check`.cwd(app).env(env);
  await $`bun run tauri build --bundles deb --ci -- --locked`.cwd(app).env(env);
  const bundle = join(target, "release/bundle/deb");
  const files = (await readdir(bundle)).filter(name => name.endsWith(".deb"));
  if (files.length !== 1) throw new Error(`Expected one LU deb, found ${files.length}`);
  const source = join(bundle, files[0]);
  const fields = await Promise.all(
    ["Package", "Version", "Architecture"].map(async field =>
      (await $`dpkg-deb --field ${source} ${field}`.text()).trim(),
    ),
  );
  if (fields.some(field => !field) || fields[2] !== "amd64")
    throw new Error("LU deb metadata is incomplete or not amd64");
  const contents = await $`dpkg-deb --contents ${source}`.text();
  if (
    !contents.includes("lu-llama-server") ||
    !contents.includes(".desktop") ||
    !/ggml-cpu[^/]*\.so/.test(contents) ||
    !contents.includes("/usr/share/doc/locally-uncensored/copyright")
  )
    throw new Error("LU deb is missing its sidecar, CPU backends, desktop launcher or license");
  const candidates = join(WORK, "lu-candidates");
  await mkdir(candidates, { recursive: true });
  const out = join(candidates, `${rev}-${Date.now()}-${process.pid}`);
  await mkdir(out);
  const artifact = join(out, basename(source));
  await copyFile(source, artifact);
  const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(artifact).arrayBuffer()).digest("hex");
  await Bun.write(
    join(out, "receipt.json"),
    JSON.stringify(
      {
        sourceCommit: rev,
        reaCommit: reaRev,
        package: fields[0],
        version: fields[1],
        architecture: fields[2],
        artifact: basename(artifact),
        sha256,
        qualification: "pending",
      },
      null,
      2,
    ) + "\n",
  );
  log(`LU candidate built at ${artifact}; qualification and image inclusion are pending`);
}

/** Rebuild and sign the apt feed (apps/webos/store; suites stable and resolute) from an export of origin/main. */
async function publish() {
  await $`git -C ${ROOT} fetch -q origin main`;
  const exp = join(WORK, `store-${process.pid}`);
  await rm(exp, { recursive: true, force: true });
  await mkdir(exp, { recursive: true });
  try {
    await $`git -C ${ROOT} archive origin/main apps/webos/store | tar -x -C ${exp}`;
    await $`bun cli.ts build apt`.cwd(join(exp, "apps/webos/store")).env({ ...Bun.env, APHRODY_NATIVE_DEBS: DEBS });
  } finally {
    await rm(exp, { recursive: true, force: true });
  }
}

async function container(args: string[]) {
  const image = "bunos-native-builder:26.04";
  await $`git -C ${ROOT} fetch -q origin main`;
  const rev = (await $`git -C ${ROOT} rev-parse origin/main`.text()).trim();
  const liveWorkspace = args[0] === "wordcraft" || args[0] === "craft-cli";
  const luExport = args[0] === "lu";
  if (liveWorkspace) {
    const head = (await $`git -C ${ROOT} rev-parse HEAD`.text()).trim();
    const clean = await $`git -C ${ROOT} status --porcelain --untracked-files=normal`
      .env({ ...Bun.env, GIT_OPTIONAL_LOCKS: "0" })
      .text();
    if (head !== rev || clean.trim()) throw new Error("WordCraft requires the clean published canonical checkout");
  }
  const pin = (await $`git -C ${ROOT} rev-parse ${rev}:vendor/cosmic-epoch`.text()).trim();
  const reaPin = luExport ? (await $`git -C ${ROOT} rev-parse ${rev}:vendor/rea`.text()).trim() : "";
  if (luExport && !/^[0-9a-f]{40}$/.test(reaPin)) throw new Error("LU source has no pinned REA workspace");
  // One export tree and container name per invocation: lanes may run side by side.
  const exp = join(WORK, `root-${process.pid}`);
  await rm(exp, { recursive: true, force: true });
  await mkdir(exp, { recursive: true });
  const paths = [
    "Cargo.toml",
    "scripts/aphrody/build/rust",
    "factory/native-apps",
    "crates/aphrody-chat",
    "crates/aphrody-search",
    "infra/config/host/libexec/aphrody-native-apps",
    "tools/aphrody/config/build-factory.json",
  ];
  const patch = (
    await $`git -C ${ROOT} ls-tree --name-only ${rev} factory/os/rust-desktop/cargo-patch.toml`.text()
  ).trim();
  if (patch) paths.push(patch);
  try {
    if (luExport) {
      await $`git -C ${ROOT} archive ${rev} | tar -x -C ${exp}`;
      // Git archives contain only gitlinks, not the workspace files at that
      // pinned revision. Export REA without changing its shared checkout.
      const rea = join(ROOT, "vendor/rea");
      const reaOut = join(exp, "vendor/rea");
      await $`git -C ${rea} cat-file -e ${`${reaPin}^{commit}`}`;
      await mkdir(reaOut, { recursive: true });
      await $`git -C ${rea} archive ${reaPin} | tar -x -C ${reaOut}`;
    } else await $`git -C ${ROOT} archive ${rev} ${paths} | tar -x -C ${exp}`;
    await $`docker build -q -t ${image} -f ${join(exp, "factory/native-apps/builder.Dockerfile")} ${join(exp, "factory/native-apps")}`.quiet();
    const proc = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "--cpus",
        "4",
        "--memory",
        "16g",
        "--name",
        `bunos-native-${process.pid}-${Date.now()}`,
        "-v",
        `${WORK}:/work`,
        "-v",
        `${liveWorkspace ? ROOT : exp}:/src/bun-os:${luExport ? "rw" : "ro"}`,
        "-v",
        `${join(HOME, ".local/bin/bun")}:/usr/local/bin/bun:ro`,
        "-v",
        "bunos-native-rustup:/opt/rustup",
        "-v",
        "bunos-native-cargo:/cache/cargo",
        "-v",
        "bunos-native-bun:/root/.bun",
        "-e",
        "CARGO_HOME=/cache/cargo",
        "-e",
        "BUNOS_NATIVE_ROOT=/src/bun-os",
        "-e",
        "BUNOS_NATIVE_WORK=/work",
        "-e",
        `BUNOS_REV=${rev}`,
        "-e",
        `BUNOS_LU_EXPORT=${luExport ? "1" : "0"}`,
        "-e",
        `BUNOS_LU_REA_REV=${reaPin}`,
        "-e",
        `COSMIC_EPOCH_PIN=${pin}`,
        "-e",
        "GIT_CONFIG_COUNT=1",
        "-e",
        "GIT_CONFIG_KEY_0=safe.directory",
        "-e",
        "GIT_CONFIG_VALUE_0=*",
        image,
        "bun",
        "/src/bun-os/factory/native-apps/build.ts",
        ...args,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`builder exited ${code}`);
  } finally {
    await rm(exp, { recursive: true, force: true });
  }
}

const [command = "", ...args] = Bun.argv.slice(2);
await mkdir(join(WORK, "src"), { recursive: true });
await mkdir(DEBS, { recursive: true });
const commands: Record<string, () => Promise<void>> = {
  rio,
  aphrody,
  "cosmic-src": cosmicSrc,
  cosmic: () => cosmic(args),
  calculator,
  spacedrive,
  wordcraft,
  "craft-cli": craftCli,
  lu,
  publish,
  container: () => container(args),
};
const run = commands[command];
if (!run) {
  console.error(`usage: bun ${basename(import.meta.path)} ${Object.keys(commands).join("|")} [args]`);
  process.exit(2);
}
await run();
