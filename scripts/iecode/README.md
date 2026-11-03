# IECODE scripts

Run repository commands through the root Bun workspace using the qualified
Aphrody Bun fork declared in `config/bun-runtime.json`. The runtime guard checks
the current executable CLI identity and source revision; standard Bun is rejected. Shared operations belong
to the installed `@aphrody/bun-workspace/automation/ops` registry export; IECODE keeps thin bindings
and game-specific tools. Explicit `APHRODY_ROOT` selects a validated source checkout. No legacy Infra
checkout fallback or second release orchestrator is active here.

| Directory                                                     | Owner and purpose                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `audit/`                                                      | Documentation, asset, runtime and reverse-engineering evidence checks    |
| `audit/uemu/`                                                 | Function proofs and their shared Unicorn helper, moved together          |
| `build/`                                                      | Native and emulator WASM build/packaging adapters                        |
| `dev/`                                                        | Local setup, environment and installed command bindings                  |
| `migration/`                                                  | Measured source/workspace transfers                                      |
| `tools/`                                                      | Domain tooling and thin central operations/transport bindings            |
| `tools/data/`                                                 | Extraction, mirroring and derived local data                             |
| `validation/`, `donnees/`, `forge/`, `ghidra/`, `ops/`, `re/` | Retained domain harnesses with established internal consumers            |
| `gecko/`, `ruzu/`, `upstream/`                                | Imported integration tooling and clearly marked historical orchestration |

The root contains this index and TypeScript configuration only. The relocation
inventory is [`config/script-layout.json`](../config/script-layout.json). Rust
proof registries and shell/PowerShell consumers point at the new canonical paths;
proof filenames and private fixtures retain their original semantics.

## Shared Infra bindings

```sh
bun run doctor
bun run check:bun
bun run check:layout
bun run check:workspace
bun run check:scripts
bun run typecheck:scripts
bun run pipeline:sync
bun run infra --help
bun run sync:main --help
```

`pipeline:sync` asks Infra to derive `config/pipeline.json` from current manifests.
It does not execute its build/test/deployment steps. Missing package gates remain
reported by the generator. `sync:main` delegates to the sole Infra transport
implementation; mutations require its explicit `--apply` option.

Legacy standalone release/deploy scripts under `upstream/nie/` are historical
references. Current host operations use `bun run infra`; their old command flags
are not automatically translated into current service operations.

## Bun and validation

One root `bun.lock` and dependency catalog govern the actual members resolved from
the root workspace patterns, including NIE UI, Inagle and RG. Public package
identities are preserved. `bunfig.toml` adopts
the Infra isolated-install policy, without upgrading dependency versions.

`bun run setup` installs locked npm dependencies and runs `cargo fetch --locked`
for the crates.io dependencies. `scripts/dev/setup.ps1` delegates to the same
bootstrap. Use `--skip-install` or `--skip-cargo` to select a dependency set;
`--dry-run` previews the setup. No engine compilation is part of bootstrap.
Private databases stay isolated; game-data resolution requires `--setup-data`.
Shared doctor/Infra operations use the installed registry owner. Explicit checkout
settings retain precedence; the declared sibling is a fallback when the package is absent.
Registry mode preserves native host configuration without inventing a source checkout.

`typecheck:scripts` checks current build/operations/validation adapters.
`upstream/nie/tsconfig.gate.historical.json` preserves the former standalone NIE
ratchet as evidence. The broader retained domain scripts are not asserted to be
covered by that TypeScript gate. `typecheck:web` requires generated WASM bindings;
`bun run --cwd apps/iecode-web build` regenerates them through `build/build-emulator-web.ts`.

Python domain commands use `uv run`. Proofs require user-provided private inputs
and their existing Python dependencies; a syntax/path check does not establish
byte-exact reconstruction or game fidelity.
