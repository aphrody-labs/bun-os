# HISTORY

Provenance of every imported path: source repo, commit, original path, destination here. Original text kept; `git show <rev>:<path>` reproduces each source.

Scan: aphrody 1948 commits (all branches), yolo 199, iecode 176, aphrody-labs/rg 1332 (legacy+main). Dated 2026-10-04.

## Imported

| Source repo             | Commit        | Source path                                                                                                | Destination                                                            | Files |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-ui`                                                                                | `rust/nie-ui`                                                          | 11    |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-render`                                                                            | `rust/nie-render`                                                      | 2     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-render3d`                                                                          | `rust/nie-render3d`                                                    | 16    |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-viewer-web`                                                                        | `rust/nie-viewer-web`                                                  | 2     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-wasm`                                                                              | `rust/nie-wasm`                                                        | 11    |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-lua-web`                                                                           | `rust/nie-lua-web`                                                     | 6     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-app/src/render.rs`                                                                 | `rust/ref/nie-app-render.rs`                                           | 1     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-game/tests/menu_render_gate.rs`                                                    | `rust/ref/menu_render_gate.rs`                                         | 1     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-cli/src/render_cmd.rs`                                                             | `rust/ref/cli-render_cmd.rs`                                           | 1     |
| iecode                  | `b337ab25`    | `crates/nie/aphrody-nie-cli/src/seed_ui.rs`                                                                | `rust/ref/cli-seed_ui.rs`                                              | 1     |
| iecode                  | `b337ab25`    | `docs/nie/DESIGN-UI.md`                                                                                    | `docs/nie/DESIGN-UI.md`                                                | 1     |
| iecode                  | `b337ab25`    | `docs/nie/DESIGN.md`                                                                                       | `docs/nie/DESIGN.md`                                                   | 1     |
| iecode                  | `b337ab25`    | `docs/nie/RENDER-QA.md`                                                                                    | `docs/nie/RENDER-QA.md`                                                | 1     |
| iecode                  | `b337ab25`    | `docs/nie/SITE.md`                                                                                         | `docs/nie/SITE.md`                                                     | 1     |
| iecode                  | `b337ab25`    | `docs/nie/ui-convergence-visual-analysis.md`                                                               | `docs/nie/ui-convergence-visual-analysis.md`                           | 1     |
| iecode                  | `b337ab25`    | `docs/nie/architecture/desktop-site-capabilities.md`                                                       | `docs/nie/architecture/desktop-site-capabilities.md`                   | 1     |
| iecode                  | `b337ab25`    | `docs/nie/game-data/native-ui-sprites.md`                                                                  | `docs/nie/game-data/native-ui-sprites.md`                              | 1     |
| iecode                  | `b337ab25`    | `docs/nie/azalee/azalee-tauri.md`                                                                          | `docs/nie/azalee/azalee-tauri.md`                                      | 1     |
| iecode                  | `b337ab25`    | `docs/nie/ievr-site`                                                                                       | `docs/ievr-site`                                                       | 4     |
| iecode                  | `b337ab25`    | `.agents/skills/pixel-perfect`                                                                             | `skills/pixel-perfect`                                                 | 3     |
| iecode                  | `b337ab25`    | `.agents/skills/nie-render-pipeline`                                                                       | `skills/nie-render-pipeline`                                           | 2     |
| iecode                  | `b337ab25`    | `docs/nie/skills/nie-render-pipeline`                                                                      | `skills/nie-render-pipeline-docs`                                      | 1     |
| iecode                  | `b337ab25`    | `apps/<website>/src/lib/nie-wasm-web`                                                                      | `packages/nie-web/src/nie-wasm-web`                                    | 4     |
| iecode                  | `b337ab25`    | `apps/<website>/src/lib/nie-engine.ts`                                                                     | `packages/nie-web/src/nie-engine.ts`                                   | 1     |
| iecode                  | `b337ab25`    | `apps/<website>/src/lib/nie-game.ts`                                                                       | `packages/nie-web/src/nie-game.ts`                                     | 1     |
| iecode                  | `b337ab25`    | `packages/inagle/src/ui`                                                                                   | `packages/inagle-ui/src`                                               | 1     |
| aphrody                 | `6bed3c00e^`  | `scripts/iecode/audit/ui/apps/nie-web`                                                                     | `packages/nie-web/audit`                                               | 4     |
| aphrody                 | `6bed3c00e^`  | `scripts/iecode/build/ui/apps/nie-web`                                                                     | `packages/nie-web/build`                                               | 5     |
| aphrody                 | `6bed3c00e^`  | `scripts/release/ui/apps/nie-web`                                                                          | `packages/nie-web/release`                                             | 1     |
| aphrody                 | `6bed3c00e^`  | `scripts/iecode/tools/ui/apps/nie-web`                                                                     | `packages/nie-web/tools`                                               | 6     |
| aphrody                 | `e82c3a5ab`   | `docs/products/ui/apps/nie-web`                                                                            | `packages/nie-web/docs`                                                | 4     |
| aphrody                 | `bc62f3f3f`   | `crates/aphrody-site/assets/nie-viewer`                                                                    | `packages/nie-web/assets/nie-viewer`                                   | 2     |
| aphrody                 | `af66f5067`   | `crates/aphrody-wasm/examples`                                                                             | `tools/pixel-perfect/examples`                                         | 8     |
| aphrody                 | `eb198ac11`   | `.claude/plugins/aphrody/skills/pixel-perfect`                                                             | `skills/pixel-perfect-aphrody`                                         | 3     |
| aphrody                 | `eddd8ddc0`   | `docs/guides/nie/CONTRIBUTING.md`                                                                          | `docs/aphrody-history/nie-CONTRIBUTING.md`                             | 1     |
| aphrody                 | `bc62f3f3f`   | `docs/web/NIERS-INTEGRATION.md`                                                                            | `docs/aphrody-history/NIERS-INTEGRATION.md`                            | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/iecode/validation/measure-rust-web-coverage.ts`                          | `tools/pixel-perfect/validation/measure-rust-web-coverage.ts`          | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/iecode/validation/menu-animation-wasm-equality.mjs`                      | `tools/pixel-perfect/validation/menu-animation-wasm-equality.mjs`      | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/iecode/validation/menu-scene-wasm-equality.mjs`                          | `tools/pixel-perfect/validation/menu-scene-wasm-equality.mjs`          | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/iecode/validation/native-presentation-wasm-equality.mjs`                 | `tools/pixel-perfect/validation/native-presentation-wasm-equality.mjs` | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/render-mode-screens.sh`                                                  | `tools/pixel-perfect/render-mode-screens.sh`                           | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/e2e-site.sh`                                                             | `tools/pixel-perfect/e2e-site.sh`                                      | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/tools/nie/scripts/setup-wasm.ps1`                                                          | `tools/pixel-perfect/setup-wasm.ps1`                                   | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/build/nie/scripts/build-wasm.sh`                                                           | `packages/nie-web/build/build-wasm.sh`                                 | 1     |
| aphrody                 | `675284765`   | `scripts/iecode/build/nie/scripts/build-wasm.ps1`                                                          | `packages/nie-web/build/build-wasm.ps1`                                | 1     |
| rg                      | `8d70233c`    | `packages/menu-render`                                                                                     | `packages/menu-render`                                                 | 11    |
| rg                      | `8d70233c`    | `packages/menu-render-webgpu`                                                                              | `packages/menu-render-webgpu`                                          | 23    |
| rg                      | `93aea3ba`    | `apps/azalee`                                                                                              | `apps/azalee-web`                                                      | 997   |
| iecode                  | `671871baa^`  | `crates/aphrody-model-view`                                                                                | `apps/tauri/model-view`                                                | 18    |
| iecode                  | `671871baa^`  | `crates/aphrody-tauri-3d`                                                                                  | `rust/tauri-3d`                                                        | 8     |
| aphrody-m3-working-copy | `(untracked)` | `design/aphrody-m3/packages/nie-ui (copy of iecode apps/iecode-web src/ui + src/styles, commit 67fb74618)` | `src`                                                                  | 13    |

## Adapted

- `packages/menu-render*`: iecode-config/catalog refs replaced by root tsconfig.base.json and root catalog; the iecode-inagle package (lua-host.ts) is provided by the iecode workspace.
- `rust/Cargo.toml`: new manifest mirroring iecode root workspace.package and the needed workspace.dependencies (path deps via sibling iecode/aphrody checkouts). No cargo was run.
- `src/` (emulator web UI) keeps the layout expected by iecode `apps/iecode-web` through `design/aphrody-m3/packages/nie-ui`.

## Kept in source repos (reason)

- iecode `crates/nie/aphrody-nie-{ui,render,render3d,viewer-web,wasm,lua-web}`: iecode Rust crate dedup is in progress by another agent; remove after it lands. render3d is still a dependency of nie-app/runtime.
- iecode `apps/<website>/src/lib/{nie-wasm-web,nie-engine.ts,nie-game.ts}`: imported by the RG website pages.
- iecode `.agents/skills/{pixel-perfect,nie-render-pipeline}`, yolo `plugins/iecode/skills/*`: skills are consumed by plugins; the nie-ui skill points here.
- iecode `packages/inagle/src/ui`: inside packages/inagle (FFI dedup agent).
- iecode docs `DESIGN.md`, `DESIGN-UI.md`, `RENDER-QA.md`, `SITE.md`, `ievr-site`, `azalee-tauri.md`: referenced by crates, READMEs and migration manifests (provenance).
- iecode `config/nie/host/systemd/nie-site.service`, yolo `config/host/{systemd,nginx}/nie`: host config owned by Infra.

## Not found

- The full former `nie-web` app (src/desktop, src/inacord, inacord gallery/three sources) and any inagle/inacord Tauri app: only its scripts and READMEs exist in any of the four histories; no ex-NIE repository exists in aphrody-labs.
- `packages/inacord-ui` (source of game-tokens.css): absent from all histories; tokens live in rust/nie-ui.
- No pixel-perfect screenshots/renderer binaries beyond the skills, examples and wasm-equality validators listed above.
- src/message.ts: copied from iecode apps/iecode-web/src/message.ts (2026-10-04) so typecheck:ui resolves standalone.
