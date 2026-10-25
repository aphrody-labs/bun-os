<!-- SPDX-License-Identifier: Apache-2.0 -->
# The Aphrody M3 framework

`aphrody-m3` is the private UI framework workspace mounted at `m3/` in Aphrody.
Other host repositories choose their own pinned mount points. It owns the Bun framework packages, React and Lit adapters, assets and application
UI. Aphrody owns the canonical Rust UI crates in `crates/ui/*`; Yolo supplies the runtime and
orchestrates the workspace commands. Package manifests and their exports define the consumer
APIs. Repository layout and commands: [framework guide](../../guides/FRAMEWORK.md).
Decisions: [M3 plan](../../plans/design/M3-PLAN.md). Host qualification:
[delivery plan](../../plans/design/M3-MULTI-HOST-PLAN.md).

## Architecture and ownership

```text
Aphrody crates/aphrody-m3-tokens          canonical Rust token contract
        |
Aphrody crates/ui/bun + interop/ffi  m3Css, Sass and icon exports
        |
@aphrody/bun                        lazy native FFI consumer
        |
@aphrody/m3                         m3Plugin, serveM3, buildM3, m3 CLI
        |
        +-- @aphrody/m3-bun         composed plugin, UI + API server, executable and packaging
        +-- material-web -> m3-react    Lit components and React wrappers
        +-- m3-primitives family       React + Tailwind application components
        +-- m3-next                    Next.js host adapter
```

CSS custom properties (`--md-sys-*`) join the renderers through shared themes. Lit components
inherit them through shadow DOM; React and Base UI components consume them through CSS and
Tailwind utilities. `packages/app-ui` is the canonical application UI in this workspace;
its Rust host remains in Aphrody. Source adapters and generated files do not establish native
installation, activation or mobile support.

`@aphrody/m3` loads `@aphrody/bun` only when native sheets or Sass are requested. The native
library comes from its owner; this design workspace does not compile it. See the
[native library guide](../../guides/NATIVE.md) for resolution and qualification.
`@aphrody/m3-bun/plugin` composes the M3 plugin with standalone font sheets, inline Material
Symbols and optional-module imports. Its TypeScript generator supplies token and scheme
sheets without the Rust library. Tailwind and SpaceUI sheets require the native generator or
an explicit `css` generator; the generated `@aphrody/m3-tailwind/preset.css` is also available.

Forks are pinned submodules under `forks/`, including `material-web`, `base-ui`, `tailwindcss`,
`material-color-utilities`, icons and fonts. The root catalog currently resolves Material Web
from `file:vendor/material-web`, while Base UI and the Tailwind compiler/scanner use catalog
versions. The lockfile determines the installed graph. Keeping a fork checkout does not imply
that every consumer imports that fork directly.

## Consumer packages

| Package | Tree | Contract |
| --- | --- | --- |
| `@aphrody/m3` | `packages/m3` | Bun plugin, dev server, UI builder, `m3` CLI; browser adapters at `/react` and `/lit`. |
| `@aphrody/m3-bun` | `packages/m3-bun` | Composed plugin, API routes, static server, compile, package, deploy-file generation and supervised smoke checks. |
| `@aphrody/bun` | Installed package or Aphrody `packages/interop/native` | FFI over the Aphrody native library: `m3Css`, HCT, Sass and icons. |
| `@aphrody/m3-tokens` | `packages/m3-tokens` | Token CSS, dynamic colour, breakpoints, expressive tokens and platform contract. |
| `@aphrody/m3-theme` | `packages/m3-theme` | Shared sheets, React theme provider and Tauri bridge. |
| `@aphrody/material-web` | `vendor/material-web` | Lit components and Aphrody extensions. |
| `@aphrody/m3-react` | `packages/m3-react` | `@lit/react` wrappers, adaptive hooks, state and transitions. |
| `@aphrody/m3-baseui`, `@aphrody/m3-primitives` | Corresponding `packages/m3-*` | Base UI styling and React application primitives. |
| `@aphrody/m3-forms`, `-explorer`, `-ai`, `-reader` | Corresponding `packages/m3-*` | Application component families sharing the theme contract. |
| `@aphrody/m3-tailwind` | `packages/m3-tailwind` | Tailwind v4 CSS preset generated from M3 tokens. |
| `@aphrody/m3-fonts`, `@aphrody/m3-icons` | Corresponding `packages/m3-*` | [Font sources](./FONTS-AND-ICONS.md) and [icon APIs](./M3-ICONS.md). |
| `@aphrody/m3-motion` | `packages/m3-motion` | Springs, easings and durations. |
| `@aphrody/m3-next` | `packages/m3-next` | Next.js adapter; examples under `packages/m3-next/examples`. |
| `@aphrody/m3-config` | `packages/m3-config` | Shared tsconfigs, `Bun.build` preset, SQLite cache and DOM test preload. |
| `@aphrody/eslint-plugin-m3` | `packages/eslint-plugin-m3` | M3 lint rules. |

