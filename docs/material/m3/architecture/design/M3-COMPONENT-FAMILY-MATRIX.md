<!-- SPDX-License-Identifier: Apache-2.0 -->
# Material Design 3 web component family matrix

This document defines the canonical multi-host component matrix for Aphrody UI, establishing the roles, boundaries, and interoperability between the Lit web component line (`@aphrody/material-web` and `@aphrody/m3-react`), the headless React/Tailwind line (`@aphrody/m3-primitives`, `@aphrody/m3-forms`, `@aphrody/m3-explorer`), and their host adapters.

## Architecture and Host Engines

| Host Environment | Primary Component Line | Secondary / Bridge Line | Token Authority | Styling Engine |
|---|---|---|---|---|
| **Tauri Desktop (`aphrody-app`)** | `@aphrody/m3-primitives`, `@aphrody/m3-forms`, `@aphrody/m3-explorer` | `@aphrody/material-web` (Lit elements on demand) | Rust `aphrody-m3-tokens` via web projections | Tailwind CSS v4 + `@aphrody/m3-theme` |
| **Next.js Web (`examples/m3-next`)** | `@aphrody/m3-primitives`, `@aphrody/m3-forms`, `@aphrody/m3-explorer` via `@aphrody/m3-next` | N/A (Server-side rendering + React 19 client components) | Rust `aphrody-m3-tokens` via web projections | Tailwind CSS v4 + `@aphrody/m3-theme` |
| **Webview / Embedded / Obscura** | `@aphrody/material-web` (`<md-*>`) | `@aphrody/m3-react` | Rust `aphrody-m3-tokens` via web projections | Material 3 Web Component Tokens (`md-sys-color-*`) |
| **Aphrody Drive Web (`drive/apps/web`)** | `@aphrody/app-ui` | `@aphrody/m3-*` | Rust `aphrody-m3-tokens` via web projections | Tailwind CSS v4 + SpaceUI scheme adapter |

---

## 19 Component Families Matrix

