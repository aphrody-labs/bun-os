<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-next-migrate

Codemods that move a Next 14/15, MUI or Tailwind v3 app to Next.js 16 with M3, plus the analysis, scaffolding and runtime shims that take a Next 16 app to Tauri or a native Bun web app.

```sh
bun add -d @aphrody/m3-next-migrate   # use bun add (not -d) when the migrated app imports the shims
```

```sh
bunx --bun next-migrate codemod --list
bunx --bun next-migrate codemod next16 ./my-app          # report only
bunx --bun next-migrate codemod all ./my-app --apply     # write
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

## Codemods: to the Next 16 + M3 stack

The codemods take an existing app **to** Next.js 16, Base UI with M3 and Tailwind v4 (the stack of `@aphrody/m3-next`,
`@aphrody/m3-baseui` and `@aphrody/m3-tailwind`); the rest of this README takes a Next 16 app out to Tauri or Vite. Without
`--apply` nothing is written: you get a report of what would change and what needs a human.

```sh
next-migrate pages-hints ./my-app               # Pages Router -> App Router plan, nothing rewritten
```

Inside the Aphrody checkout, `yolo m3 next-migrate` takes the same arguments.

| Group     | Codemod                                                            | Does                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| next16    | `next-config`                                                      | `experimental.dynamicIO`, `ppr` -> `cacheComponents`; `experimental.turbo` -> `turbopack`; `typedRoutes`, `reactCompiler`, `serverComponentsExternalPackages` -> `serverExternalPackages`; drops `eslint` and removed flags; `images.domains` -> `remotePatterns` |
| next16    | `middleware-to-proxy`                                              | `middleware.ts` -> `proxy.ts`, `export function middleware` -> `proxy`, drops `runtime = "edge"`                                                                                                                                                                  |
| next16    | `async-request-apis`                                               | awaits `cookies()`, `headers()`, `draftMode()` and makes the enclosing top-level function async                                                                                                                                                                   |
| next16    | `async-route-props`                                                | `params` and `searchParams` are Promises in page, layout, route and metadata files: types, destructuring and uses                                                                                                                                                 |
| next16    | `revalidate-tag`                                                   | `revalidateTag(tag)` -> `revalidateTag(tag, "max")`                                                                                                                                                                                                               |
| next16    | `legacy-image`, `next-package-json`                                | `next/legacy/image` -> `next/image`; versions, `next lint`, `--turbo`                                                                                                                                                                                             |
| mui       | `mui-to-m3`                                                        | Button, Switch, Checkbox, Divider -> `@aphrody/m3-baseui`; Typography, Stack, Box, Paper -> elements with M3 Tailwind classes; the rest is reported                                                                                                               |
| tailwind4 | `tailwind-css-v4`                                                  | `@tailwind` directives -> `@import "tailwindcss"`; `@layer utilities` -> `@utility`; `theme()`                                                                                                                                                                    |
| tailwind4 | `tailwind-classes-v4`                                              | `shadow-sm`, `rounded`, `ring`, `outline-none`, ... renamed; `bg-opacity-50` -> `/50`; `!p-4` -> `p-4!`; `bg-[--x]` -> `bg-(--x)`; runs once (a project already on v4 is skipped)                                                                                 |
| tailwind4 | `tailwind-config-v4`, `postcss-config-v4`, `tailwind-package-json` | `tailwind.config.js` -> `tailwind-theme.css` (`@theme`, `@plugin`, dark variant); PostCSS plugin; dependencies                                                                                                                                                    |

The codemods are pure functions on source text (`import { codemods } from "@aphrody/m3-next-migrate"`, or the subpath
`@aphrody/m3-next-migrate/codemods`): a small scanner finds strings, comments and matching brackets, so edits never land inside a
string. A shape a codemod recognises but cannot rewrite safely (a named props type, a callback that needs `await`, a MUI Select) becomes
a warning, never a guess. `pages-hints` covers `getServerSideProps`, `getStaticProps`, `getStaticPaths`, `next/router`, `next/head`,
`(req, res)` API handlers, `_app` and `_document`.

### Moved to the former Bun fork

The `next16` and `tailwind4` codemods, the source scanner (`lex`), `pages-hints` and the codemod CLI now live in `@aphrody/next-bun`
(`packages/bun-next/codemods/` of the former Bun fork, tested in `test/integration/next-bun/codemods.test.ts` there, also
`next-bun codemod`). This package keeps `mui-to-m3` (and its JSX scanner), composes `[...NEXT16_CODEMODS, mui, ...TAILWIND4_CODEMODS]`,
passes the M3 preset header to `tailwind-config-v4` and re-exports the rest from `@aphrody/m3-next-migrate/codemods`. The dependency is
the published `@aphrody/next-bun` (npm, exact pin `0.2.0-aphrody.1`).

---

## Why Migrate from Next.js 16 to Tauri v2 or Vite?

Next.js 16 introduces React 19, Server Actions, Async Request APIs (`await params`, `await cookies()`), and deep coupling to Vercel/Node edge runtimes. Migrating UI components to a desktop application (Tauri v2) or client SPA (Bun/Vite) traditionally requires manually rewriting dozens of Next.js imports and routing mechanisms.

`@aphrody/m3-next-migrate` automates this transition end-to-end:

1. **AST & Import Codemod**:
   - Strips `"use client"` and adapts `"use server"` boundaries.
   - Rewrites `next/navigation` hooks (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `redirect`, `notFound`).
   - Rewrites `next/link` with automatic desktop shell delegation (external links open in OS browser via `@aphrody/plugin-opener`, internal links route via client router).
   - Rewrites `next/image` with responsive `<img>` and `fill` mode support.
   - Rewrites `next/font/google` and `next/font/local` to standard CSS variables and fonts.
   - Rewrites `next/dynamic` to `React.lazy` + `Suspense`.
   - Normalizes Next 16 async page props (`await params` -> `params`).
   - Rewrites `process.env.NEXT_PUBLIC_*` to `import.meta.env.*`.

2. **Production-Ready Runtime Shims**:
   - `@aphrody/m3-next-migrate/shims/navigation`
   - `@aphrody/m3-next-migrate/shims/link`
   - `@aphrody/m3-next-migrate/shims/image`
   - `@aphrody/m3-next-migrate/shims/font`
   - `@aphrody/m3-next-migrate/shims/dynamic`
   - `@aphrody/m3-next-migrate/shims/headers`
   - `@aphrody/m3-next-migrate/shims/form`
   - `@aphrody/m3-next-migrate/shims/tauri-ipc`
   - `@aphrody/m3-next-migrate/shims/provider` (`<NextMigrateProvider>`)

3. **Complete Scaffolding**:
   - Generates `tauri.conf.json`, `Cargo.toml`, `vite.config.ts`, `index.html`, and `main.tsx`.

---

## CLI Usage

```bash
# Scan a Next.js 16 codebase and audit used features
next-migrate ./my-next-app --scan-only

