/** `buncc posix ...` and `buncc wine ...`. Kept out of cli.ts so the dispatcher stays small. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./lock.ts";
import {
  detectLegacy,
  executePlan,
  LEGACY_IDS,
  planUninstall,
  protectedRoots,
  realHost,
  renderPlan,
  smokeReplacements,
  type LegacyId,
  type LegacyInstall,
} from "./legacy.ts";
import { getProvider, makeContext } from "./providers/index.ts";
import { locateMingw } from "./providers/mingw.ts";
import { findShimDir } from "./providers/posix.ts";
import {
  prefixPath,
  prefixPlan,
  protonRun,
  wineRun,
  wineBuilds,
  dxvkRelease,
  vkd3dProtonRelease,
  protonCachyos,
} from "./providers/wine.ts";
import { findInstalled } from "./providers/_github.ts";
import { run } from "./process.ts";

export async function posixCommand(args: string[], root: string): Promise<number> {
  const [sub = "doctor", ...rest] = args;
  const ctx = makeContext(root);
  const host = realHost();
  const smoke = async (need = { posix: true, mingw: rest.includes("--mingw") }) => {
    // A mingw tree inside MSYS2 is what is being replaced: it does not count as a replacement.
    const found = locateMingw(ctx);
    const mingw = found && found.kind !== "msys2-readonly" ? found : undefined;
    const bin = mingw
      ? join(mingw.binDir, `${mingw.triples[0] ?? "x86_64-w64-mingw32"}-${mingw.flavor === "llvm" ? "clang" : "gcc"}`)
      : undefined;
    return smokeReplacements(need, host.exec, findShimDir(), bin);
  };
  switch (sub) {
    case "doctor": {
      for (const id of ["posix", "mingw", "msys2", "wine", "proton"]) {
        const provider = getProvider(id);
        if (!provider.platforms.includes(ctx.platform)) {
          console.log(`-- ${id.padEnd(8)} not applicable on ${ctx.platform}`);
          continue;
        }
        const d = await provider.detect(ctx);
        console.log(`${d.found ? "ok " : "-- "} ${id.padEnd(8)} ${(d.version ?? "").padEnd(24)} ${d.path ?? ""}`);
        for (const n of d.notes ?? []) console.log(`      ${n}`);
        if (!d.found && d.fixHint) console.log(`      fix: ${d.fixHint}`);
      }
      return 0;
    }
    case "smoke": {
      const results = await smoke();
      for (const r of results) console.log(`${r.ok ? "ok " : "ERR"} ${r.name.padEnd(8)} ${r.detail}`);
      return results.length && results.every(r => r.ok) ? 0 : 1;
    }
    case "uninstall": {
      const target = rest.find(a => !a.startsWith("-")) ?? "";
      const ids: LegacyId[] =
        target === "all" ? LEGACY_IDS : (LEGACY_IDS as string[]).includes(target) ? [target as LegacyId] : [];
      if (!ids.length) {
        console.error(`usage: buncc posix uninstall <${LEGACY_IDS.join("|")}|all> [--yes]`);
        return 2;
      }
      if (process.platform !== "win32") {
        console.log("uninstall: the legacy stacks are Windows-only; nothing to do on this host");
        return 0;
      }
      const installs: LegacyInstall[] = [];
      for (const id of ids) installs.push(...(await detectLegacy(id, host)));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const plan = planUninstall(
        installs,
        await protectedRoots(host),
        join(cacheDir(), "uninstall-backup", stamp),
        await host.isElevated(),
        { purge: rest.includes("--purge") },
      );
      const yes = rest.includes("--yes");
      console.log(renderPlan(plan, yes));
      if (!installs.length) return 0;
      if (!yes) return 0;
      mkdirSync(plan.backupDir, { recursive: true });
      const result = await executePlan(plan, host, smoke);
      for (const e of result.executed)
        console.log(`${e.ok ? "done" : "FAIL"} ${e.step.title}${e.detail ? `: ${e.detail}` : ""}`);
      if (result.stoppedAt !== undefined) {
        console.error(`stopped at step ${result.stoppedAt + 1}; nothing after it ran. Backup: ${plan.backupDir}`);
        return 1;
      }
      return 0;
    }
    default:
      console.error(
        "usage: buncc posix doctor | smoke | uninstall <msys2|mingw|gnuwin32|cygwin|all> [--yes] [--purge]",
      );
      return 2;
  }
}

export async function wineCommand(args: string[], root: string): Promise<number> {
  const [sub = "doctor", ...rest] = args;
  const ctx = makeContext(root);
  if (ctx.platform === "win32") {
    console.log("wine/proton: not applicable on Windows (they run Windows programs on Linux and macOS)");
    return 0;
  }
  const prefix = rest.find(a => a.startsWith("--prefix="))?.slice(9) ?? "default";
  switch (sub) {
    case "doctor": {
      for (const id of ["wine", "proton"]) {
        const d = await getProvider(id).detect(ctx);
        console.log(`${d.found ? "ok " : "-- "} ${id.padEnd(8)} ${(d.version ?? "").padEnd(16)} ${d.path ?? ""}`);
        if (!d.found && d.fixHint) console.log(`      fix: ${d.fixHint}`);
      }
      console.log(`prefixes: ${prefixPath("<name>").replace(/<name>$/, "")}`);
      return 0;
    }
    case "prefix": {
      const name = rest.find(a => !a.startsWith("-")) ?? "default";
      const wine = findInstalled(wineBuilds)?.bin ?? Bun.which("wine64") ?? Bun.which("wine");
      if (!wine) {
        console.error("wine not found: buncc install wine --run");
        return 1;
      }
      const plan = prefixPlan(wine, name, {
        dxvkDir: rest.includes("--dxvk") ? findInstalled(dxvkRelease)?.dir : undefined,
        vkd3dDir: rest.includes("--vkd3d") ? findInstalled(vkd3dProtonRelease)?.dir : undefined,
      });
      mkdirSync(plan.env.WINEPREFIX!, { recursive: true });
      for (const c of plan.commands) {
        console.error(`buncc: ${c.join(" ")}`);
        const r = await run(c, { env: { ...ctx.env, ...plan.env }, output: "inherit", timeoutMs: 600_000 });
        if (r.code !== 0) return r.code;
      }
      return 0;
    }
    case "run": {
      const [program, ...pargs] = rest.filter(a => !a.startsWith("--prefix="));
      if (!program) {
        console.error("usage: buncc wine run [--prefix=name] <program.exe> [args]");
        return 2;
      }
      const proton = findInstalled(protonCachyos);
      if (rest.includes("--proton") && proton) {
        const p = protonRun(proton.dir, prefix, program, pargs);
        return (await run(p.command, { env: { ...ctx.env, ...p.env }, output: "inherit", stdin: "inherit" })).code;
      }
      const wine = findInstalled(wineBuilds)?.bin ?? Bun.which("wine64") ?? Bun.which("wine");
      if (!wine) {
        console.error("wine not found: buncc install wine --run");
        return 1;
      }
      const w = wineRun(wine, prefix, program, pargs);
      return (await run(w.command, { env: { ...ctx.env, ...w.env }, output: "inherit", stdin: "inherit" })).code;
    }
    default:
      console.error("usage: buncc wine run|prefix|doctor");
      return 2;
  }
}
