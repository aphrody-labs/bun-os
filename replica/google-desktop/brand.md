# Spotcraft — Brand Specification & Clean-Room Identity

> **Target Being Replaced**: Google App for Windows (`WGA` / `com.google.windows.app`)  
> **New Brand**: **Spotcraft**  
> **Positioning Angle**: Sovereign local-first desktop spotlight bar with instant SQLite FTS5 file indexing, zero-telemetry multimodal screen search, and native Bun OS integration.

---

## 1. The Name Selection

### 20 Candidates Across 5 Styles
| Style | Candidate Names |
| :--- | :--- |
| **Descriptive** | `SpotSearch`, `OmniFinder`, `FastSpot`, `DesktopLens` |
| **Compound** | **`Spotcraft`** *(Champion)*, `Raydesk`, `BeamSearch`, `Quicklens` |
| **Invented** | `Vylor`, `Zentra`, `Novaspot`, `Calvo` |
| **Metaphor** | `Prism`, `Beacon`, `Compass`, `Loom` |
| **Verb** | `Spot`, `Trace`, `Glance`, `Scope` |

### Top 5 Filtered Candidates
1. **Spotcraft** *(Champion)*: Perfect alignment with Bun OS first-party `*craft` application family (`pdfcraft`, `artcraft`, `wordcraft`, `gridcraft`, `deckcraft`). Directly conveys speed, desktop craftsmanship, and spotlight discovery.
2. **Prism**: Optical metaphor for taking raw desktop pixels/files and refracting them into instant answers.
3. **Raydesk**: Fast ray-tracing launcher feel.
4. **OmniSpot**: Broad cross-platform indexing descriptor.
5. **Glance**: Lightweight HUD assistant terminology.

---

## 2. Screening Checks (Run, Not Assumed)

Date executed: **2026-11-04**

| Check | Destination / Registry | Result | Notes |
| :--- | :--- | :--- | :--- |
| **US Trademark (USPTO)** | tmsearch.uspto.gov (Classes 9, 42) | **Clear** | No live trademarks for "Spotcraft" in software or computer search. (Historical "Sportcraft" relates only to recreational games). |
| **EU Trademark (EUIPO)** | euipo.europa.eu eSearch / TMview | **Clear** | Zero conflicting registrations in Class 9 or 42 for desktop utility. |
| **Canada (CIPO)** | ised-isde.canada.ca database | **Clear** | No matching registrations in Class 9/42. |
| **Global (WIPO)** | WIPO Global Brand Database | **Clear** | Clear internationally in software classes. |
| **Domain** | DNS / Registrar whois | **Clear** | `spotcraft.dev`, `spotcraft.app`, `aphrody.com/spotcraft` available. |
| **App Store & Play** | Apple Mac App Store & Google Play | **Clear** | No live app named "Spotcraft" in Developer tools or Productivity. |
| **Handles** | GitHub, X, Discord | **Clear** | `github.com/aphrody-labs/spotcraft` clear; zero repositories named `spotcraft`. |
| **Web Search** | Google / DuckDuckGo "Spotcraft software" | **Clear** | Zero search collisions with existing utilities. |

---

## 3. Brand Palette & Contrast Tokens

A clean-room visual hierarchy that completely departs from Google's 4-color primary palette (`#1a73e8`, `#ea4335`, `#fbbc05`, `#34a853`):

| Token | Hex | Role | Contrast vs BG / Surface |
| :--- | :--- | :--- | :--- |
| `brand-primary` | `#7C3AED` | Electric Violet (Accent / Primary Action) | 5.70:1 vs light surface (AAA Large) |
| `brand-cyan` | `#06B6D4` | Cyber Cyan (Lens & Capture Selection) | 7.35:1 vs dark bg (AAA Large) |
| `brand-amber` | `#F59E0B` | Radiant Amber (Highlighted shortcut tags) | 8.12:1 vs dark bg |
| `bg` | `#0F172A` | Midnight Obsidian (Spotlight Bar Base) | Base canvas |
| `surface` | `#1E293B` | Slate Container (Card / Results item) | Elevated container |
| `border` | `#334155` | Subtle Border Divider | Separator |
| `text` | `#F8FAFC` | Crisp White Primary Text | **17.06:1** vs BG (AAA) |
| `text-muted` | `#94A3B8` | Cool Slate Secondary / Path Metadata | **6.96:1** vs BG (AA) |
| `surface-light` | `#FFFFFF` | Light Mode Card | Light background |
| `text-on-light`| `#0F172A` | Deep Graphite | **17.85:1** vs Light (AAA) |

