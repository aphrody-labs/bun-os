<!-- SPDX-License-Identifier: Apache-2.0 AND MIT -->

# @aphrody/m3-design

Design compiler and design-intelligence CLI: turns a natural-language brief into an M3 React scaffold, a canonical M3 theme and design tokens.

```sh
bun add -d @aphrody/m3-design
```

```sh
m3-design compile --prompt "Responsive M3 monitoring dashboard" --color "#6750a4"
m3-design search "minimalism dark mode" --domain style
```

License: Apache-2.0 AND MIT (`LICENSE`, `LICENSES/`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-os/blob/main/docs/material/m3/INSTALL.md).

## Product design intelligence

This package is the shared design-system owner for Bun OS and Aphrody Labs.
Material 3 tokens, themes and components remain the source of truth for product
UI. The bundled `intelligence/ui-ux-pro-max` skill adds searchable design,
accessibility, responsive-layout and interaction guidance, with M3 selected as
the default product implementation stack. Its searchable data and references
ship with this package and are exposed through `bunos mcp` as the
`ui-ux-pro-max` skill. The skill comes from UI/UX Pro Max by Next Level
Builder (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT); its
`LICENSE` and `UPSTREAM.md` sit in `intelligence/ui-ux-pro-max`. Its search
scripts are a Bun-native port of the upstream Python and read the same CSV
catalogs, and a product-specific M3 design contract is prepended to the skill.

The CLI also ships the design tools of the Replica skills
(https://github.com/Jakeschincariol/replica-skill, MIT; notice in
`LICENSES/replica-skill-MIT.txt`): a WCAG contrast check of design tokens, a
feature parity score and a layout or pixel screenshot diff. Those three
modules (`src/contrast.ts`, `src/parity.ts`, `src/imgdiff.ts`) are MIT; the
rest of the package is Apache-2.0.

Run the MCP server from a Bun OS checkout with `bunos mcp`. From the checkout
root, `bun run bunos design` runs this CLI (`m3-design` once installed):

```sh
bun run bunos design search "minimalism dark mode" --domain style
bun run bunos design search "virtualized list" --stack react-native
bun run bunos design system "fintech crypto" -p "Ledger" -f markdown
bun run bunos design compile --prompt "Responsive M3 monitoring dashboard for an operator"
bun run bunos design contrast replica/design/tokens.json   # or two hex colours
bun run bunos design parity replica/features.csv --visual replica/diffs/*.json
bun run bunos design imgdiff original.png clone.png --out diff.png --json
```

`contrast`, `parity` and `imgdiff` exit 1 when the gate fails (a pair under
AA, a score under `--fail-under`) and 2 on unreadable input. The M3 tool host
(`@aphrody/m3-mcp`) serves the same commands as `m3_design_search`,
`m3_design_system`, `m3_contrast`, `m3_parity` and `m3_imgdiff`.

The design engine below generates artifacts against the same M3 component and
token system; do not introduce a parallel product palette when extending it.

`@aphrody/m3-design` is the natural-language design compiler of the **material-web** Material Design 3 monorepo. It turns raw, natural-language design briefs directly into **Material Design 3 (M3)** React scaffolds, emitting a production-ready `index.tsx` layout tree built on `@aphrody/m3-react` components, plus the light and dark `--md-sys-color-*` stylesheet of the seed and W3C design-token JSON.

It is meant to be a fast, deterministic scaffold generator for autonomous agents and tooling: it replaces manual visual-configuration forms with a semantic parser and the `aphrody-m3-tokens` Rust engine, reached through its WebAssembly build in `@aphrody/m3-tokens`.

---

## Architecture Overview

The package is split into decoupled components that translate a text spec into running code:

```mermaid
graph TD
    A[Raw Design Brief / Prompt] --> B[Semantic Parser]
    B -->|DesignBrief Parameters| C[Design Compiler]

    D[Seed Hex Color / Option] --> E[aphrody-m3-tokens ThemeExport]
    E -->|18 Tone Steps| F[CSS Custom Properties]

    C -->|Compiles template & applies configs| G[index.tsx Layout Code]
    F -->|System Token Mappings| H[theme.css Stylesheet]

    G --> I[Self-Critique Engine]
    H --> I
    I -->|Scores & Rationale| J[GenerationResult API Payload]
```

