/**
 * Build plans for Linux desktop components: pure generation of the files and commands that drive
 * Meson/CMake/Ninja natively (`build`), cross (`cross`) or inside an Arch container (`container`).
 */
import { cmakeToolchain, mesonCrossFile, mesonNativeFile, pkgConfigEnv, type CrossOptions } from "./crossfile.ts";
import type { Closure, SourcePin } from "./closure.ts";

export interface Step {
  title: string;
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Expected stdout, trimmed (used to verify that a checkout is the pinned commit). */
  expect?: string;
}

export interface PlanFile {
  path: string;
  content: string;
}

export interface BuildPlan {
  target: string;
  files: PlanFile[];
  steps: Step[];
}

export interface PlanOptions {
  source: SourcePin;
  /** Directory the sources are cloned under. */
  srcRoot: string;
  /** Build directories root. */
  buildRoot: string;
  /** DESTDIR-style staging area; a real install goes into the sysroot overlay prefix. */
  stage: string;
  /** Cross description; omitted for a native build. */
  cross?: CrossOptions;
  /** Generated file directory. */
  fileDir: string;
  /** Host Qt / KF6 trees for cross CMake builds. */
  qtHostPath?: string;
  kf6HostTooling?: string;
  jobs?: number;
}

const fwd = (p: string) => p.replace(/\\/g, "/");

/** Shallow clone of the pinned tag, then a check that HEAD is the pinned SHA. */
export function checkoutSteps(s: SourcePin, dir: string): Step[] {
  return [
    {
      title: `clone ${s.id} ${s.tag}`,
      cmd: ["git", "clone", "--depth", "1", "--branch", s.tag, s.url, fwd(dir)],
    },
    {
      title: `verify ${s.id} is ${s.sha.slice(0, 12)}`,
      cmd: ["git", "-C", fwd(dir), "rev-parse", "HEAD"],
      expect: s.sha,
    },
  ];
}

export function planBuild(o: PlanOptions): BuildPlan {
  const { source: s } = o;
  const src = `${fwd(o.srcRoot)}/${s.id}`;
  const build = `${fwd(o.buildRoot)}/${s.id}${o.cross ? "-" + o.cross.triple.arch : ""}`;
  const stage = fwd(o.stage);
  const files: PlanFile[] = [];
  const steps: Step[] = [...checkoutSteps(s, src)];
  const env = o.cross ? pkgConfigEnv(o.cross) : undefined;
  if (s.build === "meson") {
    const args = [
      "meson",
      "setup",
      build,
      src,
      "--prefix",
      o.cross?.prefix ?? "/usr",
      "--buildtype",
      "release",
      "--wrap-mode",
      "nodownload",
    ];
    if (o.cross) {
      const f = `${fwd(o.fileDir)}/meson-${o.cross.triple.arch}.ini`;
      const n = `${fwd(o.fileDir)}/meson-native.ini`;
      files.push({ path: f, content: mesonCrossFile(o.cross) }, { path: n, content: mesonNativeFile(o.cross) });
      args.push("--cross-file", f, "--native-file", n);
    }
    args.push(...s.options);
    steps.push({ title: `configure ${s.id} (meson)`, cmd: args, env });
    steps.push({
      title: `compile ${s.id}`,
      cmd: ["meson", "compile", "-C", build, ...(o.jobs ? ["-j", String(o.jobs)] : [])],
      env,
    });
    steps.push({
      title: `install ${s.id} into ${stage}`,
      cmd: ["meson", "install", "-C", build, "--destdir", stage, "--no-rebuild"],
      env,
    });
  } else {
    const args = [
      "cmake",
      "-S",
      src,
      "-B",
      build,
      "-G",
      "Ninja",
      "-DCMAKE_INSTALL_PREFIX=/usr",
      "-DCMAKE_BUILD_TYPE=Release",
    ];
    if (o.cross) {
      const f = `${fwd(o.fileDir)}/toolchain-${o.cross.triple.arch}.cmake`;
      files.push({ path: f, content: cmakeToolchain(o.cross) });
      args.push(`-DCMAKE_TOOLCHAIN_FILE=${f}`);
      args.push(`-DCMAKE_PREFIX_PATH=${fwd(o.cross.sysroot)}/usr`);
      if (o.qtHostPath) args.push(`-DQT_HOST_PATH=${fwd(o.qtHostPath)}`);
      if (o.kf6HostTooling) args.push(`-DKF6_HOST_TOOLING=${fwd(o.kf6HostTooling)}`);
    }
    args.push(...s.options);
    steps.push({ title: `configure ${s.id} (cmake)`, cmd: args, env });
    steps.push({
      title: `compile ${s.id}`,
      cmd: ["cmake", "--build", build, ...(o.jobs ? ["-j", String(o.jobs)] : [])],
      env,
    });
    steps.push({
      title: `install ${s.id} into ${stage}`,
      cmd: ["cmake", "--install", build],
      env: { ...env, DESTDIR: stage },
    });
  }
  return { target: s.id, files, steps };
}

