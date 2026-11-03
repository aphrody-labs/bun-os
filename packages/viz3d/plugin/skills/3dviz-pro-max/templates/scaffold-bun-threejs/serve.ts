// serve.ts - development server: build into .dev/, serve it on 127.0.0.1 with Bun.serve, rebuild on change.
import { watch } from "node:fs";
import { join } from "node:path";
import { build } from "./build.ts";

const root = import.meta.dir;
const out = join(root, ".dev");
await build(".dev", false);
let pending: Promise<unknown> | null = null;
watch(root, { recursive: true }, (_event, file) => {
  if (!file || /^(\.dev|dist|node_modules)([\/]|$)/.test(file)) return;
  pending ??= build(".dev", false)
    .catch(error => console.error(error))
    .finally(() => (pending = null));
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.PORT ?? 4173),
  async fetch(request) {
    await pending;
    const path = decodeURIComponent(new URL(request.url).pathname);
    const file = Bun.file(join(out, path.endsWith("/") ? `${path}index.html` : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`http://127.0.0.1:${server.port}/`);
