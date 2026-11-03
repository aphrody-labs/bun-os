// SPDX-License-Identifier: Apache-2.0
import mui from "../transforms/orchestrator";
import icons from "../transforms/icons";
export * from "../lib/mapping";
export * from "../lib/icon-names";
export * from "../lib/theme";

export type MigrationKind = "mui" | "icons";
export interface MigrationResult {
  source: string;
  diagnostics: string[];
}

/** Transform one TSX source in memory. No files, subprocesses or network calls. */
export function transformSource(source: string, kind: MigrationKind = "mui"): MigrationResult {
  if (kind !== "mui" && kind !== "icons") throw new TypeError(`unknown migration kind: ${kind}`);
  const transformed = (kind === "icons" ? icons : mui)({
    path: "input.tsx",
    source,
  });
  return {
    source: transformed,
    diagnostics: [...transformed.matchAll(/MIGRATION-TODO:\s*([^*\n]+)/g)].map(match => match[1]!.trim()),
  };
}
