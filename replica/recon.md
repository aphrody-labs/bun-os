# Recon Map: Omarchy (`https://omarchy.fr/`) & Repositioning Aphrody as a Consumer OS

## Step 1: Scope

1. **Target Product & Platform:**
   - **Product:** Omarchy (`https://omarchy.fr/` / `https://omarchy.org/`), created by David Heinemeier Hansson (DHH).
   - **Platform:** Web showcase, marketing site, distribution landing page, and live OS ecosystem.
   - **Target Persona:** Everyday users, creators, thinkers, and modern professionals seeking a beautiful, cohesive, playful, and agentic personal operating system.

2. **Core Loop:**
   - Discover a breathtakingly simple, opinionated operating system -> Experience the aesthetic and philosophy through interactive previews, themes, and soundscapes -> Launch or install in one click -> Live in a calm, unified desktop where native apps and proactive agentic AI work together harmoniously without configuration friction.

3. **Strategic Repositioning for Aphrody:**
   - **The Problem:** Aphrody previously presented itself as an engineering showcase of internal plumbing: *“COSMIC desktop, Redox microkernel, Wine, Proton, Upstream Bun 1.4.4, libcosmic, wgpu…”*. To a consumer or business user, this reads like an internal dependencies list, not a desirable consumer product.
   - **The Resolution:** Aphrody must be sold as a **grand-public consumer Operating System**. The underlying engines (Rust, Bun, Wayland, ART, Wine) are silent implementation details. The user-facing identity is pure, refined, human-centric, and calm: **Aphrody — L'OS beau, calme et intelligent**.

---

## Step 2: Sources Table

| # | Source | URL | What It Gives Us |
|---|---|---|---|
| 1 | Official Landing Page (FR) | `https://omarchy.fr/` | Consumer positioning, manifesto ("Nous pouvons tout réparer"), agentic vision, theme switcher, ambient music player, hardware compatibility pitch. |
| 2 | Official Landing Page (Global) | `https://omarchy.org/` | International pitch, download CTAs, plugin ecosystem overview, community numbers. |
| 3 | Public Manual | `https://omarchy.org/manual/` | Complete feature hierarchy, desktop workflow, app bundling, navigation patterns. |
| 4 | Theme Manual & Gallery | `https://omarchy.org/manual/themes/` | 22 curated aesthetic themes (Solitude, Tokyo Night, Kanagawa, etc.), palette tokens, visual mood. |
| 5 | Plugin Catalogue | `https://plugins.omarchy.org/` | Micro-app extensions, widget ecosystem (Omagotchi, Radio Atlas, Omasweeper). |
| 6 | GitHub Source & Community | `https://github.com/omacom/omarchy` | Technical structure, branding assets, release schedule, package manifest. |

---

## Step 3: Screen Inventory

| ID | Screen / Section | Route / Location | Purpose | Key Components | States Seen |
|---|---|---|---|---|---|
| **S01** | **Hero & Manifesto** | `/` (Top) | Establish emotional connection, announce the OS, state the core philosophy | Brand mark, manifesto eyebrow, poetic headline, primary "Try / Install" CTA, interactive laptop/screen frame | Default, hover, mobile |
| **S02** | **Hardware Freedom** | `/#hardware` | Reassure consumer that it runs everywhere without buying a $2,000 new machine | 3 hardware category cards: New laptops, Vintage Macs, Modest PCs; badge chips | Normal, card focus |
| **S03** | **Playful Plugins & Widgets** | `/#plugins` | Delight the user with personality (not just spreadsheets and terminals) | Interactive widget cards: Ambient Radio, Virtual Pet (Omagotchi), AirPods integration, Time Machine | Active preview, audio playing |
| **S04** | **Agentic Intelligence** | `/#agents` | Present AI as an intuitive extension of the human, not a developer CLI | Multi-agent selector, crash comprehension explainer, "Make it your own" visual demo | Chat preview, interactive slider |
| **S05** | **Live Theme Showcase** | `/#themes` | Give tactile control over the visual identity with instant gratification | Theme pill buttons, dynamic background & laptop frame recoloring, contrast badges | 22 active themes, active pill |
| **S06** | **Universal App Compatibility** | `/#apps` | Reassure that work and entertainment both run effortlessly ("Il fait même tourner Windows !") | App grid: Browsers, media players, productivity tools, Windows compatibility note | Default, icon hover |
| **S07** | **Social Proof & Momentum** | `/#community` | Establish trust, credibility, and open-source momentum | Download counter, contributor avatars, community testimonials, GitHub stars | Live stats, animated ticker |
| **S08** | **Ambient Audio Player** | Floating Dock (Bottom Left) | Imbue the experience with calm, focus, and physical product charm | Vinyl/cassette artwork, play/pause toggle, track progress bar, sound equalizer bars | Playing, paused, muted |
| **S09** | **Live WebOS Session** | `/` (Desktop Mode) | Deliver the promise immediately in the browser without installing anything | Full-screen WebGPU canvas, floating return-to-showcase bar, window switcher | Loading, streaming, active |

---

## Step 4: User Flows

