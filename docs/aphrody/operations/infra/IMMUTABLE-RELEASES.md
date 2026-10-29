# Immutable release workflow

This is a historical release design. At the 2026-10-02 catalog state, the
Aphrody Web/AI plane is retired, with a separate Aphrody Discord development service. Do not run the
Aphrody all-in-one bundle procedure below unless the catalogs, data source,
release assembly and activation authorization have all been updated together.
The historical design has immutable
`releases/<id>` tree behind an atomically switched `current` link, with durable
data under `shared/` and secrets in root-owned `0600` env files under `/etc`.
The separate Aphrody Discord development service is a fourth, non-production
release. The design describes intended layout; it does not prove that every
plane is currently installed or healthy. Secret-file ownership and mode are
per-service contracts; for example, the Discord development env is
`root:ubuntu`, mode `0640`:

| Plane | Root | Contents | Adapter (installed name) | 2026-10-02 declared status |
| --- | --- | --- | --- |
| Aphrody | `/home/ubuntu/apps/aphrody` | historical five services from `aphrody-web` and `aphrody-ai` | historical adapter (`aphrody-infra-deploy-aphrody`) | retired |
| Aphrody Discord dev | `/home/ubuntu/apps/discord` | Bun bundle from pinned `aphrody-discord` commit | `scripts/build/build-aphrody-discord-release.sh` + `scripts/release/atomic-deploy-aphrody-discord.sh` | active in catalog; development service |

### VPS observation (2026-10-02, read-only)

This snapshot supersedes the older live-status notes below for current host
state. `systemctl list-units --type=service --state=running --no-legend --plain`
reported 28 running services, and `systemctl --failed --no-legend --plain`
reported no failed services; disk use was 57%. A separate
`aphrody-ssh audit --host vps --json` reported `Healthy`. The running-unit
listing included Aphrody Discord development, PostgreSQL 18,
nginx, SSH, Docker and Redis.

The paths
`/home/ubuntu/apps/aphrody/current` and `/home/ubuntu/apps/infra/current` were absent. These
observations establish systemd/SSH and filesystem state only. No application
health, database integrity, public endpoint, release checksum or rollback
validation is claimed here. Do not infer from the design table or the
2026-09-29 Discord checks below that the current application release passed
those checks.

`aphrody-infra status --target vps --json` uses the Rust CLI's target/matrix
adapter, including host service counts and selected host details; it is not
the service-catalog query. `aphrody-infra service status --target vps --json`
queries entries selected from `tools/config/service-catalog.json`; it does not
discover arbitrary units. Installed binary/catalog and current source views
can differ, so reconcile their revisions before relying on results. The root
monorepo CLI is defined in
`crates/infra/infra/src/main.rs` (not in repo);
the separate Bun host monitor is `bun scripts/tools/infra/infra-status.ts status`. These
commands have different scope and output. Invoke Cargo builds/runs through
`scripts/build/rust/cargo-serial.sh` as required by repository rules.

Current operating references: the repository
[`README.md`](../../README.md),
[`PLAN.md`](../../plans/infra/PLAN.md), and
[`INFRA-MONITORING.md`](./INFRA-MONITORING.md). Historical status notes below
retain their original dates and evidence scope.

### Aphrody Discord development endpoint

