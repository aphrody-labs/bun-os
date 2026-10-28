#!/usr/bin/env bun
// Fails unless the running Bun is the upstream oven-sh/bun build pinned in infra/runtime-pins/linux-x64.json.
import { resolve } from "node:path";
import { assertRuntimeFacts, currentRuntimeFacts, type RuntimePin } from "../packages/bun-workspace/src/runtime.ts";

const root = resolve(import.meta.dir, "..");
const pin = (await Bun.file(resolve(root, "infra/runtime-pins/linux-x64.json")).json()) as RuntimePin;
const runtime = assertRuntimeFacts(pin, currentRuntimeFacts());
console.log(JSON.stringify({ repository: pin.repository, version: runtime.version, revision: runtime.revision }));
