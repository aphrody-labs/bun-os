# Registry decoder coverage

These decoders perform no network, filesystem, process or trust operation.
`RegistryIndex.records` preserves complete version records and `metadata`
preserves the original document. Projected `PackageVersion` edges are not a
complete installer plan; consumers must interpret source-specific raw fields.

| Source | Implemented | Remaining |
| --- | --- | --- |
| npm | Full/abbreviated packument, normal/optional edges with optional override, dist URL/integrity, retained peer/platform/engine metadata; native node-semver compare/ranges | Peer placement, package aliases/git/workspace dependencies and dist-tag resolution belong to resolver |
| Cargo | Sparse JSON lines, checksum, yanked, renamed dependency identity, optional/target, retained kinds/features/default-features/registry | Feature unification and cfg evaluation belong to resolver; Cargo native range adapter not supplied here |
| NuGet | Flat-container versions, four-part comparison, case-insensitive prerelease labels, exact/minimum/interval constraints | Nuspec dependency/framework metadata, content URLs/hash fetch, floating ranges (explicit error) |
| vcpkg | Version tables preserving scheme, port revision, git-tree; default baseline | Port manifest dependencies/features/platform expressions and scheme-aware comparison; no semver fallback |
| PyPI | PEP 691 simple JSON preserving each file, hashes, relative URL, requires-python, yanked reason, core-metadata | PEP 503 HTML, filename-to-distribution/release mapping, PEP 508 dependencies, resolver prerelease/environment policy |
| Python versions | Native PEP 440 comparison and specifier membership | Specifier membership alone does not decide contextual prerelease eligibility |

No absent hash is reported as verified. No dependency metadata is invented from
a flat-container or version table. Unsupported comparison returns an error.

## Maintained semantic engines and primary specifications

- `node-semver` 2.2.0, Apache-2.0, source
  <https://github.com/felipesere/node-semver-rs>; API `Version::parse`,
  `Range::parse`, `Range::satisfies`, checked against upstream source.
- `pep440_rs` 0.7.3, Apache-2.0 OR BSD-2-Clause, source
  <https://github.com/astral-sh/uv>; `Version` and `VersionSpecifiers` parsing,
  ordering and `contains`; no source code copied from this dependency.
- Cargo sparse format: <https://doc.rust-lang.org/cargo/reference/registry-index.html>.
- NuGet flat container: <https://learn.microsoft.com/nuget/api/package-base-address-resource>.
- vcpkg version tables: <https://learn.microsoft.com/vcpkg/users/versioning>.
- PyPI simple JSON: <https://packaging.python.org/en/latest/specifications/simple-repository-api/>.

NuGet version comparison/parsing was adapted from the Apache-2.0 fork
`NuGet/NuGet.Client@37a0aead4f19d3069d6a1dff94bc8cfe15b87004`, files
`src/NuGet.Core/NuGet.Versioning/{VersionComparer,NuGetVersionFactory}.cs`.
Original .NET Foundation copyright is preserved in `nuget.rs`; license:
<https://github.com/NuGet/NuGet.Client/blob/37a0aead4f19d3069d6a1dff94bc8cfe15b87004/LICENSE.txt>.
This port covers validated ASCII labels and standard NuGet intervals. Floating
constraints are unsupported and fail explicitly, never using npm ranges.

Integrator gates: `cargo test --locked -p aphrody-pkg-core`,
`cargo clippy --locked -p aphrody-pkg-core --all-targets -- -D warnings`.
