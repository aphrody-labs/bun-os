# Ports, domains and routes — explanatory view

This page is a historical ledger of prior route/port decisions, not a generated
current inventory. Use it to understand retired entries only. The machine
catalogues below define current declared policy; dated runtime observations are
separate evidence.

Authoritative sources (never a second registry):

- `tools/config/service-catalog.json` — every unit, its loopback port, health check, owning repository
  and `status`.
- `tools/config/host/nginx/routes.json` — every public host and path, and the internal paths reached through
  a public host.
- `tools/config/production-topology.json` — the port policy (`publicPorts` vs `internalOnly`) per host.
- `tools/config/a2a-peers.json` — the A2A registry (JSON-RPC endpoints and agent cards).
- `tools/aphrody/config/asset-catalog.json` — the static CDN release trees of `cdn.aphrody.com`, served by
  `aphrody-fonts-proxy`.
- `crates/infra/infra/src/validate.rs` (`aphrody-infra validate`) enforces cross-catalog
  consistency: no two services share a port or unit, every `port`/`health` is loopback/private and
  declared `internalOnly` in the topology, every retired entry carries `status`+`retiredAt`, and
  the A2A/local-AI/pipeline/repository registries agree with the catalog.

## 1. Port range scheme

No formal range policy existed before 2026-09-26; ports were assigned service-by-service as each
stack shipped. The ranges below describe the pattern that already exists in the catalog and are
now the policy for new services — pick the next free port in the layer's range instead of an
arbitrary number.

| Range | Layer | Members (2026-09-26) |
| --- | --- | --- |
| `80`, `443` | Public — nginx only. No application ever binds these. | — |
| `3000`–`3099` | Bun/Next web frontends | `aphrody-web-api` 3007 (retired). Reserved, no current owner: 3000, 3005 (occupied by something outside this catalog per docs/PLAN.md 2026-09-23 — do not reassign), 3006. |
| `5432`, `6379` | Shared runtime data plane | PostgreSQL 5432 (loopback only, both `vps` and `dbfr`), Redis 6379 (loopback only, `vps`). |
| `8000`–`8099` | Specialized engines (nie) | `nie-site` 8085, `nie-model-serve` 8790 (both retired). |
| `8700`–`8799` | Historical Aphrody AI allocation | `aphrody-a2a` 8788, `aphrody-ai-http` 8789 (MCP `/mcp` incl. `dragonball.*`), `aphrody-embed` 8794 (retired 2026-09-25). `aphrody-site` 8083 is also retired. Local CLI defaults (2026-10-08): `aphrody gateway serve` 8786 (moved from 8795), `aphrody infra remote serve` 8795 (browser desktop) plus RFB/VNC 5900 on the same address, tunnel-only. |
| *(unscoped, intentionally off-catalog)* | Internal ops tooling, no public domain | `stack-ip.conf` (3080 public-loopback listener, upstream `stack_api` 3010) and `staging-nds.conf` (127.0.0.1:8889, explicitly never public by design) — orphaned, no owning code found in any sibling repo, banners added in place; see §4 item 10. |

## 2. Service catalog (loopback ports)

| Service | Port(s) | Unit | Repo | Status |
| --- | --- | --- | --- | --- |
| aphrody-site | 8083 | `aphrody-site.service` | aphrody-web | retired 2026-09-25 (bundle redeploy) |
| aphrody-web-api | 3007 | `aphrody-web-api.service` | aphrody-web | retired 2026-09-25 |
| aphrody-ai-http | 8789 | `aphrody-ai-http.service` | aphrody-ai | retired 2026-09-25 |
| aphrody-a2a | 8788 | `aphrody-a2a.service` | aphrody-ai | retired 2026-09-25 |
| nie-site | 8085 | `nie-site.service` | nie | retired 2026-09-25 |
| nie-model-serve | 8790 | `nie-model-serve.service` | nie | retired 2026-09-25 |
| PostgreSQL | 5432 | distro package | — | live, loopback only |
| Redis | 6379 | distro package | — | live, loopback only |

