# Independent applications

`packages/bun-artifacts` builds one Aphrody application executable per configured
capability and target. The workspace owns capability IDs, runtime provenance,
SHA-256, native builds, shared assets and deployment. The artifact package owns
embedding, manifests and extraction.

## Build inputs

`buildAppArtifact` requires:

- A clean library matching its catalog and Git submodule pin.
- An existing native CLI plus its target, source revision, SHA-256, version and
  native/SSH/Docker qualification receipt.
- An explicit Aphrody Bun 1.4.4 runtime pin and executable. Host executables are
  probed; other targets require a separately qualified runtime receipt.
- Explicit native DLLs/resources when required by that engine.
- The shared asset manifest reference from the workspace asset owner.

The builder always supplies `compile.executablePath`. It never downloads another
Bun distribution or starts Cargo. Build engines with the workspace's existing
serialized native owner. Generation now has the existing router's `artcraft-cli`
JSONL binary; its Linux native build and offline operations are qualified.

```sh
bun packages/bun-artifacts/src/cli.ts build video \
  --target bun-windows-x64 --bun /qualified/bun.exe \
  --runtime-pin /qualified/runtime-pin.json \
  --native /qualified/filmcraft-cli.exe \
  --native-receipt /qualified/video-receipt.json \
  --shared-assets .local/assets/reference.json --protocol cli-json
```

Paths are caller-selected; the example does not identify a workstation location.
Outputs default to ignored `build/apps`. Builds require a fresh
output file. The output receipt contains the executable digest and manifest.

## Runtime

The generated launcher delegates to the workspace server. `--native` exposes the
existing engine CLI; the video API reuses the existing typed bridge. The launcher
preserves native arguments. It uses no checkout discovery, Git or Cargo.

`--doctor` verifies runtime/target identity and extracts the embedded payload;
it reports this qualification precisely. `--version` needs no extraction.

Bun's embedded paths are virtual files. The extractor places native engines and
their adjacent files under `cache/native/<bundle-sha256>` before execution. It
rejects redirects, conflicting paths, size/digest mismatches and partial files.
Only its exclusive staging files are removed. Cache integrity is rechecked on
reuse; concurrency across processes can publish the same immutable bytes.

Extraction supports an AbortSignal and a 60-second default deadline, up to five
minutes. Limits are 64 files, 1 GiB per file, 2 GiB total and two workers. Native
operations use the existing process owner for deadlines, output and tree cleanup.
`APHRODY_ARTIFACT_CACHE` and `APHRODY_APP_DATA` select isolated absolute paths.

## Shared assets and deployment

Every application references the same immutable shared asset manifest. Licensed
font objects and notices use SHA-256 keys in R2. Credentials remain in protected
stores. Assets are resolved explicitly through the workspace asset owner; no
eager network fetch runs during application startup.

Native engines currently embed some fonts with Rust `include_bytes!`. Removing
those copies requires their existing font owners to accept external resources.
Separate full executables each contain their own runtime and native code.

The workspace deployment manifest binds each app hostname, target executable
digest, source/runtime pins and shared asset reference. Hostnames come from the
canonical deployment configuration. Publishing a manifest does not qualify DNS,
TLS, a native host or application operations.

For application build qualification, see [qualification](NATIVE-QUALIFICATION.md). Library source and native engine ownership remain with their pinned repositories; distribution and activation qualifications are maintained separately.
No tests are added.

## Artifact verification

```sh
bun packages/bun-artifacts/src/cli.ts verify \
  --build-report .local/builds/report.json --app video
```

`verifyAppArtifact` selects one built, extraction-qualified application from the
factory report, even when other applications failed. It validates the canonical
manifest, native source/runtime receipts, executable size/SHA-256 and sidecar
SHA-256 before running the compiled `--doctor` on its matching native target.
Digests are checked again afterward. The doctor receives no provider credentials.

The returned receipt binds application, hostname, target, binary, manifest,
source/runtime pins and shared assets for the Infra activation owner. Its
`native-doctor` qualification covers extraction and runtime identity. Media and
provider operations retain their separate gates. `--metadata-only` skips execution
and returns `metadata`; activation must require `native-doctor`.

Infra can recheck its exclusive staging files with `--binary FILE --manifest FILE`
or the API's `binary` and `manifestPath` options. The original report digests and
manifest remain authoritative; path overrides change only the inspected files.

Verification defaults to three minutes, with a five-minute maximum, caller
cancellation and bounded metadata/output. It starts no Git, Cargo or downloads.
