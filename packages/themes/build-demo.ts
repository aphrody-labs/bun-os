// Bundles demo/ into demo/out (served by `bun packages/themes/serve-demo.ts`).
import { join } from "node:path";
const d = join(import.meta.dir, "demo"),
  out = join(d, "out");
const r = await Bun.build({ entrypoints: [join(d, "main.ts")], outdir: out, target: "browser", naming: "main.js" });
if (!r.success) throw new Error(r.logs.join("\n"));
const { bootScript } = await import("./src/runtime.ts");
await Bun.write(join(out, "boot.js"), bootScript());
await Bun.write(join(out, "index.html"), await Bun.file(join(d, "index.html")).text());
await Bun.write(join(out, "themes.css"), await Bun.file(join(import.meta.dir, "generated/themes.css")).text());
console.log("demo built:", out);
