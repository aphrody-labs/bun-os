<!-- SPDX-License-Identifier: Apache-2.0 -->
# Delivery plan

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).

> Historical source references (2026-10-07): links to removed modules use verified Git revisions. These records do not establish a current CLI route or installed capability.

Active cross-repository backlog, updated 2026-09-29. [Architecture](../../architecture/ai/ARCHITECTURE.md)
owns boundaries; [GUI](../../../m3/docs/reference/GUI.md), [UI design](../../../m3/docs/architecture/UI-DESIGN.md)
and [UX](../../../m3/docs/architecture/UX-DESIGN.md) own product behavior.
The [M3 host plan](../../../m3/docs/plans/design/M3-MULTI-HOST-PLAN.md) refines D3/D5/D6:
Tauri is Aphrody's current and only qualified desktop host. Rust renderers stay reusable
libraries; no separate winit/wgpu desktop is a delivery target. A GPU host adapter is
considered only for a measured workflow that Tauri/web cannot meet, and remains part of the
same Aphrody app. Host support still requires installed-platform evidence.

Execute authorized work under [AGENTS.md](../../reference/ai/AGENTS.md), **No human in the loop**.
Choose implementation details independently. Product access modes and protocol
approvals retain their actual runtime semantics; agent workflow does not change them.

## Product contract

Installable sovereign workstation: one accessible M3 shell with **Chat, Files,
Web and Models**, a real local coding agent and optional cloud integrations.
OCR, transcription, indexing and training are object actions backed by the
existing OS jobs owner. Reuse existing libraries, resident processes and typed
contracts. No second navigation shell, service registry or job queue.

## Current baseline

Source includes the common agent runtime, tools/providers, local models, durable
rollouts and stdio/HTTP/SSE app-server. CLI image/schema inputs already exist.
The consolidated Tauri frontend has reported checks; an installed complete coding
workflow remains unqualified. Tauri is the selected desktop host; its installed
workflow still needs release evidence.

Remaining gaps: typed tool/output projection, independent bounded event subscribers,
reconnect, cancellable tools, capability/job adapters and end-to-end restricted
execution. Full access is the supported initial policy. The UI contract now records
canonical `danger-full-access` with a legacy alias; preserve that correction rather
than reopening the old spelling mismatch.

