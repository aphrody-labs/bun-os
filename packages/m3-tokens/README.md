<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-tokens

Material 3 design tokens (`--md-sys-*`) as Bun-native TypeScript and CSS, with seed-based dynamic colour.

```sh
bun add @aphrody/m3-tokens
```

```ts
import "@aphrody/m3-tokens/m3-tokens.css";
import {
  applyDynamicColor,
  cssFromSeed,
} from "@aphrody/m3-tokens/dynamic-color";

applyDynamicColor("#6750a4"); // sets the --md-sys-color-* roles on <html>
const sheet = cssFromSeed("#6750a4"); // light and dark role sheet, e.g. for SSR
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

| Export                               | What                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.` / `./theme-to-tokens`            | MUI theme to `--md-sys-*` CSS (`muiThemeToTokens`, `normalizeHex`)                                                                                                                                               |
| `./dynamic-color`                    | Material You roles from a seed: `schemeFromSeed`, `cssFromSeed`, `applyDynamicColor` (7 variants, contrast level)                                                                                                |
| `./breakpoints`, `./breakpoints.css` | Window size classes: width 600/840/1200/1600, height compact <480, medium 480-899, expanded >=900; navigation kinds `bar`, `rail-collapsed`, `rail-expanded` (same names as `adaptive.rs`)                       |
| `./expressive`, `./expressive.css`   | 15 emphasized type styles, Expressive spatial springs (`fast` 0.6/800, `default` 0.8/380, `slow` 0.8/200) and directional shapes (`extra-small-top`, `large-top`, `large-start`, `large-end`, `extra-large-top`) |
| `./m3-tokens.css`                    | Static shape, typescale, motion, elevation and state-layer tokens (generated from `crates/aphrody-m3-tokens`)                                                                                                         |
| `./platform-contract`                | `platformState(widthDp)`: size class, navigation, panes, margin                                                                                                                                                  |

`expressive.css` is generated: `bun run generate:expressive` (a test fails when it drifts).

State layers: focus and pressed stay at `0.10` (Compose); Material Web v0_192 uses `0.12`. See
`docs/architecture/DECISIONS.md`.

```sh
bun test test/      # tokens, contrast, variants, breakpoints, expressive
bun run typecheck
bun run build       # build.ts (Bun.build) + bun check -p tsconfig.build.json
```
