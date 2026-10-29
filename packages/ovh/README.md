# @aphrody/ovh

Native in-process OVHcloud SDK for Aphrody Infra, built exclusively for **Bun** (`n2b` compliant, zero Node.js/CJS runtime dependencies).

## Capabilities

- **OAuth2 service account**: `OVH_CLIENT_ID` / `OVH_CLIENT_SECRET` (env), then `client_id` / `client_secret` of a profile file, then the application key triplet. The Bearer token is cached in memory, renewed 60 s before expiry and on HTTP 401; `getV2`/`postV2`/`putV2`/`deleteV2` target the IAM `/v2` base. Secrets never appear in errors or `JSON.stringify`.
- **Pure Bun Cryptographic Signature**: Uses `Bun.CryptoHasher("sha1")` conforming strictly to OVH `$1$` specification.
- **Automated Clock Drift Correction**: Automatically computes `/auth/time` server delta and retries on time drift.
- **DNS Management**:
  - Zones & records CRUD with typing (`A`, `AAAA`, `CNAME`, `MX`, `TXT`, `SRV`, `NS`, `SPF`, `DKIM`).
  - Automated batch `setA` for apex and `www` records.
  - Standard BIND zone export (`exportZone`).
  - DNSSEC audit and production subdomain verification (`auditZone`).
- **VPS Operations**:
  - Hardware specifications inspection (`vcore`, `memory`, `disk`, cluster, model).
  - Network IP routes and reverse DNS mappings.
  - Ping and live status check.
  - Guarded hardware reboot (`--apply`).
- **Email Deliverability**:
  - Domain email service plan and mailbox accounts.
  - Aliases and redirections management.
  - Deliverability Scorecard (`auditEmailDns`): checks MX (`mail.ovh.net`), SPF (`include:mx.ovh.com`), DMARC (`_dmarc`), and DKIM selectors (`ovhmo-selector-{1,2}`).
- **Profile Resolution**:
  - Native multi-account segregation (`aphrody.com` profile, extensible through profile files).
  - Multi-format parser: Bash exports (`.bash_secrets`), INI format (`.ovh.conf`), and Certbot (`dns_ovh_*`).

## Command line

The command line is the Rust Infra owner, `aphrody ovh` (same as `aphrody infra ovh`):

```bash
aphrody ovh profiles
aphrody ovh status --profile aphrody.com
aphrody ovh dns records aphrody.com
aphrody ovh dns audit aphrody.com
aphrody ovh vps list
aphrody ovh email audit aphrody.com
aphrody ovh auth status
aphrody ovh services watch --alerts-only --notify
aphrody ovh domain list
aphrody ovh iam sync [--apply]
```

Mailbox accounts, redirection creation/deletion and VPS backups are available only through this
TypeScript API (`email.listAccounts`, `email.createRedirection`, `email.deleteRedirection`,
`vps.getBackups`) until the Rust CLI covers them.

## TypeScript API

```typescript
import {
  OvhClient,
  OvhDns,
  OvhVps,
  OvhEmail,
  resolveCredentials,
} from "@aphrody/ovh";

const creds = await resolveCredentials("aphrody.com");
const client = new OvhClient(creds);

const dns = new OvhDns(client);
const audit = await dns.auditZone("aphrody.com");

const email = new OvhEmail(client);
const emailScorecard = await email.auditEmailDns("aphrody.com");
```
