/** `buncc desktop doctor|plan|fetch|build|env|pack|bench`: GNOME/GTK4, Qt6 and KDE builds on Windows. See docs/BUNCC-DESKTOP.md. */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { firstLine, run } from "../process.ts";
import {
  buildEnv,
  buildPackage,
  cloneAt,
  defaultJobs,
  dirStats,
  ensureTools,
  mingwDir,
  pinFor,
  prefixOf,
  toolBins,
  workDir,
  type BuildOptions,
} from "./build.ts";
import { levels, loadRecipes, order, resolveAll, type Recipe } from "./recipes.ts";

const USAGE = `buncc desktop: build upstream GNOME/GTK4, Qt6 and KDE on Windows

  doctor                          toolchain and tool status per target
  plan [--pin] [<what>...]        resolve newest stable upstream tags; --pin writes factory/desktop/recipes.json
  fetch <what>...                 install pinned build tools and clone pinned sources (sha verified)
  build <what>... [--mode graph|mono] [--cc cl|clang-cl] [--target T] [--jobs N] [--lts] [--no-sccache] [--dry-run]
  env [--shell cmd|pwsh|sh|json]  environment for building in the shared prefix
  pack <what> [--runtime] [--out file.zip]
  bench <hello-gtk4|hello-qt|hello-qml|hello-kcoreaddons> [--runs N]
<what>: gtk4 | libadwaita | qt6 | kf6 | plasma-libs | app:<name> | any recipe id (graph is expanded in dependency order)
Targets: x86_64-pc-windows-msvc (default), aarch64-pc-windows-msvc, x86_64-pc-windows-gnullvm, aarch64-pc-windows-gnullvm`;

function parse(args: string[]) {
  const flags = new Map<string, string>();
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags.set(k!, v);
      else if (["mode", "cc", "target", "jobs", "shell", "out", "runs"].includes(k!)) flags.set(k!, args[++i] ?? "");
      else flags.set(k!, "true");
    } else pos.push(a);
  }
  return { flags, pos };
}

function options(root: string, flags: Map<string, string>): BuildOptions {
  return {
    root,
    target: flags.get("target") ?? "x86_64-pc-windows-msvc",
    cc: flags.get("cc") === "clang-cl" ? "clang-cl" : "cl",
    jobs: Number(flags.get("jobs")) || defaultJobs(),
    mode: flags.get("mode") === "mono" ? "mono" : "graph",
    sccache: !flags.has("no-sccache") && !!Bun.which("sccache"),
    dryRun: flags.has("dry-run"),
    lts: flags.has("lts"),
  };
}

const wanted = (pos: string[]) => pos.map(p => (p.startsWith("app:") ? p.slice(4) : p));

async function version(argv: string[]): Promise<string> {
  return (await firstLine(argv, 70)) ?? "";
}

