# Library Page Overrides

> **PROJECT:** Bun OS Play
> **Generated:** 2026-11-03 23:17:16
> **Page Type:** General

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- No overrides — use Master colors

### Component Overrides

- Avoid: Ship dark tokens with light native controls
- Avoid: Rely only on box-shadow or background changes to show focus

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus
- Accessibility: Declare color-scheme light or dark on each theme root (or light dark when following the OS)
- Accessibility: Add an outline in CanvasText or Highlight under @media (forced-colors: active)
