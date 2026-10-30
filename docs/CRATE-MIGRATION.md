# Flat crate migration

The root owns the Cargo workspace, nightly, shared dependency versions and
outputs. Each migrated product crate lives at `crates/<package-name>` as a
pinned Git submodule, retaining its source history and license notices.

Inspect immutable manifests before choosing a migration batch:

```sh
bun scripts/crate-inventory.ts aphrody=../aphrody material=../material
```

The command reads tracked Git objects at each source revision, rather than
scanning generated directories or modifying active checkouts. Its report is
written to the ignored `.local/crate-inventory.json`. It records source pins,
package identities, dependency names, proposed destinations and collisions.
The source names and extra checkout paths are explicit arguments.

`crates` counts all tracked package manifests, including nested, vendored and
fixture packages. `declaredWorkspaceCrates` counts root manifests and explicit
root workspace members after exclusions; it is not Cargo metadata's complete
automatically included dependency closure. `remainingDeclared` identifies
unmigrated declared members. Unavailable submodules are reported explicitly.

Shared source copies and generic names such as `xtask` must be reconciled
before importing them into one Cargo namespace. A proposed path in the report
does not constitute migration or a new repository. Imported libraries retain
their existing workspace until consumers, manifests, assets, histories and
native gates have actually switched. The font, atomic and selected craft-libs
crates now implement this contract; later batches should extend this record.

## CADCraft foundations — 2026-10-14

The geometry, drawing database and constraint solver histories were split from
CADCraft revision `00c7613f1af3c73f7157fa91d9fe2635c6f23c06` without changing
the source branch. Their projected trees exactly match the original prefixes.

| Root crate             | Source prefix        | Projected history                          | Integration                                |
| ---------------------- | -------------------- | ------------------------------------------ | ------------------------------------------ |
| `cadcraft-geom`        | `crates/geom`        | `e2e29710996f30623fbccad1b07daccaf8c53d2f` | `18271b67f9745c9502c0921fd5ebd735845e9396` |
| `cadcraft-doc`         | `crates/doc`         | `639f93c82f1eeec3c1db67dfd7170ab31cb74537` | `fdc2a37b7f98482c951cf674d57cf87b0e2307fb` |
| `cadcraft-constraints` | `crates/constraints` | `269214961799c3c60ddee88c7594b8987704c076` | `85a87c74f93f9b635c0cbc70b25edbeb165e9927` |

These source repositories retain `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`
and `ATTRIBUTION.md` byte for byte. They inherit version 1.4.4, edition, MSRV
and dependencies from the root, retaining serde's `rc` and serde_json's
`float_roundtrip` features at their usage sites. The existing root color owner
is reused. No new external version enters the Cargo lockfile.

Native Windows `cargo check --locked --offline` for the three new packages
and their color dependency passes with nightly `2026-09-15`; root Rust format
and Bun quality pass. The root now has 28 members and 571 locked packages.
Offline vendor metadata verifies all 543 external sources and their manifests
and notices. Active vendor source replacement and a complete product build
remain unqualified. CADCraft's remaining consumer workspace has 12 members;
its 14 foundation edges target the root's exact version 1.4.4. Its full native
application build and tests were not run.

## CADCraft DXF reader — 2026-10-14

`cadcraft-dxf` is split from CADCraft source revision
`421652b27081ef984ebb1c86c80b4e0d34f6211a`, prefix `crates/dxf`. The split
commit is `92817364e6ee09aea7560925cbe039353182a450`; its tree exactly matches
the source prefix. The split `os` branch is at
`2fb064dc24dd17ee08850ee339a3fcb966edbadc`; it retains the source-license
import commit `0b16386136b048fde06b6bab4b9cd73bdedbdde9` and the Bun OS
workspace integration. The CADCraft consumer branch `os` is at
`d9f215e852e193fe2c4d1c8702e36abc410468c4`. `LICENSE-MIT`,
`LICENSE-APACHE`, `NOTICE` and `ATTRIBUTION.md` match the source root byte for
byte. The CADCraft consumer switches to the root owner and removes the five
old tracked files. `encoding_rs` uses the source-compatible root pin `0.8.35`.
Locked offline metadata resolves all 479 CADCraft packages with exactly one
`cadcraft-dxf` owner.
Root locked offline metadata resolves 566 packages, `cargo check --locked
--offline -p cadcraft-dxf` passes, and root `cargo fmt --all -- --check` passes
after formatting the imported files. Tests were not run.

