# Aphrody M3 framework

`aphrody-m3` is the Material 3 stack for Bun: tokens, theme sheets, web components, React, Base UI,
Tailwind v4, build tooling and OS theme installers. Yolo orchestrates build, serve and compile.

## Package map

| Layer           | Package                                                                                                                                                                                                                     | Role                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens          | `@aphrody/m3-tokens`                                                                                                                                                                                                        | `--md-sys-*` tokens, Material You roles from a seed, window classes (width and height), emphasized type, Expressive springs, directional shapes |
| Theme           | `@aphrody/m3-theme`                                                                                                                                                                                                         | Fusion sheets: M3 + shadcn + Tailwind aliases, SpaceUI schemes, React/Tauri providers                                                           |
| Front           | `@aphrody/m3-front`                                                                                                                                                                                                         | Framework-agnostic: `<m3-theme>`, lazy `material-web` registration, window-class observer                                                       |
| React           | `@aphrody/m3-react`                                                                                                                                                                                                         | `@lit/react` wrappers for every `md-*` element, adaptive hooks, transitions, form state                                                         |
| Base UI         | `@aphrody/m3-baseui`                                                                                                                                                                                                        | Installed catalog Base UI parts styled with M3 tokens; pinned upstream sources in `vendor/base-ui` are not yet integrated                       |
| Tailwind        | `@aphrody/m3-tailwind`                                                                                                                                                                                                      | Tailwind v4 CSS-first `@theme` generated from the tokens (`preset.css`)                                                                         |
| Framework       | `@aphrody/m3`                                                                                                                                                                                                               | `m3` CLI, Bun plugin, `serveM3`, `buildM3`, `M3App`, `m3.config.ts`                                                                             |
| Bun application | `@aphrody/m3-bun`                                                                                                                                                                                                           | Build, serve, compile, package and deployment configuration for an app's UI and API                                                             |
| Shared          | `m3-config`, `m3-fonts`, `m3-icons`, `m3-motion`, `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`, `m3-design`, `m3-next`, `m3-next-migrate`, `m3-codemods`, `m3-reader`, `m3-mcp`, `material-design-icons`, `scaffold` | Build presets, assets, behaviour, migrations, MCP                                                                                               |
| OS              | `@aphrody/m3-os-themes`                                                                                                                                                                                                     | Windows 11, GNOME, COSMIC and Chromium theme generators and installers                                                                          |
| Web example     | `apps/web` (`@aphrody/m3-web`)                                                                                                                                                                                              | App selected by the root Yolo build, serve and compile commands                                                                                 |
| Showcase        | `apps/m3-showcase` (`@aphrody/m3-showcase`)                                                                                                                                                                                 | Adaptive mobile, desktop and TV package demos, with a Bun API                                                                                   |

Forks (`forks/`): `tailwindcss`, `base-ui`, `material-web`, `material-color-utilities`, `material-design-icons`.
Shared dependency versions live in the root `workspaces.catalog`; the lockfile pins their resolved versions.
Packages use `catalog:`, `workspace:*` and explicit dependencies where declared.

## Yolo orchestration

Root scripts run [scripts/yolo.ts](../../scripts/yolo.ts), which invokes `$YOLO_ROOT/bin/yolo` directly.
`YOLO_ROOT` defaults to `$HOME/yolo`; inspect this entry point's live help for Yolo commands.
The wrapper sets `YOLO_HOME` to this repository, so Yolo's `web|desktop|tauri` commands select `apps/web`.

