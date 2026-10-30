// Dev server of tauri.conf.json `build.devUrl` (http://localhost:1421): serves ui-dist after staging the theme bridge.
import { join } from "node:path";
const root = join(import.meta.dir, "../ui-dist");
await Bun.$`bun ${join(import.meta.dir, "../../../packages/tauri-themes-bridge/bin/stage.ts")} ${root}`;
Bun.serve({
  port: 1421,
  hostname: "localhost",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(root, path === "/" ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log("aphrody ui dev server on http://localhost:1421");
