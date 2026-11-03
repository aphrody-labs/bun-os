/**
 * Serveur de démo Bun — affiche le renderer GameMenu en HTML pur (no-SSR React).
 *
 * Le layout est fourni inline en JSON dans le HTML ; les sprites sont servis
 * depuis le dossier local `re/menu/assets/` (symlink ou copie manuelle) ou
 * depuis le CDN public en fallback.
 *
 * Usage :
 *   bun packages/menu-render/src/demo/server.ts
 *   # ouvre http://localhost:3456
 *
 * Pour les sprites locaux :
 *   ln -s /home/ubuntu/niers/data/dx11/menu packages/menu-render/src/demo/public/dx11/menu
 *   # ou copier quelques PNG de test
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error TS2307: Bun text import of the generated sheet (inlined by bun build); TypeScript has no .css text type.
import brandSheet from "../../../app-ui/src/brand.css" with { type: "text" };

const PORT = 3456;
const ASSET_BASE = "/assets";

// Chemin vers le sample layout (re/menu/sample-layout.json)
const LAYOUT_PATH = resolve(import.meta.dir, "../../../../re/menu/sample-layout.json");
const layout = JSON.parse(readFileSync(LAYOUT_PATH, "utf-8"));

// Dossier d'assets locaux (chemin absolu vers les PNG G4TX exportés)
const ASSETS_DIR = resolve(import.meta.dir, "public");

// R\u00F4les g\u00E9n\u00E9r\u00E9s de la marque Aphrody (packages/app-ui/src/brand.css, graine produit), bascul\u00E9s par le th\u00E8me
// syst\u00E8me : la page n'ex\u00E9cute aucun script avant le premier rendu.
const brandRoles = (brandSheet as string)
  .replace(/:root\.light,\s*\.light\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: light) {\n:root {$1}\n}")
  .replace(/:root,\s*\.dark\s*\{([^}]*)\}/g, "@media (prefers-color-scheme: dark) {\n:root {$1}\n}");

const HTML = /* html */ `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GameMenu Demo — ${layout.screen} (${layout.locale})</title>
  <style>
${brandRoles}
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font-family: "Google Sans Flex", "Roboto Flex", sans-serif; min-height: 100vh; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; }
    h1 { font-size: 14px; color: var(--md-sys-color-on-surface-variant); letter-spacing: 0.08em; text-transform: uppercase; }
    #root { width: 100%; max-width: 1280px; }
    .game-menu-outer {
      position: relative;
      width: 100%;
      aspect-ratio: 1280 / 720;
      overflow: hidden;
      background: black; /* design:content - letterbox of the 1280x720 game canvas */
      border: 1px solid var(--md-sys-color-outline-variant);
    }
    .game-menu-canvas {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 1280px;
      height: 720px;
      transform-origin: center center;
    }
    .menu-obj {
      position: absolute;
      image-rendering: pixelated;
    }
    .menu-obj img {
      display: block;
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
    }
    .menu-text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      line-height: 1.2;
    }
    .menu-text.align-center { justify-content: center; }
    .menu-text.align-left   { justify-content: flex-start; }
    .menu-text.align-right  { justify-content: flex-end; }
    footer { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
  </style>
</head>
<body>
  <h1>GameMenu Demo — screen: <strong>${layout.screen}</strong> locale: <strong>${layout.locale}</strong></h1>
  <div id="root">
    <div class="game-menu-outer" id="menu-outer">
      <div class="game-menu-canvas" id="menu-canvas">
        <!-- Les objets sont injectés par le script ci-dessous -->
      </div>
    </div>
  </div>
  <footer>iecode menu-render — canvas 1280×720 — ${layout.objects.length} objets</footer>

  <script>
    // Layout inline (fourni par le serveur)
    const LAYOUT = ${JSON.stringify(layout)};
    const ASSET_BASE = "${ASSET_BASE}";
    const CANVAS_W = 1280, CANVAS_H = 720;

    function radToDeg(r) { return r * 180 / Math.PI; }

    function drawTypeToBlend(dt) {
      switch(dt) { case 1: return "screen"; case 2: return "multiply"; default: return "normal"; }
    }

    function renderMenu() {
      const canvas = document.getElementById("menu-canvas");
      const sorted = [...LAYOUT.objects].sort((a, b) => a.drawPriority - b.drawPriority);

      for (const obj of sorted) {
        const w = obj.sprite?.w ?? (obj.primitive?.w ?? 256);
        const h = obj.sprite?.h ?? (obj.primitive?.h ?? 64);
        const t = obj.transform;

        const left = t.x - t.anchorX * w;
        const top  = t.y - t.anchorY * h;
        const deg  = radToDeg(t.rot);

        const el = document.createElement("div");
        el.className = "menu-obj";
        el.dataset.name = obj.name;
        el.style.left   = left + "px";
        el.style.top    = top  + "px";
        el.style.width  = w    + "px";
        el.style.height = h    + "px";
        el.style.transformOrigin = (t.anchorX * 100) + "% " + (t.anchorY * 100) + "%";
        el.style.transform = "scale(" + t.scaleX + "," + t.scaleY + ") rotate(" + deg + "deg)";
        el.style.zIndex = String(obj.drawPriority);
        el.style.mixBlendMode = drawTypeToBlend(obj.drawType);

        // Sprite
        if (obj.sprite) {
          const img = document.createElement("img");
          const base = ASSET_BASE.endsWith("/") ? ASSET_BASE.slice(0,-1) : ASSET_BASE;
          const path = obj.sprite.pngUrl.startsWith("/") ? obj.sprite.pngUrl : "/" + obj.sprite.pngUrl;
          img.src = base + path;
          img.alt = "";
          img.loading = "eager";
          img.decoding = "async";
          img.onerror = () => {
            // Sprite absent → placeholder coloré (debug)
            img.style.display = "none";
            el.style.background = "color-mix(in oklab, var(--md-sys-color-error) 25%, transparent)";
            el.style.border = "1px dashed color-mix(in oklab, var(--md-sys-color-error) 50%, transparent)";
            el.style.outline = "none";
            const lbl = document.createElement("div");
            lbl.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--md-sys-color-error);overflow:hidden;white-space:nowrap;padding:2px";
            lbl.textContent = obj.sprite.pngUrl.split("/").pop() ?? obj.name;
            el.appendChild(lbl);
          };
          el.appendChild(img);
        }

        // Primitive
        if (!obj.sprite && obj.primitive) {
          const prim = document.createElement("div");
          prim.style.width  = "100%";
          prim.style.height = "100%";
          prim.style.backgroundColor = obj.primitive.color;
          prim.style.opacity = String(obj.primitive.alpha);
          if (obj.primitive.type === "circle") prim.style.borderRadius = "50%";
          el.appendChild(prim);
        }

        // Texte
        if (obj.text) {
          const txt = document.createElement("div");
          txt.className = "menu-text align-" + obj.text.align;
          txt.style.fontFamily  = '"' + obj.text.font + '", "Noto Sans JP", sans-serif';
          txt.style.fontSize    = obj.text.size + "px";
          txt.style.color       = obj.text.color;
          txt.textContent = obj.text.value;
          el.appendChild(txt);
        }

        // Anim open (Web Animations API)
        if (obj.anim?.open) {
          el.style.opacity = "0";
        }

        canvas.appendChild(el);
      }

      // Scale responsive
      updateScale();

      // Lancer les anims open
      const els = canvas.querySelectorAll(".menu-obj[style*='opacity: 0']");
      els.forEach((el, i) => {
        const baseTransform = el.style.transform;
        el.animate([
          { opacity: 0, transform: baseTransform + " translateY(8px)" },
          { opacity: 1, transform: baseTransform }
        ], {
          duration: 320,
          delay: i * 40,
          easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          fill: "forwards"
        });
      });
    }

    function updateScale() {
      const outer = document.getElementById("menu-outer");
      const canvas = document.getElementById("menu-canvas");
      if (!outer || !canvas) return;
      const { width, height } = outer.getBoundingClientRect();
      const scale = Math.min(width / CANVAS_W, height / CANVAS_H);
      canvas.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
    }

    window.addEventListener("resize", updateScale);
    document.addEventListener("DOMContentLoaded", renderMenu);
  </script>
</body>
</html>`;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Page principale
    if (url.pathname === "/" || url.pathname === "/demo") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Assets locaux (sprites PNG)
    if (url.pathname.startsWith(ASSET_BASE + "/")) {
      const filePath = resolve(ASSETS_DIR, url.pathname.slice(ASSET_BASE.length + 1));
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("asset not found: " + url.pathname, { status: 404 });
    }

    // Layout JSON (API)
    if (url.pathname === "/api/layout") {
      return Response.json(layout);
    }

    return new Response("not found", { status: 404 });
  },
});

console.info(`GameMenu demo → http://localhost:${server.port}`);
console.info(`Layout : ${layout.screen} (${layout.locale}) — ${layout.objects.length} objets`);
console.info(`Assets : ${ASSETS_DIR}`);
console.info(`→ Placer les PNG sous ${ASSETS_DIR}/dx11/menu/... pour les sprites locaux`);
console.info(`→ Ou pointer ASSET_BASE vers le CDN (modifier la constante en haut du fichier)`);
