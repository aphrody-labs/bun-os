> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared native JavaScript and TypeScript tooling

Yolo owns the shared N2B migration engine, Oxc integration and toolchain discovery
previously maintained in Aphrody. Aphrody consumes these sources and the light
runtime SDK; its applications, UI and product orchestration retain their owners.
This is a source and native API consolidation. It does not establish a rebuilt
Bun builtin, a complete VS Code migration or measured memory/startup gains.

The dated migration receipt records source
revisions, file hashes and the scope of qualification. The runtime architecture
remains governed by [GOAL](../../GOAL.md), [PLAN](../../PLAN.md) and
[the ABI contract](../../architecture/runtime-native/RUNTIME-ABI.md).

## Canonical owners

| Surface | Yolo owner | Preserved contract |
| --- | --- | --- |
| Report types and JSON schema | aphrody-n2b-types | Schema version 2, original `$id`, Rust types and `REPORT_SCHEMA_V2` |
| Migration rules | aphrody-n2b-registry | Existing rule identities and rule registry |
| Recursive scan, fixes and reports | aphrody-n2b-core | Existing Rust API plus bounded jobs and mapped results |
| Migration C ABI | aphrody-n2b-native | `node2bun_*`, ABI 2, library-owned strings |
| Compatibility CLI | aphrody-n2b | Existing `n2b` binary and native in-process engine |
| Runtime discovery and pins | aphrody-toolchains | Bun/uv/Nushell discovery and launch environment; discovery is not engine embedding |
| Native parser, formatter, linter and minifier | aphrody-oxc-bridge | `aphrody_oxc_*`, ABI 1, official Oxc APIs |
| Grouped optional provider | [aphrody-ffi](../../../../crates/aphrody-ffi) feature `tooling` | Reexports the two C ABIs from `libaphrody_ffi`; group ABI 1 (`yolo_tooling_abi_version`); no second engine implementation |
| Repository mapper, watcher and polyglot inspection | [yolo-core in the pinned Bun SDK](https://github.com/aphrody-labs/bun/tree/6181424bc2fca4349560832161c07ba85c33e8ef/packages/bun-runtime-sdk/crates/yolo-core) with `repository-tools` | `mapper` and `polyglot`; Aphrody's `aphrody_yolo` library reexports them |

The seven transferred crates preserve their package, library and binary identities.
The `tooling` feature of `aphrody-ffi` (formerly the `yolo-tooling` cdylib) is the grouped artifact owner. The default Cargo members remain
`yolo-core` and `yolo-runtime`; repository tools and the native tooling artifact
are explicit build selections. This keeps the source implementation in the runtime
repository while avoiding unconditional parser/formatter initialization.

The N2B Bun package moved to the Bun fork and is consumed from npm:

| Package | Source | Behavior |
| --- | --- | --- |
| `@aphrody/bun-plugin-n2b` | [Bun fork](https://github.com/aphrody-labs/bun), package bun-n2b | In-process scan, codemods, Bun plugin and the `n2b` CLI (replaces `@aphrody/n2b-core`); check the fork revision before using this dated inventory |

## Native calls and ownership

[The light SDK](../../../../packages/runtime-sdk/src/tooling.ts) owns `NativeTooling` and the
shared convenience functions. `@aphrody/yolo-core/compiler` reexports that owner
and adds the official ESTree JSON types. Importing the SDK does not load a library;
the first operation or explicit probe loads and verifies the selected artifact.
Selection honors the constructor path, `YOLO_TOOLING_LIB`, a unique embedded Bun
asset, then installed SDK discovery. A missing explicit selection fails without
silently choosing another artifact.

N2B, Oxc parsing, formatting, linting and minification execute inside the process
through `bun:ffi`. They do not spawn Oxc executables or load a second N-API parser.
The SDK releases returned strings through their original allocator before decoding
the JSON result, including decoding failures. Close is terminal and idempotent.
Calls are synchronous in the calling JavaScript isolate. The C ABI artifact must
use an unwind profile to preserve its panic-to-error boundaries.

Aphrody's `@aphrody/bun/oxc` and `/n2b` compatibility wrappers route to this SDK
as consumer migration completes. Historical Rust C ABI reexports can still remain
for binary compatibility; loading another artifact containing those engines would
create a separate native copy. The SDK consolidation does not remove unrelated
Oxc consumers such as product compiler or RAG code by assertion.

The upstream Oxc revision is
`8c5a04ea0d5ca56e0d2d925f51f6b45669aa5e2a`: parser/AST/minifier 0.152.0,
formatter 0.71.0 and linter 1.86.0. The bridge's earlier import revision
`31d5266e150ff17af52f0c2fc798cc27dc9a5a59` is provenance, not the current dependency
pin. N2B, the bridge and repository JS/TS inspection use that same workspace pin.
Bun's own parser, JSC/WebKit, bundler and test runner retain their native owners.

The native APIs supply Oxc's formatter and linter implementations to the runtime
core. They currently accept source text and a filename, with default options.
The global `oxlint`, `oxfmt` and `tsc` commands remain the repository quality-gate
owners for their broader CLI behavior; no `npx` or `bunx` execution is needed.

## Shared scan budget and safe migration boundaries

[The std-only resource owner in the pinned Bun SDK](https://github.com/aphrody-labs/bun/blob/6181424bc2fca4349560832161c07ba85c33e8ef/packages/bun-runtime-sdk/crates/yolo-core/src/resources.rs) supplies one
exclusive scan lease and a worker budget of 1 through 6. N2B and repository mapping
use the same owner; defaults cap available parallelism at six. The lease creates
no worker pool. It serializes scans sharing one linked native library, including
calls from Bun workers. Other processes and separately loaded copies have separate
owners; this is not a cross-process reservation or an Oxc allocator pool.

N2B prunes ignored directories before descending, bounds the pending result queue
to twice the worker count and drains it concurrently. File results are sorted by
path. Traversal/read/write failures propagate instead of becoming successful empty
reports. The native JSON path enriches each result while its source is available,
then drops the before/after texts before collecting results. The final report still
accumulates findings and is serialized as one JSON response; no constant-memory or
zero-copy JavaScript result is claimed. Historical `files_scanned` counts emitted
file results with findings, not every visited file.

Oxc spans mask comments, strings, template text, regex literals and JSX text from
source API replacements. Spawn matching uses actual Node bindings, including named
ESM aliases and namespace imports, and excludes `Bun.spawn` and shadowed bindings.
Ambiguous cases stay conservative; destructured CommonJS aliases are not claimed
as fully supported. This does not turn every historical rule into an AST rewrite.

Rule overrides are evaluated before writing. When a rule in a file disables edits,
the entire file's proposed rewrite is withheld because historical scanners return
whole-file text without independent edit plans. Other findings remain visible.
Fixes are not a repository transaction: an error in a later file can follow earlier
writes. Check mode and `--dry-run` provide the review path before applying changes.
Choose product roots and explicit ignores for engine/vendor trees; upstream engine
source is not a blanket Node-to-Bun migration target.

The repository watcher reuses an existing Tokio runtime through its async API,
keeps one pending rescan, ignores access-only events and joins an active audit on
graceful shutdown. Its synchronous compatibility entry creates one current-thread
runtime only when no runtime is active. Callers should resolve shutdown and await
completion; dropping the future is not a graceful shutdown contract. Non-JS
polyglot extraction remains heuristic, and the historical mapper still tolerates
some individual file errors; it is not a substitute for N2B's strict traversal.

## Aphrody needs and remaining boundaries

| Need | Shared implementation | Remaining scope |
| --- | --- | --- |
| Recursive Node-to-Bun migration | Native N2B scan/fix, SDK, `yolo n2b`, preserved `n2b` CLI | Apply and validate per product; whole VS Code compatibility is unqualified |
| JS/TS module metadata and AST | Native Oxc module record and official ESTree serializer | UTF-16 spans; BigInt/RegExp runtime values are JSON null with metadata retained |
| Formatting | Native Oxc formatter, default source options | Project config discovery, ignore rules, CLI options and non-JS formatters are not exposed by this ABI |
| Linting | Native Oxc default source rule set and semantic analysis | No project traversal/config/third-party plugin API or type-aware project service exposed; no complete oxlint CLI parity claim |
| Minification | Native Oxc minifier and code generator | Default options; no project bundling contract |
| Transpile, bundle, test and dependencies | Existing Bun APIs and owner workflows | Oxc does not replace `Bun.build`, `Bun.Transpiler`, Bun tests or package management |
| TypeScript type checking | Native `bun check` owner | No external compiler backend; parser success does not prove TypeScript type correctness |
| Repository inventory and watch | Feature-gated mapper/polyglot capability | Bun OS owns the unified CLI, Git orchestration and product policy; capability boundaries are not separate products |
| UI, media and product integration | Canonical Bun OS crates/packages | Shared implementation owners do not imply completed source migration or runtime qualification |
| Python, desktop, browser and compiler engines | Existing uv/PyO3, Tauri, Obscura and Bun/Next owners | This lot does not deliver their future builtin absorption or shared WebView/allocator integration |

The canonical report schema is
[crates/contracts/schema/v2.json](../../schema/v2.json).
Its generated TypeScript surface is
[packages/runtime/src/tooling-schema.ts](../../../../packages/runtime-sdk/src/tooling-schema.ts);
the compatibility package aliases it. The Yolo schema generator owns both that
output and the Rust schema output; the Aphrody command remains a compatibility
route while consumers migrate. Regeneration must preserve the original version-2
contract, not create another handwritten report definition.

## Provenance, qualification and delivery

N2B, toolchain discovery, repository modules and the four Bun packages retain
Apache-2.0 notices. The Oxc bridge retains its MIT license and upstream notices.
Yolo core and the SDK declare `MIT AND Apache-2.0` for their mixed source; this
does not relicense imported files. Migration does not authorize publication.

Use the serialized Cargo owner via `just qualify-tooling`; `just tooling-build`
builds the grouped artifact with the `runtime` unwind profile. Factory routing and
resource guards remain authoritative, as documented in [TOOLING](TOOLING.md).
Native source tests, real provider tests, transport fixtures, release packaging,
installation and factory execution are separate proofs. The receipt identifies
which source/artifact each recorded gate covered and leaves final gates explicit.

Linux development-provider execution has been exercised. A new provider must be
rebuilt after the shared-lease changes before final artifact qualification. No
factory Bun build, desktop first-window benchmark, cross-platform release, PSS/RSS
comparison or completed VS Code migration is established by this lot. Old Aphrody
engine files are removed only after the integrator qualifies the replacement and
pins its consumers; they are not intended as a permanent fallback implementation.
