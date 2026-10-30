# Standalone application builds

`infra/apps.json` inventories distribution targets and product-specific inputs.
Every application resolves through the single `os` workspace root. Library
source modules remain pinned under `libraries/` as inputs within that workspace;
their capability IDs, Rust build recipes, standalone artifacts and canonical
application hosts use the shared package and setup graph. One root lockfile and
one `build/` directory serve all application builds. An unresolved external
context prevents an independent build.

## Owners

| Capability                                               | Owner                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| Library engine builds and standalone artifacts           | `scripts/build-apps.ts`, `@aphrody/bun-artifacts`                |
| Shared Bun standalone compiler                           | `@aphrody/bun-artifacts/compiler`                                |
| App source policy, native contracts and release receipts | `infra/app-build.ts`                                             |
| Library capability names and canonical application hosts | `@aphrody/bun-workspace/capabilities`                            |
| Child process ownership, deadlines and output capture    | `@aphrody/bun-workspace/process`                                 |
| Streamed file identity                                   | `@aphrody/bun-workspace/hash`                                    |
| Cloudflare control and credentials                       | Runtime `packages/bun-cloudflare`; domain changes use MCP        |
| R2 object authentication                                 | `createR2Client` and `loadCloudflareEnvironment`                 |
| Distribution and embedded byte identity                  | `src/distribution.ts` adapter over `@aphrody/bun-workspace/hash` |
| Executable headers                                       | Package converter `abi` and GNU loader gate in `src/elf.ts`      |
| Distribution app orchestration                           | `infra/app-build.ts`                                             |
| Shared object plans                                      | `infra/assets.ts`                                                |
| Edge and public catalog                                  | The edge/catalog capability owner                                |

`@aphrody/bun-workspace` is the single implementation owner for shared
workspace, runtime, process, hashing, capability and asset APIs. Product
adapters import that owner directly.

## Configuration

A build uses the selected native runtime binary or an explicit target snapshot.
A native runtime path may use `$BUN_INSTALL/<relative-path>` so a mutable Bun
build output is not mistaken for the pinned compiler snapshot. The snapshot pins
its resolved path, SHA256, version and revision. Cross-target snapshots also
require a matching native target receipt with the `native-runtime` gate. The
compiler and snapshot revisions must agree. Runtime metadata reports its source
URL; archive authentication is a separate qualification.

The optional `build` object declares `outputRoot`, `timeoutSeconds`,
`sharedHeavyLock` and `lockKind`. Output paths are relative to the catalog.
The lock kind is `flock` on a qualified Linux host or `exclusive-file`
for the existing native Windows lease protocol. Acquisition is immediate:
an occupied lease is preserved. The workflow also uses the existing
distribution `.factory.lock`.

Each native app provides `native.artifactsByTarget[target]`:

- `path` and `sha256`: exact backend artifact.
- `sourceRevision`: its application source pin.
- `qualificationReceipt`: matching source/artifact evidence with
  `native-backend` and `native-dependency-closure` gates.
- `dependencies`: additional embedded native files, each with path and SHA256,
  an executable/library role, and any ABI or minimum glibc requirements.
- `systemLibraries`, `abi`, `minimumGlibc`: target requirements retained
  from the native owner.

Artifact paths resolve from the catalog. ABI inspection preserves architecture
and runtime distinctions. GNU ELF executables require the actual glibc loader.
The shared ABI owner currently qualifies PE and ELF; Mach-O remains a separate
owner extension.

## Build and release

```sh
bun infra/app-build.ts plan apt --config infra/apps.json --target windows-x64
bun infra/app-build.ts build apt --config infra/apps.json --target windows-x64 --out /NEW/OUTPUT
bun infra/app-build.ts release apt --config infra/apps.json --receipt /NEW/OUTPUT/receipt.json --out /RELEASE.json
```

All standalone Bun artifacts use the compiler in `@aphrody/bun-artifacts`.
Bun OS owns distribution planning, protected-input policy,
source/runtime/native/asset proofs, ABI checks, host locks, receipts and release
staging. The build plan pins the product revision and compiler source hash; the
workspace and compiler file must remain unchanged through compilation.

