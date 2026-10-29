# Bun OS platform layer

This is the shared layer under the console shell (`crates/bun-os-shell`), play.aphrody.app
(`apps/play`) and the Bun Engine runtime (`crates/bun-engine-core` runtime/, `packages/bun-engine`).
It covers five areas:

- languages;
- themes;
- plugins;
- file types;
- transfers.

Each area has one source of data. Both sides read it:

- the Bun package `@bun-os/platform` (`packages/bun-os-platform`);
- the Rust crate `bun-os-platform` (`crates/bun-os-platform`; the `bevy` feature adds resources
  and messages).

Plugins, the file-type registry and the transfer service run only in Bun. Native hosts reach
them through the typed sidecar (JSON lines over stdio).

## Inventory (step 0) and decisions

| Area | Existing owners found | Decision |
| --- | --- | --- |
| i18n | No `.ftl` files and no first-party Fluent code. `fluent 0.17`, `fluent-bundle 0.16` and ICU4X 2.3 were already in `Cargo.lock` (pulled in by uutils and libcosmic). The external [`@rosegriffon/i18n`](https://github.com/aphrody-labs/rosegriffon/tree/main/packages/rg-i18n) library provides Accept-Language, BCP 47 registry and Intl formatters (fr, en, ja). Ad-hoc catalogs: the m3 and app-ui JSON files, TSV/TOML/JSON/`.rs` in the craft apps, `.po` in `re`, `sys-locale`. Nothing in the repo called `GetUserPreferredUILanguages`. | Project Fluent `.ftl` is the single catalog format. Rust uses `fluent-bundle` (concurrent) and formats numbers and dates with ICU4X (`icu_decimal`, `icu_datetime`). Bun uses a native Fluent parser and resolver (`src/i18n/fluent.ts`, Intl for plurals, numbers and dates). Accept-Language parsing uses the published `@rosegriffon/i18n` library. The OS locale comes from `GetUserPreferredUILanguages`: `bun:windows` `family("kernel32")` on the Bun side, `windows` `Win32_Globalization` on the Rust side; POSIX hosts read `LANGUAGE`/`LC_*`/`LANG`. |
| Theming | `crates/aphrody-m3-tokens` is the canonical M3 engine: HCT, the 9 variants, contrast, image quantize/score, `ThemeRequest`, `export_token_tables`, state layers. `@aphrody/m3-tokens` (material-color-utilities, parity-tested against it; `dynamic-color`, `native-theme`). `m3-theme` and `m3-tailwind` (CSS sheets). `design-system/bun-os-play/{MASTER,DIRECTION}.md`. No `forced-colors` support existed anywhere. | One theme file format, `bun-os-theme/1` (`themes/theme.schema.json`), in JSON, TOML or CSS custom properties. It layers over `themes/baseline.json`. Rust resolves it with `aphrody-m3-tokens`. Bun resolves it with `@aphrody/m3-tokens` plus `themes/m3-tables.json`, generated from the Rust tables by `bun-os-platform-native tables`. Verified before this change: 49/49 color roles identical for baseline, sunset, light, high contrast and art seed. The typescale differed only by f32 noise, so both sides now round to 2 decimals; re-check parity after the next native build. Web output is CSS variables (`--md-sys-*`, `--bun-os-*`) with blocks for `prefers-contrast: more`, `forced-colors: active` (CSS system colors) and `prefers-reduced-motion`. |
| Plugins | `Bun.plugin` users: `packages/bun-loaders` (PE/APK/ROM/3D/media loaders), the console and format plugins of `packages/bun-engine/src/plugins`, the m3 plugins. The `plugins/consoles/*.json` registry. Agent plugins (`bun-agent-plugin`, aphrody-agent-runtime, kernel MCP proxy). `aphrody-drive` extensions (wasmer manifest with permissions, unsigned). wasmi hosts in the craft apps. No wasmtime and no signed manifest anywhere. | A `Bun.plugin`-shaped API: `plugin.json` (name, version, permissions, entry) and `export default { name, setup(build) }`. Every hook checks a declared permission. TS/JS plugins run in Bun (play server, CLI, sidecar). The native shell reaches them through the sidecar. There is no wasm host, because no canonical wasmtime owner exists. Trust: built-ins are trusted with the checkout. `usr/lib/bun-os/plugins/*` load only when pinned (sha256 digest of the directory in `usr/etc/bun-os/plugins.lock.json`, verified the same way in Rust) or signed (Ed25519 `plugin.sig`, keys in `usr/etc/bun-os/trusted-keys/*.jwk`). The first plugin set wraps `bun-engine` (formats, machines, ROM packs, bep mirrors) and `bun-loaders` (PE/APK/3D previews, runtime loaders). Both load by path, so `@bun-os/platform` does not depend on `@aphrody/bun-engine` (bep imports the transfer service). |
| File types | `packages/bun-engine/src/formats` (`detect`, `BinaryImage`, 31 formats with typed headers). Magika: `packages/re` via `bun:python` and `crates/re` via ONNX. `packages/package-converter` (`inspect` for deb, alpm and cygwin). `bun-loaders/rom.ts`. `artcraft-mimetypes` (infer). | One registry (`src/files`). It tries, in order: a content magic table (images, video, audio, archives, packages, executables, fonts, documents, sqlite, saves); then plugin detectors (Bun Engine ROM and firmware magic and heuristics); then Magika on request; then the extension at 0.3. Previews use native Bun APIs only (next section). |
| Transfers | bep (`pm.ts`) checks sha256/sha512 but downloads whole files, with no Range and no resume. `mirrors.ts` / `mirrors.json` (sqlite index, probes, fallback). `bun-steam` lancache (Host-routed caching proxy). R2 owner `packages/bun-cloudflare` of the abandoned fork (legacy, `toolchains/bun` removed) (`loadCloudflareEnvironment`, `createR2Client`). Credentials in `~/.aphrody/config/cloudflare.env` plus the injected environment. Resumable Rust fetchers exist only in lightcraft and aphrody-models. | One `TransferService`:<br>- Range resume into `<dest>.part`; the part is re-hashed on restart, then hashing continues on the stream;<br>- candidates from the URL, the plugin providers (`bep:<service>/<path>` over `mirrors.json`) and the mirrors, with LAN cache routing for Steam CDN hosts;<br>- a queue in bun:sqlite (`usr/var/lib/bun-os/transfers.db`), with interrupted rows re-queued;<br>- pause, resume and cancel;<br>- a global and a per-transfer token-bucket cap;<br>- `progress` events.<br>Uploads and object targets go through Bun.S3Client from the R2 owner. Credentials are never printed. |

### Native Bun APIs used

- **Images.** `Bun.Image`: `metadata()` for previews; thumbnails with `resize(w, w, { fit: "inside", filter })` then `.webp()`. `filter: "nearest"` applies to pixel art (sides of 256 px or less: emulator screenshots, box art of 8/16-bit systems). Otherwise `lanczos3`. `.placeholder()` is reserved for the blurred loading state of real art. It never stands in for missing art.
- **Video.** `Bun.Video`: `metadata()`, then `.frame(t).resize().webp()` at 10% of the duration (capped at 10 s) for clip, trailer and recording thumbnails. Audio metadata uses the same API.
- **Archives.** `Bun.Archive(Bun.file(path)).files()` lists tar, tar.gz and zip. 7z, rar, xz and bzip2 go through the 7-Zip owner that bep already uses. MSI is extracted by bep (`msiexec /a`).
- **Compression.** zstd (`Bun.zstdCompress`/`zstdDecompress`) for our own transfers, caches and save sync. `CompressionStream` and `DecompressionStream` for streaming. gzip and deflate only for interop.
- **Binary data.** Detection reads only a bounded `BunFile.slice(0, 64 KiB)`. Downloads stream chunk by chunk and append to the part file. Re-hashing on resume streams `Bun.file(part).stream()`. Uploads stream into the S3 `writer({ partSize })`. Multi-GB ROM and disc images are never loaded whole.

## Layout

```
packages/bun-os-platform/
  locales/locales.json                 shipped locales: en fr ja de es it ko pt-BR zh-Hans zh-Hant
  locales/<tag>/{common,shell,play,engine}.ftl
  themes/baseline.json theme.schema.json m3-tables.json sunset.toml
  plugins/{bun-engine,bun-loaders}/    built-in plugins
  examples/retro-patches/              sample plugin (file loader + theme + catalogs + menu entry)
  src/i18n/{fluent,localizer,index,web}.ts
  src/theme/{resolve,index,web}.ts
  src/plugins/index.ts  src/files/index.ts  src/transfer/{index,throttle}.ts
  src/server.ts (Bun.serve routes)  src/sidecar.ts (native IPC)  src/check.ts  src/cli.ts
  check-baseline.json                  ratchet of the UI token/string debt
crates/bun-os-platform/
  src/{i18n,locale,theme,paths,sidecar}.rs, src/bevy.rs (feature "bevy"), src/main.rs (bun-os-platform-native)
usr/ (runtime, gitignored)
  share/bun-os/{locale,themes}/  lib/bun-os/plugins/<name>/  etc/bun-os/{settings.json,plugins.lock.json,trusted-keys/}
  var/lib/bun-os/transfers.db  var/cache/bun-os/{downloads,previews}/
```

The settings live in `usr/etc/bun-os/settings.json`. Both sides read and write it:

| Key | Values |
| --- | --- |
| `locale` | locale tag |
| `theme` | theme id or path |
| `contrast` | `standard`, `high` or `system` |
| `bandwidth` | bytes per second |
| `uploadBucket` | private R2 bucket |
| `lancache` | LAN cache URL |

Environment overrides: `BUN_OS_LOCALE`, `BUN_OS_THEME`, `BUN_OS_USR`, `BUN_OS_LANCACHE`, `BUN_OS_R2_PRIVATE_BUCKET`, `BUN_OS_HIGH_CONTRAST`.

## i18n

Catalog files:

- Domains: `common` (everything), `shell`, `play`, `engine`. Plugins add their own `.ftl` files.
- Override order: base catalogs, then `usr/share/bun-os/locale`, then plugins.
- Fallback chain: the locale, its declared fallbacks, then `en`.
- Missing keys render as the key.

Negotiation:

- Native hosts: `BUN_OS_LOCALE`, then `settings.locale`, then the OS UI languages, then `en`.
- Web: `?lang=`, then the `bun-os-locale` cookie, then Accept-Language, then `en`.
- Lookup is exact, then by script (`zh-CN` → `zh-Hans`, `zh-TW` → `zh-Hant`), then by language.

Rust usage: `bun_os_platform::i18n::init(&["common", "shell"])`, then `t("nav.games")` and
`tf("toast.reloaded", &[("count", &n)])`.

- Dotted keys map to the Fluent ids `nav-games` and `toast-reloaded`.
- Numeric arguments become Fluent numbers, which select plurals and format with ICU4X.
- `set_locale(Some("fr"))` switches at runtime and persists the choice. The UI rebuilds when
  `i18n::version()` changes, or on the `LocaleChanged` message.

Web usage: `loadWebLocalizer(["common", "play"])` fetches `GET /api/platform/i18n` and returns a
`Localizer` with `t`, `number`, `date`, `relative`, `list` and `bytes`.

## Theme

- **Native:** `PlatformPlugin` inserts `ThemeTokens` (`argb(role)`, `space(name)`, `shape(name)`,
  `duration_secs(name)`, `easing(name)`, `icon(name)`). `SetTheme { theme, seed }` re-resolves and
  emits `ThemeChanged`. High contrast follows the setting or `SPI_GETHIGHCONTRAST`.
- **Web:** `GET /api/platform/theme` returns the merged file and `GET /api/platform/theme.css`
  returns every token. `applyWebTheme({ dark, seed })` re-seeds from art only when the theme sets
  `color.dynamic: "art"`.

## Plugins

`build` registers each contribution with a hook, guarded by a permission:

| Hook | Contribution | Permission |
| --- | --- | --- |
| `onDetect`, `onPreview` | file loaders and parsers | `files` |
| `addGameSource` | game sources | `library` |
| `addTheme` | themes | `themes` |
| `addLocale` | catalogs | `locales` |
| `addMenuEntry`, `addPanel` | menu entries and panels | `ui` |
| `addMachine` | engine machines | `machines` |
| `addTransferProvider` | CDN and download providers | `transfer` |
| `onCommand` | commands | none |
| `bunPlugin` | a real `Bun.plugin` | `bun.plugin` |

Static `locales/` and `themes/` directories load without running plugin code.

Commands:

- `bun-os-platform plugins pin <dir>` pins a plugin. This is the owner's trust decision.
- `bun-os-platform plugins` lists loaded and blocked plugins.

## Transfers

```ts
const service = await transfers();
service.enqueue({ url, mirrors: ["bep:github-releases/<path>"], sha256, dest, bandwidth });
service.addEventListener("progress", (e) => e.detail); // {id,state,received,size,rate,via}
const target = await objectTarget("s3://aphrody-dist/prefix" | "r2:private/prefix", { private, bandwidth });
await target.put(key, bytes); await target.stat(key); await target.get(key); await target.delete(key);
await uploadFile(path, { spec, key });
```

- The play server publishes progress on WebSocket topic `transfers`.
- The shell receives `PlatformEvent { name: "transfer.progress" }`.
- Credentials come only from `~/.aphrody/config/cloudflare.env` and the injected environment,
  through the R2 owner. `AWS_ENDPOINT_URL_S3` is mapped to `R2_ENDPOINT`.
- The R2 key currently reaches only `aphrody-assets` and `aphrody-dist`, and both are public.
- `r2:private` resolves to `bun-os-private`. Calls fail with an explicit message until the owner
  grants the key on that bucket or issues a key for it.

## Checks

`bun-os-platform check` fails on:

- `.ftl` syntax errors;
- ids or variables that differ from `en` in any shipped locale;
- keys used in shell, play or engine code that are missing from `en`;
- hardcoded user-visible strings and raw colors, sizes or durations in UI code above
  `check-baseline.json`.

The baseline is a ratchet: counts may only go down. `--update-baseline` records the new state
after a migration step.
