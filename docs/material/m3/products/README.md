<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody UI

Material Design 3 framework for web, desktop and future mobile hosts, plus native
rendering, Drive presentation and Koharu editor components. Tauri v2 is the current
desktop host; no Android/iOS host is delivered yet. The public
webview stays focused on Chat, Files, Models and Settings; system shell, terminal,
embedded browser and infrastructure administration are separate product surfaces.
Aphrody is a Rust distribution: prefer packaging mature Rust GUIs for standalone
system applications over rebuilding them in this workspace.

## Layout and boundaries

| Location | Responsibility |
| --- | --- |
| `packages/app-ui` | One public webview: Chat, Files, Models and Settings |
| `crates/aphrody-render*`, `aphrody-m3*` | Rendering and canonical design tokens |
| `packages/m3-*`, `material-web`, `react` | Shared web components and adapters |
| `drive/`, `crates/ui/drive` | Drive runtime/plugin and source lineage |
| `packages/koharu/ui` | Extracted editor presentation |

AI runs out of process through `aphrody app-server`; UI never links AI crates.
The desktop UI contains no shell, PTY or terminal session layer. Contracts owns
wire types, OS owns jobs/process policy and Infra owns hosts/releases. Base UI and
Tailwind are maintained forks adapted to M3 in the Bun workspace.

## Build and test

Use pinned Rust/Bun versions and `RUSTC_WRAPPER=`. Current desktop commands:

```sh
bun run desktop:check
bun run desktop:dev
bun run desktop:build
```

The Rust `aphrody-bun` FFI still backs M3 build and rendering packages; its
unused runtime-router and WebAssembly surfaces have been removed.
The separate Drive workspace supplies `sd-daemon`; preparation lives in `scripts/`.
The current Linux Tauri build needs WebKitGTK 4.1, GTK3, Ayatana AppIndicator,
librsvg, libxdo and OpenSSL development packages. Standalone native applications are
selected and packaged separately; no replacement shell or browser is a UI workspace
deliverable. [AGENTS.md](../reference/AGENTS.md) owns validation gates.

## Documentation

- [Bun workspace policy](../reference/BUN.md): package-manager boundary, strict installs and catalog use.
- [Index](./_source/README.md), [GUI contract](../reference/GUI.md), [design](../architecture/UI-DESIGN.md), [UX](../architecture/UX-DESIGN.md)
- [M3 framework and host plan](../plans/design/M3-MULTI-HOST-PLAN.md): portable design contract,
  customization, mobile qualification and optional native GUI packaging.
- [Shared delivery plan](https://github.com/aphrody-labs/aphrody/blob/main/docs/plans/ai/PLAN.md)
- [Upstream forks](../reference/UPSTREAM-FORKS.md), [package publication](../reference/PUBLISHING.md)

Apache-2.0 except component-specific licenses, including Drive FSL-1.1-ALv2 and
Canvas MIT. Preserve copied-source provenance. Full OSS packaging and installed
workflows remain release gates; a successful Tauri build does not prove installed behavior.

## Automatisation transversale

Les contrôles Bun, monorepo, import/export, desktop et SpaceUI passent par les scripts `bun run` déclarés dans `package.json`, qui délèguent à `aphrody-ops` du paquet `@aphrody/workspace`.
