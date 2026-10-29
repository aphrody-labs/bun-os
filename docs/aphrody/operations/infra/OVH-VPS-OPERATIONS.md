# OVH VPS Operations — Aphrody Infra

Comprehensive guide to OVH account operations via the Aphrody CLI (`aphrody ovh`).
This runbook covers the service account (OAuth2) and IAM, every service of the account
(`services`), domains, DNS zone backups, VPS renewal, expiration management, health monitoring,
and recovery from expired services.

## Live status (2026-10-11)

The checks below were run on 2026-10-11 with the native Aphrody CLI and
`aphrody infra ssh`. Secret values are not recorded here. Infra reclaim was
applied only on the owner-administered `vps`; DBFR remains under Omar's
administration and was inspected read-only.

- OVH profile `aphrody.com` authenticated with OAuth2 client credentials on
  the EU endpoint. `aphrody infra ovh services watch --profile aphrody.com
  --alerts-only` and `aphrody infra ovh vps watch --profile aphrody.com`
  returned healthy. The `aphrody-ovh-watch.timer` is active on the VPS; its
  service run succeeded at 2026-10-11 07:05 UTC. The protected local audit task
  also completed with result 0.
- `vps-203bea89.vps.ovh.net` is active, model `vps-2025-model4`, with 12 vCPU,
  48 GiB RAM and a 300 GB OVH disk. Renewal is automatic and expires
  2026-12-01. OVH's operational status route returned HTTP 403
  `not implemented`; SSH supplied the host health evidence.
- The remote secrets contract check returned `SECURE`: 5 variables declared,
  2 present, and no required or empty variables. Values remain in the
  protected store and were not printed.
- SSH health audit still classifies the host `Critical`: `/home/ubuntu/build`
  (`/dev/sdb1`) is 100% full with about 331 MiB free. Root (`/dev/sda1`) is at
  83% with about 52 GiB free. There are no failed systemd units. A bounded
  inventory found recent Linux kernel build trees and active Bun previews; the
  exhaustive size scan exceeded its SSH deadline, so no build-volume paths were
  deleted.
- `aphrody infra reclaim --target vps --apply` reported 1,798,890,547 bytes
  reclaimed: Cargo registry cache 278,008,576 bytes, Bun install cache
  1,040,113,231 bytes, `/tmp` tmpfs 425,472,740 bytes, journal 48,287,744
  bytes, apt cache 3,809,280 bytes and rotated logs 3,198,976 bytes. Docker,
  Snap, core dumps and `/var/tmp` reclaimed 0 bytes. The receipt does not list
  individual cache files and the command has no documented rollback. No active
  Cargo/Rust compiler was observed; a Bun upstream sync and preview services
  remained active. No service failures were found after the operation.
- A second allowlisted `aphrody infra reclaim --target vps --apply` recovered
  about 0.15 GiB; Docker and the other system steps recovered 0. The build
  volume remains full. Its pruning plan only removes unreferenced Docker images
  and build cache older than seven days; that plan recovered no Docker space.
- DBFR was not modified. Its root volume is 75% used with about 25 GiB free;
  all declared containers reported healthy, and no systemd units were failed.
  The host audit's `nginx` system-unit finding remains separate.
- Two local OVH read-only scheduled audits are now registered at logon and
  every six hours as the interactive owner at Limited privilege with a
  five-minute deadline. Both latest task results were 0.
- A fresh allowlisted reclaim plan on the Aphrody VPS estimated 23.70 GiB for
  Docker, but the apply reclaimed 0.01 GiB total. `/home/ubuntu/build` remains
  full at 100%; its latest `df` reports 331 MiB free. A detailed directory-size
  scan was still blocked by slow disk I/O, so no build outputs were deleted and
  no DBFR host changes were made.
- Local `aphrody infra status --json` still fails because
  `C:\Users\aphro\aphrody\tools/config/host\inventory/targets.json` is
  missing, including when invoked with `--root C:\aphrody`. This local
  catalogue/binary issue did not block the separate OVH and SSH checks.
- The zone-metadata schema mismatch remains as recorded in the
  [protected OVH audit](ovh-protected-2026-10-09.md); the new audit verifies
  DNS records directly and does not claim zone-metadata qualification.

