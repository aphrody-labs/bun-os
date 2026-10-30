// SPDX-License-Identifier: Apache-2.0
// Search metadata for public aphrody.com paths that boot the desktop shell. The shared HTTP handler
// rewrites the shell's <head> with these values (title, description, canonical, Open Graph, Twitter), and
// seo.ts lists them in sitemap.xml. Old product hosts 301 to these paths (infra/config/routes.catalog.json),
// so each page has exactly one canonical address.
import { ROUTES, WORKSPACE_ROUTES } from "./src/config";

export const ORIGIN = ROUTES.origin;
export const SITE = "Aphrody Bun OS";

export interface PathMeta {
  title: string;
  description: string;
}

const craft = (name: string, what: string): PathMeta => ({
  title: `${name} in your browser · ${SITE}`,
  description: `${what} Installs from the Bun OS App Store, runs in your browser and keeps working offline.`,
});

export const PATHS: Record<string, PathMeta> = {
  "/": {
    title: "Aphrody Bun OS: a tiling desktop in your browser",
    description:
      "A tiling desktop that runs in your browser: windows and workspaces, files, terminal, browser, games and creative apps that install and work offline.",
  },
  "/os": {
    title: `The desktop · ${SITE}`,
    description:
      "Open the Bun OS desktop: ten workspaces, tiled or floating windows, a search-first launcher and keyboard shortcuts after Omarchy and Hyprland.",
  },
  "/apps": {
    title: `App Store · ${SITE}`,
    description:
      "Install games and creative apps into your browser. Every download is SHA-256 verified and runs offline after the first launch.",
  },
  "/art": {
    title: `Aphrody Creative · ${SITE}`,
    description:
      "Creative apps, projects and shared Drive files: generate, edit and organise your work in the browser.",
  },
  "/film": craft(
    "Video editing",
    "Cut, arrange and export video on a timeline.",
  ),
  "/photo": craft(
    "Image editing",
    "Edit photos and images with layers and filters.",
  ),
  "/vector": craft(
    "Vector drawing",
    "Draw logos, icons and illustrations as vectors.",
  ),
  "/effect": craft("Compositing", "Combine footage, titles and effects."),
  "/light": craft("Photo processing", "Develop and grade photos in batches."),
  "/pdf": craft("PDF tools", "Read, annotate, merge and sign PDF files."),
  "/word": craft("Documents", "Write and format documents."),
  "/sound": craft("Audio editing", "Record, edit and mix audio."),
  "/design": craft("Page layout", "Lay out posters, flyers and pages."),
  "/cad": craft("CAD", "Model parts and drawings in 2D and 3D."),
  "/deck": craft("Slides", "Build and present slide decks."),
  "/grid": craft("Spreadsheets", "Work with tables, formulas and charts."),
  "/fig": craft("Interface design", "Design app and web interfaces."),
};

const tool = (name: string, what: string): PathMeta => ({
  title: `${name} · ${SITE}`,
  description: what,
});

// Desktop apps of the shell (src/main.ts) at their catalog paths.
Object.assign(PATHS, {
  "/files": tool(
    "Files",
    "Your files in the browser, on a Rust file system stored in OPFS: folders, search, trash and previews.",
  ),
  "/drive": tool(
    "Aphrody Drive",
    "Creative projects and assets in the shared desktop workspace, on the same file system as Files.",
  ),
  "/browser": tool(
    "Browser",
    "Browse the web in tabs; pages are fetched by the Aphrody edge and shown script-free in a sandbox.",
  ),
  "/terminal": tool(
    "Terminal",
    "A command line in WebAssembly: the Rust shell over your browser files.",
  ),
  "/docs": tool(
    "Docs",
    "Bun, the Bun fork and Bun OS documentation, searchable in one window.",
  ),
  "/linux": tool(
    "Alpine Linux",
    "A real Alpine Linux machine running in your browser, with a shared folder to your files.",
  ),
  "/media": tool(
    "Media",
    "Play videos, music and pictures from your files or your device.",
  ),
  "/video": tool(
    "Video Studio",
    "Compose clips, titles and music on a timeline and export WebM in the browser.",
  ),
  "/playground": tool(
    "TypeScript playground",
    "Edit a TypeScript project on your browser files, bundle it and run it in an isolated worker.",
  ),
  "/inspector": tool(
    "Inspector",
    "Analyse any file: format, sections and hashes.",
  ),
  "/source": tool(
    "Source catalog",
    "Every Bun OS app, package and crate, with how each one runs and its source.",
  ),
  "/components": tool(
    "Material 3 components",
    "Every Material 3 web component of the Aphrody design system, live with its code.",
  ),
  "/theme-builder": tool(
    "Theme builder",
    "Build a Material 3 colour scheme from one colour, check contrast and export it.",
  ),
  "/web-apps": tool(
    "Web apps",
    "Sites pinned as apps, each in its own window.",
  ),
  "/calculator": tool("Calculator", "A calculator."),
  "/storage": tool("Disk usage", "What takes space in your browser files."),
  "/activity": tool("Activity", "Windows, memory and storage in use."),
  "/keyboard": tool(
    "Keyboard shortcuts",
    "Every keyboard shortcut of the desktop.",
  ),
  "/about": tool("About", "About this Bun OS desktop and its build."),
  "/settings": tool(
    "Settings",
    "Theme, colour, sounds and appearance of the desktop.",
  ),
  "/ds": tool(
    "Nintendo DS",
    "The qualified Dust Nintendo DS emulator of Bun Engine, with open-source test content.",
  ),
} satisfies Record<string, PathMeta>);
// App UI routes opened as desktop windows (apps/webos/apps.json).
for (const route of WORKSPACE_ROUTES) {
  const path = Object.entries(ROUTES.apps).find(
    ([, id]) => id === route.id,
  )?.[0];
  if (path) PATHS[path] ??= tool(route.name, `${route.desc}.`);
}

/** Normalised lookup: "/pdf/" and "/pdf" share one entry. */
export function pathMeta(pathname: string): PathMeta | undefined {
  const key = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return PATHS[key];
}