export async function desktopCommand(args: string[], root: string): Promise<number> {
  const [sub = "help", ...rest] = args;
  const { flags, pos } = parse(rest);
  const file = loadRecipes(root);
  const opts = options(root, flags);
  switch (sub) {
    case "help":
    case "--help":
      console.log(USAGE);
      return 0;
    case "doctor": {
      const probes: [string, string[], string][] = [
        ["cl", ["cl"], "MSVC (x64/arm64 targets)"],
        ["clang-cl", ["clang-cl", "--version"], "LLVM clang-cl (--cc clang-cl)"],
        ["cmake", ["cmake", "--version"], "Qt6/KDE"],
        ["ninja", ["ninja", "--version"], "all"],
        ["python", ["python", "--version"], "meson venv"],
        ["git", ["git", "--version"], "sources"],
        ["sccache", ["sccache", "--version"], "compiler cache (optional)"],
        ["perl", ["perl", "-e", "print $^V"], "optional (qtbase configure helpers)"],
      ];
      for (const [name, argv, why] of probes) {
        const path = Bun.which(name);
        console.log(
          `${path ? "ok " : "-- "} ${name.padEnd(10)} ${path ? await version(name === "cl" ? [path] : argv) : "missing"}  (${why})`,
        );
      }
      const t = toolBins();
      console.log(
        `${t.length ? "ok " : "-- "} private tools ${t.length ? t.join(delimiter) : "not installed; run `buncc desktop fetch gtk4`"}`,
      );
      const mingw = mingwDir();
      console.log(
        `${mingw ? "ok " : "-- "} llvm-mingw   ${mingw ?? "missing (gnullvm targets): buncc install mingw --run"}`,
      );
      console.log(`work dir: ${workDir()}`);
      for (const [name, tg] of Object.entries(file.targets))
        console.log(
          `   target ${name.padEnd(28)} ${tg.kind}${tg.cross ? " (cross)" : ""}${tg.needs ? `  needs ${tg.needs}` : ""}`,
        );
      return 0;
    }
    case "plan": {
      const only = pos.length ? order(file, wanted(pos)).map(p => p.id) : undefined;
      const results = await resolveAll(root, only, flags.has("pin"));
      for (const r of results) {
        const lts = r.lts ? `  lts ${r.lts.tag}` : "";
        console.log(
          `${r.changed ? "NEW" : "   "} ${r.id.padEnd(16)} pinned ${(r.current?.tag ?? "-").padEnd(10)} newest ${r.latest?.tag ?? "?"}${lts}`,
        );
      }
      const goal = pos.length ? wanted(pos) : Object.keys(file.groups);
      for (const g of goal) {
        const list = order(loadRecipes(root), [g]);
        console.log(
          `\n${g}: ${levels(list)
            .map((l, i) => `L${i}[${l.map(p => p.id).join(" ")}]`)
            .join(" -> ")}`,
        );
      }
      if (flags.has("pin")) console.log("\nrecipes.json updated");
      return results.some(r => r.changed) && !flags.has("pin") ? 0 : 0;
    }
    case "fetch": {
      const list = order(file, wanted(pos.length ? pos : ["gtk4"]));
      const env = await buildEnv(opts, file);
      await ensureTools(file, opts, env);
      for (const r of list) {
        const pin = pinFor(r, opts.lts);
        if (r.local || r.status === "plan-only" || !pin) continue;
        await cloneAt(
          r.repo!,
          pin.tag,
          pin.sha,
          join(workDir(), "src", `${r.id}-${pin.tag.replace(/[^\w.]/g, "_")}`),
          env,
        );
        console.log(`ok ${r.id} ${pin.tag} ${pin.sha.slice(0, 12)}`);
      }
      return 0;
    }
    case "build": {
      const list = order(file, wanted(pos));
      console.log(`target ${opts.target} cc ${opts.cc} mode ${opts.mode} jobs ${opts.jobs}`);
      console.log(`order: ${list.map(p => p.id).join(" -> ")}`);
      if (opts.dryRun) return 0;
      const env = await buildEnv(opts, file);
      await ensureTools(file, opts, env);
      const started = Date.now();
      const top = list.at(-1)!;
      // mono: only the requested packages build; their dependencies come from the project's own wraps in one ninja DAG.
      const run_ = opts.mode === "mono" && top.build === "meson" ? list.filter(p => wanted(pos).includes(p.id)) : list;
      const timings: string[] = [];
      for (const r of run_) {
        const res = await buildPackage(r, file, opts, env, root);
        timings.push(`${r.id}${res.skipped ? " (up to date)" : ` ${res.seconds.toFixed(1)}s`}`);
      }
      const total = (Date.now() - started) / 1000;
      console.log(`\nbuilt: ${timings.join(", ")}; total ${total.toFixed(1)}s`);
      const st = dirStats(prefixOf(opts.target));
      console.log(`prefix ${prefixOf(opts.target)}: ${st.files} files, ${(st.bytes / 1048576).toFixed(1)} MiB`);
      return 0;
    }
    case "env": {
      const env = await buildEnv(opts, file);
      const keys = [
        "PATH",
        "PKG_CONFIG_PATH",
        "CMAKE_PREFIX_PATH",
        "MESON_PACKAGE_CACHE_DIR",
        "INCLUDE",
        "LIB",
        "LIBPATH",
        "CC",
        "CXX",
      ];
      const shell = flags.get("shell") ?? "pwsh";
      if (shell === "json")
        console.log(JSON.stringify(Object.fromEntries(keys.filter(k => env[k]).map(k => [k, env[k]])), null, 2));
      else
        for (const k of keys) {
          const v = env[k];
          if (!v) continue;
          console.log(
            shell === "cmd"
              ? `set "${k}=${v}"`
              : shell === "sh"
                ? `export ${k}='${v}'`
                : `$env:${k} = '${v.replace(/'/g, "''")}'`,
          );
        }
      return 0;
    }
    case "pack": {
      const prefix = prefixOf(opts.target);
      if (!existsSync(prefix)) throw new Error(`nothing built for ${opts.target}`);
      const out =
        flags.get("out") ??
        join(workDir(), `${pos[0] ?? "desktop"}-${opts.target}${flags.has("runtime") ? "-runtime" : ""}.zip`);
      mkdirSync(join(out, ".."), { recursive: true });
      const tar = join(Bun.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
      const exclude = flags.has("runtime")
        ? [
            "--exclude=include",
            "--exclude=lib/pkgconfig",
            "--exclude=*.lib",
            "--exclude=*.a",
            "--exclude=*.pdb",
            "--exclude=lib/cmake",
            "--exclude=.buncc",
            "--exclude=share/man",
            "--exclude=share/doc",
          ]
        : [];
      const r = await run([tar, "-a", "-cf", out, ...exclude, "-C", prefix, "."], {
        output: "capture",
        timeoutMs: 1_800_000,
      });
      if (r.code !== 0) throw new Error(`tar: ${r.stderr}`);
      console.log(`${out} ${(Bun.file(out).size / 1048576).toFixed(1)} MiB`);
      return 0;
    }
    case "bench": {
      const name = pos[0] ?? "hello-gtk4";
      const prefix = prefixOf(opts.target);
      const exe = [join(prefix, "bin", `${name}.exe`), join(prefix, "bin", name)].find(existsSync);
      if (!exe) throw new Error(`${name} not built; run \`buncc desktop build ${name}\``);
      const env = await buildEnv(opts, file);
      const runs = Number(flags.get("runs")) || 10;
      const times: number[] = [];
      const benchEnv = {
        ...env,
        QT_PLUGIN_PATH: join(prefix, "plugins"),
        QML_IMPORT_PATH: join(prefix, "qml"),
        XDG_DATA_DIRS: join(prefix, "share"),
      };
      for (let i = 0; i < runs + 1; i++) {
        const t0 = performance.now();
        const r = await run([exe], { env: benchEnv, output: "capture", timeoutMs: 60_000 });
        const dt = (performance.now() - t0) / 1000;
        if (r.code !== 0) console.error(`run ${i} exit ${r.code}: ${r.stderr.slice(0, 200)}`);
        if (i > 0) times.push(dt);
      }
      times.sort((a, b) => a - b);
      const st = dirStats(prefix);
      console.log(
        JSON.stringify(
          {
            app: basename(exe),
            exeBytes: Bun.file(exe).size,
            runs,
            min: times[0],
            median: times[Math.floor(times.length / 2)],
            max: times.at(-1),
            prefixFiles: st.files,
            prefixBytes: st.bytes,
            dlls: readdirSync(join(prefix, "bin")).filter(f => f.endsWith(".dll")).length,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

export type { Recipe };