## CADCraft DWG bridge — 2026-10-14

`cadcraft-dwg` is split from CADCraft source revision
`d9f215e852e193fe2c4d1c8702e36abc410468c4`, prefix `crates/dwg`. The split
commit is `4bd80fdfcded4cc1d063607515053e53f789e731`; its tree matches the
source prefix. The split `os` branch is at
`8c7012f1b2d3d54d6907b32296e2bab43ee99520`, preserving the source licenses,
NOTICE and attribution. The CADCraft consumer branch `os` is at
`88e15b5b11e3b844b6dfff97a0210daa3ae73051`; it redirects the dependency and
removes the two old tracked DWG files. `acadrust` remains an unmodified,
separate MPL-2.0 dependency pinned to the source's exact `0.6.3` version.
Locked offline metadata resolves 479 CADCraft packages. Root locked offline
metadata resolves 572 packages, `cargo check --locked --offline -p cadcraft-dwg`
passes, and the complete root Rust format check passes. Tests were not run.

## CADCraft font layout — 2026-10-14

`cadcraft-fonts` is split from CADCraft source revision
`88e15b5b11e3b844b6dfff97a0210daa3ae73051`, prefix `crates/fonts`. The split
commit is `ddb2e5b0db66a8fc6e5be24331a905b7f758d233`; its tree matches the
source prefix. The split `os` branch is at
`ae107d5ba70f0b2ac10dadbdb7d5ba1a18acb4c1`, retaining the source license
import at `680006dcda26f88fb84cd6ec15250c5176801ddf` and workspace integration
at `c00471e3872302529d57f698de386044ce10da5f`. CADCraft consumer branch `os` is at
`533857d44f193c709fe66a650605e53d5d0f8ed0`; it redirects the dependency and
retires the original 12 tracked files. The crate uses root `skrifa 0.48.0`
with the source default `std` and `autohint_shaping` features, plus exact
`harfrust 0.12.0` and `unicode-bidi 0.3.18` pins. Its optional font input stays
external; with no `CRAFT_FONTS_DIR`, the build emits an empty font catalog.
Locked offline metadata resolves 479 CADCraft packages. Root metadata resolves
574 packages, `cargo check --locked --offline -p cadcraft-fonts` passes, and
the root Rust format check passes. Tests were not run.

## CADCraft renderer — 2026-10-14

`cadcraft-render` is split from CADCraft revision
`533857d44f193c709fe66a650605e53d5d0f8ed0`, prefix `crates/render`, at
`21f71a0d7fbff82a6f6dae1885f09037b6a93433`; the split tree matches the source
prefix. Its split `os` branch is `3bc0d98ea0ff384d8ab46f76ed7da2dc6cef39d7`, with exact MIT, Apache,
NOTICE and attribution files. CADCraft consumer branch `os` redirects the
dependency and removes the original 37 tracked files. Root locked offline
metadata resolves 579 packages and `cargo check --locked --offline
-p cadcraft-render` passes.

## CADCraft IO — 2026-10-14

`cadcraft-io` is split from CADCraft revision
`79eba098b8754170835ff3538203cf8294e2e1ac`, prefix `crates/io`, at
`e31d3f3aced049dd4c5a7a59f34e2b8714376ea8`; its tree matches the source
prefix. The split `os` branch is `7d9497ecc8775b4c597ec2fe8ffa1b7fee9e1c9b`, with exact MIT, Apache,
NOTICE and attribution files. CADCraft consumer branch `os` at
`9b4966200834de9810e76f134596712eb3b70a72` redirects to the root owner and removes the original 65 tracked
files. The IO owner uses the root `miniz_oxide` 0.9.1 and `quick-xml` 0.41.0
pins. Locked offline metadata resolves 479 CADCraft packages; root metadata
resolves 580, the IO crate check and complete root Rust format check pass.
Tests were not run.

## CADCraft CLI — 2026-10-14

