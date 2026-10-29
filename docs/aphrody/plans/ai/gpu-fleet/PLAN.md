> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Bun/Python GPU inference

Owner goal, 2026-10-09: a persistent Docker vLLM fleet using both Windows PCs,
real bun:windows and bun:python integration in Aphrody py, distributed model
memory, load allocation, RAM and network storage, and reversible exclusive
inference mode on Omar.

## Initial host allocation — owner correction, 2026-10-09

The owner PC is the native Windows development workstation. Omar is the
initial dedicated GPU inference server. VPS owns SSH build factories, a bounded
artifact cache/file depot, authenticated API proxy and static CDN cache. DBFR
owns production and its existing TLS gateway. Do not start an inference head or
persistent GPU worker on the development PC. The previous two-PC planner remains
an optional later capability, not the initial deployment prerequisite.

Use single-node vLLM on Omar (tensor/pipeline parallel size one). Qualify CUDA
arithmetic and the pinned model against the RTX 4060 budget before activation;
select a supported quantized artifact if the catalogue model does not fit.
Public CDN caching covers immutable permitted artifacts only; never cache
streamed inference, protected model weights or provider authentication publicly.

## Plan before apply

Use the existing Infra mesh and protected host stores. The RTX 4070 exposes
12282 MiB and Omar's RTX 4060 exposes 8188 MiB. Use pipeline parallelism across
hosts, tensor parallelism one within each host, and a measured heterogeneous
layer split. The initial model follows the pinned Aphrody Gemma training
catalogue. vLLM and model support require actual pinned-image qualification.

Ray/NCCL must communicate over routable private container addresses, not Docker
bridge addresses advertised behind Windows NAT. Qualify communication before
loading weights. RAM and storage are distributed resources, not magically one
address space; network delay is measured and cannot be zero. Use local verified
model caches backed by a restricted network artifact store.

The native owner process uses bun:windows for resource counters, process/Job
ownership, native service checks and exclusive-mode restoration. bun:python
hosts the Python fleet planner in the same Bun process. Docker owns vLLM
restarts; the existing Mesh entrypoint owns the dedicated Bun process. No
credentials, session histories, clipboard contents or arbitrary user directories
are synchronized.

## Initial dedicated-server qualification queue

- [x] Native GPU identities and VRAM measured on both PCs.
- [x] vLLM parallelism docs queried through the documentation MCP.
- [x] Local native CPython host loaded by the fork; same-process PID and queued calls tested.
- [ ] Native CPython host and Python environment qualified on Omar.
- [x] Real Docker CUDA arithmetic on Omar with the pinned vLLM image.
- [x] Pinned model weights verified on VPS and transferred atomically into Omar's cache.
- [x] Python fleet planner and dedicated Bun inventory/planning entrypoint; four Python tests and two Bun tests.
- [ ] Compose installation and inference client activation.
- [ ] Omar live token generation and load/latency/memory measurements.
- [ ] Reversible Omar Explorer/browser retirement after execution qualification.
- [ ] Restart, reboot, protected storage, scoped gates, commit and push.

The two-GPU layer planner and Ray/NCCL roundtrip are deferred while the owner
workstation is allocated to light Bun/Python development and control. Cargo,
engine builds, crawl and GPU computation belong on their declared remote hosts.

## Evidence and current limits

The local Docker Desktop engine currently reports LinuxKit `7.0.14-linuxkit`.
The official CUDA container fails before starting: `libnvidia-ml.so.1` missing.
Omar's Docker engine reports the Microsoft WSL2 kernel, through native Docker.
No local WSL development session is started. Existing concurrent containers
remain in place. A driver-visible GPU does not establish Docker CUDA access.

The owner's native `bun_python_host.dll` under the installed Aphrody target
loads with CPython 3.12.15. A dedicated fork Bun process calls the Python planner
in process and computes a candidate 22/13 layer split for the catalogue's
35-layer E2B model. This is planning evidence, not distributed token generation.
The CPython test is isolated in its dedicated process because direct embedding
in bun:test's shared thread lifecycle timed out.

Omar's official CUDA image (digest
`sha256:001469ea0f3dec85a1ca929aeea3b58ae369d4c11228b10aec1f642bb6ca7a6f`)
reports the RTX 4060 inside Docker. CUDA arithmetic and vLLM still need
qualification. Public image downloads use an isolated anonymous Docker config
because the Windows credential helper cannot read its store from an SSH logon.
Provider credentials are not copied or reconfigured.

