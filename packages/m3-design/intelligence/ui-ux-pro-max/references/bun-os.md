# Bun OS / Aphrody UI ecosystem

Map of the UI owners in the Bun OS workspace (`aphrody-labs/bun-distribution`, branch `os`). Paths are
repository-relative. Search the matching data with `--stack m3`, `--stack nextjs`,
`--stack html-tailwind`, `--stack shadcn` and the `brands.csv` palette rows.

## Which layer to use

| Building                         | Use                                                                        | Why                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A new Aphrody/Bun app            | `@aphrody/m3*` (`packages/m3*`)                                            | Material 3 tokens, Tailwind preset, Base UI wrappers, Next 16 integration, all generated from `crates/aphrody-m3-tokens` |
| A web-component UI (Lit, `md-*`) | `@aphrody/material-web` fork (`vendor/material-web`) + `@aphrody/m3-react` | 119 `md-*` elements with React wrappers                                                                                  |
| Any Tailwind v4 build on Bun     | `@aphrody/bun-plugin-tailwind` (`packages/m3-tailwind`)                    | `Bun.build`, `Bun.serve` HTML imports, dev server and a PostCSS entry for Next; `theme: "m3"` preset                     |

## Packages

### Material 3 (`packages/`)

- `m3-tokens`: `m3-tokens.css` (shape, typescale, motion, elevation, state layers), `expressive.css`,
  `breakpoints.css` (600/840/1200/1600 width classes, `@custom-media --md-*`), `dynamic-color`
  (`schemeFromSeed`, `cssFromSeed`, `applyDynamicColor`, `clearDynamicColor`), `platform-contract`
  (`platformState(widthDp)`). Generated from `crates/aphrody-m3-tokens/src/sheets.rs`; never hand-edit.
- `m3-tailwind`: CSS-first `preset.css` (49 colour roles, `rounded-*`/`shape-*`, `text-<role>`,
  `shadow-elevation-0..5`, easings/durations/springs, `state-layer`, `compact:`..`extra-large:`,
  Base UI `m3-open:`/`m3-highlighted:`... variants). Import order: `tailwindcss`, `m3-tokens.css`,
  `expressive.css`, `preset.css`.
- `m3-theme`: `tokens.css` (baseline seed `#6750A4`, M3 roles + shadcn aliases + Tailwind
  `@theme inline`), `tailwind.css`, `spaceui.css`.
- `m3-next`: `withM3` config, `M3Root`/`M3Html` (themed first byte, `color-scheme`, pre-paint
  script), `createM3Proxy` for `proxy.ts`, client theme provider, Tauri static export, `m3-next`
  runner (Next on Bun).
- `m3-baseui`: 38 Base UI primitives with M3 classes (`M3Button` variants filled/tonal/outlined/
  text/elevated, sizes xs..xl; compose with `render`).
- `m3-react`: React wrappers for the 119 `md-*` elements (`MdFilledButton`, `MdIcon`...).
- `m3-icons` (inline SVG Material Symbols; client bundles use `./browser` + `m3:icon/<style>/<name>`),
  `m3-fonts` (Google Sans Flex/Code, Roboto Flex/Mono, Material Symbols, JP fallbacks),
  `m3-motion` (container transform, shared axis, fade through), `eslint-plugin-m3`
  (`valid-color-role`, `require-icon-button-label`... under `bun lint` jsPlugins),
  `m3` (framework: plugin, `serveM3`, `buildM3`, `m3` CLI), `m3-bun`, `m3-os-themes`.

## Themes and selectors

| Brand ID (brands.csv)         | Selector         | Scheme       | Source of effective values     |
| ----------------------------- | ---------------- | ------------ | ------------------------------ |
| `m3-baseline-light` / `-dark` | `:root`, `.dark` | light / dark | `packages/m3-theme/tokens.css` |

- The class goes on `<html>`; an inline script first in `<head>` applies the stored theme value before paint, then
  `ThemeProvider` (`next-themes`, attribute `class`, `enableSystem: false`) takes over.
- Section identity goes on the content container; never `setTheme` on navigation. Nested themes paint
  themselves via `:where(.theme-x:not(:root))`.
- Every theme sets `color-scheme`. App `:root` defaults must stay in `@layer base`.
- `dark:` follows the class: `@custom-variant dark (&:is(.dark, .dark *));`

Fonts: M3 reference typefaces are Google Sans Flex / Google Sans Code.

## Tailwind v4 wiring

```css
/* apps/web/src/app/globals.css */
@import "tailwindcss" source("../.."); /* the build may run from the monorepo root */
@import "@aphrody/m3-theme/tokens.css";
@source "../../../../packages/m3-baseui/src"; /* symlinked workspace sources are not detected */
@plugin "@tailwindcss/typography";
```

An app can instead use `@import "tailwindcss" source(none);` with an explicit `@source` list. Apps compile through
`@aphrody/bun-plugin-tailwind/postcss` (`postcss.config.mjs`).

## Next.js 16 on Bun

- Next is the `aphrody-labs/next.js` fork (`next 16.5.0-canary.5`, root `package.json` override);
  run it with `@aphrody/next-bun` (`next-bun dev|start`). `bunfig.toml` sets `env = false` so Next loads its own env files.
- `proxy.ts` (not `middleware.ts`) with a narrow literal matcher and optimistic cookie checks.
- `next.config.ts`: `reactCompiler: true`, `transpilePackages` for workspace sources,
  `optimizePackageImports` for barrels, `outputFileTracingRoot`/`turbopack.root` at the repo root
  for standalone output.
- LCP: `fetchPriority="high"` + `loading="eager"` on the first hero image only; `priority` is
  deprecated in Next 16 (`preload` replaces it).
- Read `node_modules/next/dist/docs/` for the installed version before writing Next code.

## Accessibility defaults

Visible focus with a forced-colors outline (`CanvasText`), `prefers-reduced-motion` gating in
consumers, `color-scheme` per theme, 44px touch targets,
`aria-current="page"` in navigation, no zoom lock in `viewport`, and Baseline widely available
features by default (newer features behind `@supports`).