Next steps: recover space on `/home/ubuntu/build` only after identifying
inactive build outputs and an Infra plan for that mount; have the DBFR account
administrator authorize and apply any API-key permission change, then verify
the resulting permission path; fix the local `targets.json` resolution and
requalify OVH zone metadata separately.

## Incident: VPS Expiration Without Alert (2026-10-01 to 2026-10-05)

The VPS `vps-203bea89.vps.ovh.net` (service ID 69570856) expired on 2026-10-01 with
`deleteAtExpiration: true` configured, causing automatic service halt and factory Cargo
build pipeline downtime. The incident remained undetected for 4 days because:

1. No daily health check reported expiration.
2. API calls to the VPS returned HTTP 460 "This service is expired" without human visibility.
3. The `deleteAtExpiration` flag was set to `true` by default (high-risk for unattended renewal).

**Resolution**: Renewed the VPS for 1 month (order 260903513, paid 2026-10-05); implemented
daily automated health checks with alert thresholds; established billing policy for
`deleteAtExpiration=false` and automatic renewal flags.

## Policy

**Declared in** `tools/config/host/host-policy.toml` `[billing]`:

```toml
[billing]
vps_renewal = "automatic"           # Flag: renew.automatic=true (prevent manual renewal gate)
vps_delete_at_expiration = false    # Flag: renew.deleteAtExpiration=false (preserve VPS)
vps_alert_threshold_days = 14       # Alert if expiration < 14 days
```

**Monitoring**: `aphrody-ovh-watch.timer` (daily 07h00 UTC) executes
`aphrody ovh services watch --alerts-only --notify` over every service of the account. Exit
code: 0 if healthy, 1 if alerts, 2 if error. `aphrody ovh vps watch` remains for a VPS-only check.

## Service account (OAuth2) and authentication

The account `eu8427-ovh` is managed by a **service account** (OAuth2 client credentials). The
identifiers are private and stay outside the repository:

- `OVH_CLIENT_ID` / `OVH_CLIENT_SECRET` in `~/.config/aphrody/ovh.env` (`export KEY=VALUE`), or
  `client_id` / `client_secret` in the `[ovh-eu]` section of `~/.config/ovh/aphrody.conf`.
- On the host: `/etc/aphrody/ovh.env` (key names declared in `tools/config/secrets-contract.json`,
  service `aphrody-ovh-watch`).

The CLI exchanges them at `POST https://www.ovh.com/auth/oauth2/token`
(`grant_type=client_credentials`, `scope=all`; `ca.ovh.com` and `us.ovhcloud.com` for the other
regions, as in the official python-ovh and go-ovh SDKs), keeps the Bearer token in memory, renews it
60 s before expiry and once on HTTP 401. Calls then use `https://eu.api.ovh.com/1.0` (IAM:
`/v2`) with `Authorization: Bearer`, no `X-Ovh-*` signature.

**Selection order**: `OVH_CLIENT_ID`/`OVH_CLIENT_SECRET` from the environment (aphrody account
only) -> `client_id`/`client_secret` of a profile file (`~/.config/aphrody/ovh.env`,
`~/.config/ovh/aphrody.conf`) -> the legacy application key triplet (unchanged). Other profiles are separate accounts and keep their own files.

```bash
aphrody ovh auth status [--json] [--profile <name>]
```

Prints the effective mode (`oauth2_client_credentials` or `application_key`), endpoint, credential
source (path, never values), account and identity from `GET /auth/details` (the client id inside
the identity URN is masked). Secrets never appear in errors or logs.

**Known limit (checked 2026-10-05)**: the legacy `/service/{id}/renew` routes answer HTTP 403 to
the service account. `services renew`, `domain renew` and `vps renew` therefore fall back to the
application key triplet of the profile for the renewal quote, order and payment (a note is printed
on stderr). If the profile has no triplet, the command fails with an explicit message.

## IAM: policy and resource groups

Policy `aphrody-automation` (identity of the service account, `allow: [{action: "*"}]`) applies
to the account resource `urn:v1:eu:resource:account:eu8427-ovh` and to the resource group(s)
`aphrody-all`. Limits: 10 resources per group, and an `account` cannot join a group.

```bash
aphrody ovh iam sync            # plan (read-only)
aphrody ovh iam sync --apply    # write groups, then the policy
```

