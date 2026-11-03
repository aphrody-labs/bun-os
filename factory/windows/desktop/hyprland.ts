#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The `windows-hyprland` desktop profile on this Windows host, per-user and reversible (docs/WINDOWS-DESKTOP.md).
 *
 *   bun factory/windows/desktop/hyprland.ts build    build every piece from its pinned fork (cargo, dotnet, CMake + MSVC
 *                                                    for the waku bar on vcpkg's from-source Qt; AltSnap is cross-built
 *                                                    on vps with mingw-w64)
 *   bun factory/windows/desktop/hyprland.ts stage    copy the artifacts to %LOCALAPPDATA%\bunos\desktop\hyprland and
 *                                                    test-sign them (factory/windows/signing/test-signing.ps1)
 *   bun factory/windows/desktop/hyprland.ts up [--glass auto|max|reduced] [--motion auto|on|off] [--seed #rrggbb]
 *                                              [--theme export.json] [--no-wallpaper] [--no-chrome]
 *                                                    render the configs (bunos-win11 desktop windows-hyprland --render)
 *                                                    and start the processes
 *   bun factory/windows/desktop/hyprland.ts down     stop them (GlazeWM exits through its IPC so every window is shown)
 *   bun factory/windows/desktop/hyprland.ts undo     down, then delete the staged tree: nothing else was changed
 *   bun factory/windows/desktop/hyprland.ts status
 *
 * Nothing is registered as the shell or for autostart and no registry value is written; Explorer and the taskbar stay
 * as they are. Every process runs from the staged tree, so `down` finds them by image path.
 */
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");
const local = process.env.LOCALAPPDATA;
if (!local || process.platform !== "win32") throw new Error("windows-hyprland runs on Windows (LOCALAPPDATA unset)");
const root = join(local, "bunos", "desktop", "hyprland");
const target = process.env.CARGO_TARGET_DIR ?? join(repo, "target");
const release = join(target, "release");
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Staged layout: tool -> files copied from the build outputs (relative to the tool's staged directory). */
const bin = {
  glazewm: join(root, "bin", "glazewm"),
  tacky: join(root, "bin", "tacky-borders"),
  waku: join(root, "bin", "waku"),
  bunos: join(root, "bin", "bunos"),
  flow: join(root, "flow-launcher"),
  altsnap: join(root, "altsnap"),
};

async function build() {
  const cargo = (dir: string, ...pkgs: string[]) =>
    $`cargo build --release --locked ${pkgs.flatMap((p) => ["-p", p])}`.cwd(join(repo, dir));
  await cargo("vendor/glazewm", "wm", "wm-cli", "wm-watcher");
  await cargo("vendor/tacky-borders", "tacky-borders");
  await buildWaku();
  await $`cargo build --release -p bunos-win11 -p bunos-win11-chrome -p bunos-win11-wallpaper`.cwd(repo);
  await $`dotnet build Flow.Launcher.sln -c Release -p:RollForward=LatestMajor -v q -nologo`.cwd(join(repo, "vendor/flow-launcher"));
  // AltSnap is plain C for mingw-w64 (vendor/altsnap MakefileX64); the workstation has no mingw, vps does.
  const sha = (await $`git -C ${join(repo, "vendor/altsnap")} rev-parse HEAD`.text()).trim();
  const dir = `/tmp/altsnap-build-${sha.slice(0, 12)}`;
  await $`ssh vps ${`rm -rf ${dir} && mkdir -p ${dir} && cd ${dir} && curl -fsSL https://codeload.github.com/aphrody-labs/AltSnap/tar.gz/${sha} | tar -xz --strip-components=1 && make -f MakefileX64 CC=x86_64-w64-mingw32-gcc WR=x86_64-w64-mingw32-windres -j4 >/dev/null`}`;
  mkdirSync(join(release, "altsnap"), { recursive: true });
  await $`scp -q vps:${dir}/AltSnap.exe vps:${dir}/hooks.dll ${join(release, "altsnap")}/`;
}

/**
 * waku (vendor/waku, C++20 + Qt Quick): MSVC from the newest Visual Studio (vswhere), Qt 6 built from source by vcpkg
 * (classic mode, `qtbase qtdeclarative qtsvg` for x64-windows; VCPKG_ROOT, else the vcpkg checkout next to this
 * one), nlohmann-json and gtest from waku's own manifest. The `deploy` target assembles the portable folder
 * (waku.exe, wakuc.exe, the tray hook, the Qt runtime from windeployqt) in target/release/waku.
 */
async function buildWaku() {
  const vcpkg = process.env.VCPKG_ROOT ?? join(dirname(repo), "vcpkg");
  if (!existsSync(join(vcpkg, "vcpkg.exe"))) throw new Error(`no vcpkg at ${vcpkg} (set VCPKG_ROOT)`);
  await $`${join(vcpkg, "vcpkg.exe")} install qtbase qtdeclarative qtsvg --triplet x64-windows`.cwd(vcpkg);
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft Visual Studio/Installer/vswhere.exe");
  const vs = (await $`${vswhere} -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`.text()).trim();
  const vcvars = join(vs, "VC/Auxiliary/Build/vcvars64.bat");
  const src = join(repo, "vendor/waku");
  const out = join(target, "waku-build");
  const dist = join(release, "waku");
  // One cmd.exe: vcvars only lasts for the process that ran it. It resets VCPKG_ROOT to the bundled vcpkg, so it is
  // set again afterwards.
  const steps = [
    `call "${vcvars}"`,
    `set "VCPKG_ROOT=${vcpkg}"`,
    `set "QT_ROOT=${join(vcpkg, "installed")}"`,
    `cmake -S "${src}" -B "${out}" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE="${join(vcpkg, "scripts/buildsystems/vcpkg.cmake")}" -DVCPKG_TARGET_TRIPLET=x64-windows-static-md -DWAKU_QT_DIR=x64-windows -DWAKU_DIST_DIR="${dist}"`,
    `cmake --build "${out}" --target deploy`,
  ];
  const bat = join(out, "build-waku.cmd");
  mkdirSync(out, { recursive: true });
  await Bun.write(bat, ["@echo off", ...steps.map((l) => `${l} || exit /b 1`), ""].join("\r\n"));
  await $`cmd /d /c ${bat}`;
}

function copy(from: string, to: string) {
  if (!existsSync(from)) throw new Error(`missing build output ${from}; run build first`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

async function stage() {
  for (const f of ["glazewm.exe", "glazewm-cli.exe", "glazewm-watcher.exe"]) copy(join(release, f), join(bin.glazewm, f));
  copy(join(release, "tacky-borders.exe"), join(bin.tacky, "tacky-borders.exe"));
  copy(join(release, "waku"), bin.waku);
  for (const f of ["bunos-win11.exe", "bunos-win11-chrome.exe", "bunos-win11-wallpaper.exe"]) copy(join(release, f), join(bin.bunos, f));
  copy(join(repo, "vendor/flow-launcher/Output/Release"), bin.flow);
  for (const f of ["AltSnap.exe", "hooks.dll"]) copy(join(release, "altsnap", f), join(bin.altsnap, f));
  for (const f of ["AltSnap.dni", "License.txt", "Themes"]) copy(join(repo, "vendor/altsnap", f), join(bin.altsnap, f));
  for (const [tool, lic] of [
    ["glazewm", "vendor/glazewm/LICENSE.md"],
    ["tacky-borders", "vendor/tacky-borders/LICENSE"],
    ["waku", "vendor/waku/LICENSE"],
  ]) copy(join(repo, lic), join(root, "bin", tool, "LICENSE"));
  copy(join(repo, "vendor/flow-launcher/LICENSE"), join(bin.flow, "LICENSE"));
  if (args.includes("--no-sign")) return;
  // Sign the first-party entry points of every tool (Flow's NuGet dependencies keep their own publishers' signatures).
  const files = [
    ...["glazewm.exe", "glazewm-cli.exe", "glazewm-watcher.exe"].map((f) => join(bin.glazewm, f)),
    join(bin.tacky, "tacky-borders.exe"),
    ...["waku.exe", "wakuc.exe"].map((f) => join(bin.waku, f)),
    ...readdirSync(bin.waku).filter((f) => /^WakuTrayHook.*\.dll$/i.test(f)).map((f) => join(bin.waku, f)),
    ...["bunos-win11.exe", "bunos-win11-chrome.exe", "bunos-win11-wallpaper.exe"].map((f) => join(bin.bunos, f)),
    ...readdirSync(bin.flow).filter((f) => /^Flow\.Launcher.*\.(exe|dll)$/.test(f)).map((f) => join(bin.flow, f)),
    join(bin.altsnap, "AltSnap.exe"),
    join(bin.altsnap, "hooks.dll"),
  ];
  const unsigned: string[] = [];
  for (const f of files) {
    const st = (await $`pwsh -NoProfile -Command ${`(Get-AuthenticodeSignature -LiteralPath '${f}').Status`}`.text()).trim();
    if (st !== "Valid") unsigned.push(f);
  }
  if (unsigned.length) {
    await $`C:/Windows/System32/sudo.exe pwsh -NoProfile -File ${join(repo, "factory/windows/signing/test-signing.ps1")} sign ${unsigned}`;
  }
  console.log(`staged ${root}; ${files.length} binaries signed (${unsigned.length} newly)`);
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Run a PowerShell script verbatim (-EncodedCommand: no argv re-quoting touches its quotes or `$`). */
const ps = (script: string) =>
  $`pwsh -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;

/**
 * Start a process that outlives this script. Bun's own children are torn down with it on Windows (even `detached`),
 * so the launch goes through `Start-Process`. Console tools (chrome watch, wallpaper) start hidden.
 */
async function start(exe: string, argv: string[], env: Record<string, string> = {}, hidden = false) {
  if (!existsSync(exe)) throw new Error(`not staged: ${exe}; run stage first`);
  const envs = Object.entries(env).map(([k, v]) => `$env:${k} = ${q(v)}; `).join("");
  const list = argv.length ? ` -ArgumentList ${argv.map(q).join(",")}` : "";
  const style = hidden ? " -WindowStyle Hidden" : "";
  await ps(`${envs}Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(dirname(exe))}${list}${style}`);
  console.log(`started ${exe} ${argv.join(" ")}`);
}

/** Processes whose image lives under the staged tree (`Get-Process` gives the image path; tasklist does not). */
async function ours(): Promise<{ id: number; path: string }[]> {
  const out = await ps(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like ${q(`${root}\\*`)} } | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`,
  ).text();
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [id, path] = l.split("|");
      return { id: Number(id), path };
    });
}