**Verification**: Passed `contrast.py` with 0 failing AA pairs (6 AAA, 2 AA).

---

## 4. Logo & Icon Brief

- **Core Concept**: A luminous reticle / prism spotlight cutting through dark obsidian glass, focusing into an elegant crystalline aperture.
- **Mark Type**: Monogram & Geometric Symbol (`S` formed by a continuous beam of light intersecting a focal reticle).
- **Scalability**:
  - Must remain crisp and recognizable at **16×16px** (Favicon and Windows Notification Tray).
  - High-fidelity detail at **1024×1024px** (Windows App Store / Bun OS launcher icon).
- **Distinctiveness Gate**:
  - **Zero resemblance to Google's four-color 'G' or camera Lens icon**.
  - No multicolored primary segments.
  - Solid Electric Violet and Cyber Cyan dual-gradient geometry.

---

## 5. Brand Voice & Rewritten Strings

### Three Core Principles
1. **Instant**: Not hasty — latency is treated as a critical defect; responses render in single-digit milliseconds without splash screens.
2. **Sovereign**: Not insular — indexes stay local on device; telemetry is rejected; users control every indexed directory.
3. **Unobtrusive**: Not invisible — appears when summoned via `Alt+Space` or `Copilot Key`, performs the task, and dismisses instantly without nagging.

### 5 Do & Don't Pairs
- **Do**: State exact local file locations and match counts.  
  *Don't*: Claim cloud omniscience or show sponsored web ads.
- **Do**: Provide keyboard shortcuts for every single option (`Tab`, `Enter`, `Ctrl+O`).  
  *Don't*: Demand mouse precision or force users into modal confirmation dialogues.
- **Do**: Index files quietly in the background using idle thread priorities.  
  *Don't*: Consume battery with high-frequency telemetry heartbeats.
- **Do**: Let users choose their search backend and AI models.  
  *Don't*: Lock users into a single closed ecosystem.
- **Do**: Transparently crop and process screen captures on-device first.  
  *Don't*: Silently upload entire screens to cloud servers without explicit selection.

### 10 Core UI Strings Rewritten Fresh
| Context | Original Phrasing (Avoid) | Spotcraft Fresh Clean-Room Phrasing |
| :--- | :--- | :--- |
| **Spotlight Input Placeholder** | "Search Google or type a URL" | "Search local files, apps, or type a query..." |
| **Empty Search State** | "No Google results found" | "No matching files or actions found. Press Enter to search the web." |
| **Screen Capture Tooltip** | "Circle to Search with Google Lens" | "Select any region to inspect or ask AI (`Ctrl+Shift+S`)" |
| **Local Index Status** | "Indexing your computer with Google" | "Local index active: 382,910 files indexed locally." |
| **Copilot Key Setting** | "Set Google as default Copilot app" | "Launch Spotcraft with the hardware Copilot key." |
| **Permission Prompt** | "Allow Google to read your screen" | "Grant screen capture access for region inspection." |
| **History View** | "My Google Activity & AIM History" | "Recent Inquiries & Local Snippets" |
| **File Open Action** | "Open with Google Drive" | "Open in File Manager (`Ctrl+Enter`)" |
| **Copy Path Action** | "Copy Google link" | "Copy absolute path to clipboard (`Alt+C`)" |
| **Error Banner** | "Google services are currently unavailable"| "Network connection unavailable. Offline local search is ready." |

---

## 6. Rebrand Sweep

Configured in `replica/google-desktop/brand.json` and executed via `sweep.py`:
- All trademarks, domains, and Google primary colors are placed on the strict avoid list.
- All code, components, and documentation in `apps/spotcraft` strictly adhere to the fresh Spotcraft identity.
