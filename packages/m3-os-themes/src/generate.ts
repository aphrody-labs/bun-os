// SPDX-License-Identifier: Apache-2.0
import { validate } from "./color.ts";
import { generateChromium } from "./chromium.ts";
import { generateCosmic } from "./cosmic.ts";
import { generateGnome } from "./gnome.ts";
import { generateHyprland } from "./hyprland.ts";
import { generateWindows } from "./windows.ts";
import { TARGETS, type GeneratedFile, type Target, type ThemeInput } from "./types.ts";

const GENERATORS: Record<Target, (input: ThemeInput) => GeneratedFile[]> = {
  windows: generateWindows,
  gnome: generateGnome,
  cosmic: generateCosmic,
  chromium: generateChromium,
  hyprland: generateHyprland,
};

/** Pure: build every file for the targets. Nothing is written. */
export function generate(input: ThemeInput, targets: readonly Target[] = TARGETS): GeneratedFile[] {
  validate(input);
  return targets.flatMap(t => GENERATORS[t](input));
}