### 1. Semantic Parser (`src/parser.ts`)

Parses a raw natural-language prompt into structured design directives, extracting:

- **Output Kind**: target layout mode (`deck`, `prototype`, `dashboard`, `mobile`, `editorial`).
- **Adaptive Platform**: target device viewports (`desktop-web`, `ios`, `responsive-web`).
- **Layout Organization**: structural model (`scaffold`, `list-detail`, `supporting-pane`, `feed`).
- **Visual Density**: layout spacing (`high` compact, `default`, `low` loose).
- **Color Extraction**: detects hex patterns or color references (e.g. "dark blue", "compact red") to pick a seed color. The default seed is the M3 baseline `#6750A4`.
- **Feature Toggles**: auto-detects real-time streaming, thinking/shimmer indicators, and central action-router delegation.

### 2. Theme (`src/theme.ts`)

`generateTheme(seed, { variant, contrastLevel })` returns the ThemeExport of the canonical engine
(`aphrody_m3_tokens::theme::ThemeExport`): the 49 colour roles for light and dark, computed by
`crates/aphrody-m3-tokens` through `@aphrody/m3-tokens`. The package computes no colour itself.

- **Stylesheet**: `cssCustomProperties` declares every `--md-sys-color-*` role, light by default, dark under
  `prefers-color-scheme: dark` and `[data-theme="dark"]`.
- **Design tokens**: `src/tokens.json` is W3C design-token JSON keyed `color.<mode>.<role>`.
- **Parity**: `src/theme.test.ts` compares every role with the Rust goldens in
  `crates/aphrody-m3-tokens/tests/fixtures`.

### 3. Layout Generator (`src/generator.ts`)

The core code-generation engine. It processes the parsed `DesignBrief` and compiles the `SEED_TEMPLATE` into a finished React tree:

- **Import Aliasing**: every component in the generated artifact imports the real `Md*` export from `@aphrody/m3-react`, aliased to a friendly local name (e.g. `MdScaffold as Scaffold`, `MdType as TypeText`).
- **Layout Adapters**: mutates scaffolding structures (e.g. strips the navigation rail and adds a bottom app bar for mobile targets; restructures list items into slide sequences for deck outputs).
- **Self-Contained Primitives**: when a brief enables them, inline definitions for `ThinkingIndicator`, `StreamingText`, and the `useStreamingText` hook are injected directly into the artifact so the output compiles without external dependencies beyond `@aphrody/m3-react`.
- **Action Router / Registry**: when delegation is requested, a single root-level event handler dispatches `data-action` / `data-id` interactions through a central registry (see below).
- **Environment Injectors**: injects dark-mode classes and desaturates colors for additive environments (such as translucent AR/XR overlays).
- **Self-Critique Engine**: runs static analysis on the artifact and grades it across 5 axes: `philosophy`, `hierarchy`, `detail`, `functionalParity`, and `innovation`.

### 4. Server / CLI (`src/server.ts`)

Exposes the compiler via a Bun-native REST API server and a direct terminal CLI wrapper.

---

## Getting Started

> [!NOTE]
> bun only — `npm` and `pnpm` are not used in this monorepo. Run all tasks from this package directory (`packages/m3-design/`).

### Running via CLI

```bash
bun src/server.ts --prompt "Make a dark, compact dashboard in blue" --color "#0F52BA"
```

### Starting the HTTP Server

```bash
bun src/server.ts
```

---

## REST API Specification

### Generate Layout and Palette

- **Endpoint**: `POST /api/generate`
- **Content-Type**: `application/json`

#### Request Payload