Bold rows were missing from `tools/config/service-catalog.json` before this audit even though their
systemd unit and their port already existed in `production-topology.json`'s `internalOnly` list —
closed 2026-09-26.

## 3. Domains and routes

| Host | Path(s) | Backs onto | Status |
| --- | --- | --- | --- |
| `aphrody.com` (+`www.`) | `/` | aphrody-site :8083 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/a2a`, `/.well-known/agent-card.json` | aphrody-a2a :8788 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/models`, `/api/v1/rag/*` | aphrody-ai-http :8789 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/web/` | aphrody-web-api :3007 | retired 2026-09-25 |
| `mcp.aphrody.com` | `/mcp` | aphrody-site :8083 | retired 2026-09-25 (`tools/config/host/nginx/aphrody/aphrody-apex.conf`) |
| `n2b.aphrody.com` | `/api/v1/n2b`, `/api/v1/n2b/` | aphrody-site :8083 | retired 2026-09-25 (`tools/config/host/nginx/aphrody/aphrody.com.conf`) |
| `bot.aphrody.com` | `/` | `aphrody-discord-dev` (`127.0.0.1:4010`) | Bun dev app: signed Discord HTTP interactions, Gateway session for non-interaction events, OAuth2 login/callback; managed by `aphrody-infra` |
| `downloads.aphrody.com` / `admin.aphrody.com` | `/` | none — reserved, explicit 410 | reserved; no backing service |
| `cdn.aphrody.com` | `/s/`, `/h/`, `/s/manifest.json` | static `aphrody-cdn` release trees `/home/ubuntu/apps/cdn/current` and `symbols/current` (`tools/aphrody/config/asset-catalog.json`), served by `aphrody-fonts-proxy` (`127.0.0.1:8796`) | live on the vps host nginx since 2026-10-23 (`scripts/aphrody/tools/infra/cdn.ts publish`) |
| `nie.aphrody.com` | `/health`, `/api/`, `/f/`, `/b`, `/cdn/` | nie-site :8085, nie-model-serve :8790 | retired 2026-09-25 |
| `nie.aphrody.com` | **`/downloads/inacord/latest.json`, `/downloads/channels/stable/latest.json`, `/downloads/files/`** | static Inacord updater feed (`~/nie/var/releases/inacord/public/...`) | **kept live intentionally** (docs/PLAN.md 2026-09-26 ledger entry) even though the rest of the nie backend and the Inacord desktop app itself are retired — installed clients still poll this feed |

**2026-09-26 (all-in-one bundle):** `fut-api` / `fut.aphrody.com` (8088), registered the same
morning without a unit, a release plane or a submodule, was removed from both catalogs (never
deployed).

## 4. Gaps and owner decisions found by this audit (2026-09-26, all closed)

Fixed in this pass (see `tools/config/service-catalog.json`, `tools/config/production-topology.json`,
`tools/config/a2a-peers.json`, and the header banners added to the nginx files):

3. The A2A peer record for `aphrody` pointed at a retired service/route without saying so — now
   carries `status`/`retiredAt`.
Left as findings by the first pass (owner decisions needed) and all closed by the follow-up pass
of 2026-09-26 — nothing in this section is open any more:

10. ~~`stack-ip.conf` (port 3080, upstream `stack_api` 3010) and `staging-nds.conf`
    (`127.0.0.1:8889`)~~ — **resolved 2026-09-26: neutralized in place, not cataloged.** A
    repo-wide search of every sibling checkout (`aphrody-ai`, `aphrody-ui`, `aphrody-web`,
    `aphrody-os`, `nie`) for `stack_api`/`:3010`/`/var/www/stack` and for
    `dust`/NDS-emulator code found no owning service, systemd unit, or catalog entry for either
    template — both are orphaned from this repository's point of view. Rather than inventing a
    catalog entry for a service that does not exist, both got a header banner (matching the
    existing superseded-vhost convention) recording the finding and warning against installing
    either without first confirming a live owner. `staging-nds.conf`'s own design intent (a staged
    NDS emulator, deliberately never public) is unchanged and still documented inline; it simply
    has no implementing code yet in this ecosystem.
11. ~~`tools/config/host/nginx/aphrody/aphrody.com.conf`'s `mcp.`, `downloads.`, `n2b.`, `api.` hosts~~ — **resolved
    2026-09-26.** `mcp.aphrody.com`, `n2b.aphrody.com` and `api.aphrody.com` all back onto
    already-retired services (`aphrody-site` :8083, plus `aphrody-a2a` :8788 and `aphrody-ai-http`
    :8789 for `api.aphrody.com`; `api.aphrody.com` itself, its server block, route and DNS record were
    removed on 2026-10-09) — added matching `tools/config/host/nginx/routes.json` entries with
    `status: retired`/`retiredAt: 2026-09-25` (same date as the services they back), plus an inline
    banner on each server block in `tools/config/host/nginx/aphrody/aphrody.com.conf`/`aphrody-apex.conf` naming the
    retirement. `downloads.aphrody.com` (and its `bot.`/`admin.` siblings) is different in kind:
    it never had a backing service — it is a reserved placeholder returning an explicit 410 — so
    it correctly has no `nginx-routes.json` entry (that schema requires a `service` to reference);
    documented this distinction inline in the conf and in §3 above instead of forcing a route
    entry that would have no service to point at.

## 5. Sibling-repository code audit (hard-coded ports/hosts)

Parallel read-only+trivial-fix passes over `aphrody-ai`, `aphrody-ui`, `aphrody-web`, `aphrody-os`,
`nie` on 2026-09-26, cross-checked against the catalog above. Summary (see the
commit trailers in each repo for any fix that landed):

- **aphrody-os**: zero hits against the catalog; no fix needed.
- **aphrody-ai**: every literal that duplicates a canonical `APHRODY_AI_*` value already resolves
  through that env var first; nothing trivial to fix. One drift found and fixed 2026-09-26:
  `crates/ai/rag-eval/src/main.rs` (not in repo)'s `DEFAULT_MCP_URL` defaulted to `https://aphrody.com/mcp`,
  a path/host with no live entry in `tools/config/host/nginx/routes.json` (its `aphrody-site` backend is
  retired). Made env-driven (`APHRODY_MCP_HTTP_URL`, checked before the local default) with the
  local default repointed at `http://127.0.0.1:8789/mcp` — `aphrody-mcp http`'s own `--bind`
  default and `/mcp` mount (`crates/ai/mcp/src/main.rs` (not in repo)), the one MCP HTTP origin this
  ecosystem actually runs locally by convention. `--url` (CLI) still wins over both.
