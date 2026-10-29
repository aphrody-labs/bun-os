#!/usr/bin/env bun
/**
 * Regenerates examples/windows/{dotnet10,dotnet11} from the official SDK templates (`dotnet new`), each channel pinned by
 * its own global.json. Reproducible: same SDK -> same files. Builds every project with buncc's dotnet provider
 * (buildArgs / aotPublishArgs) and writes examples/windows/<channel>/results.json.
 *   bun packages/windows-samples-tests/scripts/generate-dotnet-templates.ts [10|11] [--no-build] [--only name,...]
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dotnetAot, dotnetBuild, repoRoot, resolveDotnet, runDotnet } from "../src/dotnet.ts";

export interface TemplateSpec { name: string; short: string; args?: string[]; aot?: boolean; windowsOnly?: boolean; run?: "run" | "test" | "aot-exe"; interactive?: boolean }
export const TEMPLATES: TemplateSpec[] = [
  { name: "console", short: "console", run: "run" },
  { name: "console-aot", short: "console", run: "aot-exe", args: ["--aot"], aot: true },
  { name: "classlib", short: "classlib" },
  { name: "winforms", short: "winforms", windowsOnly: true, interactive: true },
  { name: "winformslib", short: "winformslib", windowsOnly: true },
  { name: "winformscontrollib", short: "winformscontrollib", windowsOnly: true },
  { name: "wpf", short: "wpf", windowsOnly: true, interactive: true },
  { name: "wpflib", short: "wpflib", windowsOnly: true },
  { name: "wpfusercontrollib", short: "wpfusercontrollib", windowsOnly: true },
  { name: "wpfcustomcontrollib", short: "wpfcustomcontrollib", windowsOnly: true },
  { name: "worker", short: "worker" },
  { name: "web", short: "web" },
  { name: "webapi", short: "webapi" },
  { name: "webapiaot", short: "webapiaot", aot: true },
  { name: "mvc", short: "mvc" },
  { name: "razor", short: "webapp" },
  { name: "razorclasslib", short: "razorclasslib" },
  { name: "blazor", short: "blazor" },
  { name: "grpc", short: "grpc" },
  { name: "mcpserver", short: "mcpserver" },
  { name: "mstest-tests", short: "mstest", run: "test" },
  { name: "xunit-tests", short: "xunit", run: "test" },
  { name: "nunit-tests", short: "nunit", run: "test" },
];

const argv = process.argv.slice(2);
const channels = argv.filter(a => a === "10" || a === "11");
const build = !argv.includes("--no-build");
const only = argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
const sdkPin: Record<string, string> = Object.fromEntries(
  (Bun.env.BUNOS_DOTNET_PINS ?? "10=10.0.403,11=11.0.100-rc.3.26522.148").split(",").map(p => p.split("=") as [string, string]),
);

if (import.meta.main) {
  for (const ch of channels.length ? channels : ["10", "11"]) {
    const dir = join(repoRoot, "examples/windows", `dotnet${ch}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "global.json"), JSON.stringify({ sdk: { version: sdkPin[ch], rollForward: "disable", allowPrerelease: true } }, null, 2) + "\n");
    const dn = resolveDotnet(dir);
    if (!dn || dn.sdk !== sdkPin[ch]) { console.error(`dotnet ${sdkPin[ch]} not found (got ${dn?.sdk}); run dotnet-install into ${Bun.env.BUNOS_DOTNET_ROOT ?? "~/tools/dotnet-portable"}`); process.exit(1); }
    const results: Record<string, unknown> = { sdk: dn.sdk, tfm: `net${ch}.0`, templates: {} };
    for (const t of TEMPLATES) {
      if (only && !only.includes(t.name)) continue;
      const out = join(dir, t.name);
      rmSync(out, { recursive: true, force: true });
      const gen = await runDotnet(dn, ["new", t.short, "-n", t.name, "-o", out, "--framework", `net${ch}.0`, "--no-restore", ...(t.args ?? [])], dir, 120_000);
      const row: Record<string, unknown> = { generated: gen.code === 0 };
      if (gen.code !== 0) row.error = (gen.stdout + gen.stderr).trim().split("\n").slice(-3).join(" | ");
      else if (build) {
        const b = await dotnetBuild(dn, out);
        row.build = b.code === 0;
        if (b.code) row.buildError = (b.stdout + b.stderr).split("\n").filter(l => /error/i.test(l)).slice(0, 3).join(" | ");
        if (t.aot && b.code === 0) {
          const a = await dotnetAot(dn, out, `aot-dotnet${ch}` as "aot-dotnet10", join(out, "bin", "aot"));
          row.aot = a.code === 0;
          if (a.code) row.aotError = (a.stdout + a.stderr).split("\n").filter(l => /error/i.test(l)).slice(0, 3).join(" | ");
        }
        if (t.run && row.build) {
          const exe = join(out, "bin", "aot", `${t.name}.exe`);
          const r = t.run === "run" ? await runDotnet(dn, ["run", "-c", "Release", "--no-build"], out)
            : t.run === "test" ? await runDotnet(dn, ["test", "-c", "Release", "--no-build"], out)
            : existsSync(exe) ? await (async () => { const p = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" }); const [o, e, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]); return { code, stdout: o, stderr: e }; })()
            : { code: 1, stdout: "", stderr: "no aot exe" };
          row.run = r.code === 0 && (t.run === "test" || r.stdout.includes("Hello, World!"));
        }
        if (t.interactive) row.interactive = true;
        for (const d of ["bin", "obj"]) rmSync(join(out, d), { recursive: true, force: true });
      }
      (results.templates as Record<string, unknown>)[t.name] = row;
      console.log(`dotnet${ch}/${t.name}`, JSON.stringify(row));
    }
    const prev = existsSync(join(dir, "results.json")) ? await Bun.file(join(dir, "results.json")).json() : null;
    if (only && prev) Object.assign((results.templates as object), { ...prev.templates, ...(results.templates as object) });
    writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2) + "\n");
  }
}
