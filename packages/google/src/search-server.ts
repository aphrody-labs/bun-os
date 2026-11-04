// SPDX-License-Identifier: Apache-2.0
import searchHtml from "./search-ui.html";

const port = Number(process.env.SEARCH_PORT) || 8793;

const server = Bun.serve({
  port,
  routes: {
    "/": searchHtml,
    "/search": searchHtml,
    "/api/suggest": (req) => {
      const url = new URL(req.url);
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const mockSuggestions = [
        "bun os",
        "bun os download",
        "bun os arch linux",
        "bun os documentation",
        "bun os cosmic desktop",
        "bun vs nodejs 2026",
        "bun serve performance",
        "bun test runner",
        "bun compile aot"
      ];
      const matches = mockSuggestions.filter(s => s.includes(q));
      return Response.json([q, matches]);
    },
    "/api/search": (req) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") || "";
      return Response.json({
        query: q,
        totalResults: 142000,
        searchTimeSec: 0.18,
        organic: [
          {
            title: `Bun OS — Le Système d'Exploitation Unifié et Souverain (${q})`,
            url: "https://aphrody.com/bun-os",
            displayUrl: "https://aphrody.com > bun-os",
            snippet: "Distribution Linux optimisée pour le runtime Bun upstream avec intégration complète d'Android 17, COSMIC desktop et des modèles d'IA souverains."
          },
          {
            title: "Documentation Officielle Bun — Runtime JavaScript Ultra-Rapide",
            url: "https://bun.sh/docs",
            displayUrl: "https://bun.sh > docs",
            snippet: "Découvrez Bun : un runtime JavaScript tout-en-un doté d'un gestionnaire de paquets, d'un exécuteur de tests et d'un bundler natif haute performance."
          }
        ]
      });
    }
  },
  development: { hmr: true }
});

console.log(`Bun Search server running at ${server.url}`);
