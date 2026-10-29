> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native fleet release, 2026-10-09

This is dated release evidence for the owner's native Windows workstation, the
VPS build factory, DBFR production host and Omar's GPU host. Host roles and
permissions follow [CLOUD-READY](../cloud/CLOUD-READY.md) and the
[native execution context](../workspace/windows-native.md).

## Source integration

Completed owned batches were committed as `aphrody-dev` and normally pushed to
the existing private remotes. Concurrent source, generated documentation and
protected stores were preserved.

| Repository | Pushed source | Scope |
| --- | --- | --- |
| Aphrody | `21ff48ba62cf1bb3affd10f94ecb8a5d4e4ab330` | Rust inference gateway, Docker-independent Mesh recovery, native Windows setup producer, WireGuard peer patch and platform cfg fixes |
| Shenron | `4332b0bcf4299a5037e5d468cb0baf9b121c530b` | Native pipeline, lazy Aphrody Python SDK adapter, authenticated provider and classified official-crawl ingestion |
| Bun fork | `292de960af2bff1b8ae9bf50d7dc05409e5797e5` | Owner integrated ConPTY and Python header/exit-status batches during the release; runtime qualification uses the separate immutable release pin below |

The Cargo lock reconciliation in Aphrody was generated on the serialized VPS
factory from clean main. Its sole delta updates the first-party GPU backend
version from `1.0.0-canary` to `1.0.0-canary.1`; no third-party dependency update
was included.

## Qualified components

