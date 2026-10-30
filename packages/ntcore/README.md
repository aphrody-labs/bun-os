# @aphrody/ntcore

NT personality building blocks for Bun OS: the ReactOS cmlib registry hive engine, the Executive handle table and PE header helpers, compiled to one freestanding wasm32 module.

```sh
bun add @aphrody/ntcore
```

## License and corresponding source

GPL-2.0-or-later. `wasm/ntcore.wasm` is compiled from ReactOS sources (revision recorded in `wasm/ntcore.build.json`, https://github.com/reactos/reactos) and the glue in https://github.com/aphrody-labs/bun-os/tree/os/factory/ntcore. The complete corresponding source is available at those locations.
