# Bun + Three.js WebGPU scaffold (Bun OS)

The Bun OS twin of [scaffold-vite-threejs](../scaffold-vite-threejs/README.md): the same scene, `LOOK`, `VIEWS`,
rigs, demand-driven loop and capture contract, built and served by Bun instead of Vite and drawn by
`THREE.WebGPURenderer`, which falls back to its WebGL2 backend when the browser offers no WebGPU adapter.
`document.documentElement.dataset.backend` says which one drew. The side panel is Bun OS chrome: `m3.css` is the
Bun OS Material 3 sheet and `style.css` uses only its roles. Scene colours stay in `LOOK`.

## Copy it out first

```sh
cp -r <skill>/templates/scaffold-bun-threejs my-scene
cp -r <skill>/templates/rigs my-scene/rigs      # main.js imports ./rigs/*, including post-stack-webgpu.js
cd my-scene
bun install
bun run dev          # http://127.0.0.1:4173, rebuilds on change
bun run build        # static build in dist/
bun <skill>/scripts/capture.js --dir dist --all-views --click "#control" \
  --motion-check 2000 --expect-motion --out captures
```

Pinned: `three@0.186.1`, the release Bun OS ships. Rename `"name"` in `package.json` and add a `.gitignore` with
`node_modules/`, `dist/` and `.dev/`.

## What differs from the Vite scaffold

- `build.ts` bundles `index.html` with `Bun.build` and aliases every `three` import (yours, the rigs' and the
  addons') to `three/webgpu`, so one renderer family owns PMREM, materials and post. `serve.ts` is the dev server.
- `rigs/post-stack-webgpu.js` replaces pmndrs `postprocessing` (WebGL-only) with TSL nodes on `RenderPipeline`:
  bloom adds in linear light and the pipeline tone maps once, at the end.
- `rigs/lighting-studio.js` uses `RectAreaLightUniformsLib`, which is WebGL-only. On WebGPU call
  `RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())` from `three/addons/lights/RectAreaLightTexturesLib.js`
  instead before adding the panels.
- Shaders written as `ShaderMaterial` GLSL do not run on WebGPU; write them as TSL node materials.

Native Bun OS apps draw the same kind of scene with Bevy on wgpu (`crates/aphrody-nie-bevy`) or the
`crates/aphrody-render` scene renderer; this scaffold is the browser lane.
