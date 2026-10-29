#!/usr/bin/env bun
// SPDX-License-Identifier: 0BSD
// Distro mechanisms adopted from Omarchy, COSMIC and CachyOS (docs/DISTRO-INSPIRATION.md). Everything plans or
// writes into an explicit directory; nothing modifies the host it runs on unless --root / --conf say so.
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { installDefaults, listDefaults } from "./cosmic.ts";
import { defaultProfilesFile, loadIdsFor, parseProfiles, plan, scanHost } from "./hw.ts";
import { renderVariant, variants } from "./kernel-variant.ts";
import { refreshConfig, runHook, hookNames } from "./layers.ts";
import { defaultStateDir, migrate, pendingMigrations, seedMigrations } from "./migrate.ts";
import { applyLayers, bunosLayers, cachyosLayers, detectIsa, isaTiers, renderLayers, type IsaTier } from "./repos.ts";
import { renderTheme } from "./theme.ts";

const here = import.meta.dir;
const [cmd = "help", sub, ...rest] = Bun.argv.slice(2);
const opt = (args: string[], options: Record<string, { type: "string" | "boolean" }>) =>
  parseArgs({ args, options, allowPositionals: true, strict: true });

const USAGE = `bunos distro tools (factory/distro)
  migrate [--pending|--seed] [--dir D] [--state S]     apply migrations/<unix-ts>.{sh,ts}
  hw plan [--root /] [--profiles F] [--virt V]         hardware profile plan (chwd model), read-only
  repo detect|layers [--tier T] [--bunos-server URL] [--conf F]   x86-64 / v3 / v4 / znver4 repository layers
  kernel list|fragment <variant>                       linux-bun config fragments (HZ, NO_HZ, preempt, THP)
  cosmic list|install --out DIR                        COSMIC cosmic-config system defaults
  theme render <name> --out DIR                        colors.toml + templates
  refresh <rel> [--package-dir D] [--user-dir D]       copy a package config over the user's, with backup
  hook <name> [args]                                   run ~/.config/bunos/hooks/<name> and <name>.d/*
  overlay list|install --root DIR                      CachyOS-Settings derived system files
  doctor                                               check the files above exist and parse`;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }))
    out.push(...(e.isDirectory() ? await walk(join(dir, e.name)) : [join(dir, e.name)]));
  return out;
}