`cadcraft-cli` is split from CADCraft revision
`7966d9d6758f805985092ec8f68c53bbe35b727d`, prefix `apps/cadcraft-cli`, with
history-preserving split `97e1f5ccfd1e558c6a8a2a2d602580c94ff5a8b4` and tree
`e7949e5f317ad078ad2199649c763932b80e57bb`. Its split `os` branch is
`559b99d8c2d6012d8f62b68b15d5fbdca9cee7b0`; CADCraft consumer branch `os` is
`837073bb37aacc8c6b143c7e5886961b7335998f`. The consumer removes the original
five tracked CLI files, updates its lockfile, and routes the parity command to
the root CLI manifest. The binary inherits root
version, edition, MSRV, shared crate dependencies and lint policy; source tests
remain with its history.

Locked offline CADCraft metadata resolves 468 packages and three members. Root
metadata resolves 594 packages. The CLI crate check and complete root Rust
format check pass; tests were not run.

## CADCraft engine — 2026-10-14

`cadcraft-engine` is split from CADCraft revision
`9b4966200834de9810e76f134596712eb3b70a72`, prefix `crates/engine`, at
`c757465de70d1ff6fe17ead04e07340ea97efa59`; the split tree matches its source
prefix. Its split `os` branch is
`f90b4f5b0a237a2614fa0ca1969c7e7d8684fcb9`, with exact MIT, Apache, NOTICE and
attribution files. CADCraft consumer branch `os` at
`e9842fac1cf85e8205d036de9f1eb8c873e06786` redirects the engine dependency
and removes the original 244 tracked files. The root owns exact `rstar`
0.12.2 with default features disabled. Locked offline CADCraft metadata
resolves 479 packages; root metadata resolves 584, the engine check and
complete root Rust format check pass. Tests were not run.

## CADCraft MCP server — 2026-10-14

`cadcraft-mcp` is split from CADCraft revision
`e9842fac1cf85e8205d036de9f1eb8c873e06786`, prefix `crates/mcp`, at
`315641f5c83a0bec16fb5c383ed3a75e44abf6fb`; the split tree matches its source
prefix. Its split `os` branch is
`f270867625e262cab5872bed061e0e007dbb113b`, with exact MIT, Apache, NOTICE and
attribution files. CADCraft consumer branch `os` at
`1451a5592bb581fddeb332091cd2136e8a32515a` redirects to the root owner and
removes the original 8 tracked files. An unused direct `cadcraft-io` edge was
removed. Locked offline CADCraft metadata resolves 479 packages; root metadata
resolves 585, the MCP crate check and complete root Rust format check pass.

## CADCraft egui UI — 2026-10-14

`cadcraft-ui-egui` is split from CADCraft revision
`1451a5592bb581fddeb332091cd2136e8a32515a`, prefix `crates/ui-egui`, with
history-preserving split `a1f85460e2dea27021c90d7f129c4d4c048a76ce`. Its tree
matches the pinned source prefix. The split owner is at
`e069e194f6a0adce7e5fcdd968ef0cf8f5973656`; CADCraft `os` redirects the
consumer at `7966d9d6758f805985092ec8f68c53bbe35b727d`. The consumer workspace
removes the old nested crate and narrows its member glob to apps and `xtask`.
The build script reads contributor data from the pinned CADCraft source
submodule, avoiding a second copy.

Locked offline CADCraft metadata resolves 470 packages and four declared
members. Root metadata resolves 593 packages; the UI crate check and complete
root Rust format check pass. The check reports a recursion-depth warning in
`gpu.rs`; tests and full application builds were not run.
The subsequent complete root build with all features succeeds for all 28
members and supplies 28 hashed final artifacts. The revalidated vendor receipt
now reports `compiled: true` and `buildProof: valid`; this remains scoped to
the current root Rust workspace (see [native qualification](NATIVE-QUALIFICATION.md)).

## craft-libs batch

The five crates below are independent Git submodules and members of the single root Cargo
workspace. Their source history is split from `aphrody-labs/craft-libs` at
`e9546e191dd62f2bc1d61eca45dbdc2f1b3c1d8e`; each split commit's tree matches its source crate
directory. No nested Cargo workspace or lockfile is carried into a crate repository.