`sync` lists `GET /v2/iam/resource`, keeps existing group memberships, drops resources that
disappeared, fills free slots with new ones and opens `aphrody-all-2`, `-3`... when a group is full
(the policy references the account plus the groups, at most 10 resources). Run it after ordering or
deleting a service. A policy already in sync is left untouched.

## Services of the account

```bash
aphrody ovh services [--json]          # GET /services then /services/{id}
aphrody ovh services watch [--days N] [--alerts-only] [--notify]
aphrody ovh services renew <serviceId|resource> [--period P1M|P1Y...] [--apply] [--pay]
```

`services` lists, for every product (domain, DNS zone, DNS anycast, email, VPS and options, IP,
Public Cloud project, vRack): service id, resource name, plan, state (resource/lifecycle),
expiration, renewal mode (`-` for options renewed with their parent) and scheduled deletion.

`services watch` exit code: `0` healthy, `1` alerts, `2` error. Alerts: expired, unpaid or
errored lifecycle; suspended resource; manual renewal expiring in `--days` days (default 14, the
`vps_alert_threshold_days` policy value) or already past; manual renewal mode; scheduled
termination at expiration; stopped VPS. Options without renewal mode and legacy free email domains
with a stale date never alert. `--notify` sends the report with
`aphrody notify --channel <slack|telegram|matrix>`: the channel is `APHRODY_OVH_NOTIFY_CHANNEL` or the
first one whose token is set (`SLACK_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `MATRIX_ACCESS_TOKEN`).

`services renew` takes a service id or an exact resource name; a name shared by several services
(a domain also owns a zone, an email and an anycast service) is refused with the candidate ids.
Without `--period` the first offer (shortest) is used. Same three steps as `vps renew`: quote,
`--apply` (order), `--apply --pay` (payment).

## Domains

```bash
aphrody ovh domain list [--json]
aphrody ovh domain info <domain> [--json]
aphrody ovh domain renew <domain> [--period P1Y|P2Y...] [--apply] [--pay]
aphrody ovh domain autorenew <domain> --on|--off [--apply]
```

`list`/`info` read `GET /domain` and `GET /domain/{name}` (state, expiration, renewal state,
DNSSEC, transfer lock, name servers; no contact data). `renew` quotes and orders through the
domain's `serviceId`. `autorenew` is a plan unless `--apply`; it sets the renewal mode with
`PUT /services/{serviceId}` `{"renew": {"mode": "automatic"|"manual"}}` (public schema
`services.json`) and re-reads the domain. DNS zones stay under `aphrody ovh dns`:

```bash
aphrody ovh dns export <zone> [--output <file>]   # BIND format
aphrody ovh dns backup --dir <dir>                # every zone as <dir>/<zone>.zone
```

## Commands

### List all VPS in the account

```bash
aphrody ovh vps list [--profile <name>]
```

### Inspect a VPS: state, IPs, billing, expiration

```bash
aphrody ovh vps info <service_name> [--profile <name>]
```

Example output for an expired VPS:
```
VPS: vps-203bea89
État: stopped
Modèle: VPS 4
Cluster / Zone: cl12 (os-sbg6)
Ressources: 4 vCPU, 12288 Mo RAM, 80 Go Disque
Service: expired (id 69570856), expiration 2026-10-01, renouvellement manuel, suppression à expiration: OUI
Service expiré: renouveler avec `aphrody ovh vps renew vps-203bea89`.
```

### Get operational status (ping, network up/down)

```bash
aphrody ovh vps status <service_name> [--profile <name>]
```

Returns `HTTP 460` and terminates with clear message if the service is expired.

### Renew a VPS

Three-step process: quote (dry run), order, payment.

#### 1. Get a quote (no financial commitment)

```bash
aphrody ovh vps renew <service_name> [--period P1M|P3M|P6M|P12M]
```

Default: `P1M` (1 month). Output shows price and renewal terms.

#### 2. Order (creates unpaid order, still cancellable)

```bash
aphrody ovh vps renew <service_name> [--period P1M] --apply
```

Returns order ID and payment URL.

#### 3. Pay the order (final step, financial commitment)

```bash
aphrody ovh vps renew <service_name> [--period P1M] --apply --pay
```

Uses the account's default registered payment method. If no default, selects the first available.

**Example sequence**:
```bash
# Dry-run: check price for 1 month
$ aphrody ovh vps renew vps-203bea89
Renouvellement P1M de vps-203bea89 (statut expired, expiration 2026-10-01): €29.99 HT, €35.99 TTC, services [69570852, 69570851]
[PLAN] Aucune commande créée. --apply commande, --apply --pay paie aussi.

# Create the order
$ aphrody ovh vps renew vps-203bea89 --apply
Commande 260903513 créée (€35.99): https://www.ovh.com/manager/#/orders/260903513

# Pay the order
$ aphrody ovh vps renew vps-203bea89 --apply --pay
Commande 260903513 payée avec le moyen de paiement 12345.
```

After payment, the VPS is reactivated within minutes.

### Start a stopped VPS

If a VPS is manually stopped (state: `stopped`) and the service is not expired, restart it:

```bash
aphrody ovh vps start <service_name> [--apply]
```

Dry-run by default; pass `--apply` to confirm.

### Reboot a VPS

```bash
aphrody ovh vps reboot <service_name> [--apply]
```

Hard reboot via OVH API. Dry-run by default.

### Manage deleteAtExpiration flag

By default, expired VPS are deleted if not renewed before the expiration date. To preserve
a VPS beyond expiration (e.g., for data recovery), disable this flag while the service is active.

#### Disable auto-delete on expiration (set flag to false)

```bash
aphrody ovh vps set-delete-at-expiration <service_name> --preserve [--apply]
```

#### Enable auto-delete on expiration (set flag to true)

```bash
aphrody ovh vps set-delete-at-expiration <service_name> --delete [--apply]
```

**Note**: This command fails with HTTP 460 if the service is already expired. Renew the service first,
then update the flag.

### Health check: expiration, state, flags, manual renewal

Monitor VPS health against policy thresholds:

```bash
aphrody ovh vps watch [<service_name>] [--alerts-only] [--notify]
```

Exit code:
- `0`: All VPS are healthy (no alerts).
- `1`: One or more VPS have alerts (expiry < 14 days, `deleteAtExpiration=true`, stopped state, manual renewal).
- `2`: API error.

Alerts reported:
- `Service expiré`: Service has reached expiration date.
- `Expiration dans N jour(s)`: Expiration in N days (alert threshold: 14 days).
- `Suppression à expiration: OUI (risqué)`: `deleteAtExpiration=true` set (data loss risk).
- `Renouvellement manuel (alerte requise)`: `automatic_renew=false` (requires manual action).
- `État: ARRÊTÉ`: VPS is stopped.

**Example**: Check all VPS for alerts
```bash
$ aphrody ovh vps watch --alerts-only
Alertes VPS détectées:

vps-203bea89
  ! Service expiré
  ! Suppression à expiration: OUI (risqué)
  ! État: ARRÊTÉ
```

**Example**: Check one VPS
```bash
$ aphrody ovh vps watch vps-203bea89
Alertes VPS détectées:
…
```

**Example**: Send alerts to configured channels (future enhancement)
```bash
$ aphrody ovh vps watch --notify
# Passes alert report to `aphrody notify` (channels configured in ~/.aphrody/notify.toml)
```

## Automated Monitoring

A systemd timer runs `aphrody ovh services watch --alerts-only --notify` daily at 07h00 UTC. The
unit reads `/etc/aphrody/ovh.env` (`OVH_CLIENT_ID`, `OVH_CLIENT_SECRET`) and the optional
`/etc/aphrody/notify.env` (notify channel tokens); the home directory is not readable (`ProtectHome`).
It replaces the former `aphrody-ovh-vps-watch` units: disable and remove those if installed.

**Service unit**: `/etc/systemd/system/aphrody-ovh-watch.service`
**Timer unit**: `/etc/systemd/system/aphrody-ovh-watch.timer`

**Install on VPS** (after deploying Aphrody CLI):
```bash
# Copy declarative units from the repository (no activation)
sudo cp tools/config/host/systemd/aphrody/aphrody-ovh-watch.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aphrody-ovh-watch.timer
sudo systemctl start aphrody-ovh-watch.timer

# Verify timer is active
sudo systemctl list-timers aphrody-ovh-watch.timer
```

**View logs**:
```bash
sudo journalctl -u aphrody-ovh-watch.service -n 50 -f
```

## Factory Tunnel: `vps-cargo` Build Pipeline

The Aphrody Cargo factory runs on the VPS (`/home/ubuntu/build`). The CI/CD tunnel
(`scripts/build/rust/vps-cargo.ts`) compiles heavy Rust builds remotely.

**If the VPS is expired**: The tunnel fails with no explicit error message. Check VPS status:
```bash
aphrody ovh vps status vps-203bea89
# → Error: VPS expired, renew with `aphrody ovh vps renew vps-203bea89`
```

**Tunnel config**: `tools/config/host/vps-cargo.json` (read-only, do not modify).

## OVH API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/vps` | GET | List all VPS services. |
| `/vps/{serviceName}` | GET | Inspect VPS hardware and state. |
| `/vps/{serviceName}/ips` | GET | List IP addresses. |
| `/vps/{serviceName}/status` | GET | Get operational status (ping, up/down). |
| `/vps/{serviceName}/serviceInfos` | GET | Billing state (expiration, renewal flags, serviceId). |
| `/vps/{serviceName}/serviceInfos` | PUT | Update renewal flags (deleteAtExpiration). |
| `/vps/{serviceName}/start` | POST | Start a stopped VPS. |
| `/vps/{serviceName}/reboot` | POST | Hard reboot. |
| `/service/{serviceId}/renew` | GET | List renewal periods and prices. |
| `/service/{serviceId}/renew` | POST | Create renewal order (dryRun=true) or order it (dryRun=false). |
| `/me/order/{orderId}/paymentMethods` | GET | Fetch payment methods. |
| `/me/order/{orderId}/pay` | POST | Pay an order. |
| `/auth/details` | GET | Authentication method, account and identities of the credential. |
| `/services`, `/services/{serviceId}` | GET | Every service: resource, plan, lifecycle, expiration, renewal mode. |
| `/services/{serviceId}` | PUT | Renewal mode (`renew.mode`), used by `domain autorenew`. |
| `/domain`, `/domain/{serviceName}` | GET | Domain inventory and registration state. |
| `/domain/zone/{zone}/export` | GET | BIND export of a zone (`dns export`, `dns backup`). |
| `/v2/iam/resource`, `/v2/iam/resourceGroup`, `/v2/iam/policy` | GET | IAM inventory (`iam sync`). |
| `/v2/iam/resourceGroup`, `/v2/iam/policy` (+ `/{id}`) | POST, PUT | Create or update groups and the policy (`iam sync --apply`). |

## Troubleshooting

### Q: VPS is expired and I need data recovery.

**A**: Renew the VPS immediately (it will restart), then disable the `deleteAtExpiration` flag
to prevent future automatic deletion:

```bash
aphrody ovh vps renew vps-name --apply --pay
# Wait a minute for the service to reactivate…
aphrody ovh vps set-delete-at-expiration vps-name --preserve --apply
```

### Q: `aphrody ovh vps start` returned an error after renewal.

**A**: The API endpoint requires the service to be active (not expired). Check billing status first:
```bash
aphrody ovh vps info vps-name
# If status is "expired", renew it first.
```

### Q: The systemd timer is not running health checks.

**A**: Verify timer is enabled and systemd is aware of it:
```bash
sudo systemctl status aphrody-ovh-watch.timer
sudo systemctl list-timers aphrody-ovh-watch.timer
```

If the timer is absent or inactive:
```bash
sudo cp tools/config/host/systemd/aphrody/aphrody-ovh-watch.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aphrody-ovh-watch.timer
sudo systemctl start aphrody-ovh-watch.timer
```

### Q: Profile/credentials not found.

**A**: OVH API credentials are read from the default profile (or `--profile <name>`).
See `aphrody ovh profiles` and the Aphrody Infra README for credential setup.

## References

- [Aphrody Infra README](../../products/infra/README.md)
- [OVH API Console](https://eu.api.ovh.com/console)
- [OVH VPS Public API Docs](https://api.ovh.com/console/#/vps)
- Public schemas: [services.json](https://eu.api.ovh.com/1.0/services.json),
  [domain.json](https://eu.api.ovh.com/1.0/domain.json), [iam.json](https://eu.api.ovh.com/v2/iam.json)
- OAuth2 token URLs: [python-ovh](https://github.com/ovh/python-ovh) and [go-ovh](https://github.com/ovh/go-ovh)
- [Systemd Timer Documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
