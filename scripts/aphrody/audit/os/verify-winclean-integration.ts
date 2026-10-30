#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * WinClean integration gate: generated Bun bindings, the frozen Rust catalog
 * (`packages/bun-windows-winclean/src/tools.json`) and its migration ledger agree, then a private
 * hidden kernel (`aphrody kernel serve`) lists every catalog tool and answers a live `get_os_info`.
 *
 * Usage: bun scripts/aphrody/audit/os/verify-winclean-integration.ts [--static]
 *   --static   skip the live kernel probe (catalog, ledger and bindings only)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sessionStamp, withKernel } from "../../tools/os/scripts/kernel-session.ts";

/** Bun OS checkout root (the catalog owners live there). */
const workspaceRoot = join(import.meta.dir, "../../../..");

export const rustCatalog = join(workspaceRoot, "packages/bun-windows-winclean/src/tools.json");
export const ledgerPath = join(workspaceRoot, "packages/bun-windows-winclean/tool-migration.json");
export const bunCatalog = join(workspaceRoot, "packages/winclean/src/generated.ts");

export interface Ledger {
  catalog_sha256: string;
  catalog_tool_count: number;
  tools: string[];
  dispatch_overrides?: Record<string, string>;
}

/** SHA-256 of the catalog as Git's LF blob (core.autocrlf may expand the working file to CRLF). */
export function catalogHash(text: string): string {
  return createHash("sha256").update(text.replaceAll("\r\n", "\n"), "utf8").digest("hex");
}

/** Ledger drift against the catalog tool names and text; an empty list when they agree. */
export function ledgerDrift(names: string[], catalogText: string, ledger: Ledger): string[] {
  const problems: string[] = [];
  if (ledger.catalog_tool_count !== names.length || ledger.tools.length !== names.length)
    problems.push(
      `ledger count drift: declared=${ledger.catalog_tool_count} ledger=${ledger.tools.length} catalog=${names.length}`,
    );
  const ledgerNames = ledger.tools.toSorted();
  const native = names.toSorted();
  if (
    new Set(ledgerNames).size !== ledgerNames.length ||
    ledgerNames.length !== native.length ||
    ledgerNames.some((name, index) => name !== native[index])
  )
    problems.push("ledger names diverge from the frozen catalog");
  if (ledger.catalog_sha256 !== catalogHash(catalogText)) problems.push("ledger schema hash drift");
  return problems;
}

async function checkGeneratedBindings(): Promise<void> {
  const generator = join(workspaceRoot, "scripts/aphrody/tools/os/scripts/generate-winclean-catalog.ts");
  const child = Bun.spawn([process.execPath, generator, "--check"], {
    cwd: workspaceRoot,
    windowsHide: true,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error("WinClean generated bindings or catalog metadata diverge.");
}

export async function verify(live: boolean): Promise<Record<string, unknown>> {
  for (const path of [rustCatalog, ledgerPath, bunCatalog])
    if (!existsSync(path)) throw new Error(`WinClean integration input missing: ${path}`);
  await checkGeneratedBindings();
  const catalogText = readFileSync(rustCatalog, "utf8");
  const names = (JSON.parse(catalogText) as { tools: Array<{ name: string }> }).tools.map(tool => tool.name);
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
  const problems = ledgerDrift(names, catalogText, ledger);
  if (problems.length > 0) throw new Error(`WinClean migration ${problems.join("; ")}`);
  const report: Record<string, unknown> = {
    catalog_tools: names.length,
    rust_tools: names.length,
    ledger_tools: ledger.tools.length,
    rust_dispatched_tools: Object.values(ledger.dispatch_overrides ?? {}).filter(value => value === "rust").length,
    plugin: join(process.env.APHRODY_PLUGINS_ROOT ?? join(homedir(), "plugins"), "aphrody"),
  };
  if (!live) return { ...report, live_call: null };
  return await withKernel("winclean", sessionStamp(), async session => {
    const listed = (await session.client.request("tools/list", {})) as {
      tools?: Array<{ name: string }>;
    };
    const kernelNames = new Set((listed.tools ?? []).map(tool => tool.name));
    const missing = names.filter(name => !kernelNames.has(name));
    if (missing.length > 0)
      throw new Error(`Kernel admin drift: missing=${missing.join(", ")} catalog=${names.length}`);
    const call = (await session.call("get_os_info")) as {
      isError?: boolean;
      structuredContent?: unknown;
    };
    if (call.isError !== false || !call.structuredContent) throw new Error("Live kernel get_os_info call failed.");
    return { ...report, kernel_tools: names.length, live_call: "get_os_info" };
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun scripts/audit/os/verify-winclean-integration.ts [--static]");
  } else {
    const unknown = args.filter(arg => arg !== "--static");
    if (unknown.length > 0) {
      console.error(`Unknown argument: ${unknown.join(" ")}`);
      process.exitCode = 2;
    } else {
      try {
        console.log(JSON.stringify(await verify(!args.includes("--static"))));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    }
  }
}
