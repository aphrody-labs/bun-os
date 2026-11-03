<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-reader

Material 3 React readers for paged and vertical manga and illustrated books.

```sh
bun add @aphrody/m3-reader react react-dom tailwindcss
```

```tsx
import "@aphrody/m3-reader/styles.css";
import { MangaReader } from "@aphrody/m3-reader";

export function Chapter({ pages }: { pages: string[] }) {
  return <MangaReader title="Chapter 1" pages={pages} direction="rtl" />;
}
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

This package owns the reader UI, paging, virtual scrolling, zoom, fullscreen, thumbnails, keyboard controls, and lightbox focus. It does not own an asset server, editorial API, persistence, or OCR policy.

Import `@aphrody/m3-reader/styles.css` once in the host stylesheet. The host must load Tailwind 4 and scan the package's `dist` directory with `@source`, as with other Aphrody M3 component packages. The stylesheet imports `@aphrody/m3-theme/tokens.css` and `@aphrody/m3-theme/tailwind.css`, so every reader colour is a Material 3 `--md-sys-color-*` role; theme a reader by setting a different generated scheme on it. `@aphrody/m3-reader/dragon-ball.css` is such a skin: the dark M3 scheme of seed `#e78220`, generated into `dragon-ball.scheme.css` by `bun run generate` (`--check` reports a stale sheet).

`MangaReader` accepts page URLs, direction, adjacent chapter links, an asset resolver, an optional mirror resolver, and callbacks for page addressing. `CaptionedReader` accepts numbered pages, an abortable transcription loader, a transcription renderer, image optimization callbacks, and a preload count. `CollectionReader` owns edition and chapter controls; the host supplies its edition grouping and chapter renderer. The host supplies domain-specific loading and rendering.

The `/source` export serves TypeScript sources to hosts that transpile the package themselves (Next, Bun); the root export points to the compiled `dist`. Hosts remain responsible for asset routing, API links, reading history, on-demand transcription retrieval, OCR warnings, correction links, and Markdown rendering.
