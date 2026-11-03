#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The `windows-hyprland` desktop profile on this Windows host, per-user and reversible (docs/WINDOWS-DESKTOP.md).
 *
 *   bun factory/windows/desktop/hyprland.ts build    build every piece from its pinned fork (cargo, dotnet; AltSnap is
 *                                                    cross-built on vps with mingw-w64)
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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
  zebar: join(root, "bin", "zebar"),
  bunos: join(root, "bin", "bunos"),
  flow: join(root, "flow-launcher"),
  altsnap: join(root, "altsnap"),
};

async function build() {
  const cargo = (dir: string, ...pkgs: string[]) =>
    $`cargo build --release --locked ${pkgs.flatMap((p) => ["-p", p])}`.cwd(join(repo, dir));
  await cargo("vendor/glazewm", "wm", "wm-cli", "wm-watcher");
  await cargo("vendor/tacky-borders", "tacky-borders");
  const zebar = join(repo, "vendor/zebar");
  await $`bun install --linker hoisted`.cwd(zebar);
  await $`bun run build`.cwd(join(zebar, "packages/client-api"));
  await $`bun run build`.cwd(join(zebar, "packages/settings-ui"));
  await cargo("vendor/zebar", "zebar");
  await $`cargo build --release -p bunos-win11 -p bunos-win11-chrome -p bunos-win11-wallpaper`.cwd(repo);
  await $`dotnet build Flow.Launcher.sln -c Release -p:RollForward=LatestMajor -v q -nologo`.cwd(join(repo, "vendor/flow-launcher"));
  // AltSnap is plain C for mingw-w64 (vendor/altsnap MakefileX64); the workstation has no mingw, vps does.
  const sha = (await $`git -C ${join(repo, "vendor/altsnap")} rev-parse HEAD`.text()).trim();
  const dir = `/tmp/altsnap-build-${sha.slice(0, 12)}`;
  await $`ssh vps ${`rm -rf ${dir} && mkdir -p ${dir} && cd ${dir} && curl -fsSL https://codeload.github.com/aphrody-labs/AltSnap/tar.gz/${sha} | tar -xz --strip-components=1 && make -f MakefileX64 CC=x86_64-w64-mingw32-gcc WR=x86_64-w64-mingw32-windres -j4 >/dev/null`}`;
  mkdirSync(join(release, "altsnap"), { recursive: true });
  await $`scp -q vps:${dir}/AltSnap.exe vps:${dir}/hooks.dll ${join(release, "altsnap")}/`;
}

