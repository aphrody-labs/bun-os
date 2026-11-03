# @aphrody/viz3d

The Bun OS owner of 3D scene design intelligence: the 3Dviz Pro Max catalog (223 recipes, 440 knowledge records,
22 kit blueprints, 37 studies) with Bun-native retrieval, design context, quality brief, host probe, Blender hero
tier, a `Bun.serve` scene server on Three.js WebGPU (WebGL2 fallback) and CDP capture. UI chrome uses the Bun OS
M3 roles. Upstream and changes: `UPSTREAM.md`. License: MIT (`LICENSE`).

```sh
bun packages/viz3d/src/cli.ts search "timber cottage at dusk"
bun packages/viz3d/src/cli.ts context "riverside mill hamlet" --blueprints --host host.json --hero knowledge.blueprint-watermill
bun packages/viz3d/src/cli.ts serve --kit knowledge.blueprint-watermill --tier T2
bun packages/viz3d/src/cli.ts capture --kit knowledge.blueprint-timber-cottage --all-views --out captures
bun packages/viz3d/src/cli.ts serve --study heart
```

| Path | Role |
| --- | --- |
| `src/` | library and `viz3d` CLI; `src/bin/*.ts` are the skill entry points |
| `runtime/` | kit viewer page (WebGPU), its CSS and the generated M3 sheet |
| `bunos/` | Bun OS skill section, WebGPU scaffold and TSL post rig |
| `plugin/skills/3dviz-pro-max/` | the distributable skill (generated; a plugin's `skills/` directory) |
| `studies/` | upstream's runnable studies, served by `viz3d serve --study` |

Refresh from the fork with `bun run sync` (sync + build); rebuild the skill alone with `bun run build`; re-record
the Python golden fixtures with `bun run golden` (needs `uv`). MCP: the `viz3d_*` tools of `@aphrody/m3-mcp`.