All release rows below remain **INCOMPLET**. Source, reported checks and installed proof are distinct. The [previous detailed baseline](https://github.com/aphrody-labs/aphrody/blob/914a4bf5006366f05d030bd7976bcccd17ce93e2/docs/PLAN.md) preserves dated evidence; none of its test counts is a current guarantee.

## Organization and ownership

Use the [ecosystem catalogue](../../ecosystem/ECOSYSTEM.md) for discovery, then inspect the implementation. No reverse Cargo dependency on AI. This domain map is independent of the planned source layout: AI Rust crates and Bun/TS packages will share the `aphrody` monorepo; its Python projects join `aphrody-py`, as set by the [root consolidation plan](../workspace/PLAN.md). Repo consolidation does not change AI's wire, process or domain ownership boundaries.

The [LiteLLM review](../../research/ai/litellm-review-2026-10-01.md) records
the current gateway integration boundary: connect to a configured remote
LiteLLM service through the existing OpenAI-compatible client when needed;
keep local routing, model readiness, tool policy, secrets and durable sessions
with their current Aphrody owners. LiteLLM's Rust gateway is beta and does not
change the local gateway or release qualification plan.

## Delivery sequence

### D0 — Freeze the usable contract

**Owners:** Contracts, AI, UI. Pin the supported upstream subset, fixtures and
provenance; implement `initialize` → `initialized`, actual capability discovery,
canonical policy spelling and a separate reply path preserving server request IDs.
Establish distributed-source/license scope.
**Exit:** real handshake/turn/refusal transcripts and server-response routing fixture.
Live approval enforcement belongs to D4.

### D1 — Deliver one complete coding workflow

**Owners:** AI, UI. **Depends on D0.** One resident backend and common runtime:
select project/model, read/search, execute, edit, inspect diff, interrupt and resume.
Project real arguments/stdout/stderr/exit status/patches by thread/turn/item IDs;
connect the shell output sink and remove fabricated startup success.
**Exit:** installed multi-file coding trace, output/diff, process cleanup and
restart/resume. Explicit full access may qualify the first slice; restricted modes
stay unavailable until D4.

### D2 — Preserve sessions and concurrent event delivery

**Owners:** AI, Contracts, UI. **Depends on D0; parallel with D1.** Wire supported
session lifecycle and independent stdio/SSE/poll subscribers. Version replay/cursors,
gap detection and snapshot fallback. Bound queues, isolate per-thread state and
release global locks before long awaits. Preserve rollout backpressure, propagated
flush/fsync errors and completion durability. Fail pending requests on EOF and
reconcile under a fresh connection generation.
**Exit:** two clients observe one coherent turn; restart/disconnect recover without
lost/duplicate items. Never silently discard terminal results, approvals or mutations.

### D3 — Connect every capability family natively

**Owners:** AI adapters, capability owners, UI. **Depends on D0/D2.** Implement the matrix below in slices using existing libraries/workers and `aphrody-jobs`. Publish discovery only for actual handler/feature/model readiness. **Exit:** every enabled family has a real object→job→artifact flow with progress, cancel/error/restart behavior. Unsupported families give a truthful reason.

### D3T — Qualify a Bun coding adapter for Qwen3-Coder 30B

**Owner:** AI training and model runtime; Bun owns source, build and coding-task
oracles. **Depends on D1/D3 and a committed Bun revision.** Follow the
[Bun coder training runbook](../../reference/ai/training.md#bun-qwen3-coder-30b-adapter-delivery):
pin the upstream safetensors checkpoint and matching GGUF, build gold-disjoint
Bun tasks, implement measured MoE QLoRA, export an adapter, and compare it with
the unmodified base on held-out Bun changes. The current 12 GiB GPU qualifies
small-model pipeline checks and hybrid inference; the 30B training run needs
separately measured GPU capacity. The existing trainer supports full-precision
LoRA only, and the Bun worktree currently has uncommitted changes.
**Exit:** reproducible dataset/model manifests, successful QLoRA job and GGUF
adapter, code-task evaluation with no hidden-test leakage, resource measurements,
and an explicitly promoted model revision. Status: **INCOMPLET**.

### D4 — Enforce policies and approvals through the entire call chain

**Owners:** OS, AI, Contracts, UI. **Depends on D0; parallel with D1–D3.** Connect
every actual shell/file/patch path to OS enforcement, including traversal/reparse
checks and propagated setup errors. Cancel providers/tools and reap owned process
trees. Resolve approvals once with the original ID and real grant scope.
NHITL uses its configured policy; an unavailable required approval path fails
explicitly rather than hanging or silently allowing an operation.
**Exit:** per-platform allow/deny/network/approval/timeout/cancellation scenarios.
A process group or unused policy wrapper is not confinement.

### D5 — Meet responsiveness and resource budgets

**Owners:** AI, UI, OS, workers. **Depends on D1–D3.** Measure the budgets below;
bound queues/concurrency, keep models/workers resident and remove long global locks.
Concurrent reads are allowed where safe; order mutations and GPU/model admission.
Use authorized artifact references for large data and virtualize histories.
**Exit:** reproducible cold/warm, two-consumer and background-load measurements with
bounded memory, responsive interruption and no lost terminal state.

### D6 — Qualify and distribute the OSS workstation

**Owners:** source owners and Infra. **Depends on D1–D5 for claimed features.**
Build from pinned public source/locks/toolchains; settle Drive/FSL copied-source
provenance and model terms. Package paths, assets, workers and migrations for clean
machines; prove installation, update, recovery and uninstall on supported platforms.
AI stays `publish = false`, with CLI releases on GitHub; library publication follows
[the ladder](../../reference/ai/cargo/PUBLISH-LADDER.md).
**Exit:** ten acceptance rows with revision/platform/artifact evidence. R1 is usable
core coding; R2 is the complete capability workstation. Tauri proof alone does not
complete the native host target.

## Capability integration

Method names outside the existing-method column are intentionally not invented.
Define/version new typed requests in `aphrody-contracts` before exposing them.

| Family / existing owner | Existing app-server surface | Required product integration |
| --- | --- | --- |
| Coding / common runtime | Thread/turn lifecycle, interrupt/steer; partial item mapping | Complete Chat timeline, output/diff, sessions and approvals |
| Models / model and llama crates | `model/list`, `aphrody/llama/status` | Models hardware detection (real VRAM/AVX2), resumable download with SHA-256 verification, load/unload, progress and selected-model readiness |
| RAG / `aphrody-rag` | `aphrody/rag/search`, `aphrody/rag/context`, `aphrody/rag/status` | File/folder indexing jobs, source provenance, retrieval attachments and freshness |
| OCR/vision / existing AI owners | No qualified typed GUI adapter | Extract selected image/PDF, progress, text/artifact preview and failure handling |
| Voice / Whisper and voice owners | No qualified typed GUI adapter | Transcribe selected/recorded audio, timestamps and artifacts; optional voice features only when enabled |
| Training / `aphrody-train` | `aphrody/train/status` | Dataset/model action, durable job, resource admission, cancellation and evaluated output; no implicit promotion |
| Web / BXC and Obscura | No qualified typed GUI adapter | Browse/extract/crawl object actions, source links and resumable job results |
| Remote / SSH plus Infra | No qualified typed GUI adapter | Owner-resolved destinations, remote jobs and artifact transport; no arbitrary hard-coded host executor in UI |
| Terminal / Shell | Existing broker/terminal owner; integration to qualify | Workspace-aware PTY and process lifecycle using the existing implementation |
| Jobs / `aphrody-jobs` in OS | No qualified unified app-server job adapter | One queue/history/progress view, cancellation, retry and result links across families |
| MCP, A2A, identity and memory | Existing capability owners | Runtime extensions and contextual actions where applicable; no duplicate service registry or mandatory admin pages |

The generated ecosystem catalogue supplies exhaustive discovery. A capability is
visible only according to the current backend contract and actual availability.
Shared helper crates feed their owning capability; they do not need a separate
wire API merely to count as integrated.

## Spacebot and Drive AI parity

Compare delivered behavior with [Spacebot revision 5c2ee47](https://github.com/spacedriveapp/spacebot/tree/5c2ee47b397e09c956dc15000ea576ecd28e92bb).
The three upstream Spacedrive Memories, Autonomy and
Schedule routes are placeholders at [Spacedrive revision 6dfeccf](https://github.com/spacedriveapp/spacedrive/tree/6dfeccf2113039e35f2ce735f945e70dc3e4ea45/packages/interface/src/Spacebot/routes);
their absence from the active Aphrody UI is not a lost working feature. The
following source inventory does not qualify an installed workflow.

| Capability | Source present | Product/runtime status | Priority |
| --- | --- | --- | --- |
| Tasks, goals, autonomy | [`aphrody-agent-runtime`](../../../../crates/aphrody-agent-runtime/src/config.rs) has per-turn FullAuto/Gated; the CLI has a goal loop; OS owns [durable jobs](../../../../crates/aphrody-jobs/src/lib.rs). | **INCOMPLET:** no shared task/goal state machine, approved autonomous wake, or task API in [`aphrody-app-server`](../../../../crates/aphrody-app-server/src/lib.rs). M3 task components receive props but have no task backend. | P1 |
| Schedules | `aphrody-cron` and `aphrody-task-runner` were removed on 2026-10-09 (no consumer); the Bun fork provides `Bun.cron`. | **INCOMPLET:** nothing schedules agent work; no app-server cron API, durable agent-run result, or UI workflow. | P1 |
| Memory | [`aphrody-memory`](../../../../crates/aphrody-memory/src/types.rs) stores flat records with tags and metadata through local and hosted providers; CLI commands exist. | **INCOMPLET:** no Spacebot-equivalent typed graph, edges, cross-channel working memory, or app-server memory CRUD/search. | P1 |
| Messaging and skills | [`aphrody-messaging`](https://github.com/aphrody-labs/aphrody/blob/4d258700316af92c6f358902c60df130d8f60edf/crates/ai/messaging/src/lib.rs) has channel adapters; `aphrody-skills` (owner retiré du checkout le 2026-10-09 ; qualification historique) has skill loading and installation. | **INCOMPLET:** neither is connected to a multi-agent, per-channel app-server lifecycle; automatic reflection and skill capture are unqualified. | P2 |
| Indexed-content screening | Drive has trust tiers and quarantine fields, and [`aphrody-jev`](../../../crates/ai/jev/src/rag.rs) can judge retrieved passages. | **NON_FAIT:** [Drive's upstream-identical `SafetyModel`](../../../../apps/aphrody-drive/crates/archive/src/safety.rs) always returns safe; its optional screening feature is disabled. No production caller in this repository uses the Jev passage judge, and retrieval-time filtering cannot establish pre-index quarantine. Do not claim Prompt Guard 2 protection. | P0 |

**Ownership and order.** P0: replace the always-safe Drive screening path with an
actual versioned classifier decision, trust policy and fail-closed handling for
unjudged external records before exposing them to agent search. OS owns the
Drive index and quarantine state after extraction; AI owns model inference and
passage judgment.
P1: define task, goal, memory and schedule DTOs and error/event envelopes in
[`aphrody-contracts`](../../../crates/contracts/app-protocol/src/lib.rs),
then implement those handlers in the resident app-server using AI libraries and
OS cron/jobs/policy. P2: connect channel adapters and skill capture to that same
lifecycle. [`aphrody-ui`](../../../m3/packages/m3/src/index.ts) owns
M3 presentation through the host broker and typed contracts; it has no Cargo
dependency on AI and does not embed a second Spacebot server or navigation shell.

**Exit evidence.** Pin both upstream revisions and record a feature-by-feature
route/API map. Prove real task create/approve/execute/restart and cron
claim/retry/delivery; memory add/search/edit/delete with typed edges and source
attribution; two independent channel consumers without lost events; and
external-source injection/quarantine cases before indexing and on retrieval.
Capture protocol fixtures, data migrations, model/version/thresholds, an installed
UI trace and failure/cancellation behavior. Keep each row **INCOMPLET** until its
own source, runtime and installed evidence passes; the screening row remains
**NON_FAIT** while the classifier returns safe unconditionally.

## Latency budgets

These are **targets, not measurements**. Publish machine/OS/GPU, model and corpus,
revision, feature flags, warm/cold state, concurrency and sample counts with results.
Model load, download, inference TTFT and tokens/s are separate measurements.

| Boundary | Target |
| --- | --- |
| Warm local short request acknowledgement | p95 <= 50 ms |
| Backend event available to corresponding UI paint | p95 <= 50 ms; p99 <= 100 ms |
| Interrupt acknowledgement | p95 <= 100 ms |
| Owned shell process tree stopped after interrupt | <= 1 s under qualified workload |
| Cold UI usable / backend handshake ready | <= 1 s / <= 2 s, excluding cold model load |
| UI input/render work on a 60 Hz display | Within 16.7 ms frame budget; virtualize histories |

A long request returns a job/turn handle promptly, then streams progress. An
acknowledgement is not completion. Noninterruptible native/GPU work must report
its measured safe cancellation boundary, not falsely claim immediate termination.
Use a single clock for round trips and calibrated monotonic timestamps for
cross-process measurements. Do not subtract unrelated process clocks. For tail
latency, collect at least 1,000 representative events and include slow/failure
cases; retain raw measurement artifacts and state the workload limits.

## Release acceptance

Status here concerns **installed end-to-end qualification**, not the presence of
source code. All rows currently remain **INCOMPLET** pending a complete evidence
bundle; the baseline above records substantial existing implementation and reported
checks. A completed row needs a revision, platform, command/scenario and artifact.

| # | Criterion for 10/10 | Required release proof | Status |
| --- | --- | --- | --- |
| 1 | Reproducible OSS source closure | Clean build from documented public sources, license/notice inventory including UI lineage | INCOMPLET |
| 2 | Sovereign local inference | Install/select a real local model and complete a prompt offline without proprietary service dependency | INCOMPLET |
| 3 | Complete coding loop | Real multi-file change, command output, reviewable patch and truthful errors in installed Chat | INCOMPLET |
| 4 | Durable sessions | Resume/restart plus every claimed fork/compact/steer operation with coherent state | INCOMPLET |
| 5 | Effective policy and cancellation | Per-OS allow/deny/approval/process-tree scenarios and accurate unsupported modes | INCOMPLET |
| 6 | Declared protocol parity | Pinned upstream fixtures, compatibility subset and documented divergence scenarios | INCOMPLET |
| 7 | Unified accessible workstation | One app-ui shell, four zones, keyboard/screen reader/low-vision and real object workflows | INCOMPLET |
| 8 | Native capability coverage | Every enabled matrix family executes a real job/action; disabled families report why | INCOMPLET |
| 9 | Responsiveness under load | Published warm/cold latency and bounded-resource evidence against the budgets | INCOMPLET |
| 10 | Installed lifecycle | Supported-platform install/update, smoke, crash recovery and uninstall evidence | INCOMPLET |

## Working and evidence rules

Follow [AGENTS.md](../../reference/ai/AGENTS.md) for NHITL, scoped checks and Git hygiene.
Record **FAIT** with a revision, platform, scenario and artifact; **INCOMPLET**
names missing work/proof; **NON_FAIT** names a blocker. Update this plan and the
changelog when evidence changes. Documentation cleanup alone closes no runtime gate.
