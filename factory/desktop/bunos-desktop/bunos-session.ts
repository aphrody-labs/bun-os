#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * bunos-session: the Bun OS desktop chooser for the WSL distro. One Wayland session at a time, shown on the
 * Windows desktop through WSLg. Sessions come from /usr/share/bunos/desktop/sessions.json, which is generated from
 * the single profile source (crates/bunos-win11/src/desktop.rs, `bunos-win11 desktop --json`).
 *
 *   bunos-session                 choose interactively (default: the last session)
 *   bunos-session <id>            start cosmic | cosmic-comp | hyprland | omarchy | gnome
 *   bunos-session --list [--json] list the sessions
 *   bunos-session --plan <id>     print what would run, start nothing
 *
 * Presentation (docs/DESKTOP-SESSIONS.md):
 *   nested-window    the compositor is a WSLg Wayland client: one Windows window, no encoding
 *   devkit-viewer    gnome-shell --devkit: mutter headless + the mutter-devkit viewer as the WSLg window
 *   headless-viewer  Hyprland headless; wayvnc on loopback; the wlvncc Wayland viewer is the WSLg window
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Presentation = "nested-window" | "devkit-viewer" | "headless-viewer";
interface Session {
  id: string;
  title: string;
  exec: string;
  presentation: Presentation;
  env: [string, string][];
  packages: string[];
  vendored: string[];
}

const MANIFEST = process.env.BUNOS_SESSIONS ?? "/usr/share/bunos/desktop/sessions.json";
const STATE = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "bunos");
const VNC_PORT = process.env.BUNOS_SESSION_VNC_PORT ?? "5901";

const die = (msg: string, code = 1): never => {
  console.error(`bunos-session: ${msg}`);
  process.exit(code);
};

async function sessions(): Promise<Session[]> {
  const file = Bun.file(MANIFEST);
  if (!(await file.exists())) die(`no manifest at ${MANIFEST} (install bunos-desktop)`);
  return ((await file.json()) as { sessions: Session[] }).sessions;
}

/** WSLg's environment plus the session's; an empty value unsets the variable. */
function environment(s: Session): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, XDG_SESSION_TYPE: "wayland" };
  env.XDG_RUNTIME_DIR ??= existsSync("/mnt/wslg/runtime-dir")
    ? "/mnt/wslg/runtime-dir"
    : `/run/user/${process.getuid?.()}`;
  for (const [k, v] of s.env) env[k] = v === "" ? undefined : v;
  return env;
}

const argv = (cmd: string) => cmd.split(/\s+/).filter(Boolean);
const missing = (bin: string) => !Bun.which(bin);

function plan(s: Session): string[][] {
  const main = ["dbus-run-session", "--", ...argv(s.exec)];
  if (s.presentation !== "headless-viewer") return [main];
  return [
    main,
    ["hyprctl", "output", "create", "headless", "BUNOS-1"],
    ["wayvnc", "--output=BUNOS-1", "127.0.0.1", VNC_PORT],
    ["wlvncc", "127.0.0.1", VNC_PORT],
  ];
}

function preflight(s: Session) {
  if (!process.env.WAYLAND_DISPLAY && !existsSync("/mnt/wslg"))
    console.warn("bunos-session: no WSLg (WAYLAND_DISPLAY unset, /mnt/wslg absent); the window has nowhere to go");
  for (const step of plan(s))
    if (missing(step[0]!)) die(`${step[0]} is not installed (pacman -S ${s.packages.join(" ")})`);
  if (s.presentation === "headless-viewer" && !readdirSync("/dev/dri", { withFileTypes: true }).length)
    die("Hyprland's headless backend needs a DRM render node (vgem); /dev/dri is empty");
}

/** Wait for the Hyprland instance this process started; its instance signature and Wayland socket name. */
async function hyprlandSocket(env: Record<string, string | undefined>, before: Set<string>): Promise<[string, string]> {
  const dir = join(env.XDG_RUNTIME_DIR!, "hypr");
  for (let i = 0; i < 100; i++) {
    const fresh = existsSync(dir) ? readdirSync(dir).filter(d => !before.has(d)) : [];
    for (const sig of fresh) {
      const lock = Bun.file(join(dir, sig, "hyprland.lock"));
      if (await lock.exists()) {
        const lines = (await lock.text()).split("\n");
        if (lines[1]) return [sig, lines[1].trim()];
      }
    }
    await Bun.sleep(100);
  }
  return die("Hyprland did not come up within 10 s (see ~/.local/share/hyprland/hyprland.log)");
}

