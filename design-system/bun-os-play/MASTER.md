# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Bun OS Play
**Generated:** 2026-11-03 23:17:17
**Category:** Gaming
**Design Dials:** Variance 6/10 (Balanced / Modern) | Motion 6/10 (Standard) | Density 6/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Value | CSS Variable |
|------|-------|--------------|
| Primary | `var(--md-sys-color-primary)` | `--color-primary` |
| On Primary | `var(--md-sys-color-on-primary)` | `--color-on-primary` |
| Secondary | `var(--md-sys-color-secondary-container)` | `--color-secondary` |
| On Secondary | `var(--md-sys-color-on-secondary-container)` | `--color-on-secondary` |
| Accent/CTA | `var(--md-sys-color-tertiary-container)` | `--color-accent` |
| On Accent/CTA | `var(--md-sys-color-on-tertiary-container)` | `--color-on-accent` |
| Background | `var(--md-sys-color-surface)` | `--color-background` |
| Foreground | `var(--md-sys-color-on-surface)` | `--color-foreground` |
| Card | `var(--md-sys-color-surface-container-low)` | `--color-card` |
| Card Foreground | `var(--md-sys-color-on-surface)` | `--color-card-foreground` |
| Muted | `var(--md-sys-color-surface-variant)` | `--color-muted` |
| Muted Foreground | `var(--md-sys-color-on-surface-variant)` | `--color-muted-foreground` |
| Border | `var(--md-sys-color-outline-variant)` | `--color-border` |
| Destructive | `var(--md-sys-color-error)` | `--color-destructive` |
| On Destructive | `var(--md-sys-color-on-error)` | `--color-on-destructive` |
| Ring | `var(--md-sys-color-primary)` | `--color-ring` |

**Color Notes:** Roles only: the values come from the active scheme (@aphrody/m3-theme/tokens.css at build time, @aphrody/m3-tokens/wasm dynamic colour at runtime), both computed by crates/aphrody-m3-tokens. Never copy a resolved colour into a stylesheet.

### Typography

- **Heading Font:** Google Sans Flex
- **Body Font:** Google Sans Flex
- **Mono Font:** Google Sans Code
- **Mood:** material 3, expressive, variable optical size and width

**CSS Import:**
```css
@import "@aphrody/m3-fonts/fonts.css";
@import "@aphrody/m3-theme/tokens.css";
@import "@aphrody/m3-tokens/m3-tokens.css";
```

### Spacing Variables

*Density: 6/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `var(--md-sys-elevation-level1)` | Subtle lift |
| `--shadow-md` | `var(--md-sys-elevation-level2)` | Cards, buttons |
| `--shadow-lg` | `var(--md-sys-elevation-level3)` | Modals, dropdowns |
| `--shadow-xl` | `var(--md-sys-elevation-level4)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  padding: 12px 24px;
  border-radius: var(--md-sys-shape-corner-small);
  font-weight: 600;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  cursor: pointer;
}

.btn-primary:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-primary) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%), var(--md-sys-color-primary));
}

.btn-primary:focus-visible {
  background: color-mix(in srgb, var(--md-sys-color-on-primary) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%), var(--md-sys-color-primary));
  outline: 2px solid var(--md-sys-color-secondary);
  outline-offset: 2px;
}

.btn-primary:active {
  background: color-mix(in srgb, var(--md-sys-color-on-primary) calc(var(--md-sys-state-pressed-state-layer-opacity) * 100%), var(--md-sys-color-primary));
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--md-sys-color-primary);
  border: 1px solid var(--md-sys-color-outline);
  padding: 12px 24px;
  border-radius: var(--md-sys-shape-corner-small);
  font-weight: 600;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  cursor: pointer;
}

.btn-secondary:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%), transparent);
}

.btn-secondary:focus-visible {
  background: color-mix(in srgb, var(--md-sys-color-primary) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%), transparent);
  outline: 2px solid var(--md-sys-color-secondary);
  outline-offset: 2px;
}

.btn-secondary:active {
  background: color-mix(in srgb, var(--md-sys-color-primary) calc(var(--md-sys-state-pressed-state-layer-opacity) * 100%), transparent);
}

/* Windows High Contrast (forced colors) keeps the focus ring visible */
@media (forced-colors: active) {
  :focus-visible { outline-color: CanvasText; }
}
```

### Cards

```css
.card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-medium);
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  cursor: pointer;
}

.card:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%), var(--md-sys-color-surface-container-low));
}

.card:focus-visible {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%), var(--md-sys-color-surface-container-low));
  outline: 2px solid var(--md-sys-color-secondary);
  outline-offset: 2px;
}

.card:active {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-pressed-state-layer-opacity) * 100%), var(--md-sys-color-surface-container-low));
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  font-size: 16px;
  transition: border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.input:focus-visible {
  border-color: var(--md-sys-color-primary);
  outline: 2px solid var(--md-sys-color-secondary);
  outline-offset: 2px;
}
```

### Modals

```css
.modal-overlay {
  background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
}

.modal {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

### Motion and Color Scheme

```css
:root {
  color-scheme: dark;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Style Guidelines

**Style:** 3D & Hyperrealism

**Keywords:** Depth, realistic textures, 3D models, spatial navigation, tactile, skeuomorphic elements, rich detail, immersive

**Best For:** Gaming, product showcase, immersive experiences, high-end e-commerce, architectural viz, VR/AR

**Key Effects:** WebGL/Three.js 3D, realistic shadows (layers), physics lighting, parallax (3-5 layers), smooth 3D (300-400ms)

### Page Pattern

**Pattern Name:** Feature-Rich Showcase

- **Conversion Strategy:** Clear feature hierarchy. One key message per card. Strong CTA repetition.
- **CTA Placement:** Hero (sticky) + After features + Bottom
- **Section Order:** Hero (value prop) > Feature grid/cards (4-6) > Use cases or benefits > Social proof or logos > CTA

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Minimalist design
- ❌ Static assets

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Material Symbols, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y, including forced-colors mode
- ❌ **Lazy-loaded LCP image** — The LCP image gets `fetchPriority="high"` and `loading="eager"`

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide/Material Symbols)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] Focus visible in `forced-colors: active` (`outline-color: CanvasText`)
- [ ] `prefers-reduced-motion` respected
- [ ] `color-scheme` declared for light/dark
- [ ] LCP image uses `fetchPriority="high"` and `loading="eager"`
- [ ] Features limited to Baseline widely available (or progressively enhanced)
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
