# Googlebook / Aluminium OS — Component Specifications

> **Target Source**: `https://googlebook.google/intl/fr_fr/`  
> **Reconstruction Target**: Bun OS Assistant & Aluminium Desktop Shell  
> **Token Base**: [`replica/googlebook/design/tokens.json`](tokens.json) & [`tokens.css`](tokens.css)

---

## 1. PointerAssistantCursor (Shake to Invoke)
- **Purpose**: Wiggling the hardware mouse pointer expands a glowing aura and summons the local assistant.
- **Variants**: Default cursor, Shake detected (expanding aura), Active assistant reticle.
- **Sizes**: 24px cursor + 48px ambient aura halo.
- **States**: Idle, Shaking (`animation: pointerGlowPulse 400ms infinite`), Attached to target window.
- **Tokens**: `box-shadow: var(--gb-glow-ambient)`, `border: 2px solid var(--gb-glow-bar)`.
- **Accessibility**: Pointer shake threshold can be configured or replaced with hotkey (`Alt+Space`) for motor-impaired users.
- **Used on**: S03.

---

## 2. AssistantSheet (Side Drawer & Conversation HUD)
- **Purpose**: Floating side drawer showing conversation, contextual document understanding, or smart suggestions.
- **Variants**: Compact HUD (420px width), Full split screen (50% desktop width).
- **Sizes**: Height 100vh, border-radius `var(--gb-radius-lg)` on mobile / pill border.
- **States**: Collapsed (hidden), Slide-in (`transform: translateX(0)`), Loading skeleton, Response stream.
- **Tokens**: `background: var(--gb-surface)`, `border-left: 1px solid var(--gb-border)`, `box-shadow: var(--gb-shadow-lg)`.
- **Accessibility**: `role="dialog"`, `aria-modal="true"`, focus trapped inside sheet when open, `Esc` closes drawer.
- **Used on**: S03, S05, S07.

---

## 3. DictationPill (Smart Speech Input)
- **Purpose**: Dynamic input pill showing real-time audio waveform, filler-word removal, and punctuation formatting.
- **Variants**: Floating capsule, Attached to active text input.
- **Sizes**: Height 36px, padding `0 14px`, border-radius `var(--gb-radius-pill)`.
- **States**: Listening (audio wave bars pulsating), Processing (amber indicator), Formatted text output.
- **Tokens**: `background: var(--gb-surface-elevated)`, `border: 1px solid var(--gb-accent)`, `color: var(--gb-text)`.
- **Accessibility**: Visual live captions displayed alongside speech waveform for hearing-impaired users.
- **Used on**: S04.

---

## 4. VoiceOverlay & HardwareGlowBar
- **Purpose**: Fullscreen ambient voice assistant mode with active screen sharing and hardware LED lightbar indicator.
- **Variants**: Hardware edge glow (bottom edge of screen), Floating voice orb.
- **Sizes**: Glow bar 4px height along screen edge; Orb 64×64px centered.
- **States**: Wake word detected, Listening, Thinking, Speaking.
- **Tokens**: `box-shadow: var(--gb-glow-hardware)`, `color: var(--gb-glow-bar)`.
- **Accessibility**: Screen-share boundary indicator in high-contrast cyan to prevent accidental private data sharing.
- **Used on**: S02, S05.

---

## 5. AIFilesCard (Semantic File Manager)
- **Purpose**: File explorer cards with automatically generated content summaries and semantic topic tags.
- **Variants**: Grid card (220×180px), Detailed list row (48px height).
- **Sizes**: Standard card `var(--gb-radius-md)`.
- **States**: Default, Hover, Tag highlighted, Selected.
- **Tokens**: `background: var(--gb-surface)`, `border: 1px solid var(--gb-border)`, `text: var(--gb-text)`, `tags: var(--gb-text-muted)`.
- **Accessibility**: Full keyboard focus ring (`2px solid var(--gb-border-focus)`), `aria-label` contains auto-generated summary.
- **Used on**: S06.

---

## 6. DeviceContinuityTray (Phone Handoff & App Mirror)
- **Purpose**: System tray showing connected phone battery, recent photos, clipboard sync, and one-click app streaming.
- **Variants**: Collapsed tray icon, Expanded continuity drawer (320px width).
- **Sizes**: Touch target 44×44px for quick actions.
- **States**: Connected, Syncing, Streaming active window, Disconnected.
- **Tokens**: `background: var(--gb-surface)`, `border: 1px solid var(--gb-border)`.
- **Accessibility**: Live connection status announced via `aria-live="polite"`.
- **Used on**: S07.

---

## 7. HardwareSpecCard (Aluminium Platform Metrics)
- **Purpose**: Spec cards displaying hardware benchmarks (16 GB RAM, 256 GB SSD, 14h battery, Snapdragon X / Intel Core Ultra, <1.29 kg).
- **Variants**: Numeric metric badge, Illustrated chassis breakdown.
- **Sizes**: Grid column 1fr, min-height 140px.
- **States**: Default, Animated counter trigger.
- **Tokens**: `background: var(--gb-surface)`, `border: 1px solid var(--gb-border)`, `accent: var(--gb-accent)`.
- **Used on**: S02.

---

## 8. HeroBuyCTA (Action & Platform Pricing)
- **Purpose**: Hero purchase button and tier comparison selector (from 1,099 €).
- **Variants**: Primary pill CTA, Secondary spec comparison button.
- **Sizes**: Height 48px (lg), padding `0 28px`, border-radius `var(--gb-radius-pill)`.
- **States**: Default, Hover (`background: var(--gb-accent-hover)`), Focus-visible, Active.
- **Tokens**: `background: var(--gb-accent)`, `color: var(--gb-on-accent)`, `font-weight: var(--gb-weight-semibold)`.
- **Accessibility**: Minimum target 48px height; 6.29:1 contrast ratio (AAA Large text).
- **Used on**: S01, S10.