function copy(from: string, to: string) {
  if (!existsSync(from)) throw new Error(`missing build output ${from}; run build first`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

async function stage() {
  for (const f of ["glazewm.exe", "glazewm-cli.exe", "glazewm-watcher.exe"]) copy(join(release, f), join(bin.glazewm, f));
  copy(join(release, "tacky-borders.exe"), join(bin.tacky, "tacky-borders.exe"));
  copy(join(release, "zebar.exe"), join(bin.zebar, "zebar.exe"));
  // Tauri resolves `../../resources` (the starter pack, templates) from the exe directory as `_up_/_up_/resources`.
  copy(join(repo, "vendor/zebar/resources"), join(bin.zebar, "_up_", "_up_", "resources"));
  copy(join(repo, "vendor/zebar/packages/desktop/resources"), join(bin.zebar, "resources"));
  for (const f of ["bunos-win11.exe", "bunos-win11-chrome.exe", "bunos-win11-wallpaper.exe"]) copy(join(release, f), join(bin.bunos, f));
  copy(join(repo, "vendor/flow-launcher/Output/Release"), bin.flow);
  for (const f of ["AltSnap.exe", "hooks.dll"]) copy(join(release, "altsnap", f), join(bin.altsnap, f));
  for (const f of ["AltSnap.dni", "License.txt", "Themes"]) copy(join(repo, "vendor/altsnap", f), join(bin.altsnap, f));
  for (const [tool, lic] of [
    ["glazewm", "vendor/glazewm/LICENSE.md"],
    ["tacky-borders", "vendor/tacky-borders/LICENSE"],
    ["zebar", "vendor/zebar/LICENSE.md"],
  ]) copy(join(repo, lic), join(root, "bin", tool, "LICENSE"));
  copy(join(repo, "vendor/flow-launcher/LICENSE"), join(bin.flow, "LICENSE"));
  if (args.includes("--no-sign")) return;
  // Sign the first-party entry points of every tool (Flow's NuGet dependencies keep their own publishers' signatures).
  const files = [
    ...["glazewm.exe", "glazewm-cli.exe", "glazewm-watcher.exe"].map((f) => join(bin.glazewm, f)),
    join(bin.tacky, "tacky-borders.exe"),
    join(bin.zebar, "zebar.exe"),
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

/** Detached start; the child keeps running after this script exits. */
function start(exe: string, argv: string[], env: Record<string, string> = {}) {
  if (!existsSync(exe)) throw new Error(`not staged: ${exe}; run stage first`);
  Bun.spawn([exe, ...argv], { cwd: dirname(exe), env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "ignore"] }).unref();
  console.log(`started ${exe} ${argv.join(" ")}`);
}

/** Processes whose image lives under the staged tree (`Get-Process` gives the image path; tasklist does not). */
async function ours(): Promise<{ id: number; path: string }[]> {
  const out = await $`pwsh -NoProfile -Command ${`Get-Process | Where-Object { $_.Path -like '${root}\\*' } | ForEach-Object { "$($_.Id)|$($_.Path)" }`}`.text();
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [id, path] = l.split("|");
      return { id: Number(id), path };
    });
}

async function up() {
  const renderArgs = ["desktop", "windows-hyprland", "--render", root, "--glass", flag("--glass") ?? "auto", "--motion", flag("--motion") ?? "auto"];
  if (flag("--seed")) renderArgs.push("--seed", flag("--seed")!);
  if (flag("--theme")) renderArgs.push("--theme", resolve(flag("--theme")!));
  console.log(await $`${join(bin.bunos, "bunos-win11.exe")} ${renderArgs}`.text());
  const running = new Set((await ours()).map((p) => p.path.toLowerCase()));
  const once = (exe: string, argv: string[], env?: Record<string, string>) => {
    if (running.has(exe.toLowerCase())) console.log(`already running ${exe}`);
    else start(exe, argv, env);
  };
  if (!args.includes("--no-wallpaper")) once(join(bin.bunos, "bunos-win11-wallpaper.exe"), ["run", "31536000"]);
  if (!args.includes("--no-chrome")) once(join(bin.bunos, "bunos-win11-chrome.exe"), ["watch"]);
  once(join(bin.glazewm, "glazewm.exe"), ["start", `--config=${join(root, "glazewm", "config.yaml")}`]);
  once(join(bin.tacky, "tacky-borders.exe"), [], { TACKY_BORDERS_CONFIG_HOME: join(root, "tacky-borders") });
  const zebarConfig = join(root, "zebar", "config");
  mkdirSync(zebarConfig, { recursive: true });
  once(join(bin.zebar, "zebar.exe"), ["startup", `--config-dir=${zebarConfig}`]);
  once(join(bin.altsnap, "AltSnap.exe"), []);
  once(join(bin.flow, "Flow.Launcher.exe"), []);
  await Bun.sleep(4000);
  await themeZebar(zebarConfig);
}

/** Append the rendered M3 bar theme to every installed starter stylesheet (Zebar copies the pack on first run). */
async function themeZebar(config: string) {
  const css = join(root, "zebar", "bunos-theme.css");
  const walk = (d: string): string[] =>
    existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : [];
  for (const styles of walk(config).filter((f) => f.endsWith("styles.css"))) {
    const text = await Bun.file(styles).text();
    const marker = "/* bunos-theme */";
    const body = text.split(marker)[0];
    await Bun.write(styles, `${body}${marker}\n${await Bun.file(css).text()}`);
    console.log(`themed ${styles}`);
  }
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
