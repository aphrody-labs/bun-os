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
  const zebar = join(bin.zebar, "zebar.exe");
  const zebarConfig = join(root, "zebar", "config");
  mkdirSync(zebarConfig, { recursive: true });
  await themeZebar();
  const settings = join(zebarConfig, "settings.json");
  if (!existsSync(settings) && !running.has(zebar.toLowerCase())) {
    // First run: Zebar writes settings.json and registers its starter pack; it picks the `vanilla` bar because our
    // GlazeWM is not an installed app, so let it initialise once and restart it on the GlazeWM widget.
    await start(zebar, ["startup", `--config-dir=${zebarConfig}`]);
    for (let i = 0; i < 40 && !existsSync(settings); i++) await Bun.sleep(250);
    await $`taskkill /IM zebar.exe /F`.nothrow().quiet();
    running.delete(zebar.toLowerCase());
  }
  if (existsSync(settings)) {
    const s = await Bun.file(settings).json();
    for (const c of s.startupConfigs ?? []) if (c.pack === "glzr-io.starter") c.widget = "with-glazewm";
    await Bun.write(settings, `${JSON.stringify(s, null, 2)}\n`);
  }
  await once(zebar, ["startup", `--config-dir=${zebarConfig}`]);
  await once(join(bin.altsnap, "AltSnap.exe"), []);
  await once(join(bin.flow, "Flow.Launcher.exe"), []);
}

/** Append the rendered M3 bar theme to the staged starter stylesheet (Zebar serves the starter pack from there). */
async function themeZebar() {
  const styles = join(bin.zebar, "_up_", "_up_", "resources", "starter", "styles.css");
  if (!existsSync(styles)) return;
  const marker = "/* bunos-theme */";
  const body = (await Bun.file(styles).text()).split(marker)[0];
  await Bun.write(styles, `${body}${marker}\n${await Bun.file(join(root, "zebar", "bunos-theme.css")).text()}`);
  console.log(`themed ${styles}`);
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
