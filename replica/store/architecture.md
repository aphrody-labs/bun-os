# Bun OS Store: architecture of the clean-room replica

Inputs: `replica/playstore/recon.md`, `replica/msstore/recon.md`, both `features.csv`. Data contract: `apps/webos/store/types.ts` (`StoreCatalog`, `StoreApp`, `StoreSource`, `StoreQualification`). Everything shown comes from the real catalog; there is no fake app, rating, download count or review.

## Screens (build order)

| id | screen | replicates | data |
|----|--------|------------|------|
| S01 | Shell: top bar (tabs Home, Apps, Games, Libraries, Linux; search; sources; library), responsive rail at 390px | P01, M01 | catalog.sources, categories |
| S02 | Home: hero carousel (featured), source chips, shelves per category and source, "recently built" and "qualified" lists | P01, M01 | catalog.featured, apps |
| S03 | Collection/category page with grid and sort | P05, M02 | apps by category/source |
| S04 | Search with live suggestions and results | P03, M03 | apps name, summary, pkg |
| S05 | App detail: header, stat strip, install group, sticky install bar, about, permissions, versions, requirements, ratings (none yet), similar | P04, M04 | StoreApp |
| S06 | Install flows: browser install with progress, download, command copy per manager, agent one-click | P04 | install fields |
| S07 | Library (installed) and Updates | P06, P07, M06 | pkg.installed, aph.store.installed |
| S08 | Sources: repository, setup line, count, qualification with step logs | extends Play device chips | sources, qualification |
| S09 | States: skeleton loading, empty, error with retry, not found with search | P*/M05 | n/a |

## Components

AppBar, TabBar, SearchField with SuggestList, Hero (slides, dots, arrows, pause on hover/focus), Chip and ChipRow, AppTile (icon, name, source badge, version, size), Shelf (heading link, scroll buttons), RankedList (real metric label), Grid, DetailHeader, StatStrip (version, size, license, source, qualified), InstallGroup, CommandBox (copy), ProgressBar, StickyInstallBar, ExpandableText, PermissionList, VersionTable, RequirementsTable, RatingSummary (empty state), Skeleton, EmptyState, ErrorState, SourceCard, QualificationPanel, Toast.

## Data model

`StoreApp` fields feed the UI directly: `id`, `name`, `pkg`, `source`, `category`, `summary`, `description`, `version`, `size`, `license`, `homepage`, `member`, `icon`, `screenshots`, `permissions`, `versions`, `install{pwa,download,command,removeCommand,agent}`, `qualified`, `featured`, `unavailable`, `rating: null`.

Real repositories behind the sources (served at https://aphrody.com): pacman `/repo/os/x86_64`, apk `/repo/apk/v3.22/main`, flatpak `/repo/flatpak`, npm `/npm/`, cargo `/cargo/index/`, Android `/repo/android/index.json`, browser apps `/registry.json`. Per-format indexes: `/api/store/index/<format>`.

## Mapping store features to real data

| Store feature | Bun OS source |
|---------------|---------------|
| Hero/featured | `catalog.featured`, only real flagship members (WebOS flatpak, bun-canary, bun, craft apps) |
| Top charts | Only real metrics, always labelled: "Largest", "Newest version", "Recently built" (catalog.generated and index timestamps), "Qualified" (qualification pass). No popularity ranking. |
| Ratings and reviews | `rating` is null: show "No ratings yet". No stars, no histogram. |
| Downloads | Not available: omit. Show size and version. |
| Screenshots | `screenshots` when present, otherwise the section is absent. |
| Data safety | `permissions` (capabilities declared by the build) |
| Requirements | architecture of the source, dependency counts from the index meta, size, license |
| Similar / more by publisher | same `member.kind`, same category or same source |
| Install | `install.pwa` (cache install with SHA-256), `install.download`, `install.command` with Copy, `install.agent` one-click when `/api/agent/status` answers |
| Qualified badge | `qualification.results` per source (arch uses pacman) |
| Unavailable | `unavailable` reason replaces the install group |

## Routing

Deep links, no framework: `?store=<appId>` opens detail, `?category=<id>` a collection, `?q=<text>` search, `?view=library|updates|sources`. The window keeps an in-memory history stack so Back works inside the window and the browser history receives `replaceState` only.

## Accessibility

Landmarks (banner, navigation, main, search), `role=tablist` for tabs, hero as `region` with `aria-roledescription=carousel`, auto-advance off by default and always pausable, arrow-key navigation in chip rows and shelves, visible focus ring from the state-layer tokens, 48px minimum targets, `aria-live=polite` for install progress and search result counts, `prefers-reduced-motion` disables slide and skeleton animation, contrast from the M3 on-* pairs.

## Responsive

390px: single column, bottom or rail navigation, hero one slide at a time with peek, shelves scroll horizontally, detail stat strip wraps to two rows, sticky install bar is bottom-docked. 1440px: top bar, hero at max width 1200, shelves show 6 to 8 tiles, ranked lists in two columns, detail in two columns (main and facts). Layout uses container queries on the window, not the viewport, because the Store lives inside a resizable WebOS window.

## States

Skeleton for catalog, shelves and detail; empty for search, library, updates and collections; error with Retry and offline banner when only `/registry.json` loaded; not found for unknown `?store=` with a search field.

## Verification plan

Per screen: screenshot at 390 and 1440 on https://aphrody.com into `replica/store/clone-screens/<screen>-<width>.png`, one commit per screen, notes in `replica/store/build-log.md`. Install flows are checked against the live repositories through `/api/store/qualification`.