| Script                                  | Runs                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run build`                         | `yolo web build` (apps/web `build` = `m3 build`), then `scripts/build.ts build --no-apps` for the default package scope                                            |
| `bun run serve`                         | `yolo web dev` (apps/web `dev` = `m3 dev`, HMR)                                                                                                                    |
| `bun run compile`                       | `yolo tauri build`, then apps/web `compile` (`m3 compile`, delegated to `@aphrody/m3-bun` for the executable)                                                      |
| `bun run test`                          | Yolo preflight (`yolo version --json`), the root script suites, then workspace `test` scripts in parallel, followed by export, asset and documentation link checks |
| `bun run lint`                          | Bun's native linter over packages, apps and scripts                                                                                                                |
| `bun run typecheck`                     | Bun's native checker over packages, apps and scripts                                                                                                               |
| `bun run bench` / `bun run bench:check` | Benchmark harness / performance budgets; see the limitations below                                                                                                 |
| `bun run install:theme -- <args>`       | the `m3-os-themes` CLI (dry-run unless `--apply`)                                                                                                                  |

The pipeline's default scope is package names matching `@*/m3*` and workspace members under `apps/`.
Package builds with a `build.config.ts` use the shared `Bun.build` preset, followed by declaration emission
when `tsconfig.build.json` exists. Members without a build config are reported as skipped; direct package
scripts may use a different build path. App builds run their declared `build` script after packages.
The root build's `--no-apps` prevents this final app stage, including `apps/m3-showcase`.

Package type checks use their declared `bun check` scripts. The root native checker covers packages,
apps and scripts. The build pipeline still emits declarations for packages with `tsconfig.build.json`.
the root task wrapper currently forwards extra arguments only for benchmarks and theme installation.

Workspace tests include the apps and nested `packages/m3-next/examples/*` members. The root manifest
and test runner exclude the host-bound `packages/app-ui`,
`packages/web-to-tauri`, and the independent `packages/nie-ui` repository. Those owners keep their own
installation and gates. `app-ui` builds Rust and belongs to the integrator using the enclosing
Aphrody repository's `scripts/build/rust/cargo-serial.sh`.

## Showcase commands

Run the [adaptive showcase](../../apps/m3-showcase/README.md) from `apps/m3-showcase`:

```sh
bun run dev
bun run build
bun run serve
bun run compile
bun run test
bun run typecheck
```

These commands use [m3-bun](../../packages/m3-bun/README.md) and the showcase's own configuration.
Its inventory step precedes development, build and compile. Root `serve` and `compile` continue to
select `apps/web`; they do not select this app. Tauri desktop/mobile packaging additionally needs
the target toolchains; a configuration or web build does not establish an installed native bundle.

## Benchmark qualification limits

The [performance report](../reports/PERF.md) records dated measurements; rerun a corrected harness
before making current performance claims. As observed on 2026-10-04, `scripts/bench/run.ts` starts
Yolo with `bun $YOLO_ROOT/bin/yolo`, although this entry point is a Bash script. That invocation
fails with a syntax error, while direct `$YOLO_ROOT/bin/yolo version --json` succeeds.
The harness records timings without rejecting these nonzero exits, so a budget comparison alone
does not qualify the Yolo measurements. Its stored test/lint/typecheck exit strings and snapshot
errors also do not necessarily cause the ordinary benchmark command to fail. Performance budgets
are separate from the technical gates listed above.

## Theme install per OS

```sh
bun packages/m3-os-themes/src/cli.ts generate --target all --seed '#6750a4' --out out   # files only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark           # plan only
bun packages/m3-os-themes/src/cli.ts install  --target gnome --seed '#6750a4' --mode dark --apply   # applies
bun packages/m3-os-themes/src/cli.ts uninstall --target gnome --apply                                # restores
```

- **Windows 11**: `install-windows.ps1` writes `Themes\Personalize` (`AppsUseLightTheme`, `SystemUsesLightTheme`,
  `ColorPrevalence`), DWM (`AccentColor`, `ColorizationColor`) and `Explorer\Accent`, generates a wallpaper and loads
  the `.theme`. The first run snapshots the previous values (`%LOCALAPPDATA%\m3-os-themes`); `-Uninstall` restores them.
- **GNOME Shell**: `~/.local/share/themes/M3-<name>/{gnome-shell,gtk-3.0,gtk-4.0}`, `~/.config/gtk-4.0/gtk.css` for
  libadwaita, gsettings (`gtk-theme`, `color-scheme`, `accent-color`, User Themes `name`). Snapshot and `--uninstall`.
- **COSMIC**: cosmic-theme ThemeBuilder RON keys under `~/.config/cosmic/com.system76.CosmicTheme.{Dark,Light}.Builder/v1/`
  and an importable `M3-<name>-<mode>.ron`. Snapshot and `--uninstall`.
- **Chromium browsers**: a Manifest V3 theme per mode (load unpacked) and the `BrowserThemeColor` managed policy for Chrome,
  Chromium, Brave and Edge (Linux `/etc/*/policies/managed`, Windows `.reg`). `install-chromium.md` has the steps.

`--mode auto` leaves the OS light/dark preference alone and ships both variants. Tests generate in memory or in a
temporary directory; nothing in the repository applies a theme to the machine that runs it.
