# WASM OS recipes (docs/WASMOS.md). Imported by the root justfile.

[group('wasmos')]
wasmos-compositor:
    bun packages/wasmos/src/cli.ts build-compositor
    cd packages/wasmos && bun test test/compositor.test.ts

[group('wasmos')]
wasmos-alpine:
    bun factory/wasmos/build-alpine.ts

[group('wasmos')]
wasmos-boot wasm="build/wasmos/alpine-3.24.2-x86_64.wasm":
    WASMOS_ALPINE_WASM={{wasm}} bun test packages/wasmos/test/boot.test.ts