Bun source conditions and built `default`/declaration entries vary by package. Inspect the
requested export in its manifest. The shared build pipeline (`scripts/build.ts`) reads
`build.config.ts`, uses the `m3-config/bun-build` preset and emits declarations. Root workspace
exclusions distinguish host-bound application packages from standalone members. These private
packages are not published by the framework commands.

## Application and commands

```text
my-app/
  m3.config.ts      defineM3Config: entry, routes, proxy, port, tauri.uiDist, theme
  bunfig.toml       [serve.static] plugins = ["@aphrody/m3/plugin"]
  package.json      "dev": "m3 dev", "build": "m3 build"
  src/index.html    m3:theme.css and a module script
  src/m3-env.d.ts   reference types="@aphrody/m3/client"
```

`m3 new <dir>` creates the web scaffold through `@aphrody/scaffold` without installing
dependencies. `mountM3App` from `@aphrody/m3/react` composes `StrictMode`, `M3ThemeProvider`,
the window size class and reduced-motion-aware `MotionConfig`.

| Command | Behavior |
| --- | --- |
| `m3 dev` | Serves the configured HTML and routes with Bun HMR and optional proxying. |
| `m3 build` | Builds the configured UI through `Bun.build`. |
| `m3 build --tauri [dir]` | Writes `index.html`, `app.js`, `app.css` and `fonts/` for the configured webview. |
| `m3 desktop` | Builds the Tauri webview output; `--dev` starts its UI dev server. Native packaging belongs to the host build owner. |
| `m3 compile` | Delegates to the optional `@aphrody/m3-bun` peer to embed UI/API and produce an executable. |
| `m3 check` | Runs the nearest `aphrody-m3` repository's `check`, or a legacy host `bun:check`, then the current application's tests. At the M3 root it uses the repository `test` script. An unrelated application `check` cannot claim the repository contract. |
| `m3-bun build`, `serve`, `compile`, `package` | Build, serve and package an application with UI and API in one process. |
| `m3-bun deploy` | Generates reviewed host configuration files; applying or activating them belongs to the host owner. |

An app using `m3-bun` registers `@aphrody/m3-bun/plugin` in `bunfig.toml` and can export
`bun = defineM3Bun({ api: "src/api.ts" })` beside its default M3 configuration. Its API is
typed with `defineM3Api`; `routesToFetch` exposes those routes to fetch-based hosts. The
compiled app carries its built files; platform support still requires execution and packaging
checks on each supported target.

## Tokens and adaptive layout

`m3:*` modules can be imported from TypeScript or linked from HTML. Tailwind resolves its own
CSS imports, so a Tailwind `@import` cannot address a virtual M3 module. Bun's static dev server
loads plugins from `bunfig.toml`; `m3 dev` reports a missing registration. Native scheme names
are kebab-case (`tonalSpot` becomes `tonal-spot`).

The Rust adaptive contract is in Aphrody `crates/aphrody-m3-tokens/src/adaptive.rs`. Web width
boundaries are exposed by `@aphrody/m3-tokens/breakpoints`: compact `< 600`, medium `< 840`,
expanded `< 1200`, large `< 1600`, then extra-large. Height classes use `480` and `900`.
`@aphrody/m3-react/adaptive` provides SSR-safe hooks; `M3App` defaults to `compact` until mounted.

```sh
# Bun framework: native sheet generation
m3 tokens --sheet tokens --seed '#6750a4' --out tokens.css
m3 tokens --bundle token-bundle

# Installed Aphrody CLI: baseline colour tokens and fusion aliases
aphrody design tokens --output tokens.css
aphrody design tokens --fusion --dark --format css
```

The two CLI surfaces expose different options; consult their live help. `m3 tokens` requires
the native library unless a caller supplies a generator through the programmatic API.
Output files alone do not establish renderer parity or measured performance.

## Qualification

Root `check` runs package-export, asset and documentation-link gates. Root `test`, `lint` and
`typecheck` use the workspace task owner. The CLI boundary regression is explicitly run with
`bun test ./packages/m3/qualification/check.test.ts`; it covers standalone and nested M3
checkouts, host compatibility, test ownership and exit-code propagation using temporary fixtures.
Native suites state their skips when the required library is unavailable. Record the command,
target and result before claiming installation, compatibility or activation.
