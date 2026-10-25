<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-theme

One generated Material 3 stylesheet (`tokens.css`, light and dark) that maps the shadcn/ui and Tailwind v4 colour aliases
onto the `--md-sys-color-*` roles.

```sh
bun add @aphrody/m3-theme
```

```ts
import "@aphrody/m3-theme/tokens.css"; // Bun bundles the CSS into the page
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

The roles are the ones [`@aphrody/material-web`](https://www.npmjs.com/package/@aphrody/material-web) reads. Import the
sheet once and style with either vocabulary; no app hand-rolls colour values.

## What's in `tokens.css`

- the M3 system palette `--md-sys-color-*` (light `:root`, dark via
  `@media (prefers-color-scheme: dark)` **and** a `.dark` class for a forced
  theme);
- the **shadcn/ui** alias block (`--background`, `--primary`, `--border`, …)
  mapped onto the M3 roles;
- the **Tailwind v4** `@theme inline` block (`--color-background`, …).

Because the shadcn and Tailwind aliases reference `var(--md-sys-color-*)`, the
dark theme only re-declares the M3 palette — the aliases follow automatically.

## Use

```html
<!-- force the dark theme regardless of the OS preference -->
<html class="dark"></html>
```

Then style with the M3 roles (`background: var(--md-sys-color-surface)`) or the
shadcn aliases (`var(--background)` / `var(--primary)`).

## Regenerate

```sh
bun run generate                                   # tokens.css, tailwind.css, spaceui.css
M3_SEED=#1a73e8 M3_VARIANT=vibrant bun run generate  # another seed / variant for tokens.css
bun run fixture:mcu                                # refresh the Rust parity fixture
```

The sheets are rendered in Rust (`crates/aphrody-m3-tokens/src/sheets.rs`) and reached through
`m3Css()` of `@aphrody/bun`; this package holds no colour tables. The Rust colour science is an
exact port of `@material/material-color-utilities` (2021 spec): `test/sheets.test.ts` and
`cargo test -p aphrody-m3-tokens` check every role against it. `tokens.css` is the tonal-spot
scheme of the M3 baseline seed `#6750A4`, all 49 roles, light and dark.

## `tailwind.css` and `spaceui.css`

- **`tailwind.css`**: every M3 system token as a Tailwind v4 utility — all colour roles
  (`bg-surface-container`, `text-on-surface-variant`, fixed roles), the extended `success` /
  `warning` roles, state layers as opacity modifiers (`hover:bg-on-surface/8`), the 10-step shape
  scale (`rounded-extra-large`), the typescale (`text-label-large`), `font-brand|plain|code`,
  elevation (`shadow-md3-1..5`), easings (`ease-emphasized-decelerate`) and the M3 breakpoints
  (`medium:`, `expanded:`, `large:`, `extra-large:`).
- **`spaceui.css`**: the seven SpaceUI themes (dark, light, midnight, noir, slate, nord, mocha) as
  M3 dynamic schemes under their upstream selectors, plus the SpaceUI compatibility utilities
  (`bg-app-box`, `text-ink-dull`, `rounded-window`) resolved to M3 roles and state layers. Use it
  instead of `tokens.css` in SpaceUI-derived apps.

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-theme/spaceui.css"; /* or tokens.css */
@import "@aphrody/m3-theme/tailwind.css";
```

The SpaceUI tables mirror `crates/aphrody-m3-tokens/src/spaceui.rs`; `bun test` fails when they
drift or when a committed sheet is stale. Mapping and rules: `docs/architecture/ui/design/SPACEUI-M3-FUSION.md`.

## Runtime theme

Colours come only from the Rust owner `crates/aphrody-m3-tokens`. The page's compiled sheets
(`m3:theme.css` from the `@aphrody/m3` plugin, `tokens.css`, a brand sheet) carry the build-time
theme. Nothing in this package derives a colour or writes a `--md-sys-color-*` role inline, so the
Rust `@media (prefers-contrast: more)` blocks keep their effect.

A different seed, variant or contrast is the Rust `scheme` sheet (`m3Css({ sheet: "scheme", ... })`
of `@aphrody/bun`, or an app-server route answering with it), installed as one `<style>` element
together with its contrast-1 twin under `@media (prefers-contrast: more)`. Without a sheet source
the change fails with an explicit error.

### 1. Vanilla JS/TS: `applyDynamicFusionTheme`

```ts
import { applyDynamicFusionTheme, type M3SchemeSheet } from "@aphrody/m3-theme";

