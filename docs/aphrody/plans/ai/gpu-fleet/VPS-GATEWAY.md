<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS cache, file depot and inference gateway

Owner extension, 2026-10-09. Measured through Infra SSH: VPS root disk has 146 GiB available; RAM has 36623 MiB available. DBFR has 43 GiB disk and 6576 MiB RAM available. Native nginx is inactive on both; production routing uses the existing DBFR gateway container.

## Selected topology

1. Omar's RTX 4060 executes the initial single-node vLLM service. The owner
   PC remains the native development workstation. Use the existing private
   mesh to reach Omar; a two-PC pipeline is reserved for a later explicitly
   selected allocation and is not required for this deployment.
2. VPS holds an immutable model/artifact depot under its own protected Aphrody
   home. Existing authenticated SSH/SFTP serves files; no public model bucket
   or new general Windows share. Allocate an initial 32 GiB depot quota and
   at most 2 GiB RAM cache, preserving the declared build factory allocation.
3. The dedicated GPU host keeps a checksum-verified local model cache at the same
   container path. Download once, verify revisions and checksums, then reuse
   local disk. Network disk latency never sits on each token's weight path.
4. A private authenticated Bun gateway on VPS fronts Omar's GPU API over
   the existing tunnel, with streaming and backpressure. Health gates reject
   unavailable models. Retry only before a generation has produced output.
5. Keep existing sites, cookies and domain profiles isolated. An upstream OpenAI-compatible API does not imply OpenAI provider access.

## Active gateway deployment (2026-10-11)

For the current activation, the owner requested deployment through the reachable `vps`/`dbfr` Infra hosts. The gateway therefore runs on DBFR at `127.0.0.1:8786`, authenticated with a DBFR-local token, and forwards to `127.0.0.1:8799/v1`. Port 8786 is declared internal-only, the Nginx route stays absent, and the health probe checks upstream model readiness. This deployment uses the existing four-billion-parameter CPU model; the selected GPU topology remains pending restored transport and CUDA qualification.

The systemd unit is `aphrody-ai-gateway-dbfr.service`, managed by the host unit
catalog and applied with the pinned Aphrody binary through `host-plan` / `host-apply`.
The host plan generates `APHRODY_AI_HTTP_TOKEN` on DBFR, installs a checksum-pinned
binary, rejects unauthenticated and wrong-token requests, and makes one bounded
generation smoke request without logging response content.

## Cache and memory behavior

vLLM's prefix/KV cache stays with the GPU execution owner. CPU offload is
configured per node only after memory and latency measurements. Ray may own
distributed CPU objects; summing resource counters does not produce a single
coherent RAM or VRAM address space.

The VPS file cache contains model/artifact data whose provenance permits use.
Prompt/result caching is disabled by default. An explicitly configured cache
must remain in its domain's protected store, use short TTLs and scoped keys,
and exclude provider credentials, private histories and authentication state.
Streaming API responses are not cached by the public reverse proxy.

## Deployment gates

- [x] Capacity and current routing owner observed through Infra.
- [x] Private topology selected without moving protected data.
- [x] Hub RTT measured: VPS to owner 26.1 ms, VPS to Omar 17.7 ms; owner to Omar 53 ms (three probes each, no loss).
- [ ] Direct-PC bypass and useful throughput measured.
- [ ] GPU container networking and CUDA arithmetic qualified on both PCs.
- [ ] Model depot quota, pinned artifacts and verified local caches applied.
- [ ] Bun gateway, authentication, cancellation and streaming failure tests.
- [ ] Declared route, gateway configuration test, live authenticated generation.

This is a measured deployment plan; no public inference route or shared depot
has yet been activated. The current local LinuxKit Docker GPU failure must be
resolved without starting a local WSL development workflow or disrupting
concurrent containers.

## Current transport evidence

Both private GPU transport containers are healthy and use isolated named key
volumes. This proves interface startup, not peer handshake, CUDA arithmetic or
inference. The initial service must not depend on the development PC's transport.
The pinned vLLM image download on Omar remains in progress; do not restart it
because the SSH wrapper has not yet returned output.
