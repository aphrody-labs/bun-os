<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-bun

One Bun plugin and the `m3-bun` CLI that build, serve (HMR), compile, package and generate deploy configs for M3 apps.

Status: this package depends on `@aphrody/m3`, which is private in this repository; npm only has the older
`@aphrody/m3@3.3.10`, so `bun add @aphrody/m3-bun` from npm cannot resolve `@aphrody/m3@1.4.4` today. Inside this
workspace it works through `workspace:*`.

```sh
bun add -d @aphrody/m3-bun
```

```sh
m3-bun create web my-app       # starter from @aphrody/scaffold (templates: web, app, example)
cd my-app && m3-bun dev        # HMR dev server: UI and API in one process
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).
Full guide: [M3-BUN.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/guides/M3-BUN.md).

## Commands

```sh
m3-bun dev                     # HMR dev server: UI and API in one process (bunfig [serve.static] plugins)
m3-bun build [--minify none|basic|full] [--graph[=<registry>]]
m3-bun graph [file]            # recorded builds, or what depends on a file
m3-bun serve                   # production server of the build directory
m3-bun compile [--target linux-x64-musl|windows-x64|darwin-arm64|...]
m3-bun package [--rootfs] [--deploy]
m3-bun deploy docker systemd nginx vercel fly cloudflare coolify vscode windows   # or: all
m3-bun smoke                   # run the executable (yolo runtime when installed), GET /, /healthz, /api/m3/info
```

Inside the Aphrody checkout the same commands run as `yolo m3 bun <command>`.

## The plugin

`@aphrody/m3-bun/plugin` is `@aphrody/m3`'s plugin (Tailwind v4, Sass, `m3:*` token sheets, `?url`) plus what a
standalone checkout needs: the token sheets from `@aphrody/m3-tokens` when the Rust library is absent, the font sheets from
`@aphrody/m3-fonts`, `m3:icons/[style/]name[?fill=1&wght=300]` (Material Symbols SVG markup from the forked catalogue, inlined
at build time) and `m3:optional/<specifier>` (a module that may not be installed: its namespace and `resolved: true`, or
`null` and `resolved: false`).

```toml
# bunfig.toml
[serve.static]
plugins = ["@aphrody/m3-bun/plugin"]
```

```ts
// m3.config.ts
import { defineM3Config } from "@aphrody/m3/config";
import { defineM3Bun } from "@aphrody/m3-bun/config";

export default defineM3Config({
  entry: "src/index.html",
  theme: { seed: "#6750a4" },
});
export const bun = defineM3Bun({
  api: "src/api/index.ts",
  port: 3000,
  compile: { bytecode: true },
});
```

The fork's Bun plugins compose behind options of `m3Bun` (`src/plugins.ts`): `yaml`, `svelte` (on by default), `mdx`
(`@aphrody/bun-mdx-rs`, native `onBeforeParse`), `n2b` and `oxc`. Each one is imported on the first module its hooks
match. The m3 packages are modules too (`src/plugins-m3.ts`): `m3:icon/<style>/<name>` (`@aphrody/m3-icons`),
`m3:theme/{tokens,tailwind,spaceui}.css` (`@aphrody/m3-theme`) and `m3:assets/<path>[?url]` (`@aphrody/assets`).

## Build graph

`m3-bun build --graph` (or `bun: { graph: true }` in `m3.config.ts`) records the build in a SQLite registry (`bun:sqlite`,
`src/graph-registry.ts`), `.m3-bun/graph.sqlite` by default: the app is a repository, the build a run with its duration
sample and one artifact (path, SHA-256, bytes) per output file, and the `Bun.build` metafile a graph snapshot. Its nodes
are the inputs (virtual `m3:` modules included), the outputs and the external imports; its edges the imports, keyed by
import kind, and `bundled-into` from an input to each output it contributed to. `m3-bun graph` prints the
markdown report; `m3-bun graph src/main.ts` lists the modules that import the file, transitively, and the outputs it went
into. 

## One process, UI and API

`src/api` exports Bun routes (`defineM3Api`); `Bun.serve` runs them natively next to the file server (cache headers,
ETag, brotli and gzip, SPA fallback, `/healthz`, `/api/m3/info`, security headers, traversal guard). `routesToFetch` turns the
same routes into one `fetch` handler for Cloudflare Workers and Vercel functions.

The server's optional parts load on first use (`src/server-*.ts`), on Bun APIs only:

| Module    | What it does                                                       |
| --------- | ------------------------------------------------------------------ |
| HTML      | `HTMLRewriter`: CSP nonce on every script, and the request's theme |
| Markdown  | `Bun.markdown` pages                                               |
| Crawl     | `sitemap.xml`, `robots.txt` and `llms.txt`                         |
| Realtime  | WebSocket topics                                                   |
| Data      | `bun:sqlite` with migrations                                       |
| Secrets   | `Bun.secrets`                                                      |
| Auth      | `Bun.password` and sessions                                        |
| Cache     | `Bun.RedisClient`                                                  |
| MCP       | `@aphrody/m3-mcp` tools                                            |
| AG-UI     | `@aphrody/m3-ai`                                                   |
| Next      | `@aphrody/next-bun` behind a proxy                                 |
| m3 routes | `@aphrody/m3/server` routes                                        |

`m3-bun dev --inspect [--inspector-ui]` runs the dev server in a child Bun with its inspector on, relays its console and
exceptions, and serves the WebKit Web Inspector (`@aphrody/web-inspector-bun`). API load and handler errors go to Bun's
error overlay.

## Tools

`m3-bun lint` (eslint-plugin-m3 through `bun lint`), `migrate` (m3-codemods, `--next` for m3-next-migrate), `create`
(scaffold), `design` (m3-design), `og` (canvas Open Graph image) and `lib` (m3-config library build). Each tool package
loads on first use (`src/tools-*.ts`). If a package is missing, the error names it.

Deploy targets also include `tauri`, `webos`, `lambda`, `os-themes`, `release`, `next` and `windows-inspect`.

## Compile: bytecode and the limits

`m3-bun compile` embeds the built files and the API in a generated entry and links it with the Bun runtime. It passes
`bytecode: true` to `Bun.build` (with `minify` as configured and `sourcemap: "none"`): JavaScriptCore bytecode is stored in
the executable, so start-up skips parsing. Measured on the fixture app (medians, same host, interleaved runs):
`--version` 4.3 ms instead of 7.5 ms, first `/healthz` 5.8 ms instead of 9.3 ms; the executable grows by about 1.5 MB.
Bytecode output is CommonJS, so the generated entry has no top-level await. `compile: { bytecode: false }` turns it off.

The executable is not static: glibc targets link libc, libm, libdl, libpthread and the loader, musl targets link musl and
libstdc++. Images carry those libraries (`m3-bun package --rootfs`); the `docker` target
compiles and runs on `ghcr.io/aphrody-labs/alpine:3.24-runtime` (musl, libstdc++, CA certificates, tzdata). Windows
metadata (`compile.windows`) is applied only when compiling on Windows; elsewhere the report says so.

`m3 compile` of `@aphrody/m3` runs this compiler (an optional peer): compiling an HTML entry directly yields an HTML
file, not an executable.

Deploy targets are files; nothing here applies, pushes or reloads anything.
