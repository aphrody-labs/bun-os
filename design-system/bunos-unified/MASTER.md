# Bun OS Unified Master Design System

# Material 3 Expressive × Aluminium OS × Android 17 × ChromiumOS × Google Workspace

> **LOGIC:** When building or refactoring any Bun OS surface, first check `design-system/bunos-unified/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise, strictly follow the rules below.

---

**Product:** Bun OS (Unified In-Browser WebOS & Local Native Image)  
**Target Environments:**

1. **In-Browser WebOS**: `aphrody.com` session running full desktop shell, apps & WebAssembly runtime
2. **Local Native OS**: Bootable Bun OS image running COSMIC (`libcosmic` / Iced) and Hyprland (Wayland)
3. **Desktop Native Apps**: Spotcraft, Spacedrive, Storyteller, Artcraft, bunos-wsl
4. **Websites & Docs**: `aphrody.com`, `googlebook.google` replica surfaces, developer hubs

---

## 1. Architectural Vision & Subsystem Convergence

Bun OS unites 5 core OS paradigms into one seamless, pixel-perfect experience:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BUN OS UNIFIED RUNTIME                          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ 1. Aluminium OS (Googlebook) Intelligence & Hardware Layer     │   │
│   │    • Gemini Live full-duplex Voice HUD                         │   │
│   │    • Dynamic 4-color bottom Glow Bar (--bunos-glowbar-radial)  │   │
│   │    • Dedicated G-Key Launcher trigger (F12 / Copilot rebind)   │   │
│   │    • Magic Pointer shake detection & Rambler speech dictation  │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────┴────────────────────────────────┐   │
│   │ 2. Android 17 Material 3 Expressive (M3E) Shell & Shape System │   │
│   │    • 28dp pill radius shelf & system tiles                     │   │
│   │    • Dynamic tonal color extraction from seed (#8c6c88)        │   │
│   │    • "Continue on Aluminium" & "Cast My Apps" phone streaming  │   │
│   │    • Touch-ready target bounds (≥48×48px)                      │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────┴────────────────────────────────┐   │
│   │ 3. ChromiumOS Window & Desktop Compositor Management           │   │
│   │    • Floating center-aligned shelf with active running pills   │   │
│   │    • Quick Settings drawer (Wi-Fi, BT, Live, Night Light)      │   │
│   │    • Multi-profile tabs & seamless web app sandboxing          │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────┴────────────────────────────────┐   │
│   │ 4. Google Workspace & Spotcraft Productive Canvas              │   │
│   │    • Drive file browser with M3 pill navigation drawer         │   │
│   │    • Docs / Sheets / Slides high-contrast document canvas      │   │
│   │    • Instant Spotcraft / WGA omnibox search & Lens lookup      │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Canonical Color Roles (Material 3 Expressive)

Generated from the canonical seed `#8c6c88` via `aphrody-m3-tokens`:

### Light Mode (`:root` / `Light`)

| Role                          | Hex       | CSS Custom Property                        |
| :---------------------------- | :-------- | :----------------------------------------- |
| **Surface**                   | `#fff7fa` | `--md-sys-color-surface`                   |
| **Surface Container Lowest**  | `#ffffff` | `--md-sys-color-surface-container-lowest`  |
| **Surface Container Low**     | `#fdf0f7` | `--md-sys-color-surface-container-low`     |
| **Surface Container**         | `#f7ebf1` | `--md-sys-color-surface-container`         |
| **Surface Container High**    | `#f1e5eb` | `--md-sys-color-surface-container-high`    |
| **Surface Container Highest** | `#ebdfe6` | `--md-sys-color-surface-container-highest` |
| **On Surface**                | `#201a1e` | `--md-sys-color-on-surface`                |
| **On Surface Variant**        | `#4e444b` | `--md-sys-color-on-surface-variant`        |
| **Outline**                   | `#7f747c` | `--md-sys-color-outline`                   |
| **Outline Variant**           | `#d1c3cc` | `--md-sys-color-outline-variant`           |
| **Primary**                   | `#7e4d7c` | `--md-sys-color-primary`                   |
| **On Primary**                | `#ffffff` | `--md-sys-color-on-primary`                |
| **Primary Container**         | `#ffd6f8` | `--md-sys-color-primary-container`         |
| **On Primary Container**      | `#643663` | `--md-sys-color-on-primary-container`      |
| **Secondary**                 | `#6d586a` | `--md-sys-color-secondary`                 |
| **On Secondary**              | `#ffffff` | `--md-sys-color-on-secondary`              |
| **Secondary Container**       | `#f6dbf0` | `--md-sys-color-secondary-container`       |
| **Tertiary**                  | `#825247` | `--md-sys-color-tertiary`                  |
| **On Tertiary**               | `#ffffff` | `--md-sys-color-on-tertiary`               |
| **Tertiary Container**        | `#ffdad2` | `--md-sys-color-tertiary-container`        |

