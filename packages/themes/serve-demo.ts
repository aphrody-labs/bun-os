// Serves demo/out on a free port: `bun packages/themes/serve-demo.ts` then open the printed URL (?theme=apple&scheme=dark&accent=pink).
import { join } from "node:path";
const root = join(import.meta.dir, "demo/out");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  fetch: req => {
    const p = new URL(req.url).pathname;
    return new Response(Bun.file(join(root, p === "/" ? "index.html" : p)));
  },
});
console.log(`http://localhost:${server.port}/`);
