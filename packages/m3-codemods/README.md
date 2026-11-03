<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-codemods

Codemods and ast-grep rules that migrate MUI React (`@mui/material`, `@mui/icons-material`) to `@aphrody/m3-react` and Material Symbols.

```sh
bun add -d @aphrody/m3-codemods
```

```ts
import { transformSource } from "@aphrody/m3-codemods";

const { source, diagnostics } =
  transformSource(`import { Button } from "@mui/material";
export const Save = () => <Button variant="outlined">Save</Button>;`);
console.log(source); // MdOutlinedButton from @aphrody/m3-react
console.log(diagnostics); // MIGRATION-TODO notes left for manual work
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

The source transforms run on Bun alone; `m3-bun migrate` runs them over a project. The theme migration below uses
`@aphrody/m3-tokens` for the colour roles MUI lacks.

## Theme migration

`muiThemeToTokens(theme, { darkTheme })` turns a MUI `createTheme` object into `--md-sys-*` CSS: colour roles from the
canonical engine seeded with `palette.primary.main`, the colours the theme spells out carried over, typography mapped
onto the M3 typescale and the corner scale rescaled by `shape.borderRadius / 4`.

```sh
bun scripts/theme.ts theme.json --dark dark.json > m3-theme.css
bun scripts/theme.ts --seed "#0b57d0"   # reference MUI themes with another primary
```

## Two tools

| Tool                       | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| transforms (`transforms/`) | Full rewrite: imports, JSX, props, slots; variant-aware and idempotent. |
| ast-grep rules (`rules/`)  | Inventory of what is left to migrate, plus a few trivial fixes.         |

## Transforms

All transforms share `lib/engine.ts` (mapping table `lib/mapping.ts`, JSX helpers `lib/jsx-helpers.ts`). Sources are read
by a TSX scanner (`lib/tsx-scan.ts`) and changed by positioned text edits (`lib/edits.ts`), so untouched code keeps its
formatting. Input must be TSX that `Bun.Transpiler` accepts; otherwise the file is left unchanged with a `SyntaxError`.

| Transform                    | Scope                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `transforms/orchestrator.ts` | The whole mapping (recommended for bulk migration).            |
| `transforms/mui-imports.ts`  | Same as the orchestrator (semantic alias).                     |
| `transforms/button.ts`       | `Button`, `IconButton`, `Fab` only (variant-aware).            |
| `transforms/fields.ts`       | `TextField`, `Select`, `NativeSelect` (+ `MenuItem`) only.     |
| `transforms/icons.ts`        | `@mui/icons-material` to `<md-icon>` (Material Symbols names). |

From a checkout of this package:

```sh
bun scripts/codemod.ts orchestrator 'src/**/*.tsx' --dry   # list the files that would change
bun scripts/codemod.ts icons src/App.tsx                   # write the change
```

Each transform exports `default (file: { path?, source }, api?, options?) => string`. `icons.ts` is separate (the
orchestrator does not touch `@mui/icons-material`): `<CloseIcon/>` becomes `<md-icon>close</md-icon>` through
`lib/icon-names.ts` (PascalCase to snake_case, checked against the 4253 official glyphs in
`data/material-symbols-names.json`); brand logos are kept with a TODO. The consolidated component and icon mapping is
`mui-m3-map.json` (`bun scripts/export-map-json.ts`). Targeted transforms (`button`, `fields`) touch only their components.

### Automated

- Imports: `@mui/material` named, default sub-path and aliased imports become one sorted
  `import { ... } from "@aphrody/m3-react"`; the side-effect import `@aphrody/material-web/icon/icon.js` is added when an
  `<md-icon>` is generated.
- Variant-aware wrappers: `Button` contained (or none) / outlined / text / elevated / tonal become `MdFilledButton`,
  `MdOutlinedButton`, `MdTextButton`, `MdElevatedButton`, `MdFilledTonalButton`; `TextField` and `Select` filled or
  outlined become the matching `MdFilled*` / `MdOutlined*`. The `variant` prop is consumed.
- One-to-one renames: `Checkbox` to `MdCheckbox`, `Switch` to `MdSwitch`, `Dialog` to `MdDialog`, `MenuItem` to
  `MdMenuItem`, `Divider` to `MdDivider`, `Typography` to `MdType`, and so on.
- Icons: `startIcon` / `endIcon` become `<md-icon slot="icon">` as the first child (TODO for `endIcon`).
- Slotted parts: `DialogTitle` / `DialogContent` / `DialogActions` and `CardContent` / `CardHeader` / `CardMedia` become
  `<div slot="headline|content|actions|media">` (with a TODO).
- Layout: `Box`, `Container`, `Stack`, `Grid`, `Paper` become `<div>` (TODO for Tailwind classes).
- Everything else gets a `MIGRATION-TODO` marker that is always valid JSX.

### Manual (marked `MIGRATION-TODO`)

- `sx`: removed; convert to Tailwind classes and `--md-sys-*` tokens. Tailwind cannot reach the shadow DOM of `md-*`.
- `onChange(e, value)`: material-web emits native `input` / `change` events; read `e.target.value`. Handler bodies are not
  rewritten.
- Props without an equivalent (`color`, `size`, `fullWidth`, `disableElevation`, `disableRipple`) are removed.
- Gap components (`Avatar`, `Alert`, `Breadcrumbs`, `Rating`, `Skeleton`, `Backdrop`, `Modal`, `Popover`, `Popper`, `Link`,
  transitions, `CssBaseline`, ...) are not transformed; their JSX and MUI import stay.
- Dialog and Card slots: check that each `<div slot>` is a direct child of the `md-*` parent.

### Known limits

- Handler bodies and controlled-state logic are not rewritten.
- Member-expression components (`<Foo.Bar/>`) and indirect re-exports (`import { Button } from "./ui"`) are not handled.
- `Tab` always becomes `MdPrimaryTab`.
- Children of a renamed element lose line-break JSX whitespace (cosmetic; run `bun fmt` afterwards).
- `startIcon` / `endIcon` on a self-closing element is removed without an `<md-icon>` (TODO added).

## ast-grep rules (`rules/`, `sgconfig.yml`)

```sh
ast-grep scan                                           # report for the project (from this directory)
ast-grep scan --filter '^fix-divider$' --update-all     # apply the Divider fix
```

| Rule                    | Kind            | Effect                                                     |
| ----------------------- | --------------- | ---------------------------------------------------------- |
| `detect-mui-imports`    | report, warning | Every `@mui/material` import (root and sub-paths).         |
| `detect-gap-components` | report, error   | Gap components without an `md-*` equivalent.               |
| `detect-sx-prop`        | report, warning | `sx` props to convert.                                     |
| `fix-divider`           | fixable         | `<Divider .../>` to `<md-divider ...>` (the import stays). |

The rules do not choose variants or manage imports; use the transforms for a real migration.

## Fixtures

Before/after fixtures live in `__testfixtures__/` (prefix `icons-` runs the `icons` transform, others the orchestrator).
`bun scripts/run-fixtures.ts` compares them (`--update` regenerates the expected outputs after an intended change).