### Dark Mode (`[data-theme="dark"]` / `Dark`)

| Role                          | Hex       | CSS Custom Property                        |
| :---------------------------- | :-------- | :----------------------------------------- |
| **Surface**                   | `#181116` | `--md-sys-color-surface`                   |
| **Surface Container Lowest**  | `#120c11` | `--md-sys-color-surface-container-lowest`  |
| **Surface Container Low**     | `#20191f` | `--md-sys-color-surface-container-low`     |
| **Surface Container**         | `#251d23` | `--md-sys-color-surface-container`         |
| **Surface Container High**    | `#2f272d` | `--md-sys-color-surface-container-high`    |
| **Surface Container Highest** | `#3b3238` | `--md-sys-color-surface-container-highest` |
| **On Surface**                | `#ebdfe6` | `--md-sys-color-on-surface`                |
| **On Surface Variant**        | `#d1c3cc` | `--md-sys-color-on-surface-variant`        |
| **Outline**                   | `#9a8d96` | `--md-sys-color-outline`                   |
| **Outline Variant**           | `#4e444b` | `--md-sys-color-outline-variant`           |
| **Primary**                   | `#efb4e9` | `--md-sys-color-primary`                   |
| **On Primary**                | `#4b1f4b` | `--md-sys-color-on-primary`                |
| **Primary Container**         | `#643663` | `--md-sys-color-primary-container`         |
| **On Primary Container**      | `#ffd6f8` | `--md-sys-color-on-primary-container`      |
| **Secondary**                 | `#d9bfd3` | `--md-sys-color-secondary`                 |
| **On Secondary**              | `#3c2b3b` | `--md-sys-color-on-secondary`              |
| **Secondary Container**       | `#544151` | `--md-sys-color-secondary-container`       |
| **Tertiary**                  | `#f6b8a9` | `--md-sys-color-tertiary`                  |
| **On Tertiary**               | `#4c251d` | `--md-sys-color-on-tertiary`               |
| **Tertiary Container**        | `#663b31` | `--md-sys-color-tertiary-container`        |

---

## 3. Aluminium OS & Gemini Intelligence Tokens

Derived from the official Googlebook / Aluminium OS release captures:

```css
:root {
  /* Dynamic Aluminium OS Gradient Wallpaper */
  --bunos-gradient-wallpaper: linear-gradient(
    135deg,
    #10141d 0%,
    #171d2b 40%,
    #1e122b 75%,
    #2a1523 100%
  );
  --bunos-gradient-light: linear-gradient(
    135deg,
    #f8fafc 0%,
    #f1f5f9 50%,
    #fdf2f8 100%
  );

  /* Gemini Bottom Glow Bar Aura */
  --bunos-glowbar-radial: radial-gradient(
    ellipse 80% 100% at bottom center,
    rgba(66, 133, 244, 0.42) 0%,
    rgba(219, 68, 55, 0.32) 28%,
    rgba(244, 180, 0, 0.28) 58%,
    rgba(15, 157, 88, 0.32) 85%,
    transparent 100%
  );
  --bunos-glowbar-active-pulse: 0 0 48px 12px rgba(66, 133, 244, 0.35);
  --bunos-glowbar-height: 80px;

  /* Dedicated G-Key Accent & Glow */
  --bunos-g-key-surface: #252a36;
  --bunos-g-key-glow: 0 0 16px rgba(126, 77, 124, 0.5);

  /* Pointer Shake & Dictation HUD */
  --bunos-pointer-shake-scale: 1.4;
  --bunos-rambler-capsule-bg: rgba(30, 25, 34, 0.88);
  --bunos-rambler-capsule-blur: blur(20px);
}
```