Primary references: [vLLM parallelism](https://docs.vllm.ai/en/v0.26.0/serving/parallelism_scaling/),
[Docker Windows GPU support](https://docs.docker.com/desktop/features/gpu/).

## Dedicated-server qualification, 2026-10-09

The standalone Compose profile serves only Omar, with TP=1 and PP=1 and no Ray
startup. Six Python tests cover the planner, routed Ray addresses and distinct
standalone/distributed serving commands. Two native Bun/Python tests pass;
scoped strict TypeScript, lint, formatting and Compose parsing pass.

The pinned catalogue repository and revision were confirmed through the model
registry API. Its model.safetensors response declares 10,246,621,918 bytes,
which exceeds Omar's 8,188 MiB VRAM before runtime/KV allocations. Do not activate
the BF16 service unchanged. Quantization or measured CPU offload must qualify
against this exact model and image, with actual token generation. The vLLM image
pull remains active; no CUDA arithmetic or model generation is yet claimed.

## Quantization candidate and artifact integrity

The initial single-GPU command now accepts the explicitly selected
`bitsandbytes` four-bit candidate, and starts with one concurrent sequence.
It does not silently enable remote model code or install dependencies. The
candidate follows [vLLM 0.26 BitsAndBytes documentation](https://docs.vllm.ai/en/v0.26.0/features/quantization/bnb/);
Gemma compatibility, installed bitsandbytes version and actual generation still
require container qualification. Seven scoped Python tests now pass.

The [fleet catalogue](../../../../../tools/aphrody/config/ai/gpu-fleet.json) pins the model
revision, exact weight byte count and registry LFS SHA-256. The depot is private,
limited to 32 GiB and contains no prompt cache. VPS capacity was rechecked:
145 GiB free. The declaration is not evidence of a downloaded or verified cache.

The VPS artifact transfer is running in the dedicated tmux session
`aphrody-gpu-model-cache`. Its first inspected partial file was 594,161,664
bytes. The job enforces the expected file size and verifies the pinned SHA-256
before renaming the partial file. Transfer completion and local Omar cache
qualification are pending; the model is not yet served.

## Isolated Omar qualification source

The CUDA probe runs fleet.py directly, avoiding imports of unrelated SDK
providers and their dependencies. Omar has an isolated release source directory
under its configured Aphrody home; its Compose file and environment were
updated to use that directory. No source checkout or provider store was replaced.
The standalone profile removes the distributed layer partition environment
variable rather than setting it to an empty invalid value. Seven Python tests,
Ruff and Compose parsing pass for this batch.

VPS metadata, tokenizer, chat template and repository notices were downloaded
from the pinned revision. Their local checksum manifest verifies rereads;
weight verification remains tied to the independently recorded registry LFS
SHA-256. The weight transfer was observed at 4,007,993,344 bytes and active in
its existing tmux session. Neither partial weights nor interface health count
as live inference qualification.

## Live CUDA and verified depot result, 2026-10-09

The pinned vLLM image download completed on Omar. The actual probe container
executed CUDA torch.arange/dot and returned the exact expected 5,559,680 value
on its RTX 4060. Reported free VRAM was 7,405,043,712 bytes and total VRAM
8,585,216,000 bytes. This qualifies CUDA arithmetic in the selected image,
not model loading or generation. The probe container was removed after exit.

VPS completed the 10,246,621,918-byte weight download. Its independent registry
LFS SHA-256 check returned OK before the partial file was renamed to
model.safetensors. Tokenizer/configuration/notices also reside in that private
depot. A direct VPS SSH connection to Omar was tested and rejected for lack of
an authorized key; no credential was copied. Delivery to Omar must use the
existing owner SSH transport or a scoped authenticated private artifact service.

The isolated anonymous Docker configuration omits the Compose plugin discovery
path. After the image is locally cached, normal Docker Compose with `--pull
never` runs the qualified probe without touching provider credentials.

## Owner integration and Explorer volumes, 2026-10-09

Owner correction: stop isolated tool entrypoints. Native Windows/Python control
and private artifact delivery move into @aphrody/product's administration owner,
under `admin flotte`. Python model execution and artifacts remain under the
Aphrody inference owner. The isolated source launchers are removed after tests.

The fork's Windows job controller uses installed psmux 3.3.8. A selected release
build reports Bun 1.4.3-aphrody.4 and its `ssh exec --native --json` successfully
executed hostname on Omar and VPS. The PATH Bun remains the older build and is
not silently replaced during concurrent work.

Explorer mount plan: install signed WinFsp and SSHFS-Win with verified package
hashes, then expose reciprocal C: filesystem views through authenticated SFTP,
existing private WireGuard addresses and host-specific SSH keys. Do not enable
public SMB or copy owner SSH private keys to Omar. Select unused drive letters;
register persistence through the existing product/mesh owner after qualification.
The initial owner-side WinFsp installation has started; mounts are not yet
qualified. Preserve credentials, cookies and provider stores in their existing
locations; remote filesystem access is not a provider-memory sync.

A requested research subagent examined actual remote PCIe support. Windows11Home
plus WireGuard has no qualified mechanism to register either distant RTX as a
real local CUDA PCIe device. Microsoft GPU partitioning stays on the physical
Hyper-V host; Dolphin's current PCIe borrowing matrix does not support Windows
borrowers. A remote API/compute inventory must not masquerade as a local driver.

## Persistent owner depot and serving qualification, 2026-10-09

`admin flotte` owns Windows inventory, same-process Python planning, Explorer
mount adapters and authenticated private artifact delivery. Four Bun tests pass
(including real CPython embedding), scoped TypeScript/lint/format pass, and ten
Python tests pass. The replaced isolated GPU tool entrypoints are removed.

Signed WinFsp 2.1.25156 and SSHFS-Win 3.5.20357 are installed on both PCs.
Reciprocal protected SSH authentication passed. Existing `\\Aphrody\\Mesh`
tasks launch the declared mount adapters with the interactive user's token.
Their process start is verified; graphical Explorer reads and reboot
persistence remain unqualified.

The declared [VPS user unit](../../../../../infra/config/host/systemd/aphrody/aphrody-gpu-depot.service)
uses that product owner bundle, replacing the temporary artifact tmux session.
`systemd-analyze --user verify` passed before activation. The unit is enabled
and active, user linger is enabled, and its declared private mesh address returns
401 without authentication. Protected weights and provider stores are not public.

Omar's pinned cache transfer exited successfully after the full 10,246,621,918
weight bytes and independently pinned SHA-256 matched. Native Docker executed a
real pinned-host-memory CUDA probe. Enabling `VLLM_WSL2_ENABLE_PIN_MEMORY=1`
resolved vLLM 0.26 V2's unavailable-UVA startup failure on Omar's 6.18 kernel.
BitsAndBytes loaded the complete model, reporting 6.63 GiB, but the first runtime
profile had negative available KV memory at 85% GPU utilization. This is a
failed serving qualification, not a working model API.

The explicit 2 GiB CPU-offload candidate left the same negative KV budget.
Raising GPU utilization to 93% failed the measured initial free-memory check.
Both are failed candidates. Their configurable commands remain bounded before
launch; distributed roles refuse the standalone offload setting. See the exact
[vLLM 0.26 offload contract](https://github.com/vllm-project/vllm/blob/v0.26.0/vllm/config/offload.py).
Real generation, stable restart and model-backed client activation still gate
delivery. This Gemma candidate is distinct from the existing trained
`shenron-chat-v2` Qwen adapter; no model alias invents a training result.

## Real model API qualification, 2026-10-09

The dedicated chat allocation uses vLLM's explicit language-model-only mode,
256 MiB of KV cache, 512 batched tokens and 2,048 context tokens. CUDA graphs and
compilation remain enabled. Actual startup reports 17,256 cache tokens and
completed graph capture, with restart count zero. Full multimodal loading is
not qualified by this chat allocation.

The inference owner's `qualify` operation, executed in Omar's real container,
authenticated against `/v1/models`, checked the exact `gemma4-e2b` identity,
then completed `/v1/chat/completions`. The arithmetic request returned `Four.`
with 18 prompt tokens and 3 generated tokens in 0.400 seconds. This is a single
request receipt, not a throughput benchmark, RAG eval or tool-call qualification.
Fourteen Python tests now pass, including the SDK's optional-provider-free
planner import. The inference package retains its public exports lazily.

Omar now has the qualified fork as `bun.exe` in its versioned directory and
Buv's actual `uv 0.12.24` installed CPython 3.12.15. Buv dispatch depends on the
supported executable basename: the earlier renamed `.exe` did not expose UV.
Its unmanaged existing Python launcher was preserved. SDK bridge distribution
and model-backed Shenron clients still require their host receipts.

## Shenron delivery and remaining host qualification, 2026-10-09

The pinned Shenron pipeline `1545a33f` was built and run on the VPS, then
delivered to DBFR with its exact locked Zod dependency and SHA-256 receipts.
Inlining Zod failed before execution; the qualified package keeps it external.
After a checksum-verified PostgreSQL source-registry backup, the native import
applied 396 records and preserved 57 from 17 official documents and 436 media
references. Canon promotion remains zero; references do not prove fetched media
or fresh RAG embeddings. The crawl respects robots with 25 requests and depth two.

The production audit checked all 381 listed images of Soshuhen volume one,
receiving 381 image responses with HTTP 206. The other 17 volume API records
have no listed pages. No complete CDN, OCR, wiki or RAG delivery is inferred.

The configured provider is consumed by `aphrody ai agent app-server` and the
shared site/desktop daemon. The installed help states that
`aphrody ai agent exec [PROMPT]` currently returns unsupported. Source-level
authenticated MCP/SSE changes require newly distributed binaries before
activation; the older installed binary is not this qualification.

At 19:10 UTC, Omar's direct private SSH connection timed out and the VPS no
longer listened on reverse ports 22010 or 22011. The earlier real generation
receipt remains valid, but current reachability, Python host DLL delivery,
GPU training, Mistral.rs activation and reboot persistence remain unqualified.
The owner workstation started no Cargo or GPU jobs for this batch.