- **aphrody-ui**: same pattern (env-first, literal only as fallback); nothing trivial to fix.
- **aphrody-web**: fixed and committed (`8bd5380`) two literal-duplicates-in-scope-value cases —
  `crates/aphrody-site/src/gateway.rs` (not in repo) now calls the existing `aphrody_api::a2a_url()` helper
  instead of repeating `"http://127.0.0.1:8788"`, and `apps/bxc/src/db/AphrodyRedis.ts` (not in repo) now imports
  the already-exported `DEFAULT_REDIS_URL` instead of repeating the Redis literal. Everything else
  (aphrody-site's own 8083/3007/8788 defaults, bxc's CDP debug ports, dev-server defaults) matches
  the catalog or is out of scope (local tooling).
- **nie**: nothing to fix — the prior 2026-09-25 report's two flagged issues are already resolved
  upstream: `nie net server`'s default no longer collides with `nie-site` (bumped to `127.0.0.1:8796`
  with an explicit comment), and the `ai.json` `127.0.0.1:8792` A2A literal is not dead, it is
  `nie`'s documented slot in the cross-repo A2A convention, bound externally by the `aphrody` CLI
  (`aphrody a2a serve --bind 127.0.0.1:8792`, `docs/A2A-CODEX.md` (not in repo)).