/** Compare a `verify` step's output with the pin. */
export function verifyOutput(step: Step, stdout: string): boolean {
  return step.expect === undefined || stdout.trim() === step.expect;
}

/** Pinned Bun that drives buncc inside the container (npm `bun` canary, same pin as factory/bunos/components.json). */
export const CONTAINER_BUN = "1.4.4-canary.20261028.1";

/** Post-install checks: files that must exist in the stage and, for programs, a headless `--version` run. */
export const SMOKE: Record<string, { files: string[]; run?: string[] }> = {
  glib: { files: ["usr/lib/libglib-2.0.so.0"] },
  gtk4: { files: ["usr/lib/libgtk-4.so.1"] },
  libadwaita: { files: ["usr/lib/libadwaita-1.so.0"] },
  gjs: { files: ["usr/bin/gjs"], run: ["usr/bin/gjs", "--version"] },
  mutter: { files: ["usr/bin/mutter", "usr/lib/libmutter-18.so.0"], run: ["usr/bin/mutter", "--version"] },
  "gnome-shell": { files: ["usr/bin/gnome-shell"], run: ["usr/bin/gnome-shell", "--version"] },
  "gnome-session": { files: ["usr/bin/gnome-session"], run: ["usr/bin/gnome-session", "--version"] },
  "gnome-settings-daemon": { files: ["usr/lib/gnome-settings-daemon/gsd-power"] },
  "gnome-control-center": { files: ["usr/bin/gnome-control-center"] },
  kwin: { files: ["usr/bin/kwin_wayland"], run: ["usr/bin/kwin_wayland", "--version"] },
  "plasma-workspace": { files: ["usr/bin/plasmashell"], run: ["usr/bin/plasmashell", "--version"] },
  "plasma-desktop": { files: ["usr/lib/qt6/plugins/plasma/kcms/systemsettings/kcm_keyboard.so"] },
  libplasma: { files: ["usr/lib/libPlasma.so"] },
  qtbase: { files: ["usr/lib/libQt6Core.so"] },
};

/**
 * Arch container invocation: pacman installs the closure inside the container only (never on the host);
 * buncc is driven by the pinned npm Bun canary. `cwd` is the checkout mounted at /work.
 */
export function containerPlan(
  closure: Closure,
  target: string,
  engine: "podman" | "docker" = "podman",
  image = "docker.io/library/archlinux:base-devel",
  cwd = ".",
  deep = false,
): Step[] {
  const names = closure.sysroot.packages.map(p => p.name);
  const script = [
    "set -euo pipefail",
    "pacman -Syu --noconfirm --needed base-devel git meson ninja cmake pkgconf python nodejs npm wayland-protocols dbus glib2-devel gobject-introspection sassc",
    `pacman -S --noconfirm --needed ${names.join(" ")}`,
    `npm install -g bun@${CONTAINER_BUN}`,
    `bun /work/packages/buncc/src/cli.ts linux build ${target} --run${deep ? " --deep" : ""} --dir /work/.buncc/linux-desktop`,
  ].join("\n");
  return [
    {
      title: `build ${target} in ${image}`,
      cmd: [engine, "run", "--rm", "-v", `${cwd}:/work`, "-w", "/work", image, "bash", "-ec", script],
    },
  ];
}

/** Environment and notes explaining what cannot run on a given build host. */
export function hostLimits(
  s: SourcePin,
  hostIsLinux: boolean,
  crossArch: string | undefined,
  hostArch: string,
): string[] {
  const out: string[] = [];
  if (!s.hostRun?.length) return out;
  const canRunTarget = hostIsLinux && (!crossArch || crossArch === hostArch);
  if (!canRunTarget) out.push(...s.hostRun.map(n => `host-run: ${n}`));
  return out;
}
