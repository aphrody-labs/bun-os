// SPDX-License-Identifier: Apache-2.0
/**
 * Craft Pro Hub (craft.aphrody.app) Backend Server.
 * Native Bun.serve with HTML imports, Better Auth session guards, and studio catalog.
 */
import { createBetterAuthServer } from "@aphrody/auth";
import indexHtml from "../index.html";

const port = Number(process.env.CRAFT_PORT) || 8794;
const authServer = createBetterAuthServer();

export const STUDIOS = [
  { id: "word", name: "WordCraft", domain: "Word / Google Docs", category: "productivity", icon: "document-text", status: "ready" },
  { id: "grid", name: "GridCraft", domain: "Excel / Google Sheets", category: "productivity", icon: "table-cells", status: "ready" },
  { id: "deck", name: "DeckCraft", domain: "PowerPoint / Google Slides", category: "productivity", icon: "presentation-chart-bar", status: "ready" },
  { id: "pdf", name: "PDFCraft", domain: "Adobe Acrobat Pro", category: "productivity", icon: "document", status: "ready" },
  { id: "photo", name: "PhotoCraft", domain: "Photoshop RAW", category: "creative", icon: "photo", status: "ready" },
  { id: "vector", name: "VectorCraft", domain: "Illustrator", category: "creative", icon: "pencil-square", status: "ready" },
  { id: "design", name: "DesignCraft", domain: "InDesign", category: "creative", icon: "square-3-stack-3d", status: "ready" },
  { id: "fig", name: "FigCraft", domain: "Figma / Adobe XD", category: "creative", icon: "window", status: "ready" },
  { id: "light", name: "LightCraft", domain: "Capture One / Lightroom", category: "creative", icon: "sun", status: "ready" },
  { id: "film", name: "FilmCraft", domain: "Premiere Pro", category: "creative", icon: "film", status: "ready" },
  { id: "effect", name: "EffectCraft", domain: "After Effects", category: "creative", icon: "sparkles", status: "ready" },
  { id: "sound", name: "SoundCraft", domain: "Audition / Logic Pro", category: "creative", icon: "speaker-wave", status: "ready" },
  { id: "cad", name: "CADCraft", domain: "Fusion 360 / AutoCAD", category: "spatial", icon: "cube", status: "ready" },
  { id: "art", name: "ArtCraft", domain: "Generative Creative Studio", category: "spatial", icon: "paint-brush", status: "ready" },
] as const;

const server = Bun.serve({
  port,
  routes: {
    "/": indexHtml,
    "/api/studios": () => Response.json({ studios: STUDIOS, count: STUDIOS.length, timestamp: Date.now() }),
    "/api/auth/*": req => authServer.handle(req),
    "/health": () => Response.json({ status: "healthy", service: "craft-hub", timestamp: Date.now() }),
  },
  development: { hmr: true },
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/src/")) {
      const file = Bun.file("." + url.pathname);
      return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Craft Hub running at ${server.url}`);
export default server;