The standalone development service is outside the Aphrody production bundle. It
serves `https://bot.aphrody.com`, binds only to loopback `:4010`, and reads
`/etc/aphrody-discord.env` (`root:ubuntu`, mode `0640`) for `DISCORD_BOT_TOKEN`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`,
`DISCORD_GUILD_ID`, `BASE_URL` and `PORT`. Never place that file in a release.

For first-time provisioning, issue a dedicated certificate with the webroot
challenge and install the Nginx/systemd files from yolo (`$YOLO_ROOT/tools/config/host/{nginx,systemd}`, default `~/yolo`; nginx `include snippets/*.inc` files go to `/etc/nginx/snippets/`):

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name bot.aphrody.com -d bot.aphrody.com
bun "${YOLO_ROOT:-$HOME/yolo}/packages/core/src/host/cli.ts" compose-unit aphrody-discord-dev.service \
  | sudo tee /etc/systemd/system/aphrody-discord-dev.service >/dev/null
sudo install -d /etc/nginx/snippets && sudo install -m 0644 "${YOLO_ROOT:-$HOME/yolo}"/config/host/nginx/snippets/*.inc /etc/nginx/snippets/
sudo install -o root -g root -m 0644 "${YOLO_ROOT:-$HOME/yolo}/config/host/nginx/aphrody/bot.aphrody.com.conf" \
  /etc/nginx/conf.d/bot.aphrody.com.conf
sudo install -o root -g root -m 0755 scripts/tools/infra/certbot-nginx-reload.sh \
  /etc/letsencrypt/renewal-hooks/deploy/aphrody-nginx-reload
sudo nginx -t && sudo systemctl daemon-reload && sudo systemctl reload nginx
```

The vhost retains the HTTP-01 challenge path for unattended Certbot renewal; the
deploy hook reloads Nginx after Certbot installs a renewed certificate.
Build from a clean, pinned Aphrody Discord checkout with
`scripts/build/build-aphrody-discord-release.sh`, copy the artifact to the VPS, then
activate it with `scripts/release/atomic-deploy-aphrody-discord.sh`. Activation requires
a valid certificate and env file, waits for the Gateway to reach READY, probes
local and public HTTPS health, and restores the previous release on failure.
After HTTPS validation, the app's interaction endpoint is set through Discord's
`PATCH /applications/@me` API. Register
`https://bot.aphrody.com/oauth/callback` separately in Developer Portal → OAuth2
→ Redirects before enabling OAuth login; the bot token API does not manage this
redirect registration, and the app reports a setup response until it exists.
Historical status (2026-09-28): the callback was registered; Discord API readback
confirmed it and `/oauth/login` returned the authorization redirect (`302`).

Historical status (2026-09-29 08:50 UTC): release
`084964f4a95c1d4231a75d282b61c371b4852120` is active. The release
checksums, public health/Gateway, `ping` command, minimal login and separate
install redirects, denied callback replay, and logout origin checks passed.
The authorized callback and rollback drill remain open; see
`tools/config/host/inventory/aphrody-discord-dev-2026-09-29.md`.

Historical status (2026-09-29 08:56 UTC): release
`4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` superseded the prior
release. Checksums, service, public health/Gateway, login/install redirects and
unauthenticated session response passed. Its login rate limit was tested
locally, without exhausting the live development login endpoint.
The rollback drill reactivated `084964f4a95c1d4231a75d282b61c371b4852120`,
verified health/Gateway, then reactivated `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808`
with the same checks passing. A fresh authorized OAuth callback remains open.

The historical **all-in-one bundle** pins the planes to one superproject commit and
activates them through
`scripts/release/atomic-deploy-bundle.sh` (`aphrody-infra-deploy-bundle`). Every
adapter checks checksums and preconditions before touching anything, keeps the
previous release, and restores the previous `current`, units, vhost and service
states on any failure. `aphrody-infra deploy --target vps --stack
bundle --release PATH [--apply]` is the deployment entry point
(`ssh vps sudo -n <adapter> PATH`); without `--apply` it prints the plan.
Nothing is ever deleted: old releases stay until pruned explicitly.

## Aphrody stack — historical, retired

Everything in this section describes the retired deployment contract. Listener,
secret-file and database details below are not evidence of current files or
services. Root catalog entries for this stack carry `status: retired`; use the
runbook only as implementation history until its explicit reactivation gates
are met.

| Unit | Binary (release `bin/`) | Listener | Source |
| --- | --- | --- | --- |
| `aphrody-site` | `aphrody-site` | `127.0.0.1:8083` | `aphrody-web` |
| `aphrody-web-api` | `aphrody-web-api` + `lib/libaphrody_web_ffi.so`, `lib/libbxc_render.so` | `127.0.0.1:3007` | `aphrody-web` |
| `aphrody-a2a` | `aphrody a2a serve` | `127.0.0.1:8788` | `aphrody-ai` (feature `aphrody/rag`) |
| `aphrody-ai-http` | `aphrody-mcp http` (MCP on `/mcp`, REST `/api/v1/*`) | `127.0.0.1:8789` | `aphrody-ai` (feature `aphrody-mcp/ocr`) |
| `aphrody-embed` | `aphrody-embed serve` (pure Rust E5) | `127.0.0.1:8794` | `aphrody-ai` (feature `server`) |

The agent console served by `aphrody` is `aphrody-ui`'s tracked
`crates/ui/app/ui-dist`, embedded at compile time by
`aphrody-app-server`; a build that falls back to its placeholder page fails.
Nginx serves `/ai.json` byte-for-byte from `/home/ubuntu/apps/aphrody/current/ai.json` and
routes the apex (`tools/config/host/nginx/aphrody/aphrody-apex.conf`: `aphrody.com`,
`www.aphrody.com`, `mcp.aphrody.com`) to the loopback services.

Persistent state stays outside releases: Web SQLite, crawler queue and cookies
in `/home/ubuntu/apps/aphrody/shared/bxc` (`BXC_DB_PATH`, `BXC_STORAGE_DIR`,
`BXC_COOKIES_DIR`, owner `ubuntu`), the A2A VFS in `shared/a2a` (links to the
active `ai.json` and to the `shared/coord` mailbox), AI state in `shared/ai`
(owner `aphrody`, `APHRODY_HOME`), the Gemini Web session
`shared/ai/google-cookies.json` (`aphrody`, `0600`) and the E5 weights in
`shared/models/e5-native` (`config.json`, `tokenizer.json`,
`model.safetensors`, preloaded with `aphrody-embed install --model-dir`; the
service never downloads). Web rankings/SEO live in PostgreSQL `aphrody_web`
(role `aphrody_web`); the AI RAG corpus in PostgreSQL `aphrody`
(role `aphrody_ai_http`).

### Secrets (`/etc/aphrody`, root `0600`, key names only)

| File | Keys |
| --- | --- |
| `aphrody-site.next.env` → `aphrody-site.env` | `APHRODY_WEB_DATABASE_URL`, `APHRODY_SITE_DATABASE_URL` (equal alias), `APHRODY_SITE_WEB_API_TOKEN`, `APHRODY_BXC_API_TOKEN` (equal alias), `APHRODY_SITE_WEB_BACKEND_TOKEN` |
| `aphrody-web-api.next.env` → `aphrody-web-api.env` | `BXC_API_TOKEN` (= site backend token), `APHRODY_WEB_DATABASE_URL` (= site DSN) |
| `aphrody-ai-http.env` | `APHRODY_MCP_DATABASE_URL`, `APHRODY_AI_EMBED_MODEL=Xenova/multilingual-e5-small`, `APHRODY_AI_EMBED_BASE_URL=http://127.0.0.1:8794/v1` |
| `aphrody-a2a.env` | optional |

The key list is mirrored in `tools/config/secrets-contract.json`.

### Activation checks

`atomic-deploy-aphrody-stack.sh /home/ubuntu/apps/aphrody/releases/ID` verifies
`SHA256SUMS` and the smoke attestation `SMOKE.json` (schema
`aphrody-stack-smoke/v1`, status `ok`, same `RELEASE_ID`, SHA-256 of the
release's `SHA256SUMS`, the five services, at least one `dragonball.*` tool),
the env files and token/DSN relationships, the shared directories and owners,
the E5 files (readable by `aphrody`), the Gemini cookie and the A2A links. It
then installs the five units, the apex vhost and the staged env files, switches
`current`, restarts, checks each `ExecStart`, `/proc/<pid>/exe` and executable
hash against the release, probes `:3007`, `:8788`, `:8789`, `:8083`, `:8794`,
lists the `dragonball.*` tools over `/mcp`, reloads Nginx and probes the apex
through `--resolve` (health, A2A card announcing
`https://aphrody.com/api/v1/a2a`, `/api/v1/models`, `/ai.json` hash, rankings
provenance, Web auth, allowlist and an authenticated scrape of a local
fixture). `APHRODY_STACK_EXPECT_EMPTY_RANKINGS=yes` additionally requires an
empty public ranking list. The activation backup (default
`shared/deploy-backups/<stamp>`, or `APHRODY_STACK_BACKUP_DIR`) is kept;
`--restore BACKUP` re-applies it (units, vhost, active env files, `current`,
service states).

## Build (historical Aphrody bundle procedure)

The commands here build the retired Aphrody bundle and are not a current
production release recipe. Do not execute them while the catalog marks its
services retired.

Releases are built on Linux x86_64 from
the monorepo commit on a native filesystem. The superproject and
submodule layout (`aphrody-src`, `prepare-release-workspace.sh`) was retired; the
compute release is built from one monorepo commit:

```bash
bash scripts/build/build-aphrody-stack-release.sh --compute-only "$PWD" "$(git rev-parse HEAD)"
```

```
BUNDLE.json      superproject + 13 submodule SHAs, component pins, builder
RELEASE_SHA      one `repo=sha` line per repository (aphrody-src first)
SHA256SUMS       every file of the bundle
aphrody/         the Aphrody release (bin/, lib/, systemd/, nginx/, ops/, ai.json,
                 RELEASE_SHA, RELEASE_ID, SHA256SUMS, .coord -> shared/coord, SMOKE.json)
```

NIE and IECode ship no VPS release. The bundle contains no secret.

## All-in-one bundle (runbook)

### Prerequisites

1. **PostgreSQL.** The 2026-10-02 host observation lists PostgreSQL 18 as
   running, superseding the 2026-09-25 failure note. That is service-manager
   state only; database integrity and the current databases were not checked
   in that observation. Before any release that depends on PostgreSQL, inspect
   the cluster and logs, then run the integrity/readability checks below. Do
   not reset or restart a cluster that is already running without a diagnosed
   need. The 2026-10-01 database deduplication retired the Aphrody databases;
   do not treat `aphrody` or `aphrody_web` as present production databases.

   ```bash
   df -h /var/lib/postgresql
   sudo tail -n 80 /var/log/postgresql/postgresql-18-main.log   # cause, last checkpoint
   systemctl is-active postgresql@18-main && pg_lsclusters      # verify current state
   sudo -u postgres psql -Atc 'SHOW data_checksums' -c 'SELECT datname FROM pg_database'
   sudo -u postgres /usr/lib/postgresql/18/bin/pg_amcheck --all --heapallindexed --progress
   ```

   Do not rename, drop or recreate databases as part of these checks. Check
   readability against the intended database only after its approved restore
   source and target have been established (prerequisite 2).
2. **Database source.** The old restore dumps and
   `/home/ubuntu/apps/aphrody/shared/db-backups/restore` referenced by earlier revisions of
   this runbook were removed during the 2026-10-01 database deduplication; the
   Aphrody databases were retired. See
   [`db-dedup-2026-10-01.md`](../workspace/HISTORY.md). The 2026-10-02 VPS
   observation confirms PostgreSQL 18 is running but does not inspect its
   databases. Before restoring or activating the Aphrody production plane,
   identify and verify an authorized current data source, checksum its backup,
   and stage it in a newly approved private location. Do not reuse the removed
   paths or assume the 2026-09-25 dumps remain available. If no valid data
   source is available, the Aphrody production plane is not ready to activate.
3. **Secrets.** `provision-aphrody-stack-env.sh --fresh-host` generates every
   Aphrody credential (table above); nothing
   is copied from the old host.
4. **TLS.** `aphrody.com`, `www.aphrody.com` and `mcp.aphrody.com` have no
   certificate on the host any more. Check their A/AAAA records point to the
   VPS first (`aphrody-infra ovh dns records aphrody.com --type A`). Prefer
   DNS-01 when the Aphrody OVH credentials are installed as a root `0600` file
   (never in Git):

   ```bash
   sudo apt-get install -y python3-certbot-dns-ovh
   sudo certbot certonly --dns-ovh --dns-ovh-credentials /root/.secrets/certbot/ovh-aphrody.ini \
     --dns-ovh-propagation-seconds 120 --cert-name aphrody.com \
     -d aphrody.com -d www.aphrody.com -d mcp.aphrody.com
   ```

   If those credentials are unavailable and all names resolve to the VPS,
   `sudo bash scripts/tools/infra/issue-aphrody-certificate-http.sh` bootstraps the
   same certificate with HTTP-01. The helper serves only the challenge path,
   validates and reloads Nginx, then removes its temporary vhost. The shipped
   Aphrody HTTP vhosts keep that challenge path at `/var/www/letsencrypt` so
   Certbot can renew without another Nginx change.
5. **E5 weights.** After unpacking (step 3 below), as `aphrody`:
   `sudo -u aphrody /home/ubuntu/apps/aphrody/releases/ID/bin/aphrody-embed install --model-dir /home/ubuntu/apps/aphrody/shared/models/e5-native`
   (pinned manifest, SHA-256 verified), or copy the files verified by the local
   build from `~/aphrody-release/e5-native`.
6. **Gemini Web cookie.** Place a valid session at
   `/home/ubuntu/apps/aphrody/shared/ai/google-cookies.json`, `chown aphrody:aphrody`,
   `chmod 0600` (the offloaded copy under `srv/aphrody/shared/ai/` may have
   expired: refresh it before use). Never log it.
7. **Adapters.** On the VPS, `git -C ~/aphrody-infra fetch && git
   -C ~/aphrody-infra checkout --detach INFRA_SHA` (the bundle's
   `aphrody-infra` pin), then `sudo bash scripts/tools/install-vps-adapter.sh`: it
   installs the four adapters, the catalog snapshots and `ADAPTER.json`, and
   removes the retired site-only `aphrody-infra-deploy`.

### Ordered commands (historical; do not execute without reactivation gates)

```bash
# WSL: build (see Build), then transfer only the archive and its checksum.
scp ~/aphrody-release/bundles/ID.tar.gz{,.sha256} vps:/tmp/
# VPS
cd /tmp && sha256sum -c ID.tar.gz.sha256
sudo install -d -m 0755 /home/ubuntu/apps/infra/bundles
sudo tar -C /home/ubuntu/apps/infra/bundles -xzf ID.tar.gz
(cd /home/ubuntu/apps/infra/bundles/ID && sha256sum --quiet -c SHA256SUMS)
B=/home/ubuntu/apps/infra/bundles/ID/aphrody/ops
sudo env PGOPTIONS=-cdefault_transaction_read_only=off $B/provision-aphrody-stack-env.sh --fresh-host
# Set these to the checksummed, approved restore files from prerequisite 2.
VERIFIED_APHRODY_DUMP=/approved/private/path/aphrody.dump
VERIFIED_APHRODY_WEB_DUMP=/approved/private/path/aphrody_web.dump
PGOPTIONS=-cdefault_transaction_read_only=off $B/copy-aphrody-web-tables.sh --fresh-host \
  "$VERIFIED_APHRODY_DUMP" "$VERIFIED_APHRODY_WEB_DUMP"
# prerequisites 4-7 (TLS, E5, cookie, adapters)
# Windows or WSL, from the pinned aphrody-infra checkout:
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- deploy --target vps --stack bundle --release /home/ubuntu/apps/infra/bundles/ID
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- deploy --target vps --stack bundle --release /home/ubuntu/apps/infra/bundles/ID --apply
```

The bundle adapter verifies the bundle, compares `ADAPTER.json` with the
pinned infra commit, copies `aphrody/` to `/home/ubuntu/apps/aphrody/releases/ID`,
records the current targets in
`/home/ubuntu/apps/infra/state/ID/BUNDLE.previous.json`, then runs the
adapters in order (a stack already on its pinned release is left untouched).
If a step fails, its adapter restores that stack and the bundle adapter
restores the completed steps newest first from their activation backups; the
state directory is renamed `…failed-<stamp>` and nothing is recorded as
active. On success `/home/ubuntu/apps/infra/BUNDLE.json` (with `activatedAt`) and
`BUNDLE.previous.json` describe the active and previous states;
`sudo aphrody-infra-deploy-bundle --rollback` restores the previous state.

After activation: drop `"status": "retired"` from the
five Aphrody services, their routes, the `vps` allocation and the `vps`
local-AI target in `config/`, refresh `tools/config/host/inventory/vps-source.json`, then run
the `live` pipeline stage (`bun run audit:live`).

## Existing-host path (legacy)

On a host that still has an active legacy `aphrody-site.env`,
`provision-aphrody-stack-env.sh` (no flag) stages the site/Web env and creates
the roles without rotating anything, `copy-aphrody-web-tables.sh` (as
`ubuntu`, with `aphrody-site` stopped and `APHRODY_WEB_WRITE_FREEZE=confirmed`)
copies `aphrody_bxc_rankings` and `aphrody_seo_entities` from `aphrody` into a
new `aphrody_web` owned by `aphrody_web`, compares ordered content hashes and
keeps a private checksummed dump; `prepare-aphrody-data-contract.sh` stages the
canonical Web DSN on an already-provisioned host. No script drops a table or a
database.

After activation, `sudo /home/ubuntu/apps/aphrody/current/ops/aphrody-rag-web-ingest.sh URL`
ingests one approved page into the AI PostgreSQL corpus through the loopback
Web API (credentials read from the two `0600` env files, CLI run as
`aphrody`). It is not a crawler.