```
F01 Consumer Discovers and Evaluates Aphrody
    S01 (Hero Manifesto) -> S05 (Interactive Theme Preview) -> S03 (Playful Widgets & Pet) -> S06 (App Compatibility)
    Happy path: 3 scrolls or 2 tab clicks to understand the value proposition.
    Edge cases: Visitor on mobile device, slow network (lazy load media), prefers reduced motion.

F02 Instant Web Experience (Zero Installation)
    S01 -> Click "Essayer dans le navigateur" / "Launch WebOS" -> S09 (Live Streamed Desktop Session)
    Happy path: 1 click. Glass-to-glass latency under 15ms.
    Edge cases: Unauthenticated visitor offered instant guest or Google sign-in; WebGPU unsupported gracefully falls back to WebGL2.

F03 Customizing the Personal Aesthetic
    S05 -> Click theme pill ("Solitude", "Obsidian Gold", "Nordic Calm", "Sakura") -> Entire page and laptop preview transform
    Happy path: 1 click per theme. Immediate visual feedback.
    Edge cases: Theme persisted in localStorage for return visits.
```

---

## Step 5: Components

1. **Brand Bar (`.brand-header`):**
   - Clean typographic wordmark with subtle pet/sparkle emblem.
   - Minimalist nav links (L'OS, Intelligence, Applications, Thèmes, Essayer).
   - "Essayer en direct" pill button with soft ambient glow.

2. **Poetic Hero Block (`.hero-manifesto`):**
   - Eyebrow badge: "L'OS personnel réinventé pour l'ère des agents".
   - Headline: Large, human, confident, balanced.
   - Dual actions: "Essayer dans le navigateur" (Primary) and "Installer sur votre machine" (Secondary).

3. **Interactive Device Showcase (`.device-showcase`):**
   - Ultra-clean aluminum chassis mockup.
   - Live switchable desktop views (Bureau Calme, Compagnon Agentique, Applications Mobiles, Divertissement).
   - Zero terminal clutter or raw code listings in default consumer view.

4. **Curated Theme Switcher (`.theme-switcher`):**
   - Horizontal pill bar with color swatches.
   - Instant CSS variable morphing across backgrounds, cards, accents, and the laptop display.

5. **Ambient Sound / Music Capsule (`.ambient-player`):**
   - Floating pill with miniature album art, song title, play/mute toggle, and animated frequency bars.
   - Imparts a relaxing, artisanal atmosphere.

6. **Feature Trio Cards (`.story-card`):**
   - Soft container backgrounds (`rgba(255, 255, 255, 0.04)`), generous padding (32px+), refined typography, delicate 1px border.

---

## Step 6: Inferred Data Model

| Entity | Fields | Purpose | Confidence |
|---|---|---|---|
| **Theme** | `id`, `name`, `primaryColor`, `accentColor`, `surfaceColor`, `textColor`, `wallpaperUrl` | Powers the instant aesthetic switching | High |
| **Track** | `id`, `title`, `artist`, `audioUrl`, `artworkUrl`, `duration` | Powers the ambient music player | High |
| **SubsystemFeature** | `id`, `category` (productivity, ai, apps, gaming), `title`, `consumerDescription`, `icon` | Consumer-friendly abstraction over internal engines | High |
| **SessionProfile** | `userId`, `themeId`, `storageMode` (essential/functional), `installedApps` | User preferences persisted across sessions | High |

---

## Step 7: What Cannot / Should Not Be Cloned

1. **DHH's Personal Endorsement / 37signals Branding:**
   - *Skip.* Aphrody has its own voice: Byron Love, Aphrody Labs, and the official Pet Companion identity.
2. **Arch Linux Installation Friction:**
   - *Skip.* Omarchy requires ISO downloads, USB flashing, and hardware reboot. Aphrody's killer advantage is that it runs **instantly in the browser over WebGPU** as well as on bare metal.
3. **Developer-Only Jargon (AUR, Hyprland binds, Waybar configs):**
   - *Deliberately omitted.* All low-level technical machinery is relegated to secondary developer docs (`/docs` or `llms.txt`), never on the flagship consumer landing page.

---

## Step 8: Sizing

- **Scope:** Small to Medium (S/M).
- **Execution:** Pure HTML5 + CSS3 + modern vanilla ES modules. No heavy framework dependencies.
- **Estimated Build Time:** 1 focused iteration to revamp the landing page HTML/CSS/JS and deploy it to the live server.

---

## Output Summary

- **Core Loop:** Experience an elegant, calm, agentic personal OS directly in the browser with 1 click; customize themes and audio; run all favorite apps with zero technical friction.
- **Screen Count:** 9 distinct consumer surfaces and interactive viewports.
- **Flow Count:** 3 primary user journeys (Discovery -> Instant Web Launch -> Aesthetic Customization).
- **Key Paradigm Shift:** Banish the laundry list of libraries (*COSMIC, Redox, Wine, Bun*); replace it with an emotional, high-end consumer identity (*Un OS pur, beau et intelligent*).
- **Next Step:** Apply this purified consumer identity directly to `crates/aphrody-webos-client/web/index.html`, `site.css`, and `site.js`, then compile and deploy to `https://aphrody.com/`.
