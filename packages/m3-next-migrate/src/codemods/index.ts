// SPDX-License-Identifier: Apache-2.0
// The codemod set: Next 14/15 -> 16 and Tailwind v3 -> v4 from @aphrody/next-bun (the former Bun fork,
// packages/bun-next/codemods), plus MUI -> M3 (Base UI) and the M3 preset header in the converted tailwind.config.
import {
  NEXT16_CODEMODS,
  TAILWIND4_CODEMODS,
  runCodemods as runNextCodemods,
  selectCodemods as selectNextCodemods,
  tailwindConfigToCss,
  type Codemod,
  type FileReport,
  type RunOptions,
} from "@aphrody/next-bun/codemods";
import { muiToM3 } from "./mui";

export * from "@aphrody/next-bun/codemods";
export { muiToM3 } from "./mui";

/** The comment the converted tailwind.config starts with: M3 apps take the colours from the preset. */
export const M3_TAILWIND_HEADER: readonly string[] = [
  "/* From tailwind.config: M3 apps replace the colours with the preset: */",
  '/* @import "@aphrody/m3-tokens/m3-tokens.css"; @import "@aphrody/m3-tokens/expressive.css"; @import "@aphrody/m3-tailwind/preset.css"; */',
];

export const MUI_CODEMODS: readonly Codemod[] = [
  {
    id: "mui-to-m3",
    group: "mui",
    title:
      "MUI Button, Switch, Checkbox, Divider -> Base UI wrappers; Typography, Stack, Box, Paper -> elements with M3 classes",
    test: p => /\.(tsx|jsx)$/.test(p),
    run: source => muiToM3(source),
  },
];

export const CODEMODS: readonly Codemod[] = [
  ...NEXT16_CODEMODS,
  ...MUI_CODEMODS,
  ...TAILWIND4_CODEMODS.map(codemod =>
    codemod.id === "tailwind-config-v4"
      ? Object.assign({}, codemod, {
          run: (source: string, path: string) => tailwindConfigToCss(source, path, M3_TAILWIND_HEADER),
        })
      : codemod,
  ),
];

export const CODEMOD_GROUPS = ["next16", "mui", "tailwind4"] as const;

/** Resolve ids (`all`, a group name, or codemod ids) to codemods; unknown ids throw. */
export function selectCodemods(ids: readonly string[]): Codemod[] {
  return selectNextCodemods(ids, CODEMODS);
}

/** Run codemods over a project. Without `apply` nothing is written. */
export async function runCodemods(options: RunOptions): Promise<FileReport[]> {
  return await runNextCodemods({ codemods: CODEMODS, ...options });
}