| Field       | Type     | Required | Description                                                   |
| :---------- | :------- | :------- | :------------------------------------------------------------ |
| `prompt`    | `string` | **Yes**  | Natural language text defining design layout requirements.    |
| `seedColor` | `string` | No       | Hex string (e.g., `#6750A4`) seeding the canonical M3 scheme. |

#### Response Schema (`GenerationResult`)

```json
{
  "brief": {
    "outputKind": "deck",
    "platforms": ["desktop-web"],
    "audience": "general users",
    "tones": ["minimal"],
    "seedColor": "#0F52BA",
    "scale": "8 slides",
    "constraints": "Dark mode first",
    "rawBrief": "Make a dark compact deck in blue",
    "layoutType": "scaffold",
    "density": "high",
    "hasThinkingIndicator": false,
    "hasStreaming": false,
    "hasActionRouter": false
  },
  "theme": {
    "seed": "#0f52ba",
    "themeExport": {
      "schema_version": 1,
      "spec_version": "2021",
      "seed": "#0f52ba",
      "variant": "tonal-spot",
      "contrast_level": 0,
      "light": { "primary": "...", "onPrimary": "..." },
      "dark": { "primary": "...", "onPrimary": "..." }
    },
    "cssCustomProperties": ":root {
  color-scheme: light dark;
  --md-sys-color-background: ..."
  },
  "files": [
    { "path": "src/theme.css", "content": "..." },
    { "path": "src/tokens.json", "content": "..." },
    { "path": "src/index.tsx", "content": "..." }
  ],
  "critique": {
    "scores": {
      "philosophy": 90,
      "hierarchy": 92,
      "detail": 95,
      "functionalParity": 98,
      "innovation": 94
    },
    "rationale": "M3 design compiler successfully mapped the brief..."
  }
}
```

---

## Mapped Component Catalog

The layout generator scaffolds against a catalog of components imported from `@aphrody/m3-react`. Each friendly local name aliases the real `Md*` React wrapper.

