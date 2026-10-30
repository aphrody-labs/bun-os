#!/usr/bin/env bun
// Thin entry point kept for existing callers; Cargo itself runs through buncc (packages/buncc, docs/BUNCC.md).
import { runCargo } from "@aphrody/buncc/cargo";
import { cargoArgs } from "@aphrody/buncc";
import { inspectCargoWorkspace, loadConfig } from "@aphrody/bun-workspace";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const [action = "metadata", ...args] = Bun.argv.slice(2);
if (action === "metadata") {
  const config = await loadConfig();
  console.log(
    JSON.stringify(
      await inspectCargoWorkspace(config, { runtimePolicy: "development", cargoContract: "members" }),
      null,
      2,
    ),
  );
} else if (action === "fmt" || action === "check" || action === "test") {
  process.exitCode = (await runCargo(cargoArgs(action, { packages: [] }), { root, timeoutMs: 1_800_000 })).code;
} else if (action === "exec") {
  if (args[0] !== "--" || args.length < 2) throw new Error("Usage: bun scripts/cargo.ts exec -- <cargo arguments>");
  process.exitCode = (await runCargo(args.slice(1), { root, cwd: process.cwd(), timeoutMs: 1_800_000 })).code;
} else {
  throw new Error("Usage: bun scripts/cargo.ts metadata|fmt|check|test|exec -- <cargo arguments>");
}