Compilation bundles JavaScript, rejects unresolved imports, disables build-time
environment inlining and executable dotenv/config autoloading, and embeds
explicit approved assets. The source graph and input checksums accompany the
artifact. Changed compiler, runtime or application inputs fail the build.

Native wrappers verify embedded payload hashes and materialize one cache
object per digest. Loader views use hard links, preserving dependency
filenames without copying blobs for each app. Arguments and streams pass
to the existing executable. The native owner retains responsibility for
system libraries, protected stores and application behavior.

A build receipt distinguishes binary production, ABI checks, runtime snapshot,
embedded dependencies, application execution and deployment. A release stage
contains content-addressed references. Edge/catalog publication owns routing
and release activation.

## Shared assets

```sh
bun infra/assets.ts plan --config infra/apps.json --out /ASSET-PLAN.json
bun infra/assets.ts upload --config infra/apps.json --plan /ASSET-PLAN.json --out /ASSET-RECEIPT.json
```

Only explicitly configured `assetRoots` are enumerated. Symlinks, protected
stores, credentials, provider sessions, datasets, game data and model weights
are excluded. Entry count, depth, object size and execution time are bounded.

Assets use `objects/sha256/<digest>` globally. App references contain paths,
content types and object identities; no object payload is copied under an app
prefix. The uploader checks immutable source bytes, uses conditional writes,
and verifies existing or newly written R2 content by SHA256. Public delivery
through the configured custom domain is qualified by the edge owner.

Credentials stay in the existing Cloudflare native store and environment.
Asset plans and release metadata contain no credentials or signed URLs.

Primary API references:
[Bun executables](https://bun.com/docs/bundler/executables),
[Bun S3](https://bun.com/docs/runtime/s3),
[R2 S3 operations](https://developers.cloudflare.com/r2/api/s3/api/).
The configured fork declarations and native CLI help govern available flags.

## Factory commands

`scripts/build-apps.ts` plans or builds the configured applications. Planning is
the default and starts no native build. App IDs, source pins, protocols, digests,
native build locks and artifact packaging retain their existing owners.

```sh
bun scripts/build-apps.ts plan --target bun-linux-x64
bun scripts/build-apps.ts build --app video --target bun-linux-x64 \
  --bun /qualified/bun --runtime-pin /qualified/runtime-pin.json \
  --host vps --mode ssh --shared-assets .local/assets/reference.json \
  --output build/apps --report .local/builds/linux-video.json
```

Run the factory with the pinned upstream Bun canary; pass the qualified executable with `--bun`. A runtime pin
contains `version`, `repository` and the full `revision`. `--runtime-receipt`
optionally checks its recorded target, binary digest and observed provenance.
The factory probes and hashes the actual host executable. It never downloads an
upstream runtime or changes the checkout's platform-specific runtime pin.

Each selected engine builds in release mode with its existing locked Cargo
workspace. The native build owner serializes admission on that host. The factory
then discovers the release CLI, observes its version, records its source pin and
SHA-256, and builds a standalone Bun executable through the artifact package.
Native extraction is qualified with `--doctor`; business operations retain
separate qualification. No tests run.

All 14 capabilities appear in plans. Generation reuses `artcraft_router` and its
`artcraft-cli` JSONL binary. Builds continue across application failures;
the report records each stage and exits unsuccessfully if any selected app fails.
Native hosts build their own targets; cross target engine compilation requires
separate native qualification and supplied artifact receipts.

Builds use fresh output files inside the selected checkout. Results default to
`build/apps/<target>/<app>/aphrody-<app>`, with native and app manifests beside
the binary. `--report` persists progress after every application. Aphrody Infra
owns activation and replacement of previously qualified deployed artifacts.

`--resources JSON` maps app IDs to explicit native DLLs, libraries, resources or
notices. Each input has an absolute `source`, a portable payload `path` and a
`kind` of `library`, `resource` or `notice`. The artifact owner validates and embeds
them. The factory does not scan provider stores or duplicate shared R2 assets.
Builds require one `--shared-assets` reference, applied to every selected app.

Native deadlines default to 30 minutes; Bun compilation defaults to three
minutes. Set bounded seconds with `--native-timeout` and `--compile-timeout`.
Per-app native process output retains the existing owner policies.
