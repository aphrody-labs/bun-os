# Bun OS product CLI

The root `bunos` command is the product entry point. It routes to the existing package owners so installed commands and workspace source share one implementation.

## First-party commands

- `bunos design <query> --stack m3` searches UI/UX Pro Max against the M3 product stack. Add `--design-system` to generate a design-system artifact. `bunos design compile --prompt <brief>` invokes the canonical M3 compiler, HCT theme generator and self-critique. The full searchable catalog and references ship inside `@aphrody/m3-design`.
- `bunos engine <command>` runs Bun Engine operations such as `probe`, `build`, `run`, `compile`, `web` and `frontend`.
- `bunos re <arguments>` runs the Bun OS RE facade; `bunos rea <arguments>` runs the canonical REA CLI. Use `bunos rea mcp` to start REA's standalone MCP server.
- `bunos superapp build|craft|serve|deploy` builds, serves or deploys the WebOS-based Aphrody super-site and its Craft WebAssembly apps. The root Bun workspace installs `@aphrody/webos` with the shared M3 and WebOS-WASM packages.

`apps/webos` assembles the browser super-site and mounts the canonical `packages/app-ui` at `/workspace/`. `superapp build` first builds App UI with this deployment prefix, then assembles WebOS using that artifact. `BUN_OS_APP_UI_DIST` selects the shared intermediate artifact directory (default `build/app-ui`). Browser App UI already adapts the WebOS-WASM RPC envelope through `webOsTransport`; native Aphrody Drive uses its native transport. These storage domains remain distinct.

Run assembly and Craft compilation on the Linux VPS factory. A custom intermediate directory must stay under the root `build/`. WebOS-WASM must already be built by its native owner; missing inputs are reported before App UI compilation. `superapp craft [id ...]` uses the root serialized Cargo owner, the shared root target directory and at most four compiler jobs.

The root workspace directly depends on M3 Design, Bun Engine, Bun OS RE and REA so package installation resolves these owners with the product. The UI/UX guidance uses the canonical M3 token, theme and component packages for Bun OS and Aphrody Labs interfaces.

## Workspace inventory

Use `bunos workspace inventory` for the read-only catalog of Cargo/Bun manifests, source owners, revisions, physical locations and migration state. It separates package members from fixtures, vendored inputs, unavailable sparse checkouts and source submodules; do not treat every manifest under `vendor/` as a product package. At this checkout the scan reports 3,640 manifests (2,052 Cargo and 1,568 Bun), including 682 root Cargo members and 533 root Bun members. See `docs/SOURCE-WORKSPACE.md` for the source-owner inventory contract.