| Crate            | Source prefix     | Flat history SHA                           | Internal workspace edge |
| ---------------- | ----------------- | ------------------------------------------ | ----------------------- |
| `craft-settings` | `crates/settings` | `e5398ed4c44cd1169b3e737dfb9e89f3d50b2228` | `craft-atomic`          |
| `craft-cms`      | `crates/cms`      | `b7c8aa0852fcf1b63cbfcc7e1c3d29728a322397` | —                       |
| `craft-print`    | `crates/print`    | `af397671180b55681be312c549355562c2f6d931` | —                       |
| `craft-quit`     | `crates/quit`     | `deee19612f25d2627cc97b07a59760a9c26974bb` | —                       |
| `craft-ui`       | `crates/ui`       | `49c2c2265a72ea81525907d01310e73187e0a4d0` | —                       |

`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` and `ATTRIBUTION.md` are copied from the source
repository root into each crate repository. `craft-settings` also carries the settings policy
document; `craft-ui` carries its UI audit, docking, theme and visual-regression documents. ICC
profiles and the FOGRA39 test data remain with `craft-cms`.

The crate package version, edition and Rust version inherit from this root workspace. Each
manifest retains its upstream dual-license expression and source repository metadata. Dependency
versions are pinned once in `[workspace.dependencies]`, with package-specific feature additions
kept at each use site. `winprint` remains on the reviewed immutable Git revision because the
maintained fork preserves terminal error/cancellation reporting and bounds completion waits.

The source's `craftrules` URL could not be retrieved during migration, so no unavailable rules were
recreated. The available source `AGENTS.md` and `CLAUDE.md` lint policy is retained in the crate
manifests. Native Windows Clippy and test gates remain pending the root Cargo build window; metadata
and formatting qualification do not substitute for those gates.

## Dependency updates

Registry versions were checked against the crates.io API and Cargo registry on 2026-10-13. This
batch uses `dirs 7.0.0`, `toml_edit 0.25.17`, `tempfile 3.27.0`, `rayon 1.12.0`, `moxcms 0.9.1`,
`roxmltree 0.21.1`, `miniz_oxide 0.9.1`, `egui`/`egui_extras`/`egui_kittest 0.36.2`,
`serde_json 1.0.154`, `objc2 0.6.5`, `objc2-app-kit 0.3.2`, `dispatch2 0.3.1`, `muda 0.21.2`,
and `winsafe 0.0.29`. Shared `serde 1.0.229` and `image 0.25.10` retain the root versions.

