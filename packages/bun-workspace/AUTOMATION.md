# Bun OS workspace automation

`@aphrody/bun-workspace` owns the product source catalog, native library builds,
shared process/runtime policy and workspace automation. The absorbed automation
sources retain their Aphrody history and Apache-2.0 SPDX notices. Automation is
exported through `./automation` and `./automation/*`; native library APIs retain
their existing exports.

Run commands from the selected checkout:

```sh
bun src/cli.ts workspace --help
bun src/cli.ts workspace inventory
bun src/cli.ts ops imports-exports --root . --json
bun src/cli.ts ops monorepo-audit --root . --only imports --json
bun src/cli.ts ops bun-workspace --root . --json
bun src/cli.ts ops monorepo-gate --root . --no-build --plan --json
bun src/cli.ts infra --help
```

`workspace` dispatches workspace commands; `ops` loads only the selected
automation module. `infra` invokes the native infrastructure owner for hosts,
services, pipelines and deployment. Host-specific permissions still apply.
The adapters do not synchronize credentials, cookies, raw provider sessions,
databases or model weights.

`BUN_OS_ROOT` selects the checkout explicitly. Otherwise discovery walks to
the enclosing Bun OS source catalog; nested runtime checkouts cannot replace
the product owner. `BUN_OS_INFRA_BIN` selects an installed native Infra binary.
The bridge discovers `bunos-infra` first and supports installed Aphrody
capability-owner executables. Explicit `APHRODY_*` configuration remains
compatible. Installed executables are separate from checkout build evidence.

Source compilation requires `BUN_OS_INFRA_BUILD_FROM_SOURCE=1`; it uses the
serialized native root owner:

```sh
bun scripts/cargo.ts exec -- run --quiet --locked -p aphrody-infra --bin bunos-infra -- --help
```

`BUN_OS_NO_BUILD=1` disables that opt-in. The bridge never starts WSL or selects
a shell build backend. Type checking, lint, formatting and migration use
`bun check`, `bun lint` and `bun fmt` directly. The compatibility
`ops n2b` route loads the native n2b addon (N-API); it does not discover
an external executable or read `N2B_BIN`.

Infra catalogs live in `infra/config`. The `./automation/client` export is the
typed HTTP boundary for the native Infra server. Inventory, help, source
validation, builds and deployed-host qualification remain distinct evidence.
