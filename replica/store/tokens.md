# Store design tokens (WebOS Material 3 only)

Components use CSS custom properties from the WebOS Material 3 token set (`--md-sys-*`, defined by `@aphrody/m3-tokens` and applied by `apps/webos/src/m3.ts`, `styles.css`, `themes.ts`). No raw hex, rgb or hsl in `appstore.css`; no fixed pixel radii; a theme switch (light/dark/seed colour) restyles the Store with no extra code.

## Color roles

| Role | Token |
|------|-------|
| Window and page background | `--md-sys-color-surface` |
| Shelf and card background | `--md-sys-color-surface-container` (raised: `-high`, hero/detail header: `-highest`, quiet: `-low`) |
| Primary text | `--md-sys-color-on-surface` |
| Secondary text | `--md-sys-color-on-surface-variant` |
| Primary action | `--md-sys-color-primary` / `--md-sys-color-on-primary` |
| Tonal action, selected chip, selected tab | `--md-sys-color-secondary-container` / `--md-sys-color-on-secondary-container` |
| Hero overlay and install bar accent | `--md-sys-color-primary-container` / `--md-sys-color-on-primary-container` |
| Qualified badge | `--md-sys-color-tertiary-container` / `--md-sys-color-on-tertiary-container` |
| Dividers and outlines | `--md-sys-color-outline-variant`, `--md-sys-color-outline` |
| Errors, failed qualification | `--md-sys-color-error` |
| Scrim (lightbox, dialogs) | `--md-sys-color-scrim` |
| Toast | `--md-sys-color-inverse-surface` / `--md-sys-color-inverse-on-surface` |

Source badges use the tonal pairs only (secondary, tertiary, primary containers); a source is identified by its label, never by colour alone.

## Shape

App icon tile: `--md-sys-shape-corner-large`. Cards and shelves: `--md-sys-shape-corner-medium`. Hero: `--md-sys-shape-corner-extra-large`. Chips: `--md-sys-shape-corner-small`. Buttons and search field: `--md-sys-shape-corner-full`. Screenshots: `--md-sys-shape-corner-medium`.

## Elevation

Resting cards level0 (tonal surface container, no shadow); hovered tile `--md-sys-elevation-level1`; sticky install bar and hero arrows `--md-sys-elevation-level2`; lightbox and menus `--md-sys-elevation-level3`. Shadows use `--md-sys-elevation-shadow-color`.

## Type scale (`--md-sys-typescale-<role>-{font,size,weight,line-height,tracking}`)

| Use | Role |
|-----|------|
| Hero headline | `display-small` (1440px), `headline-medium` (390px) |
| Page and detail title | `headline-medium` |
| Shelf heading | `title-large` |
| Tile name, section label | `title-medium` |
| Body, description | `body-large` |
| Summary, tile caption | `body-medium` |
| Badges, chips, buttons | `label-large`; metadata `label-medium`; stat captions `label-small` |

## Spacing and layout

A 4px base grid: 4, 8, 12, 16, 24, 32 (declared once as `--store-space-*` in `appstore.css` from multiples of 4px). Content max width 1200px, tile 112px wide, hero height 280px at 1440 and 200px at 390. Minimum target 48px.

## Motion

Slides, sheets: `--md-sys-motion-duration-medium2` with `--md-sys-motion-easing-emphasized`. Hover and state layer: `--md-sys-motion-duration-short2` with `--md-sys-motion-easing-standard`. Skeleton shimmer: `--md-sys-motion-duration-extra-long2` linear loop. All disabled under `prefers-reduced-motion`.

## State layers

Hover and focus overlays come from the M3 components (`md-*` elements); custom clickable tiles use `color-mix` of `--md-sys-color-on-surface` at the standard state-layer opacities (hover 8%, focus 10%, pressed 10%) over the container color.

## Icons and art

App icons are the real ones the catalog provides (`icon` glyph or package art); otherwise a monogram on `--md-sys-color-secondary-container`. Illustrations for empty and error states are original inline SVG drawn with `currentColor` and the tokens above. Nothing is loaded from play.google.com or microsoft.com.
