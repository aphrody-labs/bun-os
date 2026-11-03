<!-- SPDX-License-Identifier: Apache-2.0 -->
# Canvas upstream integration

The submodule `third_party/canvas` tracks the non-fork upstream
`https://github.com/Brooooooklyn/canvas` at `8411071` (upstream 1.0.9). The Aphrody namespace
stays outside the submodule, in `packages/canvas` as `@aphrody/canvas`; no non-Aphrody scoped
package is exposed in the Bun workspace.

## Published package

- The upstream JavaScript loader, typings and license are copied unmodified into
  `packages/canvas/vendor/` (provenance and SHA-256 in `vendor/UPSTREAM.md`).
- Prebuilt Skia binaries come from the upstream `@napi-rs/canvas-<platform>` packages pinned at
  the same version in `optionalDependencies`.
- `bun scripts/vendor-upstream.ts` regenerates the copies; `--check` is the `prepack` gate and
  `vendor.test.ts` fails on drift. `NAPI_RS_NATIVE_LIBRARY_PATH` selects an Aphrody-built addon.
- Details: [`packages/canvas/README.md`](../../../../packages/canvas/README.md).

The upstream source is never mass-rewritten (N2B findings there are upstream CI, Yarn and native
build scripts); the Aphrody wrapper is N2B-clean and owns the Bun workspace contract.

## Role

Canvas is the CPU/native Skia path for images and PDF. WebGPU and `aphrody-render` remain the GPU
path ([`design/M3-RENDER.md`](../architecture/design/M3-RENDER.md)); there is no second GUI renderer.