# Migrate an entire Next.js 16 project to Tauri v2
next-migrate ./my-next-app ./desktop-app --target tauri

# Migrate to a Bun / Vite web SPA
next-migrate ./my-next-app ./web-app --target vite

# Migrate a single component file
next-migrate ./components/Hero.tsx ./dist/Hero.tsx
```

---

## Programmatic API

```typescript
import {
  transformComponent,
  scanNextDirectory,
  migrateProject,
} from "@aphrody/m3-next-migrate";

// Transform component code
const result = transformComponent(nextSourceCode, {
  target: "tauri",
  rewriteEnv: true,
  stripDirectives: true,
});

// Full project migration
const report = await migrateProject({
  sourceDir: "./next-site",
  targetDir: "./tauri-desktop",
  target: "tauri",
  projectName: "my-desktop-app",
  scaffold: true,
});
```

The generated project is written by [`@aphrody/scaffold`](../scaffold) (the `app` template), the single scaffolder of the
UI stack; `TAURI_3` is re-exported from there. See [`docs/guides/ui/SCAFFOLD.md`](../../docs/guides/SCAFFOLD.md).

---

## Testing & Verification

```bash
bun test packages/m3-next-migrate
bun run --filter @aphrody/m3-next-migrate typecheck
bun run --filter @aphrody/m3-next-migrate build
```
