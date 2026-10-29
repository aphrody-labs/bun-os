/**
 * `buncc linux <closure|sysroot|cross|build|container|hello|pins>`: build and cross-compile GNOME, KDE Plasma and
 * Qt 6 for Linux from Windows, CI or a Linux host. Dry run unless `--run` is given.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SMOKE, containerPlan, hostLimits, planBuild, verifyOutput, type Step } from "./build.ts";
import { buildOrder, closureProblems, loadClosures, resolveTarget, sysrootPackages, type Closure } from "./closure.ts";
import { linkOnlyFlags, parseTriple, targetFlags, type CrossOptions } from "./crossfile.ts";
import { SAMPLES, helloCommand } from "./hello.ts";
import { ArchIndex, archClosure } from "./pacmandb.ts";
import { pcFlags } from "./pkgconfig.ts";
import {
  downloadPackages,
  extractPackage,
  fetchIndex,
  findGccInstallDir,
  sysrootManifest,
  TOOLCHAIN_ROOTS,
  type SysrootManifest,
} from "./sysroot.ts";

export const LINUX_USAGE = `buncc linux: build and cross-compile GNOME, KDE Plasma and Qt 6 for Linux targets

  buncc linux closure [gnome|qt6|plasma] [--packages]
                                                sources (tag, SHA), build order and sysroot size of a closure; --packages lists the Arch packages
  buncc linux pins                              validate the closure files (SHAs, dates, graph)
  buncc linux sysroot <closure|target|--roots a,b> [--arch x86_64|aarch64] [--dir d] [--cache d] [--full] [--run]
                                                Arch-package sysroot manifest; --run downloads and extracts it (no tar, no symlink rights needed)
  buncc linux cross <target> [--arch a] [--sysroot d] [--compiler clang|zig] [--deep] [--run]
                                                generate Meson cross / CMake toolchain files and build with Ninja
  buncc linux build <target> [--run]            same build on a Linux host (native, no cross files)
  buncc linux container <target> [--engine podman|docker] [--run]
                                                build inside an Arch container (pacman stays in the container)
  buncc linux hello <glib|gtk4|libadwaita> --sysroot d [--arch a] [--out d]
                                                cross-compile a smoke program with LLVM clang + lld
  Targets: gnome-shell mutter gtk4 libadwaita gjs gnome-session gnome-settings-daemon gnome-control-center
           plasma-workspace kwin plasma-desktop libplasma qtbase qtdeclarative qtwayland ... | app:<dir>
Nothing is built, downloaded or installed unless --run is given.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i]!;
  if (a.includes("=")) return a.slice(a.indexOf("=") + 1);
  const n = args[i + 1];
  return n && !n.startsWith("--") ? n : "true";
}

const MIB = (n: number) => `${(n / 1048576).toFixed(0)} MiB`;

export function closuresDir(root: string): string {
  return join(root, "factory", "linux-desktop");
}

async function runSteps(steps: Step[], log: (s: string) => void): Promise<number> {
  for (const s of steps) {
    log(`$ ${s.cmd.join(" ")}   # ${s.title}`);
    const p = Bun.spawn(s.cmd, {
      cwd: s.cwd,
      env: { ...process.env, ...s.env },
      stdout: s.expect ? "pipe" : "inherit",
      stderr: "inherit",
    });
    const out = s.expect ? await new Response(p.stdout as ReadableStream).text() : "";
    const code = await p.exited;
    if (code !== 0) return code;
    if (s.expect && !verifyOutput(s, out)) {
      log(`pin mismatch: got ${out.trim()}, expected ${s.expect}`);
      return 3;
    }
  }
  return 0;
}

function defaults(root: string, args: string[]) {
  const arch = parseTriple(opt(args, "arch") ?? "x86_64");
  const work = resolve(opt(args, "dir") ?? join(root, ".buncc", "linux-desktop"));
  return { arch, work };
}

/** Files exist in the stage; programs answer `--version` with the stage libraries on LD_LIBRARY_PATH. */
async function smokeCheck(id: string, stage: string, log: (s: string) => void): Promise<number> {
  const spec = SMOKE[id];
  if (!spec) return 0;
  for (const f of spec.files)
    if (!existsSync(join(stage, f))) {
      log(`smoke: missing ${f} in ${stage}`);
      return 4;
    }
  log(`smoke: ${spec.files.length} files present`);
  if (!spec.run || process.platform !== "linux") return 0;
  const lib = ["usr/lib", "usr/lib64", "usr/lib/x86_64-linux-gnu"].map(d => join(stage, d)).join(":");
  const p = Bun.spawn([join(stage, spec.run[0]!), ...spec.run.slice(1)], {
    env: { ...process.env, LD_LIBRARY_PATH: lib },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  log(`smoke: ${spec.run.join(" ")} -> exit ${code}: ${(out || err).trim().split("\n")[0]}`);
  return code === 0 ? 0 : 5;
}

export async function linuxMain(args: string[], root: string, log: (s: string) => void = console.log): Promise<number> {
  const [sub = "help", ...rest] = args;
  const closures = loadClosures(closuresDir(root));
  const positional = rest.filter(
    (a, i) =>
      !a.startsWith("--") &&
      ![
        "--arch",
        "--dir",
        "--cache",
        "--sysroot",
        "--compiler",
        "--engine",
        "--out",
        "--src",
        "--roots",
        "--qt-host",
        "--kf6-host",
      ].includes(rest[i - 1] ?? ""),
  );
  const run = rest.includes("--run");

  if (sub === "help" || sub === "--help") {
    log(LINUX_USAGE);
    return 0;
  }
  if (sub === "pins") {
    let bad = 0;
    for (const c of closures.values()) {
      const problems = closureProblems(c);
      log(`${c.id}: ${c.sources.length} sources, ${problems.length ? problems.join("; ") : "ok"}`);
      bad += problems.length;
    }
    return bad || !closures.size ? 1 : 0;
  }
  if (sub === "closure") {
    const id = positional[0];
    for (const c of closures.values()) {
      if (id && c.id !== id) continue;
      const pk = sysrootPackages(closures, c.id);
      if (rest.includes("--packages")) {
        pk.forEach(p => log(p.name));
        continue;
      }
      log(
        `${c.id} (resolved ${c.resolvedAt}${c.extends ? ", extends " + c.extends.join(",") : ""}): ${c.sources.length} sources, sysroot ${pk.length} packages, ${MIB(pk.reduce((a, p) => a + p.csize, 0))} compressed / ${MIB(pk.reduce((a, p) => a + p.isize, 0))} installed`,
      );
      const { order } = buildOrder(
        c.sources,
        c.sources.map(s => s.id),
      );
      for (const sid of order) {
        const s = c.sources.find(x => x.id === sid)!;
        log(
          `  ${s.id.padEnd(28)} ${s.tag.padEnd(10)} ${s.sha.slice(0, 12)} ${s.date.slice(0, 10)} ${s.build}  needs: ${s.needs.join(",") || "-"}`,
        );
      }
    }
    return closures.size ? 0 : 1;
  }

  const { arch, work } = defaults(root, rest);
  const cache = resolve(opt(rest, "cache") ?? join(work, "cache"));

  if (sub === "sysroot") {
    const name = positional[0];
    const custom = opt(rest, "roots")?.split(",").filter(Boolean);
    if (!name && !custom) return (log("usage: buncc linux sysroot <closure|target> | --roots pkg,pkg"), 2);
    const found = name ? (closures.get(name) ?? resolveTarget(closures, name)?.closure) : undefined;
    if (name && !found) return (log(`unknown closure or target "${name}"`), 2);
    const closure = found ?? {
      id: name ?? "custom",
      sysrootRoots: custom ?? [],
      sysrootExclude: [] as string[],
      extends: undefined,
    };
    const index: ArchIndex = await fetchIndex(arch.arch, cache);
    const roots = custom ?? [
      ...closure.sysrootRoots,
      ...(closure.extends ?? []).flatMap(e => closures.get(e)?.sysrootRoots ?? []),
    ];
    const manifest: SysrootManifest = sysrootManifest(index, arch.arch, roots, closure.sysrootExclude);
    const dir = resolve(opt(rest, "sysroot") ?? join(work, `sysroot-${closure.id}-${arch.arch}`));
    mkdirSync(work, { recursive: true });
    const mf = join(work, `sysroot-${closure.id}-${arch.arch}.json`);
    writeFileSync(mf, JSON.stringify(manifest, null, 2) + "\n");
    log(
      `manifest ${mf}: ${manifest.totals.packages} packages, ${MIB(manifest.totals.csize)} compressed, ${MIB(manifest.totals.isize)} installed, unresolved: ${manifest.unresolved.join(",") || "none"}`,
    );
    if (!run) return (log(`dry run: pass --run to download into ${cache} and extract into ${dir}`), 0);
    const files = await downloadPackages(manifest.packages, cache, log);
    let n = 0;
    for (const p of manifest.packages) {
      const s = extractPackage(files.get(p.name)!, dir, rest.includes("--full"));
      n += s.files;
    }
    log(`extracted ${n} files into ${dir}; gcc install dir: ${findGccInstallDir(dir) ?? "missing"}`);
    return 0;
  }

  if (sub === "hello") {
    const id = positional[0] as keyof typeof SAMPLES;
    const sample = SAMPLES[id];
    const sysroot = opt(rest, "sysroot");
    if (!sample || !sysroot) return (log("usage: buncc linux hello <glib|gtk4|libadwaita> --sysroot <dir>"), 2);
    const out = resolve(opt(rest, "out") ?? join(work, "hello"));
    mkdirSync(out, { recursive: true });
    const cross: CrossOptions = {
      triple: arch,
      sysroot: resolve(sysroot),
      gccInstallDir: findGccInstallDir(resolve(sysroot)),
    };
    const pc = pcFlags(
      sample.modules,
      [join(resolve(sysroot), "usr/lib/pkgconfig"), join(resolve(sysroot), "usr/share/pkgconfig")],
      resolve(sysroot),
    );
    if (pc.missing.length) return (log(`missing pkg-config modules in the sysroot: ${pc.missing.join(", ")}`), 1);
    const src = join(out, `${id}.c`);
    writeFileSync(src, sample.source);
    const exe = join(out, `${id}-hello-${arch.arch}`);
    const cmd = helloCommand("clang", targetFlags(cross), linkOnlyFlags(cross), pc.cflags, pc.libs, src, exe);
    log(`$ ${cmd.join(" ")}`);
    const code = await runSteps([{ title: `cross-compile ${id}`, cmd }], log);
    if (code === 0) log(`built ${exe}`);
    return code;
  }

  if (sub === "cross" || sub === "build" || sub === "container") {
    const target = positional[0];
    if (!target) return (log(`usage: buncc linux ${sub} <target>`), 2);
    if (target.startsWith("app:")) {
      log(
        `app targets: point meson/cmake at ${target.slice(4)} with the generated files; see docs/BUNCC-LINUX-DESKTOP.md`,
      );
      return 0;
    }
    const resolved = resolveTarget(closures, target);
    if (!resolved) return (log(`unknown target "${target}"; run: buncc linux closure`), 2);
    const hostLinux = process.platform === "linux";
    if (sub === "container") {
      const steps = containerPlan(
        resolved.closure,
        target,
        (opt(rest, "engine") as "podman" | "docker") ?? "podman",
        undefined,
        process.cwd(),
        rest.includes("--deep"),
      );
      steps.forEach(s => log(`$ ${s.cmd.slice(0, 7).join(" ")} ...   # ${s.title}`));
      return run ? runSteps(steps, log) : (log("dry run: pass --run"), 0);
    }
    const sysroot = resolve(opt(rest, "sysroot") ?? join(work, `sysroot-${resolved.closure.id}-${arch.arch}`));
    const cross: CrossOptions | undefined =
      sub === "cross"
        ? {
            triple: arch,
            sysroot,
            compiler: (opt(rest, "compiler") as "clang" | "zig" | undefined) ?? "clang",
            gccInstallDir: existsSync(sysroot) ? findGccInstallDir(sysroot) : undefined,
          }
        : undefined;
    const chain = rest.includes("--deep")
      ? resolved.order
      : [{ closure: resolved.closure.id, source: resolved.source }];
    for (const { source } of chain) {
      const limits = hostLimits(source, hostLinux, cross?.triple.arch, process.arch === "arm64" ? "aarch64" : "x86_64");
      const plan = planBuild({
        source,
        srcRoot: join(work, "src"),
        buildRoot: join(work, "build"),
        stage: join(work, "stage", source.id),
        cross,
        fileDir: join(work, "cross"),
        qtHostPath: opt(rest, "qt-host"),
        kf6HostTooling: opt(rest, "kf6-host"),
      });
      log(
        `== ${source.id} ${source.tag} (${source.sha.slice(0, 12)}) ${cross ? "cross " + cross.triple.llvm : "native"}`,
      );
      limits.forEach(l => log(`   ${l}`));
      for (const f of plan.files) {
        mkdirSync(join(f.path, ".."), { recursive: true });
        writeFileSync(f.path, f.content);
        log(`   wrote ${f.path}`);
      }
      if (!run) plan.steps.forEach(s => log(`   $ ${s.cmd.join(" ")}`));
      else {
        const code = await runSteps(plan.steps, log);
        if (code) return code;
        if (!cross) {
          const smoke = await smokeCheck(source.id, join(work, "stage", source.id), log);
          if (smoke) return smoke;
        }
      }
    }
    if (!run) log("dry run: pass --run to execute");
    return 0;
  }
  log(LINUX_USAGE);
  return 2;
}

export type { Closure };
export { archClosure, TOOLCHAIN_ROOTS };