| Category           | Local Name           | Real Export            | Custom Element              |
| :----------------- | :------------------- | :--------------------- | :-------------------------- |
| **Action**         | `ElevatedButton`     | `MdElevatedButton`     | `<md-elevated-button>`      |
|                    | `FilledButton`       | `MdFilledButton`       | `<md-filled-button>`        |
|                    | `FilledTonalButton`  | `MdFilledTonalButton`  | `<md-filled-tonal-button>`  |
|                    | `OutlinedButton`     | `MdOutlinedButton`     | `<md-outlined-button>`      |
|                    | `TextButton`         | `MdTextButton`         | `<md-text-button>`          |
|                    | `IconButton`         | `MdIconButton`         | `<md-icon-button>`          |
|                    | `FilledIconButton`   | `MdFilledIconButton`   | `<md-filled-icon-button>`   |
|                    | `Fab`                | `MdFab`                | `<md-fab>`                  |
|                    | `BrandedFab`         | `MdBrandedFab`         | `<md-branded-fab>`          |
|                    | `ButtonGroup`        | `MdButtonGroup`        | `<md-button-group>`         |
|                    | `FabMenu`            | `MdFabMenu`            | `<md-fab-menu>`             |
|                    | `FabMenuItem`        | `MdFabMenuItem`        | `<md-fab-menu-item>`        |
| **Forms & Select** | `Checkbox`           | `MdCheckbox`           | `<md-checkbox>`             |
|                    | `Radio`              | `MdRadio`              | `<md-radio>`                |
|                    | `Switch`             | `MdSwitch`             | `<md-switch>`               |
|                    | `Slider`             | `MdSlider`             | `<md-slider>`               |
|                    | `AssistChip`         | `MdAssistChip`         | `<md-assist-chip>`          |
|                    | `FilterChip`         | `MdFilterChip`         | `<md-filter-chip>`          |
|                    | `InputChip`          | `MdInputChip`          | `<md-input-chip>`           |
|                    | `SuggestionChip`     | `MdSuggestionChip`     | `<md-suggestion-chip>`      |
|                    | `ChipSet`            | `MdChipSet`            | `<md-chip-set>`             |
|                    | `DatePicker`         | `MdDatePicker`         | `<md-date-picker>`          |
|                    | `TimePicker`         | `MdTimePicker`         | `<md-time-picker>`          |
| **Inputs**         | `FilledTextField`    | `MdFilledTextField`    | `<md-filled-text-field>`    |
|                    | `OutlinedTextField`  | `MdOutlinedTextField`  | `<md-outlined-text-field>`  |
| **Communication**  | `Dialog`             | `MdDialog`             | `<md-dialog>`               |
|                    | `CircularProgress`   | `MdCircularProgress`   | `<md-circular-progress>`    |
|                    | `LinearProgress`     | `MdLinearProgress`     | `<md-linear-progress>`      |
|                    | `Snackbar`           | `MdSnackbar`           | `<md-snackbar>`             |
|                    | `LoadingIndicator`   | `MdLoadingIndicator`   | `<md-loading-indicator>`    |
| **Navigation**     | `Tabs`               | `MdTabs`               | `<md-tabs>`                 |
|                    | `PrimaryTab`         | `MdPrimaryTab`         | `<md-primary-tab>`          |
|                    | `SecondaryTab`       | `MdSecondaryTab`       | `<md-secondary-tab>`        |
|                    | `Menu`               | `MdMenu`               | `<md-menu>`                 |
|                    | `MenuItem`           | `MdMenuItem`           | `<md-menu-item>`            |
|                    | `NavigationRail`     | `MdNavigationRail`     | `<md-navigation-rail>`      |
|                    | `NavigationRailItem` | `MdNavigationRailItem` | `<md-navigation-rail-item>` |
|                    | `TopAppBar`          | `MdTopAppBar`          | `<md-top-app-bar>`          |
|                    | `BottomAppBar`       | `MdBottomAppBar`       | `<md-bottom-app-bar>`       |
| **Containment**    | `List`               | `MdList`               | `<md-list>`                 |
|                    | `ListItem`           | `MdListItem`           | `<md-list-item>`            |
|                    | `Divider`            | `MdDivider`            | `<md-divider>`              |
|                    | `BottomSheet`        | `MdBottomSheet`        | `<md-bottom-sheet>`         |
|                    | `SideSheet`          | `MdSideSheet`          | `<md-side-sheet>`           |
|                    | `Carousel`           | `MdCarousel`           | `<md-carousel>`             |
|                    | `CarouselItem`       | `MdCarouselItem`       | `<md-carousel-item>`        |
| **Layout Panes**   | `Scaffold`           | `MdScaffold`           | `<md-scaffold>`             |
|                    | `Pane`               | `MdPane`               | `<md-pane>`                 |
|                    | `ListDetail`         | `MdListDetail`         | `<md-list-detail>`          |
|                    | `SupportingPane`     | `MdSupportingPane`     | `<md-supporting-pane>`      |
| **Enterprise**     | `Tooltip`            | `MdTooltip`            | `<md-tooltip>`              |
|                    | `ExpansionPanel`     | `MdExpansionPanel`     | `<md-expansion-panel>`      |
|                    | `Accordion`          | `MdAccordion`          | `<md-accordion>`            |
|                    | `GridList`           | `MdGridList`           | `<md-grid-list>`            |
|                    | `GridTile`           | `MdGridTile`           | `<md-grid-tile>`            |
|                    | `Table`              | `MdTable`              | `<md-table>`                |
|                    | `Paginator`          | `MdPaginator`          | `<md-paginator>`            |
|                    | `VirtualScroller`    | `MdVirtualScroller`    | `<md-virtual-scroller>`     |
|                    | `Stepper`            | `MdStepper`            | `<md-stepper>`              |
|                    | `Step`               | `MdStep`               | `<md-step>`                 |
|                    | `Autocomplete`       | `MdAutocomplete`       | `<md-autocomplete>`         |
|                    | `Tree`               | `MdTree`               | `<md-tree>`                 |
|                    | `TreeItem`           | `MdTreeItem`           | `<md-tree-item>`            |
| **Typography**     | `TypeText`           | `MdType`               | `<md-type>`                 |
|                    | `WebgpuCanvas`       | `MdWebgpuCanvas`       | `<md-webgpu-canvas>`        |