`roxmltree 0.21` changed `Node::attribute` to match local names, and added external-entity
resolution. `craft-print` only queries unqualified PrintTicket names, so no call-site adaptation is
needed. `miniz_oxide 0.9.1` is used as the latest stable release. Upstream issue
[#200](https://github.com/Frommi/miniz_oxide/issues/200) documents a conservative slow-copy choice
in a secondary decompression path; the fast bulk path is described as unaffected. This workload
has not yet been benchmarked on Windows, so its performance impact remains unmeasured.

The root lockfile still contains older _transitive_ releases constrained by other upstream crates:
`image 0.25.10` uses `moxcms 0.8.1`, `png 0.17.16`/`0.18.1` use `miniz_oxide 0.8.9`,
`usvg 0.45.1` uses `roxmltree 0.20.0`, and older `objc2` ecosystem crates use `objc2 0.5.3`.
The five migrated crates declare the workspace versions above directly; this batch does not patch
those upstream semver ranges or claim that every transitive dependency in the full product lockfile
is on the same release.

## Independent Craft library batch

Four self-contained product crates were split from their immutable source pins into dedicated private repositories. The split commit tree was checked against the source crate-prefix tree. Root Cargo membership and shared dependency declarations are centralized separately; this batch does not edit root manifests or locks.

| Crate                | Source pin and prefix                                                   | Split commit                               | Root dependency |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------ | --------------- |
| `deckcraft-matroska` | DeckCraft `1660982e58ee48fd9f9bef6dc2620d78ada04613`, `crates/matroska` | `4fafa1e454df18f72baaf1f01fc0a00afc363a50` | none            |
| `pdfcraft-compare`   | PdfCraft `7437bde378f43856eada40af25b983812e615e8a`, `crates/compare`   | `1e3fd4405fd3268b511ce738d1a55497fb3d399e` | none            |
| `cadcraft-color`     | CADCraft `00c7613f1af3c73f7157fa91d9fe2635c6f23c06`, `crates/color`     | `28bf2b1c25926aca9f63abeeccc4e1b70e22a445` | root `serde`    |
| `gridcraft-pdf`      | GridCraft `84acf6293b1dc1fc09837524e035d674eb4d6741`, `crates/pdf`      | `379d3266749b03ffd031b208d337612cfcc4504f` | none            |

Each flat manifest points to the root workspace, inherits version 1.4.4, edition and Rust version, and declares the upstream `MIT OR Apache-2.0` expression locally because the distribution root is MIT. Package lint tables preserve the source workspace's effective Rust and Clippy rules; extra DeckCraft/CADCraft/GridCraft allowances are not added to the global workspace. Repository metadata points to each new canonical source. `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` and `ATTRIBUTION.md` are copied byte-for-byte from the corresponding source pin. The Adobe AFM metrics permission and attribution comment remains intact in `gridcraft-pdf/src/metrics.rs`.

Root integration now includes all four crates in the twelve-member Cargo
workspace. Each crate has a shared path dependency declaration; only
`cadcraft-color` needs the existing root serde version. Locked metadata and
root formatting pass on native Windows. The full offline feature graph resolves
526 package identities against the unchanged 514-package vendor source snapshot.
Compilation, Clippy and tests remain pending the release owner's native window.

| Crate                | Pinned `os` revision after root formatting |
| -------------------- | ------------------------------------------------ |
| `deckcraft-matroska` | `0b81b6f11085ad571f6705bfbb940b48e1a2eeae`       |
| `pdfcraft-compare`   | `28ab78b38b9062f5cd47d6289a19b1262eb0ed74`       |
| `cadcraft-color`     | `c3734c8787556b2bac99de433af9ffab84555cdd`       |
| `gridcraft-pdf`      | `dd5f4656384ee36ebaf37a073f4d2e875d8b9c6f`       |

Formatting commits preserve each original split history. The license/notice
files and Adobe permission comment remain byte-identical to their source pins.

## Aphrody protocol and AI primitive batch

Eight crates were extracted from Aphrody source commit
`3187d795e84ff88da67f53f12be1add715ad73b2` using history-preserving subtree
splits. Each split tree was checked against the corresponding source prefix.
The child manifests inherit version, edition and Rust version from the Bun OS
workspace, keep the source `Apache-2.0` license locally, point repository
metadata at the split source, and reproduce the effective source Rust
and Clippy lints locally because the distribution root does not define those
workspace lint tables. Each child contains a byte-identical copy of the
Apache license from the pinned Aphrody tree.

| Crate                     | Source prefix                   | Split commit                               | Root dependency                                                                      |
| ------------------------- | ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `aphrody-a2a`             | `crates/contracts/a2a`          | `647214015bb8ea6dbb9ecb7656f09f42cb51c3fc` | base64, chrono, serde, serde_json, thiserror, uuid                                   |
| `aphrody-agent-proto`     | `crates/contracts/agent-proto`  | `bf96dfe4371a6f9fceddb566937f4c75a5881470` | serde, serde_json, thiserror, uuid, pretty_assertions (dev)                          |
| `aphrody-app-protocol`    | `crates/contracts/app-protocol` | `85d54a052d80137218f3c78b38957ce51b7632b1` | serde, serde_json, pretty_assertions (dev)                                           |
| `aphrody-toolcall`        | `crates/ai/toolcall`            | `a60aaa3982cddf1be485e6988092a7606157f03c` | serde, serde_json, async-trait, thiserror, pretty_assertions (dev)                   |
| `aphrody-patch`           | `crates/ai/patch`               | `89ad5615a6d23d3185bb533d0f63a83289179852` | similar, thiserror, pretty_assertions/tempfile (dev)                                 |
| `aphrody-toolcall-repair` | `crates/ai/toolcall-repair`     | `acc8ba251cd3819d3374026562587e6569d2c777` | serde, serde_json, thiserror, regex, proptest/pretty_assertions (dev), aphrody-patch |
| `aphrody-translate-core`  | `crates/ai/translate-core`      | `fc600936dc3d9edac57d4e0ebf7072678d429d64` | regex                                                                                |
| `aphrody-http-error`      | `crates/ai/http-error`          | `547866967471097fde3cfb3ae157cfa9d4320502` | axum, serde, serde_json, tokio (dev)                                                 |

The source `schemars` dependency was omitted from `aphrody-toolcall`: an
exhaustive search of the pinned crate found no code, feature, API, or document
usage of it; the only remaining mention is explanatory prose. The shared
dependency declaration for `aphrody-patch` is required by
`aphrody-toolcall-repair`. Features are enabled at the use site where the
root's shared dependency disables defaults, preserving source defaults and
the source's wasm UUID/chrono behavior. The app-protocol fixtures retain their
upstream Codex provenance and `FIXTURES_REV`; toolcall-repair keeps its paired
input/expected-output fixtures unchanged. This records source extraction and
manifest intent only; it does not claim native compile, Clippy, or test gates.

The integrated 20-member root passes locked offline metadata with all features
(559 identities: 20 product crates and 539 remote source packages), root Rust
formatting, TypeScript checking of 111 files, lint and formatting. Child
refs match the formatted local heads; Apache notices and fixture trees remain
unchanged. Native compilation, Clippy and tests for this batch remain pending.

## Aphrody runtime primitives

The next four packages were split from the immutable Aphrody source pin
`3187d795e84ff88da67f53f12be1add715ad73b2`; each extracted tree matches its
source prefix. Child manifests inherit the product version, edition and Rust
version from this workspace, retain the source Apache-2.0 license, and keep
the source-effective local lint policy.

| Crate               | Source prefix              | Split commit                               | Dependencies                                                                                                                |
| ------------------- | -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `aphrody-guard`     | `crates/os/ostd/guard`     | `d074a4b411efdd3e05de20f59373e7a8bf5a481a` | libc, pretty_assertions (dev)                                                                                               |
| `aphrody-subsystem` | `crates/os/ostd/subsystem` | `01db6a17875a3aa58ec4d8b3a2d44ae645a71074` | async-trait, serde, serde_json, thiserror, tokio                                                                            |
| `aphrody-proc`      | `crates/os/ostd/proc`      | `edcb752128ef1bbcca7b0829417bc4a79f94ba2a` | serde, serde_json, thiserror, tracing, tokio (optional), rustix (Unix), windows (Windows), pretty_assertions/tempfile (dev) |
| `aphrody-config`    | `crates/ai/config`         | `fda495b079928c1d8249011eb76708cb9c9e5b88` | serde, serde_json, thiserror, toml, pretty_assertions/tempfile (dev)                                                        |

`aphrody-config` embeds a synthetic contract fixture containing only the 19
public canonical environment-variable names. It does not copy runtime values
or the source checkout's external local configuration file. Root formatting
and locked offline metadata with all features pass for 24 members and 564
package identities. Locked offline Cargo check with all features passes for
all 24 members. Full build, Clippy and new-crate tests remain pending; see
[native qualification](NATIVE-QUALIFICATION.md).

The updated font pilot also inherits the root MSRV; fonts tests inherit
`craft-fonts` and exact `skrifa =0.48.0` from the workspace, preserving
skrifa defaults and the resolved source version. All direct dependencies of
the 24 members use workspace inheritance. Imported Apache license bytes
match Git blob `d9a10c0d8e868ebf8da0b3dc95bb0be634c34bfe` and SHA-256
`a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9`.

## Bun Jev owner

`aphrody-jev` is integrated from the immutable Bun checkout pin
`ac6832f65bf9921d33aa0d31cc72b3fa714ed20a`, prefix `crates/aphrody-jev`.
The prefix has one source-history commit; its split root tree is
`3da6e84c6227e1bafdb122efd57ab9d563fb6f91`, with split commit
`ffeaa77f36197f081603ec93a9a1ad4631dcc35d`. The extracted tree preserves all
21 tracked files, including `LICENSE-APACHE`, `LICENSE-BUN-MIT.md` and `NOTICE`.
The child integration commit changes only its manifest to inherit the root
workspace version, edition and MSRV while preserving the dual license.

The workspace pins `futures` to `=0.3.34`, matching the immutable Bun owner's
workspace version; this records reuse of that pin and does not assert that it
is the latest registry release. Serde, serde_json, reqwest, rustls, Tokio,
tracing, URL, Axum and thiserror inherit the root dependencies. HTTPS uses the
Bun owner's reqwest `rustls-no-provider` path with rustls ring; `client` and
`server` remain optional crate features. The workspace dependency disables
features by default so consumers enable `client` only where needed.

The response contract preserves `usage: null` when token accounting is
unavailable; an explicit zero remains a reported measurement. Existing
Aphrody `agent-tools` and MCP adapters remain protected consumer paths and are
not duplicated in this root batch. The `os` pin is
`be4a36bd503c79d98619ad39c8b2d0fbc36632eb`. Cargo formatting and complete
locked metadata with all features pass: 25 root members and 568 identities,
including 543 remote sources. No pre-existing locked version changed.

Native Windows `cargo check --locked --offline -p aphrody-jev --all-features`
passes through the serialized owner (25.80 seconds after cache preparation).
The protocol test build ended before a test result was produced; tests and
the full root build remain unqualified. The updated vendor verifies 543 remote
sources, 671768402 bytes and 28572 checksum-listed files. Active Cargo source
replacement remains disabled.

## Nested workspace and lockfile exceptions

Nested `[workspace]` manifests and `Cargo.lock` files are classified in
[`cargo-exceptions.json`](cargo-exceptions.json) (see
[`cargo-exceptions.md`](cargo-exceptions.md)); `bun src/cli.ts workspace check`
enforces it. Entries classed `migrate` are the remaining migration batches.

## Consolidation state — 2026-10-22

Measured on `origin/os` at `15d3c89088` (`bun src/cli.ts workspace check`, `cargo metadata
--no-deps --locked` on the VPS); the totals and open decisions are collected in
[MONOREPO](MONOREPO.md). The recent root commits changed these facts:

- **Flat Bevy tools.** `tools/bevy/build-easefunction-graphs`, `build-templated-pages`,
  `build-wasm-example`, `compile_fail_utils`, `example-showcase` and `export-content` now live at
  `crates/<name>` (`c93236a800`), as root members with updated path references and in the component
  inventory. The six `tools/bevy/*` entries left the inventory. `tools/bevy/ci` stays the only member
  outside `apps/`, `packages/` and `crates/`.
- **Nested members.** Twelve members are still nested below a crate directory: the three
  `compile_fail` suites of `bevy_derive`, `bevy_ecs` and `bevy_reflect`, and nine under `crates/bevy/`
  (`benches`, `errors`, `examples/mobile`, `examples/no_std/library`,
  `examples/reflection/auto_register_static` and four `examples/large_scenes/*`). No rule in the owner
  documents names their flat form; see the open decisions in [MONOREPO](MONOREPO.md#open-decisions).
- **Excluded standalone workspaces.** Fuzz, fixture, example-plugin and bevy test/mobile workspaces
  were added to the root `exclude` list (`9250e43294`), so the root now excludes 36 paths. They keep
  their own lock where the [exceptions ledger](cargo-exceptions.md) lists one.
- **Invariants are checked.** `workspace check` fails on a nested Bun lockfile, an unlisted nested
  `[workspace]` or `Cargo.lock`, and a stale ledger entry; the inventory is persisted at
  `docs/generated/component-inventory.json` (`867501bc0e`).
- **Cargo members contract.** `bun scripts/cargo.ts metadata` runs Cargo under the members contract
  (`60d0480174`) and prints the workspace report (package names, target directory), not Cargo's JSON.
- **`crates/sqlite_tasks`** stays excluded: it uses SQLx 0.7, whose `libsqlite3-sys 0.27` clashes with the
  `links = "sqlite3"` of the root's `libsqlite3-sys 0.38`. Decision pending (rusqlite rewrite onto
  `aphrody-sql`, or a shared SQLx).
- **Pending `migrate` entries.** `apps/desktop/src-tauri`, `apps/figcraft/plugins`,
  `apps/m3-published-consumer` and `packages/bun-tauri` still own nested workspaces and locks.

The earlier batch sections above stay the record of each split; "batches 1 to 5" are not numbered in this
repository, so the facts above are listed by commit instead.
