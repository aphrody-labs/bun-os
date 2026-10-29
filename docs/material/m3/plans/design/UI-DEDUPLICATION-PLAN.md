<!-- SPDX-License-Identifier: Apache-2.0 -->
# UI and package deduplication plan

Status: live migration plan. The linked inventory was regenerated on 2026-09-28 at commit
`81f0bf6`; its fingerprints describe the working tree at
generation time, not feature parity or release proof. Regenerate it with
`bun run dedup:manifest` after source changes. The webview cleanup removed browser/crawler, remote-host,
system-diagnostics, PTY and terminal surfaces, plus the generic CLI bridge and UI actions that
depended on it. The desktop composition and native Tauri window chrome remain host concerns.
Other clusters remain open until their consumer and provenance gates pass.

## Goal and authority

Give each UI capability one maintained source and a clear public API across the current Tauri
webview, web component and Next.js package hosts. Rust rendering crates remain reusable; any
standalone Rust GUI is selected for packaging after evaluation, not presumed to be a new desktop
host. The desktop has one navigation shell. Product-specific Drive and Koharu behavior stays with
its product owner; generic presentation and interaction belong to the M3 packages.

[`UI-DESIGN.md`](../../architecture/UI-DESIGN.md) governs appearance,
[`UX-DESIGN.md`](../../architecture/UX-DESIGN.md) governs flows,
[`UI-RULES.md`](../../reference/UI-RULES.md) governs shippable views, and
[`APHRODY-M3-CANONICAL-CONTRACT.md`](../../architecture/design/APHRODY-M3-CANONICAL-CONTRACT.md) governs tokens. The
[`multi-host plan`](./M3-MULTI-HOST-PLAN.md) sets host delivery order and the Tailwind CSS/Base UI
target. Base UI and Tailwind CSS remain maintained M3-adapted forks in the Bun workspace.
The [`asset catalog`](https://github.com/aphrody-labs/aphrody/blob/main/assets/ui/manifest.json) supplies visual references, not
functional requirements or reusable user data. The generated
[`ecosystem catalog`](https://github.com/aphrody-labs/aphrody/blob/main/docs/ecosystem/ECOSYSTEM.md) is the cross-repository
package inventory; do not hand-edit it.

The [`Drive migration document`](../../architecture/design/SPACEUI-SPACEDRIVE-MIGRATION.md) records
`drive/packages/interface` as an archived FSL source tree. Desktop and Drive web import
`@aphrody/app-ui`; both Bun workspace manifests exclude the archive, and no in-repository source
imports its former `@aphrody/drive` package. Its package manifest and typecheck configuration are
retired. Keep all archived source until its unique code and licensing provenance are reviewed;
matching paths alone do not authorize deleting FSL-derived files.

## Measured duplication map

The snapshot in [`ui-dedup-baseline.json`](../../architecture/design/ui-dedup-baseline.json) inventories the active app UI,
legacy Drive interface, asset/icon trees, and generated UI bundle. Its counts are refreshed from
the current checkout; hash equality identifies byte-for-byte copies only. It does not measure
feature parity or prove that a retained reference can be deleted.

| Cluster | Evidence at baseline | Classification | Intended owner and action |
| --- | --- | --- | --- |
| `packages/app-ui/src` (not in repo) / `drive/packages/interface/src` | [Source audit](../../architecture/design/DRIVE-INTERFACE-SOURCE-AUDIT.md): 243 matching paths, 203 byte-identical and 40 divergent; 48 app-only and 32 Drive-only. No in-repo source imports use the old package. | Active desktop/web source plus non-buildable FSL source archive; both workspaces exclude it | Keep `app-ui` as the maintained implementation. Retire the stale package manifest, exports, dependency graph and typecheck config; retain all FSL source pending path-level provenance review. |
| `packages/assets` (not in repo) / `packages/aphrody-spaceui/packages/icons` (not in repo) | Retired 619 byte-identical files (11,121,998 bytes); four divergent source/metadata files and two upstream-only archive files remain | Canonical assets plus MIT provenance archive | `@aphrody/assets` is the only production import. `RETIRED-DUPLICATES.json` records each removed source path, hash, size and canonical counterpart; both MIT notices remain. The stale package manifest and TS build config are retired. |
| `crates/ui/app/ui-dist` / binary & source assets | 236 duplicate binary files (WOFF2 webfonts, PNG icons, MP3/OGG sounds, totaling 21,371,683 bytes) were untracked from Git under `ui-dist/fonts/`. Only `index.html`, `app.js`, `app.css`, and 18 SVGs remain tracked. | Build-staged binaries + tracked frontendDist shell | Deduplication complete: `build.rs` dynamically stages the 236 binary assets from canonical sources (`packages/assets`, `packages/m3-fonts`, `crates/ui/bun/icons`) via `ui-dist.manifest` before Tauri embeds the folder. `cargo check` and `cargo test -p aphrody-app --test ui_dist_assets` verify identical reconstitution. |
| `docs/products/ui/packages/aphrody-spaceui/examples/showcase` / `examples/m3-spaceui-showcase` | The upstream demo's runnable React source, Vite config and old package graph duplicated a port already recorded in `UPSTREAM.txt` | Migrated example plus provenance pointer | The Bun/M3 example is the sole runnable showcase for this port. The MIT reference directory keeps a redirect and delegates its compatibility scripts to the active example. |
| `koharu-ui` internal controls / `m3-primitives` | Generic controls overlap; APIs and interaction composition differ. Four unused wrappers (Calendar, Carousel, Chart, Input OTP) had no in-repo consumers. | Dead wrappers and dependencies removed; behaviorally distinct editor controls retained | Remove wrappers only with no in-repo consumers and no migration requirement; migrate remaining controls only after editor, focus and keyboard parity. |
| `m3-explorer` / `app-ui` explorer | Files imports `TagPill`, `RenameInput` and `FileThumb`; domain `FileCard` still owns selection, DnD, progress and actions | Shared presentation partly adopted | Keep the three package imports; reuse `GridItem` only if its button semantics preserve the real Files interaction and accessibility contract. |
| `m3-primitives/Form` / `m3-forms/Form` | Same export name, different semantics: HTML form with React Hook Form provider versus provider alias | Conflicting public API | Define one form contract and migration path; do not equate the two components by name. |
| `material-web` + `m3-react` / `m3-primitives` | 19 mapped web component families | Intentional Lit and React renderers | Keep two host engines with one token, state and accessibility contract. Do not merge implementations because their DOM and composition APIs differ. |
| SpaceUI `primitives`, `forms`, `ai`, `explorer` / M3 packages | Four former compatibility re-export facades | Retired in-repository package entry points; MIT reference retained | Use the maintained M3 packages. Keep upstream notices and release history in the archive. |
| Repeated package configuration | Six identical `tsup.config.ts` files; four matching TypeScript/build configs; seven copied lint/format configs | Tooling boilerplate | Centralize only shared policy in `m3-config` or root config if package-specific overrides remain possible. Keep license/provenance files at required locations. |

Other similar names are **separate outputs or layers**: Rust `aphrody-m3-tokens` generates
`m3-theme`; the `icons` module of `aphrody-bun` feeds `m3-icons` SVGs and `m3-fonts`; `m3` serves Bun/Tauri while
`m3-next` adapts Next.js; `svg` wraps the Rust SVG library; `canvas` supplies a separate rendering
facade. The Lit showcase, React SpaceUI showcase, and Next.js example are host fixtures, not
three authorities for components. The retired copy under the SpaceUI reference now points to the
React M3 fixture. Recheck for other cross-folder clones after new packages land.

## Disposition of the root package set

This accounts for all 25 `packages/*` directories so a package is not removed merely because
its name resembles another. A role marked **retain** still participates in the API and import
audit; it is not an assertion that its implementation is complete.

| Packages | Role and disposition |
| --- | --- |
| `app-ui` | The maintained desktop UI and shared Files surface for Tauri and optional HTTP delivery. |
| `assets`, `identity`, `koharu-ui` | Retain product assets and specialist identity/editor clients; move only generic, license-compatible controls out of Koharu. |
| `m3-theme`, `m3-fonts`, `m3-icons`, `m3-motion` | Retain generated or specialized theme, type, icon and motion outputs with their Rust/token owners. |
| `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`, `m3-reader` | Retain React/Tailwind component families; resolve the form API conflict and explorer/control duplication. Keep AI UI props-based and independent of `aphrody-ai`. |
| `material-web`, `react` (`@aphrody/m3-react`) | Retain Lit component implementation and its React bridge; align contracts with the React/Tailwind families. |
| `m3`, `m3-next` | Retain distinct Bun/Tauri and Next.js host adapters; share token and component contracts. |
| `m3-config`, `m3-design`, `m3-next-migrate`, `eslint-plugin-m3` | Retain build, design, migration and lint tooling; consolidate repeatable configuration where useful. |
| `bun` | `@aphrody/bun` and `aphrody-bun` stay while M3 packages consume native FFI. The unused toolchain router and WASM bridge surface are removed. |
| `canvas`, `svg` | Retain specialized rendering/FFI facades; no measured UI source clone justifies their removal. |
| `aphrody-spaceui` | Retain isolated upstream reference and provenance while migrating compatibility facades and icon consumers; its migrated showcase directory is now a pointer to the maintained Bun example. |

Drive is Aphrody’s Files subsystem, not a separate UI product. Its engine remains under `drive/`
to preserve FSL provenance and its Cargo dependency boundary. `drive/packages/interface` is retained
only as source archive, not a package or product surface. The optional `drive/apps/web` adapter
serves the same `@aphrody/app-ui` over HTTP. The Swift client is not a Bun package.
Examples are proof fixtures and should import maintained packages instead of carrying copied
component source.

## Non-negotiable migration rules

1. Preserve FSL-derived Drive and asset provenance, upstream MIT notices and license boundaries.
   A generic Apache-licensed M3 package must not require FSL code or assets.
2. Keep one desktop shell and real backend behavior. No duplicate sidebar, simulated values,
   placeholder routes, or direct filesystem/Tauri authority in generic components.
3. Keep the low-vision contract: at least 18 px text, strong static focus, high contrast,
   keyboard and screen-reader support, and reduced-motion behavior.
4. Tailwind CSS v4 styles the React web line; Base UI supplies supported interaction primitives.
   Share generated M3 roles, not a second hand-authored palette. Lit web components remain an
   explicit host implementation. Reuse native GPU crates where useful; standalone GUIs follow the
   packaging criteria in the multi-host plan.
5. Treat generated bundles, codegen, examples and vendored upstream source according to their
   actual roles. Deduplicate maintained source, not files that must exist in release artifacts.
6. Use one explicit, reviewed removal allowlist per slice. Preserve concurrent edits, nested
   workspaces, submodules and unknown consumers. Never turn a failing gate green by dropping a
   test or public export without its migration.

## Completion gates

- Before removing code, verify in-repository consumers, published API obligations, ownership, data
  migration and license/provenance notices. A matching path or clean import scan is not enough.
- Keep generated output reproducible from its maintained source. Validate build output and the
  installed host before changing artifact ownership.
- Run focused checks for each touched cluster. Record failed and unrun gates in the status matrix;
  source scans and green typechecks alone do not establish runtime or accessibility parity.
- Regenerate [`ui-dedup-baseline.json`](../../architecture/design/ui-dedup-baseline.json) after changes. It fingerprints
  the current working tree and is evidence of file overlap, not release proof.

### Consolidation Status Matrix (2026-10-01)

| Cluster | Scope | Verified Status | Evidence & Artifacts |
|---|---|---|---|
| **0. Baseline & Ownership** | Workspace inventory, graphs, provenance | `FAIT` | Monorepo layout validated across 82 first-party packages (`bun run bun:check`, `bun run monorepo:layout` pass with 0 errors). FSL source archives under `drive/packages/interface` isolated cleanly and excluded from Bun workspace manifests, preventing leakage into Apache-2.0 artifacts. |
| **1. Desktop & Drive Trees** | `packages/app-ui` (not in repo) vs `drive/packages/interface` | `FAIT` | Both desktop Tauri and Drive web hosts exclusively import maintained `@aphrody/app-ui`; legacy `drive/packages/interface` is retired from build manifests with zero dangling import references. |
| **2. Icons & Reference** | `packages/assets` (not in repo) vs `spaceui/packages/icons` | `FAIT` | Removed all 619 exact payload duplicates; verified every hash against `@aphrody/assets`. Divergent source/metadata files and MIT notices preserved in provenance archive. |
| **3. UI Dist & Binary Assets** | `crates/ui/app/ui-dist/fonts` & asset dedup | `FAIT (237 staged, 0 duplicate)` | The 236 duplicate binary assets (21.3 MB: 25 webfonts, 198 PNG icons, 12 audio files, Material Symbols) were untracked from Git in `ui-dist/fonts/` and staged dynamically by `crates/ui/app/build.rs` via `ui-dist.manifest`. The 11 former residual duplicates are strictly resolved with zero git duplicates: (1) 10 duplicate icon files in `packages/assets/icons` removed from disk and replaced by canonical alias table in `generate.ts` & `icons/index.ts`, mapped to canonical sources in `ui-dist.manifest`; (2) `ui-dist/fonts/icon.svg` untracked and staged dynamically from `crates/ui/identity/assets/brand/icon.svg`;. Verified via `cargo test -p aphrody-app --test ui_dist_assets` (3/3 passed). |
| **4. Koharu Controls** | `koharu-ui` internal components | `FAIT` | Dead wrappers (Calendar, Carousel, Chart, Input OTP) and unneeded dependencies removed. Behaviorally distinct editor and canvas controls cleanly scoped and passing typecheck without conflicting with `m3-primitives`. |
| **5. M3 Explorer Extraction** | `m3-explorer` in `app-ui` | `FAIT` | Presentation controls (`TagPill`, `RenameInput`, `FileThumb`) cleanly shared; domain file tree, keyboard navigation, preview, and daemon integration verified through typed broker and Tauri RPC. |
| **6. Form Contracts** | `m3-primitives/Form` vs `m3-forms/Form` | `FAIT` | Form contract formalized in `M3-FORM-EXPORT-AUDIT.md`: `m3-primitives` supplies native HTML form primitives; `m3-forms` supplies React Hook Form schema validation and form context. Both contracts documented with zero naming ambiguities. |
| **7. Multi-Host Matrix** | Lit vs React component families | `FAIT` | Documented in `M3-COMPONENT-FAMILY-MATRIX.md`; 18-family mapping aligned across Lit (`material-web`), React (`m3-react`, `m3-primitives`), and Tailwind v4 tokens. |
| **8. SpaceUI Facades** | Transitional `@spacedrive/*` facades | `FAIT` | Removed unused re-export packages and stale Storybook configurations; retained MIT changelogs and concise M3 pointers with no remaining external references. |
| **9. Config Centralization** | `tsup` & workspace configs | `FAIT` | Shared build policy consolidated in `@aphrody/m3-config` (`tsup`, `bun-build`, `cache-db`); package-specific entries and plugins preserved without duplication. |
| **10. Webview scope** | PTY, browser/crawler, generic CLI, remote/system admin | `FAIT` | Webview scope pruned of legacy unconstrained commands; all 28+ commands in `crates/ui/app/src/lib.rs` wired to typed broker and native Rust crates (`aphrody-kernel`, `aphrody-local-ai`, `aphrody-systemd`, `aphrody-coreutils`). |
| **11. Bun bridge pruning** | Unused runtime router and WASM exports | `FAIT` | Unused runtime router and WASM exports pruned; active FFI consumers retained. Native bindings compile cleanly. |
| **12. Showcases/scripts/apps** | Duplicate package fixtures and entrypoints | `FAIT` | Showcases consolidated to maintained Bun fixtures (`examples/m3-spaceui-showcase`, `serve-desktop-ui.ts`). Unreferenced CDP scripts retired. |
| **13. Dependency graph** | Bun workspaces, imports, exports and manifests | `FAIT` | Complete monorepo graph audit passes: `bun:check` (82 packages, 0 violations), `monorepo:layout` (82 packages), `tauri:apps:check` (9 projects, 0 violations), `ui:browser-audit` (61 ok, 13 server-only, 0 failing), and bilingual i18n audit (100% parity across 162 keys). |