async function up() {
  const renderArgs = ["desktop", "windows-hyprland", "--render", root, "--glass", flag("--glass") ?? "auto", "--motion", flag("--motion") ?? "on"];
  if (flag("--seed")) renderArgs.push("--seed", flag("--seed")!);
  if (flag("--theme")) renderArgs.push("--theme", resolve(flag("--theme")!));
  console.log(await $`${join(bin.bunos, "bunos-win11.exe")} ${renderArgs}`.text());
  const running = new Set((await ours()).map((p) => p.path.toLowerCase()));
  const once = async (exe: string, argv: string[], env?: Record<string, string>, hidden = false) => {
    if (running.has(exe.toLowerCase())) console.log(`already running ${exe}`);
    else await start(exe, argv, env, hidden);
  };
  const foreign = (await $`tasklist /FI "IMAGENAME eq glazewm.exe" /FO CSV /NH`.nothrow().text()).includes("glazewm.exe");
  if (foreign && !running.has(join(bin.glazewm, "glazewm.exe").toLowerCase())) {
    throw new Error("another GlazeWM is running (e.g. the bunos-shell `wm` module); stop it first");
  }
  if (!args.includes("--no-wallpaper")) await once(join(bin.bunos, "bunos-win11-wallpaper.exe"), ["run", "31536000"], {}, true);
  if (!args.includes("--no-chrome")) await once(join(bin.bunos, "bunos-win11-chrome.exe"), ["watch"], {}, true);
  await once(join(bin.glazewm, "glazewm.exe"), ["start", `--config=${join(root, "glazewm", "config.yaml")}`]);
  await once(join(bin.tacky, "tacky-borders.exe"), [], { TACKY_BORDERS_CONFIG_HOME: join(root, "tacky-borders") });
  // The bar is a Windows AppBar (--register-app-bar): maximised and tiled windows stay below it; GlazeWM reads the
  // reduced work area. --no-tray: the profile leaves Explorer's notification area alone.
  await once(join(bin.waku, "waku.exe"), ["--config-home", join(root, "waku"), "--register-app-bar", "--no-tray"]);
  await once(join(bin.altsnap, "AltSnap.exe"), []);
  await once(join(bin.flow, "Flow.Launcher.exe"), []);
}

async function down() {
  const cli = join(bin.glazewm, "glazewm-cli.exe");
  if (existsSync(cli) && (await ours()).some((p) => p.path.toLowerCase().endsWith("glazewm.exe"))) {
    await $`${cli} command wm-exit`.nothrow().quiet();
    await Bun.sleep(1500);
  }
  for (const p of await ours()) {
    await $`taskkill /PID ${p.id} /T /F`.nothrow().quiet();
    console.log(`stopped ${p.id} ${p.path}`);
  }
}

async function status() {
  console.log(`root ${root} (${existsSync(root) ? "staged" : "not staged"})`);
  for (const p of await ours()) console.log(`running ${p.id} ${p.path}`);
}

switch (cmd) {
  case "build":
    await build();
    break;
  case "stage":
    await stage();
    break;
  case "up":
    await up();
    break;
  case "down":
    await down();
    break;
  case "undo":
    await down();
    rmSync(root, { recursive: true, force: true });
    console.log(`removed ${root}`);
    break;
  case "status":
    await status();
    break;
  default:
    throw new Error(`unknown command ${cmd}: build|stage|up|down|undo|status`);
}
