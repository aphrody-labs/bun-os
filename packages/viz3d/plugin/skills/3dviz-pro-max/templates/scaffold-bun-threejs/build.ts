// build.ts - bundle the scene into dist/ with Bun (replaces Vite). Keep the alias plugin: every `three` import,
// from your files, the rigs and three's own addons, resolves to the WebGPU build, so there is one Three.js.
import type { BunPlugin } from "bun";

export const threeWebGPU: BunPlugin = {
  name: "three-webgpu",
  setup(build) {
    const webgpu = Bun.resolveSync("three/webgpu", import.meta.dir);
    build.onResolve({ filter: /^three$/ }, () => ({ path: webgpu }));
  },
};

export async function build(outdir = "dist", minify = true): Promise<string[]> {
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/index.html`],
    outdir: `${import.meta.dir}/${outdir}`,
    minify,
    sourcemap: "linked",
    plugins: [threeWebGPU],
  });
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  return result.outputs.map(output => output.path);
}

if (import.meta.main) console.log(`${(await build()).length} files in dist/`);
