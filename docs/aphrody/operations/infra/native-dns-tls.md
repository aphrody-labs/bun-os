<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native DNS and TLS rollout

Scope authorized by the owner on 2026-10-09: native product hosting on the VPS
and PC, with HTTPS and HTTP/2/3 qualification. The distinct public VPS name is
`vps.aphrody.com`. Preserve the existing `aphrody.com` apex and aliases on DBFR;
this operation does not migrate those production domains.

## Verified live inputs

- Native `aphrody ovh dns records aphrody.com --type A` reports apex, inacord and
  n2b targeting `51.255.162.6` (DBFR). No A for `vps` was present at inspection.
- The CNAME list includes admin, api, bot, cdn, creator, downloads, mcp, nie and
  www targeting `aphrody.com.`. No CNAME for `vps` was present. Preserve them.
- VPS nginx1.28.3 is built with OpenSSL3.5.5 and both `http_v2_module` and
  `http_v3_module`. The existing `/usr/bin/certbot` is installed. An unprivileged
  listing returned no readable certificate directories; this is not proof that
  no protected certificate store exists.
- PC `gateway` contains nginx1.31.6 with OpenSSL3.5.8 at runtime and both
  H2/H3 modules. Its Docker mapping currently publishes port80 only. A compiled
  QUIC module does not prove external UDP443 reachability or HTTP/3 negotiation.

The native Rust Infra nginx renderer supports configured certificate/key paths,
but the scoped existing Cargo/Infra source search found no native Rust ACME
issuance owner. Existing Certbot remains an installed historical capability,
not evidence that the new native site has a trusted certificate. No alternate
ACME client or duplicated provider-auth store was installed by this work.

## Owned native OVH orchestration

[aphrody-native-dns-tls.ps1](../../../../scripts/aphrody/tools/infra/aphrody-native-dns-tls.ps1)
uses the installed native Rust `aphrody ovh dns` owner for records, BIND export,
add, delete and refresh. It reads no provider secret value and copies no auth.
The installed CLI exposes a record table rather than a JSON flag; its parser
checks record IDs, types, names and TTLs and refuses unrecognized record rows.

Default/DryRun is a plan: it may read DNS but creates no directory, export,
state, record or refresh. Apply requires an explicit IPv4 target and a configured
absolute backup directory outside the repository. Before each DNS mutation it
exports the whole zone into that protected store, copies the export and compares
SHA-256, then writes the checksum ledger. Recovery retains those private backups;
do not stage them or include them in documentation.

The only supported hostname is this owned rollout's `vps.aphrody.com`. EnsureA
creates a new `vps` A record if absent. An existing exact match is unchanged;
any conflicting record refuses replacement. It never uses `set-a`, whose
defaults would include the production apex and www. Other DNS records remain
untouched; authoritative refresh is performed only after an owned mutation.

```powershell
# Resolve APHRODY_HOME from the configured current host; never copy its credentials.
$backup = Join-Path $env:APHRODY_HOME 'protected-backups/native-dns'
$state = Join-Path $backup 'vps-a.json'
pwsh scripts/tools/infra/aphrody-native-dns-tls.ps1 -Action EnsureA -IPv4 51.77.147.152 -BackupDirectory $backup -StateFile $state -DryRun
pwsh scripts/tools/infra/aphrody-native-dns-tls.ps1 -Action EnsureA -IPv4 51.77.147.152 -BackupDirectory $backup -StateFile $state -Apply
```

Applied on 2026-10-09: native OVH created A record ID `5440657070`,
`vps.aphrody.com` → `51.77.147.152`, TTL300, after the protected BIND export and
SHA-256 verified copy. A second Apply returned `unchanged` with the same ID.
Google Public DNS returned Status0, ADtrue, the new VPS address and TTL300;
a separate apex query still returned `51.255.162.6`. The native A record list
also preserved the original apex/inacord/n2b records.

This proves the record/refresh and that resolver's propagated answer, not every
resolver, ingress health or certificate issuance. The state records the
created ID for deliberate owner rollback; rollback must check that ID, name,
type and target still match and preserve the apex/aliases.

## Certificate lifecycle and DNS01

The same adapter implements scoped `PresentDns01` and `CleanupDns01` for
`_acme-challenge.vps`. The ACME owner supplies only the public base64url DNS01
digest and a unique protected StateFile; account/private keys stay in its
existing certificate store. The adapter creates no ACME account, signs no CSR
and performs no automatic certificate issuance. RFC8555 defines that separate
protocol owner: <https://www.rfc-editor.org/rfc/rfc8555>.

PresentDns01 preserves other TXT challenges. Existing exact TXT values remain
unchanged and do not establish ownership. Cleanup requires the persisted owned
record ID, hostname, type and exact digest to match current provider state; it
deletes only that record and refreshes after another verified zone backup.
Propagation and ACME authorization must succeed before challenge cleanup is
requested. Concurrent challenge owners need distinct state files.

Next integration: reuse or extend the qualified native ACME capability owner in
Infra, with protected account state, DNS01 via these native OVH operations,
SAN `vps.aphrody.com`, verification of the complete certificate chain, expiry and
renewal state, and atomic host-side certificate activation. No provider-auth file,
private key or raw session may enter the repository, build artifact or transcript.
Certificate paths are configurable metadata; do not print key contents.

## HTTPS, H2 and H3 are distinct gates

Rust product endpoints remain native; an existing nginx gateway can terminate
TLS for the same Rust upstream. The root site implementation owns any direct
Rust TLS/ALPN integration. Do not restore JS business servers for HTTPS.

For a qualified TLS gateway, configure its existing declared host route with the
actual certificate paths and HTTPS TCP443. H2 needs successful ALPN `h2`
negotiation. H3 needs QUIC UDP443, the built module, its explicit listener,
matching certificate/SNI, firewall/NAT reachability and a real H3 client request;
`Alt-Svc` alone does not prove negotiation. Nginx references:
<https://nginx.org/en/docs/http/ngx_http_v2_module.html> and
<https://nginx.org/en/docs/http/ngx_http_v3_module.html>.

PC gateway adaptation must preserve existing DBFR domains, mounts,
container identities and data stores. Adding TCP/UDP443 mappings usually requires
container recreation through its declared deployment owner; module support alone
does not authorize an ad hoc gateway replacement. The configured native Infra
gateway adapter owns this integration. Root/host owners qualify the preview and
protected backup before an apply. This DNS adapter does not mutate containers.

Pending acceptance: native trusted ACME issuance, certificate renewal/activation,
public SNI/chain/expiry checks, H2 ALPN and H3 UDP transport, and PC443 mapping.
Record each actual host result; no broad "HTTPS/H3 complete" claim follows from
DNS A creation, compile flags or an HTTP80 health check.
