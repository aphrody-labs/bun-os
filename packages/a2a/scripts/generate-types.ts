// SPDX-License-Identifier: Apache-2.0
/**
 * Regenerate `src/generated/a2a.ts` from the A2A proto owned by the Rust `aphrody-a2a-pb` crate.
 *
 *   bun scripts/generate-types.ts           write the file
 *   bun scripts/generate-types.ts --check   exit 1 when the committed file is stale
 */
import { join, relative } from "node:path";
import { generateTypes, parseProto } from "./proto-to-ts.ts";

const packageRoot = join(import.meta.dir, "..");
const repoRoot = join(packageRoot, "..", "..");
const protoFile = join(repoRoot, "crates", "aphrody-a2a-pb", "proto", "a2a.proto");
const outFile = join(packageRoot, "src", "generated", "a2a.ts");

export async function renderGenerated(): Promise<string> {
  const source = await Bun.file(protoFile).text();
  return generateTypes(parseProto(source), {
    protoPath: relative(repoRoot, protoFile).replaceAll("\\", "/"),
    command: "bun run generate",
  });
}

if (import.meta.main) {
  const rendered = await renderGenerated();
  if (process.argv.includes("--check")) {
    const current = (await Bun.file(outFile).exists()) ? await Bun.file(outFile).text() : "";
    if (current !== rendered) {
      console.error("src/generated/a2a.ts is stale: run `bun run generate` in packages/os/a2a");
      process.exit(1);
    }
    console.log("src/generated/a2a.ts is up to date");
  } else {
    await Bun.write(outFile, rendered);
    console.log(`wrote ${relative(repoRoot, outFile)}`);
  }
}
