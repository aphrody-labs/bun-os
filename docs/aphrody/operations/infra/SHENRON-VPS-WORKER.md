# Shenron crawl worker on the VPS

This runbook describes the isolated Shenron crawl lane. The VPS uses its local
Aphrody job queue; it does not share a SQLite file with the PC, and this
configuration does not replicate or synchronize Shenron's editorial database,
scrap database, or caches. Database/cache replication needs a separate owner
and an explicit consistency contract.

## Components

- `aphrody-jobs-worker-vps` consumes only jobs placed for host `vps`; its queue
  remains local under `/home/ubuntu/.aphrody` and concurrency is limited to 1.
- `aphrody-mcp-http` listens on `127.0.0.1:8793`. The optional WireGuard
  socket projection stays pending until the listener, root-owned bearer, and
  authenticated probes have all been qualified.
- Shenron's catalogued Dragon Ball crawl selects `--browser playwright`. The
  Rust crawler uses the VPS-local Obscura CDP browser on `127.0.0.1:9222`
  through `aphrody-web-playwright-vps.service`, which listens only on
  `127.0.0.1:9230`. The bridge uses the pinned upstream Bun runtime already
  installed on the VPS; it is not a second crawler or a public endpoint.
- The SSH client forwards PC loopback `127.0.0.1:9234` (MCP),
  `127.0.0.1:9235` (health), and `127.0.0.1:9233` (Obscura CDP) to the VPS.
  A reverse loopback forward exposes the VPS renderer at PC `127.0.0.1:9230`
  for the local qualification command. Both directions remain loopback-only.
  The PC task runs with the owner's limited user token.

## Activation gates

Do not activate from the catalog alone. The Shenron Compose `env_file` is
optional, so a release can proceed before crawl is configured. Do not create
`web.json` or set `SHENRON_ADMIN_WEB_CONFIG` at this stage: the crawl queue must
remain disabled until its worker and browser probes pass and one bounded job
succeeds. The credential provisioning step below creates the DBFR environment
file with owner `root:ubuntu`, mode `0640`; DBFR must not receive a `web.json`
yet.

Provision the shared private bearer with `aphrody infra host-provision crawl`
to print a no-change plan, then add `--apply` to create it. The command sends
the CSPRNG value only through SSH stdin to VPS and DBFR; it writes
`/etc/aphrody/aphrody-mcp-http.env` as `root:root` `0600` and
`/etc/aphrody/shenron-web-crawl.env` as `root:ubuntu` `0640`. It prints no
secret, and it refuses partial or divergent existing files. The VPS file uses
`APHRODY_MCP_HTTP_TOKEN`; the DBFR file uses
`APHRODY_VPS_MCP_HTTP_TOKEN`. Both contain the same CSPRNG bearer, transferred
only through SSH stdin. The DBFR file contains no
`SHENRON_ADMIN_WEB_CONFIG`, so the distributed queue stays disabled.
Re-running against matching files is a no-op.

Next, build the VPS Aphrody artifact from a clean pinned revision. Run
`aphrody infra host-apply --target vps --service aphrody-mcp-http
--binary-from <artifact> --binary-sha256 <receipt-sha256>` to print the plan;
add `--apply` only to stage the catalogued binary and unit. Repeat for the
`aphrody-jobs-worker-vps` service using the same pinned artifact. These commands
do not start units. They verify the local and remote binary hashes, verify the
systemd units, and restore previous files if installation fails. Successful
applies retain root-only rollback files and print `rollbackId`,
`binarySha256`, and `unitSha256`. To restore that apply, first print a rollback
plan with `aphrody infra host-rollback --target vps --service aphrody-mcp-http
--rollback-id <id> --binary-sha256 <hash> --unit-sha256 <hash>`, then add
`--apply`. Rollback refuses if the installed files no longer match those hashes.
The managed binary destination is `/home/ubuntu/.local/share/aphrody/bin/aphrody`;
the units continue to launch `/home/ubuntu/.local/bin/aphrody`. Host apply and
rollback verify that the launcher remains a symlink to the managed file and
never replace the symlink itself.