async function run(s: Session) {
  preflight(s);
  mkdirSync(STATE, { recursive: true });
  await Bun.write(join(STATE, "session"), `${s.id}\n`);
  if (s.id === "omarchy") await seedOmarchy();
  // First session: the design track's default look (bunos-design-m3) on every desktop; later the user's choice.
  if (!existsSync(join(STATE, "theme")) && existsSync("/usr/share/bunos/themes/bunos-m3") && Bun.which("bunos-theme"))
    await Bun.spawn(["bunos-theme", "bunos-m3"], { stdio: ["ignore", "inherit", "inherit"] }).exited;
  const env = environment(s);
  const [main, ...rest] = plan(s);

  if (s.presentation !== "headless-viewer") {
    const p = Bun.spawn(main!, { env, stdio: ["inherit", "inherit", "inherit"] });
    process.exit(await p.exited);
  }

  const hyprDir = join(env.XDG_RUNTIME_DIR!, "hypr");
  const before = new Set(existsSync(hyprDir) ? readdirSync(hyprDir) : []);
  const compositor = Bun.spawn(main!, { env, stdio: ["ignore", "inherit", "inherit"] });
  const [sig, display] = await hyprlandSocket(env, before);
  const inner = { ...env, WAYLAND_DISPLAY: display, HYPRLAND_INSTANCE_SIGNATURE: sig };
  await Bun.spawn(rest[0]!, { env: inner, stdio: ["ignore", "inherit", "inherit"] }).exited;
  const vnc = Bun.spawn(rest[1]!, { env: inner, stdio: ["ignore", "inherit", "inherit"] });
  await Bun.sleep(300);
  // The viewer is the WSLg window: it talks to WSLg's compositor, not to Hyprland.
  const viewer = Bun.spawn(rest[2]!, {
    env: { ...process.env, XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await Promise.race([viewer.exited, compositor.exited]);
  for (const p of [viewer, vnc, compositor]) p.kill();
  process.exit(code);
}

/** Omarchy reads ~/.config/hypr; seed it once from the bunos-omarchy package, as Omarchy's own installer does. */
async function seedOmarchy() {
  const conf = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  if (existsSync(join(conf, "hypr", "hyprland.lua"))) return;
  const src = "/usr/share/omarchy/config";
  if (!existsSync(src)) die("bunos-omarchy is not installed");
  await Bun.spawn(["cp", "-rn", `${src}/.`, `${conf}/`]).exited;
}

async function choose(all: Session[]): Promise<Session> {
  const last = (
    await Bun.file(join(STATE, "session"))
      .text()
      .catch(() => "")
  ).trim();
  const def = Math.max(
    0,
    all.findIndex(s => s.id === last),
  );
  all.forEach((s, i) => console.log(`${i === def ? "*" : " "} ${i + 1}. ${s.id.padEnd(12)} ${s.title}`));
  const answer = (prompt(`session [${def + 1}]:`) ?? "").trim();
  const pick = answer === "" ? def : Number(answer) - 1;
  return all[pick] ?? all.find(s => s.id === answer) ?? die(`no session ${answer}`, 2);
}

const args = Bun.argv.slice(2);
const all = await sessions();
const byId = (id: string) => all.find(s => s.id === id) ?? die(`unknown session ${id} (bunos-session --list)`, 2);

if (args[0] === "--list") {
  if (args[1] === "--json") console.log(JSON.stringify(all, null, 2));
  else for (const s of all) console.log(`${s.id.padEnd(12)} ${s.presentation.padEnd(16)} ${s.title}`);
} else if (args[0] === "--plan") {
  const s = byId(args[1] ?? die("usage: bunos-session --plan <id>", 2));
  for (const [k, v] of s.env) console.log(v === "" ? `unset ${k}` : `${k}=${v}`);
  for (const step of plan(s)) console.log(step.join(" "));
} else if (args[0] === "-h" || args[0] === "--help") {
  console.log("usage: bunos-session [<id> | --list [--json] | --plan <id>]");
} else {
  await run(args[0] ? byId(args[0]) : await choose(all));
}