async function main(): Promise<number> {
  switch (cmd) {
    case "migrate": {
      const { values } = opt([sub, ...rest].filter(Boolean) as string[], {
        pending: { type: "boolean" },
        seed: { type: "boolean" },
        dir: { type: "string" },
        state: { type: "string" },
      });
      const dir = values.dir ?? join(here, "migrations");
      const state = values.state ?? defaultStateDir();
      if (values.pending) {
        const p = await pendingMigrations(dir, state);
        for (const f of p) console.log(f);
        return p.length ? 0 : 1; // omarchy-migrate --pending: 0 = some pending
      }
      if (values.seed) return void console.log(`seeded ${(await seedMigrations(dir, state)).length}`) ?? 0;
      const r = await migrate({ dir, stateDir: state, pacmanLock: "/var/lib/pacman/db.lck" });
      if (r.locked) console.error("pacman database locked; retry later");
      if (r.failed) console.error(`migration ${r.failed.file} failed (exit ${r.failed.code})`);
      return r.failed ? 1 : 0;
    }
    case "hw": {
      const { values } = opt(rest, {
        root: { type: "string" },
        profiles: { type: "string" },
        virt: { type: "string" },
      });
      const file = values.profiles ?? defaultProfilesFile;
      const profiles = parseProfiles(await readFile(file, "utf8"));
      const host = await scanHost(values.root ?? "/");
      if (values.virt) host.virt = values.virt;
      const p = plan(profiles, host, { ids: await loadIdsFor(profiles, join(here, "hw")) });
      console.log(JSON.stringify({ devices: host.pci.length, ...p }, null, 2));
      return 0;
    }
    case "repo": {
      const { values } = opt(rest, {
        tier: { type: "string" },
        "bunos-server": { type: "string" },
        conf: { type: "string" },
      });
      const run = async (...argv: string[]) => {
        const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
        const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return out;
      };
      const detected = async (): Promise<IsaTier> =>
        detectIsa({
          ldHelp: await run("/lib/ld-linux-x86-64.so.2", "--help").catch(() => ""),
          gccTarget: await run("gcc", "-march=native", "-Q", "--help=target").catch(() => ""),
        });
      const tier = (values.tier as IsaTier | undefined) ?? (await detected());
      if (!isaTiers.includes(tier)) throw new Error(`unknown tier ${tier}; known: ${isaTiers.join(", ")}`);
      if (sub === "detect") return void console.log(tier) ?? 0;
      const layers = [
        ...(values["bunos-server"] ? bunosLayers(tier, values["bunos-server"]) : []),
        ...cachyosLayers(tier),
      ];
      if (values.conf) {
        await writeFile(values.conf, applyLayers(await readFile(values.conf, "utf8"), layers));
        console.log(`updated ${values.conf} for ${tier}`);
      } else console.log(renderLayers(layers));
      return 0;
    }
    case "kernel": {
      if (sub === "list") {
        for (const [name, v] of Object.entries(variants)) console.log(`${name}: ${v.summary}`);
        return 0;
      }
      process.stdout.write(renderVariant(rest[0] ?? ""));
      return 0;
    }
    case "cosmic": {
      const defaults = join(here, "cosmic", "defaults");
      if (sub === "list") {
        for (const d of await listDefaults(defaults)) console.log(`${d.appId}/v${d.version}/${d.key}`);
        return 0;
      }
      const { values } = opt(rest, { out: { type: "string" } });
      if (!values.out) throw new Error("--out DIR required (use <root>/usr/share/cosmic)");
      for (const f of await installDefaults(defaults, values.out)) console.log(f);
      return 0;
    }
    case "theme": {
      const { values, positionals } = opt(rest, { out: { type: "string" } });
      if (sub !== "render" || !positionals[0] || !values.out) throw new Error("theme render <name> --out DIR");
      const r = await renderTheme({
        themesDir: join(here, "themes"),
        name: positionals[0],
        templates: join(here, "themed"),
        userTemplates: join(homedir(), ".config", "bunos", "themed"),
        out: values.out,
      });
      console.log(`${r.name}: ${r.files.join(", ")}`);
      return 0;
    }
    case "refresh": {
      const { values } = opt(rest, { "package-dir": { type: "string" }, "user-dir": { type: "string" } });
      const r = await refreshConfig({
        packageDir: values["package-dir"] ?? "/usr/share/bunos/config",
        userDir: values["user-dir"] ?? join(homedir(), ".config", "bunos"),
        rel: sub ?? "",
      });
      console.log(`${r.action}: ${r.target}${r.backup ? ` (backup ${r.backup})` : ""}`);
      return 0;
    }
    case "hook": {
      if (!sub || !(hookNames as readonly string[]).includes(sub))
        throw new Error(`hook name: ${hookNames.join(", ")}`);
      const r = await runHook(join(homedir(), ".config", "bunos", "hooks"), sub, rest);
      return r.failed.length ? 1 : 0;
    }
    case "overlay": {
      const root = join(here, "overlay");
      const files = (await walk(root)).map(f => relative(root, f).replaceAll("\\", "/")).sort();
      if (sub === "list") return void console.log(files.join("\n")) ?? 0;
      const { values } = opt(rest, { root: { type: "string" } });
      if (!values.root) throw new Error("overlay install --root DIR");
      await cp(root, values.root, { recursive: true });
      console.log(`installed ${files.length} files into ${values.root}`);
      return 0;
    }
    case "doctor": {
      const profiles = parseProfiles(await readFile(defaultProfilesFile, "utf8"));
      const checks: [string, boolean][] = [
        [`hw profiles parse (${profiles.length})`, profiles.length > 0],
        [
          `kernel variants render (${Object.keys(variants).length})`,
          Object.keys(variants).every(v => renderVariant(v).includes("CONFIG_")),
        ],
        ["cosmic defaults present", (await listDefaults(join(here, "cosmic", "defaults"))).length > 0],
        ["overlay present", existsSync(join(here, "overlay", "usr"))],
        ["migrations dir", existsSync(join(here, "migrations"))],
      ];
      for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
      return checks.every(([, ok]) => ok) ? 0 : 1;
    }
    default:
      console.log(USAGE);
      return cmd === "help" ? 0 : 2;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