| Family | `@aphrody/material-web` (Lit) | `@aphrody/m3-react` (Bridge) | `@aphrody/m3-primitives` (Tailwind + Base UI) | Accessibility / ARIA Contract |
|---|---|---|---|---|
| **Button** | `<md-filled-button>`, `<md-outlined-button>`, `<md-text-button>`, `<md-elevated-button>`, `<md-tonal-button>` | `MdFilledButton`, `MdOutlinedButton`, `MdTextButton`, `MdElevatedButton`, `MdTonalButton` | `Button` (variants: `filled`, `outlined`, `text`, `elevated`, `tonal`) | `role="button"`, `tabindex="0"`, Enter/Space activation, `focus-visible:outline-3` |
| **Icon Button** | `<md-icon-button>`, `<md-filled-icon-button>`, `<md-outlined-icon-button>`, `<md-tonal-icon-button>` | `MdIconButton`, `MdFilledIconButton`, `MdOutlinedIconButton`, `MdTonalIconButton` | `Button` (with `icon` or icon-only size) | `aria-label` required, min 48x48dp tap target |
| **Checkbox** | `<md-checkbox>` | `MdCheckbox` | `Checkbox` (`BaseUI.Checkbox`) | `role="checkbox"`, `aria-checked`, Space toggle |
| **Chips** | `<md-chip-set>`, `<md-assist-chip>`, `<md-filter-chip>`, `<md-input-chip>`, `<md-suggestion-chip>` | `MdChipSet`, `MdAssistChip`, `MdFilterChip`, `MdInputChip`, `MdSuggestionChip` | `TagPill` (`@aphrody/m3-explorer`), `SelectPill` | `role="button"` or `role="checkbox"`, separate remove action focus target |
| **Dialog** | `<md-dialog>` | `MdDialog` | `Dialog`, `DialogRoot`, `DialogContent`, `DialogTrigger` (`BaseUI.Dialog`) | `role="dialog"`, `aria-modal="true"`, focus trap, Escape to dismiss, focus restore |
| **Divider** | `<md-divider>` | `MdDivider` | `Separator` (`BaseUI.Separator`) | `role="separator"`, `aria-orientation` |
| **Elevation** | `<md-elevation>` | `MdElevation` | `shadow-md3-1` .. `shadow-md3-5` utilities | Pure presentation, no ARIA role |
| **FAB** | `<md-fab>`, `<md-branded-fab>` | `MdFab`, `MdBrandedFab` | `Button` (variant: `fab`, `rounded-large`) | `role="button"`, primary action elevation 3 |
| **Field / Input** | `<md-filled-text-field>`, `<md-outlined-text-field>` | `MdFilledTextField`, `MdOutlinedTextField` | `Input` (`BaseUI.Input`), `InputField` (`@aphrody/m3-forms`) | `aria-invalid`, `aria-describedby`, label association |
| **Icon** | `<md-icon>` | `MdIcon` | `Icon` (Material Symbols via SVG/font) | `aria-hidden="true"` or `role="img"` with `aria-label` |
| **List** | `<md-list>`, `<md-list-item>` | `MdList`, `MdListItem` | `SpaceItem`, list utilities | `role="list"`, `role="listitem"`, Arrow key navigation |
| **Menu** | `<md-menu>`, `<md-menu-item>` | `MdMenu`, `MdMenuItem` | `Dropdown`, `DropdownMenu` (`BaseUI.Menu`) | `role="menu"`, `role="menuitem"`, Arrow navigation, Escape to close |
| **Progress** | `<md-linear-progress>`, `<md-circular-progress>` | `MdLinearProgress`, `MdCircularProgress` | `Progress` (`BaseUI.Progress`) | `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| **Radio** | `<md-radio>` | `MdRadio` | `RadioGroup`, `Radio` (`BaseUI.RadioGroup`) | `role="radiogroup"`, `role="radio"`, Arrow selection |
| **Ripple** | `<md-ripple>` | `MdRipple` | M3 state layers (`before:opacity-8`, `active:opacity-10`) | Pure visual interaction layer |
| **Select** | `<md-filled-select>`, `<md-outlined-select>` | `MdFilledSelect`, `MdOutlinedSelect` | `Select` (`BaseUI.Select`), `SelectField` (`@aphrody/m3-forms`) | `role="combobox"`, `aria-expanded`, popup listbox |
| **Slider** | `<md-slider>` | `MdSlider` | `Slider` (`BaseUI.Slider`) | `role="slider"`, Arrow step, PageUp/PageDown, Home/End |
| **Switch** | `<md-switch>` | `MdSwitch` | `SwitchField` (`@aphrody/m3-forms`) | `role="switch"`, `aria-checked`, Space/Enter toggle |
| **Tabs** | `<md-tabs>`, `<md-primary-tab>`, `<md-secondary-tab>` | `MdTabs`, `MdPrimaryTab`, `MdSecondaryTab` | `TabsRoot`, `TabsList`, `TabsTrigger`, `TabsContent` (`BaseUI.Tabs`) | `role="tablist"`, `role="tab"`, `role="tabpanel"`, Arrow keys |

---

## Form Contracts: `m3-primitives` vs `m3-forms`

To eliminate ambiguity between the two form offerings:

1. **`@aphrody/m3-forms`** is the **high-level form family**:
   - `Form`: React Hook Form `FormProvider` context alias (`<Form {...formMethods}>`).
   - `FormField`: Field controller wrapping input and state context.
   - `FormItem`: Container grouping label, control, and supporting text with consistent M3 spacing.
   - `FormLabel`: Accessible label (`text-label-large` for fields, `text-body-large` for inline controls, turns `text-error` on validation failure).
   - `FormControl`: Clones child input to attach `aria-describedby`, `id`, and `aria-invalid`.
   - `FormDescription`: M3 supporting text (`text-body-small`).
   - `FormMessage`: Error message with leading error icon and `role="alert"`.
   - Field components: `InputField`, `CheckboxField`, `SwitchField`, `SelectField`, `RadioGroupField`, `TextAreaField`.

2. **`@aphrody/m3-primitives`** supplies:
   - `FormRoot`: The actual HTML `<form>` element wrapping a `<fieldset>` and `FormProvider` (`<FormRoot form={form} onSubmit={...}>`).
   - `Form`: Backward-compatible alias for `FormRoot`.
   - `ErrorMessage`: Animated error supporting text (`m3Durations`, `m3Easings`, `Icon error`).

---

## Explorer Presentation: `m3-explorer` vs `app-ui`

1. **`@aphrody/m3-explorer`** owns **generic presentational file management UI**:
   - `TagPill`: Accessible M3 filter/input chip with separate button triggers for click and remove.
   - `RenameInput`: Generic text input with inline extension badge, auto-select, Enter/Escape keyboard handling.
   - `FileThumb`: Presentational image/icon box with layered thumbnail loading, bearded icons, and M3 selection outlines.
   - `GridItem`: M3 selectable grid tile with thumbnail, title, volume capacity indicator, and tags.

2. **`@aphrody/app-ui`** owns **Drive domain logic and host integration**:
   - Selection context, range selection, multi-selection.
   - File-service daemon RPC commands (rename, delete, move, tags).
   - Sidecar URL resolution (`ServerContext`) and video thumbstrip scrubber (`ThumbstripScrubber`).
   - Context menus with system integration and AI contextual actions (OCR, transcription, RAG).