---

## 4. Android 17 / ChromiumOS Shelf & Window Metrics

| Element                   | Geometry              | Metric / Token                                | Description                            |
| :------------------------ | :-------------------- | :-------------------------------------------- | :------------------------------------- |
| **Floating Shelf Height** | Fixed height          | `56px`                                        | Floating 12px above bottom screen edge |
| **Shelf Corner Radius**   | M3 Corner Extra Large | `28px` (`--md-sys-shape-corner-extra-large`)  | Android 17 rounded pill shelf          |
| **Shelf Margin**          | Horizontal padding    | `16px`                                        | Detached from display edges            |
| **App Icon Dimensions**   | Square target         | `40×40px` (touch target `48×48px`)            | Crisp high-DPI vector icons            |
| **Active App Indicator**  | Pill dot / dash       | `4×4px` circle or `16×3px` bar                | Underneath active app icon             |
| **Quick Settings Pill**   | Pill                  | Height `40px`, Radius `9999px`                | Time, battery, Wi-Fi, Gemini Live      |
| **Window Frame Radius**   | Rounded rect          | `14px` (Hyprland) / `16px` (COSMIC / Web)     | Smooth anti-aliased corners            |
| **Window Border**         | Active gradient       | `2px` at 45° from `--primary` to `--tertiary` | Subtle active focus indicator          |

---

## 5. Google Workspace & Canvas Styling

- **Unified Navigation Drawer**: Width `256px`, pill items with `height: 44px`, `border-radius: 9999px`. Active state background: `--md-sys-color-secondary-container`.
- **Top Omnibar Search**: Height `48px`, `border-radius: 9999px`, background `--md-sys-color-surface-container-high`, subtle icon padding `16px`.
- **Canvas Area**: Background `--md-sys-color-surface-container-lowest` (pure white in light, `#120c11` in dark), inset shadows for document viewports.
- **Tab Bar**: Clean M3 shape with active tab connected to canvas without hard border lines.

---

## 6. Multi-Target Implementation Matrix

| Target           | Emitter File                                 | Generated Output                                                                                    | Applied Rules                                             |
| :--------------- | :------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| **Hyprland**     | `packages/m3-os-themes/src/hyprland.ts`      | `hypr/themes/BunOS-{mode}.conf`, `waybar/themes/BunOS-{mode}.css`, `fuzzel/themes/BunOS-{mode}.ini` | 14px rounding, active border gradient, 28px waybar shelf  |
| **COSMIC**       | `packages/m3-os-themes/src/cosmic.ts`        | `M3-BunOS-{mode}.ron`, builder config v2                                                            | sRGB float RON values, window hint, neutral tint          |
| **ChromiumOS**   | `packages/m3-os-themes/src/chromium.ts`      | MV3 theme manifest, NTP background, BrowserThemeColor                                               | System frame colors, active/inactive tab tints            |
| **WebOS / Web**  | `packages/m3-os-themes/src/apps.ts`          | `packages/m3-os-themes/generated/bunos-m3.css`                                                      | Complete `--md-sys-*` tokens + Glow Bar custom properties |
| **Desktop Apps** | `crates/bunos-design` & `packages/m3-design` | Native themes for Iced, egui, and Tauri Spacedrive                                                  | Exact token parity across Rust systems and JS wrappers    |

---

## 7. Pre-Delivery Quality Checklist

- [x] No raw hex in UI components — all colors bound to `--md-sys-color-*` or `--bunos-*`
- [x] Light & Dark mode contrast ≥ 4.5:1 (verified by `bunos-design` and `contrast.py`)
- [x] No emoji as icons — 100% SVG (Heroicons / Lucide / Material Symbols)
- [x] Touch & click target minimum 48×48px with `cursor: pointer`
- [x] Transition timings strictly between 150ms and 250ms with `cubic-bezier(0.2, 0.0, 0, 1.0)`
- [x] `prefers-reduced-motion` suppresses parallax and glow pulses
- [x] Multi-target consistency: identical color roles across Hyprland, COSMIC, Chromium, and WebOS.