const sheet: M3SchemeSheet = async request =>
  (
    await fetch(
      `/api/m3/scheme.css?${new URLSearchParams(Object.entries(request).map(([k, v]) => [k, String(v)]))}`,
    )
  ).text();

await applyDynamicFusionTheme("#6750A4", {
  dark: false,
  contrastLevel: 0,
  variant: "tonalSpot",
  sheet,
});
```

Options: `dark` (default: the target's `.dark` class or `prefers-color-scheme`), `target` (default
`<html>`; another element is scoped through `data-m3-scheme`), `contrastLevel` in `[-1, 1]`,
`variant` and `sheet`. `applyM3Mode(dark, target)` sets only the mode classes and `color-scheme`;
`clearM3Scheme(target)` returns to the compiled theme. Invalid input or a sheet that is not a Rust
`scheme` sheet rejects and leaves the installed theme unchanged.

### 2. React: `M3ThemeProvider` & `useM3Theme`

The `default*` props describe the compiled theme. While the theme equals them, the provider only
sets the mode. `setSeedColor`, `setVariant` and `setContrastLevel` throw when no `sheet` prop is
given; a failing sheet source is exposed as `schemeError`.

```tsx
import { M3ThemeProvider, useM3Theme } from "@aphrody/m3-theme/react";

function App() {
  return (
    <M3ThemeProvider
      defaultSeedColor="#6750a4"
      defaultThemeMode="system"
      sheet={sheet}
    >
      <YourMainAppLayout />
    </M3ThemeProvider>
  );
}
```

### 3. Tauri 2.0 Integration: `useM3TauriThemeSync` & `M3TauriTitlebar`

For React applications compiled into Tauri 2.0 desktop shells, this package provides seamless, zero-dependency integration helpers to manage native window styling:

- **`useM3TauriThemeSync`**: A custom React hook that automatically synchronizes the M3 theme mode (light/dark) back to the Tauri native window context, allowing native context menus and dialog boxes to match your application's appearance.
- **`M3TauriTitlebar`**: A highly polished, Material Design 3 custom titlebar component. It handles window dragging (`data-tauri-drag-region`), maximize/restore state, and window actions (minimize, maximize, close) without external library requirements, automatically hiding when the application runs in a normal web browser.

```tsx
import { M3ThemeProvider } from "@aphrody/m3-theme/react";
import { M3TauriTitlebar, useM3TauriThemeSync } from "@aphrody/m3-theme/tauri";

function MainAppLayout() {
  // Syncs M3 theme mode back to Tauri window
  useM3TauriThemeSync();

  return (
    <div className="flex flex-col h-screen">
      {/* Renders a custom M3 borderless titlebar for the desktop app */}
      <M3TauriTitlebar title="My Material App" logo={<AppLogo />} />
      <div className="flex-1 overflow-auto">{/* Your content */}</div>
    </div>
  );
}
```

## Relationship to `@aphrody/m3-tokens`

The Rust crate `aphrody-m3-tokens` owns the canonical role definitions and generated
sheets. `@aphrody/m3-tokens` supplies the web-facing dynamic-colour API, CSS and
breakpoint projection. `m3-theme` adds the shadcn and Tailwind aliases, so Lit web
components and React utilities resolve to the same M3 roles. Keep runtime web output
in parity with the Rust contract; do not maintain a second palette table.
