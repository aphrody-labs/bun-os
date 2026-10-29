# @aphrody/buncc

Bun C Compiler: a `cc`/`c++`/`ar`/`link` driver, toolchain providers (clang, MSVC via xwin, MinGW, MSYS2, CMake, GN, vcpkg, uv, just, Rust, wasm, .NET) and a workspace build orchestrator for Bun OS. Run with Bun.

```sh
bun add -g @aphrody/buncc
buncc --help
```

Toolchains are downloaded on demand from their upstream publishers; none are bundled in this package.

License: MIT. Source: https://github.com/aphrody-labs/bun-os/tree/os/packages/buncc