---

## Physical Motion Presets

In alignment with **Material Design 3 motion**, transition timings enforce standard spring profiles via CSS cubic-bezier parameters.

> [!IMPORTANT]
> Always match the correct preset mode to the visual property being animated.

- **Spatial Animations**: components moving across dimensions (expanding sidebar, dragging sliders, dialog scales).
- **Effects Animations**: opacity shifts and background color state changes (hover shadows, active highlights, fades).

### Spring Presets Specification Table

| Preset Name         | Damping Ratio | Cubic Bezier Curve                     | Target Duration | Common Uses                   |
| :------------------ | :------------ | :------------------------------------- | :-------------- | :---------------------------- |
| **Fast Spatial**    | `0.9`         | `cubic-bezier(0.42, 1.67, 0.21, 0.90)` | `350 ms`        | Slide panels, quick lists.    |
| **Default Spatial** | `0.9`         | `cubic-bezier(0.38, 1.21, 0.22, 1.00)` | `500 ms`        | Modal dialog openings, rails. |
| **Fast Effects**    | `1.0`         | `cubic-bezier(0.31, 0.94, 0.34, 1.00)` | `150 ms`        | Opacity fades, hover changes. |
| **Default Effects** | `1.0`         | `cubic-bezier(0.34, 0.80, 0.34, 1.00)` | `200 ms`        | Color updates, page loads.    |

---

## Action Router Delegation

When a brief requests delegation, the generated code uses a **centralized event-delegation pattern** to optimize performance and avoid event-listener pollution.

Rather than binding distinct `onClick` listeners to hundreds of separate elements, a single root-level handler listens at the viewport boundary and dispatches interactions through a central registry keyed by `data-action`, passing along `data-id`.

> [!TIP]
> This routing model lowers memory footprint and avoids component re-renders during interactions.

```tsx
export default function GeneratedArtifact() {
  // Action registry dynamically mapped based on layout actions
  const actionRegistry: Record<string, (id: string | null) => void> = {
    "toggle-dialog": () => {
      const dialog = document.querySelector("md-dialog");
      if (dialog) (dialog as any).open = !(dialog as any).open;
    },
    "select-item": id => {
      console.log("Delegated select-item:", id);
    },
  };

  // Central action router
  const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
    const actionElement = (e.target as HTMLElement).closest("[data-action]");
    if (!actionElement) return;

    const action = actionElement.getAttribute("data-action");
    const id = actionElement.getAttribute("data-id");
    console.log(`[Action Router] Action: ${action}, ID: ${id}`);

    if (action && actionRegistry[action]) {
      actionRegistry[action](id);
    }
  };

  return (
    <div onClick={handleInteraction} className="min-h-screen bg-background">
      <TopAppBar>
        <ElevatedButton data-action="toggle-dialog" data-id="main-spec-modal">
          Show Specs
        </ElevatedButton>
      </TopAppBar>

      <List>
        <ListItem
          headline="Spring Config"
          data-action="select-item"
          data-id="spring-item"
        />
      </List>
    </div>
  );
}
```

---

## Workspace Specifications

All modules are clean, type-safe ESM exports:

- `src/types.ts`: core models (`DesignBrief`, `M3Theme`, `GeneratedFile`, `GenerationResult`).
- `src/parser.ts`: natural-language prompt parsing.
- `src/theme.ts`: the ThemeExport of the seed from the canonical engine.
- `src/prompts.ts`: directive mappings, the seed template, and visual catalogs.
- `src/generator.ts`: the layout compiler.
- `src/handlers.ts`: side-effect-free HTTP handler and CLI runner.
- `src/server.ts`: application entrypoint (starts the HTTP server or runs the CLI).

### Testing

```bash
bun test        # unit suites (parser, theme, generator)
bun check -p tsconfig.json --noEmit
```
