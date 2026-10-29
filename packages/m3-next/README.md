<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-next

Next.js 16 App Router integration for the M3 stack (config, server and client theme components, proxy, CSS) with the `m3-next` runner that runs Next on Bun.

```sh
bun add @aphrody/m3-next next react react-dom tailwindcss
```

```ts
// next.config.ts
import { withM3 } from "@aphrody/m3-next";

export default withM3({}, { cacheComponents: true, typedRoutes: true }); // reactCompiler: true needs babel-plugin-react-compiler
```

```sh
m3-next dev        # or build, start: the app's Next.js on Bun
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

App Router, Cache Components, `proxy.ts`, React Compiler, typed routes, Tailwind v4 and Base UI, run on Bun with no Node.
In this repository `apps/m3-next-example` is a working app and `apps/m3-next-tauri-example` the static export a Tauri
webview loads.

| Import                    | Runtime                            | Contents                                                                                                                                          |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aphrody/m3-next`        | any (config, server, client, edge) | `withM3`, metadata and viewport helpers, scheme helpers, `colorSchemeScript`, `m3TypefaceCss`, crawler files (sitemap, robots, llms.txt, JSON-LD) |
| `@aphrody/m3-next/server` | Server Components                  | `M3Html`, `M3Root` (class, `color-scheme`, inline scheme, typefaces, pre-paint script), `readM3ThemeMode`, `m3Css`                                |
| `@aphrody/m3-next/client` | `'use client'`                     | `M3ThemeProvider`, `M3NextThemeProvider`, `useM3Theme`, `useM3ThemeToggle`                                                                        |
| `@aphrody/m3-next/proxy`  | `proxy.ts`                         | `createM3Proxy`: every page request carries a valid theme cookie                                                                                  |
| `@aphrody/m3-next/m3.css` | CSS                                | tokens, expressive tokens, colour roles and the Tailwind preset (`@aphrody/m3-tailwind`)                                                          |
| `m3-next` (bin)           | Bun                                | runs the app's Next on Bun: `m3-next dev \| build \| start` (in the Aphrody checkout: `yolo m3 next`)                                             |

## Set up

The `next.config.ts` above is the whole config step.

`withM3` transpiles the M3 packages (including `@aphrody/m3-baseui`, which ships source), keeps `@aphrody/bun` external on the
server, rewrites barrel imports and keeps strict mode on. Options never override a key the config sets.

```css
/* app/globals.css */
@import "tailwindcss";
@import "@aphrody/m3-next/m3.css";
@import "@aphrody/m3-baseui/m3-baseui.css"; /* or css/core.css and the sheets you use */
```

```tsx
// app/layout.tsx
import { M3Root } from "@aphrody/m3-next/server";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <M3Root readCookie={false}>{children}</M3Root>;
}
```

```ts
// proxy.ts (Next 16's name for middleware.ts)
import { createM3Proxy } from "@aphrody/m3-next/proxy";
export const proxy = createM3Proxy();
// `matcher` is parsed at compile time, so it must be a literal. Pages only:
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
```

## Theme, SSR and Cache Components

- `M3Root` renders `<html>` with the mode class, `color-scheme` and the scheme's colour roles inline, so the first byte is themed.
- With `readCookie={false}` (or `mode="system"`) the shell is static: Cache Components and a static export need that. The inline
  pre-paint script reads the `m3-theme` cookie in the browser and sets `.dark` / `.light` before first paint, so a saved
  preference never flashes. Without `readCookie={false}` the layout reads the cookie on the server (dynamic).
- A Server Component that reads the cookie (`readM3ThemeMode()`) belongs behind `<Suspense>`; `proxy.ts` guarantees the cookie
  exists on the first request, so the server and the client agree from the first byte (`apps/m3-next-example/app/theme`).
- The client provider is a few hundred bytes (cookie, `.dark`, `.light`, `data-m3-theme`, `color-scheme`). The Material You
  engine (material-color-utilities, about 90 KB) is a separate chunk, loaded only when the seed, variant or contrast differ from the
  scheme the server inlined. It replaces the `@aphrody/m3-theme/react` provider: the client entry is 94 KB before and 3.3 KB now
  (`docs/reports/M3-NEXT-BUNDLE.md`).

## Fonts

`next/font` needs literal arguments in the module that calls it, so a library cannot load fonts for you. Load them in
`layout.tsx` and hand the CSS variable to `M3Root`, which points the M3 reference typefaces at it:

```tsx
const roboto = localFont({
  src: "./RobotoFlex.woff2",
  variable: "--font-roboto-flex",
  weight: "100 1000",
});
<M3Root
  className={roboto.variable}
  typefaces={{
    brand: "var(--font-roboto-flex), sans-serif",
    plain: "var(--font-roboto-flex), sans-serif",
  }}
/>;
```

`@aphrody/m3-fonts/fonts.css` is the alternative: `@font-face` rules for the M3 typefaces, imported from the global stylesheet.

## Tauri static export

`withM3(config, { tauri: true })` (or `"auto"`: only when the Tauri CLI runs the build) sets `output: "export"`, unoptimized
images, trailing slashes, `cacheComponents: false` and `NEXT_PUBLIC_M3_STATIC=1`, so `M3Root` stops reading the cookie.
`TAURI_DEV_HOST` adds the dev `assetPrefix` a phone needs. A static export has no `proxy.ts`, route handlers (unless
`force-static`) or server cookies: the preference lives in the cookie the client writes. Point Tauri's `frontendDist` at `../out`.
`apps/m3-next-tauri-example` imports only the sheets of the three components it renders.

## On Bun, no Node

`bun --bun next build` runs Next itself on Bun, but Turbopack spawns `node` for its PostCSS and loader workers and fails when that
is not Bun (`node: --bun is not allowed in NODE_OPTIONS`). `m3-next` puts a `node` that is Bun first on PATH, so the whole
build, workers included, runs on one runtime and Turbopack stays the bundler (no `--webpack` fallback: `apps/m3-next-example`, cold, back to back on one machine: 4.5 s with
Turbopack, 15.3 s with `--webpack`). `m3-next dev`, `build` and `start` pass their arguments to `next`.

### Moved to the former Bun fork

The runner (`bunNodeShim`, `nextBin`, `nextCommand`) and its tests now live in `@aphrody/next-bun`
(`packages/bun-next/lib/run.js` and `test/integration/next-bun/` of the former Bun fork, also `next-bun dev|build|start`).
`bin/m3-next.ts` re-exports them and keeps the `m3-next` usage. The dependency is the published
`@aphrody/next-bun` (npm, exact pin `0.2.0-aphrody.1`).

A file named `proxy.ts` anywhere in a transpiled package is treated as the app's proxy by Next: that is why this package's helper
lives in `theme-proxy.ts` (exported as `@aphrody/m3-next/proxy`).

## Examples and checks

```sh
bun scripts/examples.ts check          # build, dev, production and static export; probe every route
bun scripts/examples.ts bench          # cold and warm builds, three runs each
bun scripts/bundle-report.ts --examples    # bundle sizes (docs/reports/M3-NEXT-BUNDLE.md)
bun run test                               # unit tests, then the DOM tests (happy-dom preload)
```

The examples live under the root `apps/` owner. `scripts/examples.ts` invokes the existing `m3-next` runner in each application directory; no temporary workspace or source links are created.
Migrating an existing app to this stack: `@aphrody/m3-next-migrate` (`next-migrate codemod all <dir>`).
