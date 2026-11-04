// SPDX-License-Identifier: Apache-2.0
import indexHtml from "../index.html";

const port = Number(process.env.PORT) || 8792;
const server = Bun.serve({
  port,
  routes: {
    "/": indexHtml,
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

console.log(`Spotcraft running at ${server.url}`);
