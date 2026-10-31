# Aphrody Craft browser workspace (Adobe reference recon)

Scope: Browser-based creative and office suite inside Bun WebOS, using Adobe Creative Cloud's public applications page as a clean-room UX reference. Preserve Aphrody Identity, Aphrody Drive and Material 3; do not reuse Adobe branding, assets, source, or private APIs.
For: Aphrody users creating, editing, organizing and handing off documents and media across a shared workspace.
Date: 2026-10-21

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Adobe all-apps catalog (observed) | https://www.adobe.com/apps/all/all-platforms | Public app catalog; common navigation, category and platform filters, app cards and entitlement actions. |
| 2 | Adobe photography category (observed) | https://www.adobe.com/apps/photography/all-platforms | Photoshop, Lightroom, Lightroom Classic, Firefly, Express, Stock and mobile photo tools. |
| 3 | Adobe video/audio category (observed) | https://www.adobe.com/apps/video-audio/all-platforms | Premiere, After Effects, Audition, Animate, Media Encoder, Frame.io and Firefly. |
| 4 | Adobe design category (observed) | https://www.adobe.com/apps/design/all-platforms | Photoshop, Illustrator, InDesign, Express, Firefly, Fonts, Stock and Fresco. |
| 5 | Adobe Acrobat/PDF category (observed) | https://www.adobe.com/apps/acrobat-pdf/all-platforms | Acrobat, Express, Scan and Fill & Sign. |
| 6 | Adobe 3D/AR category (observed) | https://www.adobe.com/apps/ar/all-platforms | Substance 3D family, community assets, Reviewer and Mixamo. |

## Core loop

Open a project from Aphrody Drive, launch the right Craft app in a desktop window, edit with the existing artifact, save back to the same project, then open or hand off that artifact to another Craft app.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | All-apps catalog | /apps/all/all-platforms | Discover and launch tools | Home/Apps/Files/Create nav, search, category checkboxes, platform popup, app cards, product details, trial/buy/open/download actions | populated list; “all apps” selected |
| S02 | Image catalog | /apps/photography/all-platforms | Browse image/photo tools | shared catalog shell, Photoshop/Lightroom/Firefly/Express/Stock cards | populated list; image filter selected |
| S03 | Video and audio catalog | /apps/video-audio/all-platforms | Browse video/audio tools | shared catalog shell, Premiere/After Effects/Audition/Animate/Media Encoder/Frame.io cards | populated list; video filter selected |
| S04 | Design catalog | /apps/design/all-platforms | Browse design and layout tools | shared catalog shell, Photoshop/Illustrator/InDesign/Express/Fresco/Fonts cards | populated list; design filter selected |
| S05 | Documents catalog | /apps/acrobat-pdf/all-platforms | Browse PDF/document tools | shared catalog shell, Acrobat/Scan/Fill & Sign cards | populated list; document filter selected |
| S06 | 3D and AR catalog | /apps/ar/all-platforms | Browse 3D tools and assets | shared catalog shell, Substance 3D products, assets, Reviewer and Mixamo | populated list; 3D filter selected |
| S07 | Owned apps | catalog > “Vos applications” | Limit catalog to user-entitled apps | category filters and app cards | not opened; infer from visible filter label |
| S08 | Product detail | app card > “Détails du produit” | Explain one app and route to acquisition/open | product details link | not opened |
| S09 | Files | global “Fichiers” nav | Manage cloud files | shared navigation link | destination not opened |
| S10 | Create | global “Créer” nav | Start a new creative item | shared navigation link | destination not opened |

## Flows

```
F01 Discover an app by category
    S01 -> S02/S03/S04/S05/S06 -> select app action
    happy path clicks: 2 (choose category, choose app action)
    edge: category empty, app unavailable on platform, user has not installed/entitled it

F02 Open a document from a shared workspace (Aphrody Craft target)
    Drive/workspace -> select file -> open-in menu -> Craft editor -> save
    happy path clicks: target 3 or fewer after selecting the file
    edge: unsupported format, oversized file, app absent, offline, save conflict, rejected file bridge

F03 Move an artifact across creative tools (Aphrody Craft target)
    open project -> create/edit in one app -> save to Drive -> open in compatible next app
    happy path clicks: target 4 or fewer excluding editing work
    edge: incompatible format, missing conversion, partial export, stale revision

F04 Select a platform
    S01 -> platform popup -> select platform -> inspect resulting cards
    state not explored; preserve as an unverified reference path
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Global navigation | Home, Apps, Files, Create | current, hover, focus | catalog pages |
| Category filter | All, Owned, Image, Video, Design, Document, 3D, Beta | selected, unselected | S01-S06 |
| Platform filter | platform selector | collapsed, expanded, selected (selection result unverified) | S01-S06 |
| App card | trial, included, open, download, unavailable | default, action variant | S01-S06 |
| Product details link | app-specific | link, external/navigation | S01-S06 |
| Plan CTA | “Find a plan” | available | category pages |
| Craft window (target) | editor/app, Files, Creative | focused, unfocused, minimized, maximized, loading, error | Bun WebOS |
| Drive file action (target) | Open with Craft, Save, Export | enabled, disabled, progress, conflict, success, error | Bun WebOS |

## Inferred data model

```
CatalogApp  name, category, platform availability, product URL, action set
            evidence: S01-S06 visible app cards, category filters
            confidence: high for displayed fields; low for platform rules

Entitlement  user, app, entitlement status, available action
             evidence: “Vos applications” filter and varying Open/Trial/Buy/Download actions
             confidence: medium

CraftWorkspace  user, project, Drive root, opened documents, recent apps
                evidence: user requirement and target Aphrody integration, not Adobe page
                confidence: guess until verified against product implementation

CraftArtifact  path, media/document type, app owner, version, preview, modified time
               evidence: target Drive/editor/open-save loop
               confidence: guess pending one shared artifact contract
```

Relationships: CatalogApp belongs to one or more categories and supports platforms; Entitlement joins a user to CatalogApp; CraftWorkspace owns projects and CraftArtifact files.

## Feature matrix

See `features.csv`. Adobe exposes a unified catalog organized by creative domain and app availability. Aphrody Craft's target is deeper integration: app discovery, documents and assets must all resolve to the same Identity/Drive-backed workspace. Do not show a package as available until its built artifact is present and qualified.

## Out of scope (cannot or should not be cloned)

- Adobe's source, icons, logos, copy, proprietary file-format behavior, services, stock media, fonts, user network or subscription entitlements.
- Unobserved login, checkout, cloud collaboration and product editor screens; use official public documentation or Aphrody's own product contracts before defining them.
- Claiming feature parity in 3D, generative AI, stock assets, color libraries or real-time review without a shipped and qualified Craft owner.

## Size

10 reference/target screens, 4 flows. Hard parts: shared artifact format/import-export, Drive save/conflict semantics, cross-window state, app capability/entitlement availability, and large WASM/media performance. Size: XL for the full workspace; L for a first reliable release of all currently owned Craft apps integrated with Drive.
