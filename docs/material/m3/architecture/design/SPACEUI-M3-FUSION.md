<!-- SPDX-License-Identifier: Apache-2.0 -->
# SpaceUI -> Material Design 3 fusion

[SpaceUI](https://github.com/spacedriveapp/spaceui) (Spacedrive and Spacebot design system, MIT)
is rebuilt on the Aphrody M3 system. This page is the token and component contract of the
`@aphrody/m3-*` React packages. Drive integration and ownership:
[`SPACEUI-SPACEDRIVE-MIGRATION.md`](./SPACEUI-SPACEDRIVE-MIGRATION.md). `drive/` keeps its
FSL-1.1-ALv2 provenance.

## Where everything went

| SpaceUI (`packages/aphrody-spaceui/` (not in repo), reference copy) | Aphrody |
| --- | --- |
| `packages/tokens` (not in repo) (7 HSL themes, `app/ink/sidebar/menu/accent/status`) | `crates/aphrody-m3-tokens/src/spaceui.rs`, `@aphrody/m3-theme` `spaceui.css` / `tailwind.css` |
| `@spacedrive/primitives` | `@aphrody/m3-primitives` (Base UI headless layer) |
| `@spacedrive/forms` | `@aphrody/m3-forms` |
| `@spacedrive/ai` | `@aphrody/m3-ai` |
| `@spacedrive/explorer` | `@aphrody/m3-explorer` |
| `@spacedrive/icons` | `@aphrody/assets` |
| `examples/showcase` | `examples/m3-spaceui-showcase` (Bun) |

`scripts/spaceui-to-m3.ts` (not in repo) is the deterministic first pass over upstream class names; component
anatomy is then aligned by hand to the rules below. Production code never imports the reference
copy.

## Tokens

Each SpaceUI theme is a dynamic-scheme seed: the SpaceUI accent `#2499ff` as primary, neutrals
keyed on the theme's `app` surface. Selectors are upstream's, so `class="nord-theme"` keeps
working: dark (`:root`, `.dark`, default), light (`.light`, `.vanilla-theme`), midnight, noir,
slate, nord, mocha. `success` and `warning` are M3 extended colours (`--md-ext-color-*`).

| SpaceUI | M3 | SpaceUI | M3 |
| --- | --- | --- | --- |
| `accent` | `primary` | `sidebar` | `surface-container-low` |
| `ink` | `on-surface` | `sidebar-box` | `surface-container` |
| `ink-dull` | `on-surface-variant` | `sidebar-selected` | `secondary-container` |
| `ink-faint` | `outline` | `menu` | `surface-container` |
| `app` | `surface` | `menu-selected` | `secondary-container` |
| `app-box` | `surface-container` | `app-selected` | `secondary-container` |
| `app-overlay`, `app-button` | `surface-container-high` | `app-line`, `app-divider` | `outline-variant` |
| `app-input`, `app-slider` | `surface-container-highest` | `status-error` / `status-info` | `error` / `primary` |
| `app-hover` | `on-surface` 8 % over the container | `app-active` | `on-surface` 10 % over the container |

Two sheets, import one palette sheet per app:

- `@aphrody/m3-theme/spaceui.css`: upstream utilities (`bg-app-box`, `text-ink-dull`) resolve to
  the roles above, so Spacedrive code re-themes without edits.
- `@aphrody/m3-theme/tailwind.css`: M3-native utilities used by the `@aphrody/m3-*` packages:
  colour roles (`bg-surface-container`), state layers (`hover:bg-on-surface/8`), shape
  (`rounded-extra-small` ... `rounded-full`), type (`text-label-large`), fonts (`font-brand`,
  `font-plain`, `font-code`), elevation (`shadow-md3-1..5`), easing (`ease-emphasized-*`) and
  breakpoints (`medium:`, `expanded:`, `large:`, `extra-large:`).

## Component rules

- **Colour.** M3 utilities only. Content on a container uses its pair (`bg-primary
  text-on-primary`); never `text-white`, hex values or `brightness-*`. Selection is
  `bg-secondary-container text-on-secondary-container`. Errors use `error` / `error-container`.
- **States.** Hover 8 %, focus 10 %, pressed 10 %, dragged 16 % of the content colour. Disabled:
  content 38 %, container 12 %. Focus ring: `focus-visible:outline-3 outline-secondary
  outline-offset-2`.
- **Shape.** Buttons, icon buttons, switches, slider handles, nav indicators, search bars:
  `rounded-full`. Chips: `rounded-small`. Cards, rich tooltips: `rounded-medium`. Menus, plain
  tooltips, snackbars, text fields: `rounded-extra-small`. FAB: `rounded-large`. Dialogs, sheets:
  `rounded-extra-large`.
- **Size.** M3 baselines are the default size (button 40, icon button 40 in a 48 target, chip 32,
  text field 56, menu item 48, list item 56, tab 48); smaller sizes are -4 dp density steps.
- **Type.** Buttons, tabs, chips, menu items: `text-label-large`. Field input: `text-body-large`.
  Helper text: `text-body-small`. Dialog title / body: `text-headline-small` / `text-body-medium`.
  Section headers: `text-title-small`.
- **Elevation.** Menus: `shadow-md3-2` on `surface-container`. Dialogs: `surface-container-high`,
  level 3. Snackbars: `inverse-surface` / `inverse-on-surface`, level 3.
- **Motion.** Enter `emphasizedDecelerate`, exit `emphasizedAccelerate`, small transitions
  `standard` at 200 ms, from `@aphrody/m3-motion`. Overlays animate in and out through Base UI's
  `data-starting-style` / `data-ending-style`; imperative motion uses `motion/react` with
  `m3Easings` / `m3Durations`.
- **Icons.** Material Symbols through `Icon` (`@aphrody/m3-primitives`); props that took a
  Phosphor component accept an `IconSource`.
- **APIs.** The former in-repository `@spacedrive/*` re-export facades are retired. Use the
  maintained `@aphrody/m3-*` packages; the upstream archive keeps MIT provenance and release
  history, not buildable packages or API compatibility shims.

## Base UI

`@base-ui/react` (version pinned in the root `catalog`) is the only headless layer under
`@aphrody/m3-primitives`; it owns behaviour, keyboard, focus, ARIA and positioning, the M3 layer
owns every class. No `@aphrody/m3-*` package depends on `@radix-ui/*` or `@headlessui/react`.
Radix-era props (`asChild`, `forceMount`, `delayDuration`, positioning props) are mapped onto Base
UI. Style on Base UI attributes, not Radix `data-state`:

| Radix | Base UI |
| --- | --- |
| `data-[state=checked]` / `unchecked` | `data-checked` / `data-unchecked` |
| `data-[state=on]` (toggle) | `data-pressed` |
| `data-[state=active]` (tab) | `data-active` |
| `data-[state=checked]` (select item) | `data-selected` |
| `data-[state=open]` on a popup / trigger | `data-open` / `data-popup-open` |
| `--radix-*-transform-origin`, `--radix-select-trigger-width` | `--transform-origin`, `--anchor-width` |

## Integration

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-theme/spaceui.css";   /* or tokens.css: one palette sheet per app */
@import "@aphrody/m3-theme/tailwind.css";
@source "../node_modules/@aphrody/m3-primitives/dist";
@source "../node_modules/@aphrody/m3-forms/dist";
@source "../node_modules/@aphrody/m3-ai/dist";
@source "../node_modules/@aphrody/m3-explorer/dist";
```

Register Material Symbols once with `ensureMaterialSymbols()`
(`@aphrody/material-web/icon/material-symbols.js`).