The service still requires `/etc/aphrody/aphrody-mcp-http.env`, owned by
`root:root` with mode `0600`. The same bearer is already present in the DBFR
crawl environment file; keep both values out of command lines and logs.

Before enabling or starting the browser forward, install its missing SSH unit
through the narrowly allowlisted unit-only operation. Run
`aphrody infra host-unit-apply --target vps --service omar-browser-client-vps`
to inspect the catalog path/hash and plan; add `--apply` to stage the unit,
verify it with `systemd-analyze verify`, and install it under
`/etc/systemd/system/aphrody-obscura-omar-client.service`. This operation
installs no Aphrody binary and never starts the unit. It retains a root-only
rollback copy and prints a `rollbackId` and `unitSha256`. Roll back only if the
installed unit still matches the pin:
`aphrody infra host-unit-rollback --target vps --service omar-browser-client-vps
--rollback-id <id> --unit-sha256 <hash>`; add `--apply` after reviewing the
plan. Then use the Infra boot catalog to enable the unit and start it through
Infra. Require its active state and successful VPS loopback probes on both
9234 and 9235 before the qualification job.

The private MCP WireGuard projection is also absent on the VPS. Install its
catalogued unit bundle before enabling or starting that socket:
`aphrody infra host-unit-apply --target vps --service aphrody-wg-proxy`
prints the plan; add `--apply` to stage and install the service template,
paired socket template, and the four service drop-ins declared in the host
catalog. Infra checks every source/hash, rejects symlink destinations, runs
`systemd-analyze verify`, retains root-only backups, and reloads systemd. It
does not enable or start either unit. Rollback is pinned to the bundle hash:
`aphrody infra host-unit-rollback --target vps --service aphrody-wg-proxy
--rollback-id <id> --unit-sha256 <bundle-hash>`; add `--apply` after reviewing
the plan. The socket remains private to the declared WireGuard address and
must pass the later authenticated MCP probe before activation.

After installation, use the Infra boot catalog to enable the declared units,
then start `aphrody-web-browser-vps`, `aphrody-web-playwright-vps`,
`aphrody-mcp-http`, `aphrody-obscura-omar-client`, the private WireGuard MCP
socket, and `aphrody-jobs-worker-vps` through their owning Infra commands. The
worker creates its private local queue under the prepared
`/home/ubuntu/.aphrody/jobs` directory. Require all of these checks before
submitting a qualification job:

The Obscura and Playwright unit-only installs are explicit and hash-pinned:
`aphrody infra host-unit-apply --target vps --service aphrody-web-browser-vps`
and `aphrody infra host-unit-apply --target vps --service aphrody-web-playwright-vps`.
Review each plan, then repeat with `--apply`. Obscura installs the four catalogued
Ubuntu/sandbox drop-ins; Playwright installs its loopback-only Bun bridge unit.
These operations install files only. Enable and start them through Infra after
the candidate Aphrody binary and required Bun runtime are present.
Use `aphrody infra service enable --target vps --id aphrody-web-browser-vps`
and the matching `aphrody-web-playwright-vps` service id, then start both with
`aphrody infra service start --target vps --id <service-id>`.

1. The candidate artifact is built from a clean pinned Bun OS revision with
   Cargo features `jobs,mcp-jobs`; verify the artifact hash against the build
   receipt.
2. VPS Obscura CDP (`127.0.0.1:9222`) and the Playwright render bridge
   (`127.0.0.1:9230/health`) pass health checks; the forwarded PC Playwright
   MCP `tools/list` includes the expected browser tools.
3. The MCP listener returns `401` without a bearer, returns healthy with its
   protected bearer, and its authenticated `tools/list` includes jobs, web
   crawl, and Obscura browser tools.
4. Submit one bounded official Shenron crawl directly through authenticated
   Aphrody MCP with host affinity `vps`; wait for `succeeded` and retain its
   actual remote job ID. This does not enable the Shenron admin queue.