The [Aphrody private release](https://github.com/aphrody-labs/aphrody/releases/tag/native-20261009-21ff48ba62)
was published at 20:40:35 UTC with 18 uploaded, checksum-verified assets. It is
a private prerelease and does not change the public downloads manifest. Its
aggregate `release.json` SHA-256 is
`8241c5819f34b4e94951f89f505cdeca8d4cd68218f1585ba5e1b11e2d6f36a6`.
The published tag resolves to source `21ff48ba62`.

The [Shenron private release](https://github.com/aphrody-labs/shenron/releases/tag/native-20261009-4332b0bc)
contains the pipeline CLI, its locked Zod dependency and the bundled lazy Python
adapter. The archive SHA-256 is
`280980db17c439c1c67d08d6be4676475ae9a87165e481939d9f26c74bdecad0`.
All inner-file checksums were verified on the VPS and DBFR. The packaged CLI
processed the protected official corpus as a dry run: 17 documents, 453
references, complete receipt, no database writes.

The [Bun fork runtime release](https://github.com/aphrody-labs/bun/releases/tag/aphrody-v1.4.3-aphrody.4)
is pinned to `41211b56872ca2957e5c037ad1756f56f8f89b7c`. The downloaded
Windows x64 runtime and service ZIPs match their published SHA-256 digests.
The service ZIP starts a loopback HTTP probe; it does not provision the fleet
Mesh, SSH, WireGuard or updates. It was not installed as a fleet service.

Aphrody setup 0.3.0 was compiled natively using this Bun runtime from clean source
`0cfbb591a36483bc65e53b706073bd6c14ca1678`. Real Windows smoke checks passed:
version, installation simulation, admin and creator CLIs, desktop catalogues
and both-role simulation. Its EXE SHA-256 is
`c363314b15bc4c64c113d3e01cde6dcdbba7fe3429cfceeff5d76152efa4cff2`.
The separately generated CLI build and source SDK/Mesh package have their own
revision and checksum receipts; a component's pin is not inferred from the
aggregate release tag.

The source SDK/Mesh component selects 185 tracked Python application and
packaging files. Its final inventory has 197 checksum-verified files; 14 Mesh
tests with 54 assertions passed. The bundled Mesh dispatcher answered its
Windows capability and loopback health commands. `bun:python` imported SDK and
training application packages 0.1.0 from this packaged source in the same
process, normalized text and parsed 155 Python files. The outer component
archive SHA-256 is
`1e777ef1b6ad88f544b3767a157cdec6da89499e908ec0ab12737f9265490d43`.
The external native host and CPython DLLs were checked but are not included.

The canonical Bun Product CLI was bundled separately from source `0cfbb591a3`.
Its real native Windows version, install simulation, admin version and creator
desktop catalogue commands passed. This 668,042-byte bundle requires the
qualified fork runtime; it does not embed or replace that runtime. Its SHA-256
is `ce5489e1a2f156b673bf32c2e6a63548a5f338b4e667194d09f33b1e8f1fc443`.

The actual Windows CLI build from clean `21ff48ba62` passed on the VPS in
8 min 30 s with the catalogued MCP/WinClean feature set and MSVC target. The
PE32+ x86-64 EXE is 297,473,536 bytes with SHA-256
`0da432c13f776a3ca5c460fdbc5c9ae6363fd57dc98c3caa2e200b3825a996c4`.
Packaging and native Windows command qualification are recorded separately
from this build result.

Native Windows qualification confirmed the EXE's compiled commit, target and
release profile. The actual gateway, WireGuard, `infra remote always-online`
and MCP-server command parsers passed. A real MCP stdio initialization and
`tools/list` returned 342 tools, including `computer_observe` and the WinClean
actions, from an isolated test home. No tool action, GPU job or host service was
started by this protocol gate.

For the published setup, the VPS used its existing pinned Bun Linux `.3`
producer and explicitly embedded the checked Windows `.4` executable. The
musl `.4` candidate could not run on the VPS because its ELF loader was absent;
no global runtime was installed to bypass this. The resulting setup differs
from the prior native Windows producer and was qualified afresh on Windows:
all nine checks passed, including the full admin/creator role simulation.
Published setup EXE SHA-256:
`8f3bab296480e4025ace6dc0432caa49b7f9255be329a18eade44613ff29e31c`.
Its flat update archive SHA-256 is
`696953290246e10bd02701f1cef803aaed92f950c3394cdd4daf4730fefb4d28`.
The larger artifacts were uploaded through the VPS's existing isolated GitHub
authentication; no credential was copied from the workstation.
Tracked third-party provenance and license records from the same source pin
are included in a dedicated legal asset. A superseded manifest for the
cancelled slow workstation upload was removed from the draft before publication.

The eight WireGuard/platform source files match the isolated qualification
snapshot `9537c962f8a553da604356972de49b7a11e613ab`. The VPS passed 35 scoped
tests, strict Clippy for five owners and the MSVC cross-check. Windows builds
require the catalogued `TARGET_CPU=x86-64-v2`: an initial run without it failed
in WebP's SSE4.1 C source; the corrected run passed. No heavy Cargo, GPU or
engine build ran on the owner workstation.

## Host delivery and activation

The immutable Shenron pipeline component is staged under the resolved Aphrody
home on both VPS and DBFR, in the `lib/shenron/releases/native-4332b0bc`
directory. No production service or image was restarted for that delivery.
OCR dependencies, native Bun/CPython libraries and the Aphrody Python
application source are selected separately on each host. This component release
does not establish a GPU training run, a complete RAG evaluation or production
model promotion.

At 20:08 UTC Omar's public SSH reverse client was connected to the VPS, but its
forwarded Windows SSH, desktop, MCP and VNC destinations returned no service
response. Direct WireGuard destinations and the WSL SSH forward also timed out.
This establishes a recovery channel, not working Windows command execution.
No release upload or service activation on Omar is claimed.
The Windows SSH forward still returned an empty banner at 20:34 UTC.

Recovery requires the existing Windows services on Omar to start. The pending
host-side bootstrap is PowerShell as administrator:

```powershell
Get-ScheduledTask -TaskPath '\Aphrody\' |
  Where-Object { $_.TaskName -match 'WG|WireGuard|Mesh' } |
  Start-ScheduledTask
Start-Service sshd
```

After authenticated Windows SSH responds, Infra can inspect the host, plan
delivery, upload immutable artifacts, verify checksums and activate the declared
hidden Mesh task. Preserve the host's checkout edits, keys, profile stores,
databases and model cache. Requalify the real GPU service after the reboot before
allocating training or another inference engine.

## Packaging limits

Artifacts contain no provider authentication, cookies, raw sessions, protected
database contents, datasets or model weights. Python sources are not a built
wheel or a distributed native runtime. Local CPU integration evidence with
external Bun/CPython libraries does not qualify their binary provenance for
redistribution. Windows artifacts have checksum integrity; no signing key was
configured. The initially active Bun ConPTY and Python batches were subsequently
committed by their owner as `d84e82a5418`, `c321e648765` and `292de960af2` and
confirmed on origin/main. No newer Windows runtime binary was qualified by this
release: the deployed candidate remains the immutable `.4` / `41211b568`.
Concurrent local settings, skill and manifest edits were preserved.