Then run `aphrody infra host-activate crawl --job-id <id>` to print its live
qualification plan. It repeats the enabled/active Obscura, VPS Playwright
bridge, worker, MCP and SSH units; VPS and forwarded PC browser/MCP probes;
bearer, auth and job-status checks. Add `--apply` only after reviewing the plan.
It atomically installs `web.json` with `workerReady: false` and `vps-mcp.toml`,
then adds `SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json` to the DBFR
env file. Repeating host-activate preserves an existing prepared or ready
config; it never resets `workerReady: true`. It never starts or restarts a
service. Keep the WireGuard socket projection private; no listener is exposed
publicly.

The false readiness value leaves the admin queue unable to offer crawl jobs.
The bot container reads `env_file` only when Docker creates it. Deploy/recreate
the Shenron bot through its release owner now, and wait for the unique Compose
bot container to become healthy. Then inspect the plan:

```sh
aphrody infra host-ready crawl --revision <40-character-release-revision>
```

Infra requires exactly one running Compose `bot` container in project `shenron`
on DBFR, its
`org.opencontainers.image.revision` label to match the requested revision, a
healthy Docker health status, and the exact
`SHENRON_ADMIN_WEB_CONFIG=/run/aphrody/web-crawl/web.json` environment entry.
The probe emits only the container ID, revision, health state, and a boolean
for that one environment entry; other environment values are never read out.
After reviewing the plan, repeat with `--apply`. Infra rechecks the same
container and release, then atomically changes only `workerReady: false` to
`true` in `web.json`. It does not change the environment, Compose, queue
SQLite, or start/restart services. The config is reread on bot operations, so
the ready state becomes effective only after this verified transition.
Repeating the command is a no-op only while the same revision is still active,
healthy, and has the expected environment entry. Recreate/release and requalify
before marking a different revision ready.

The service and unit catalogs are desired-state declarations. `infra boot
apply` cannot install an absent systemd unit. Never copy a unit or binary into
a live host manually.

## Queue and data boundaries

The VPS queue is independent from DBFR's queue. A job assigned to `vps` is not
automatically run on DBFR. The VPS lane does not write Shenron's Postgres
editorial database, its SQLite scrap database, or either local/remote cache.
Until a versioned synchronization contract exists, keep crawl outputs as
source-attributed job artifacts and let Shenron's existing data owner import
them.

## Pulling one crawl artifact to DBFR

Infra provides `aphrody infra host-pull crawl` as a DBFR-host operation, run as
the `ubuntu` account. The live DBFR SSH identity uses the existing `vps-wg`
alias, `~/.ssh/aphrody_fleet_vps`, strict host-key checking, and the pinned
`10.200.77.1` known-host entry. The host-pull preflight verifies those exact
values, the SSH/scp executables, and a read-only SSH probe. It queries the real
MCP job status and requires a successful VPS-affined job whose payload names
the same output directory. That path is derived as
`<allowlisted-root>/<sha256(intent-key)>`, matching Shenron's
`crawlJobOutputDirectory`. The pull copies exactly one file,
`shenron-documents.jsonl`, then checks its VPS inventory before and after
transfer, local size/SHA-256, JSONL record count, and the 512 MiB and
10,000-document limits. Its durable receipt records transport facts only; it
explicitly says no export manifest is present and the staged data is not
importable. The Shenron exporter must later validate/project the source and
produce the official two-file export before any ingest.

The Shenron intent code fixes its output root at
`/home/ubuntu/.aphrody/workspaces/dbfr/crawl/campaigns`; Infra allowlists that
exact root. The remote per-job directory and JSONL must still exist and match
the successful job receipt before transfer. If the producer changes that
contract, update the catalog from its owner rather than passing a source path
on the command line. The command shape is:

```sh
aphrody infra host-pull crawl \
  --job-key <dbfr-intent-key> \
  --remote-id <vps-job-id>
```

Review the plan, then repeat with `--apply`. This leaves the single raw JSONL
under `.../crawl-artifact-staging/<sha256(intent-key)>/artifact/` and the transport
receipt beside it. The pull does not verify a policy digest, synthesize an
export manifest, or make raw JSONL eligible for import. Export and ingest stay
separate, reviewed steps.
