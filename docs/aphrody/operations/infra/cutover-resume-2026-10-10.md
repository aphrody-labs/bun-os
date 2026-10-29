<!-- SPDX-License-Identifier: Apache-2.0 -->
# Domain cutover resumption, 2026-10-10

Read-only observations on the native Windows owner workstation, around
00:27 Europe/Paris (2026-10-09 22:27 UTC). This receipt does not supersede
the concurrent Cloudflare catalog or claim provider activation.

## Registrar and delegation

Two fresh executions of `scripts/tools/infra/domain-cutover.ps1 -Action Plan`
returned zero effective DNS differences (28 OVH records, 25 Cloudflare records),
preserved mail, validated HTTPS and the assigned nameservers
`duke.ns.cloudflare.com` / `veda.ns.cloudflare.com`.
Both `a.gtld-servers.net` and `b.gtld-servers.net` returned authoritative
negative SOA proofs with zero DS records. OVH still returned
`disableInProgress`; Cloudflare was `pending`. The existing guard requires
OVH `disabled`, so no nameserver mutation was attempted. Recheck that status
before `SwitchNameServers`, then verify actual delegation and zone activation.
Checksum-backed plans remain in the protected Aphrody home, not in Git.

## SSH and public service routing

The installed capability owner `aphrody infra ssh exec --host vps|dbfr --cmd`
successfully executed fresh reads on both hosts. The previously reported
aws-lc crash was not reproduced by these commands; this does not qualify all
SSH code paths or establish that the underlying issue is fixed.

VPS has nginx listening on 80/443 and only `aphrody.com` in
`/etc/nginx/sites-enabled`; its site listens on `127.0.0.1:8083`.
DBFR has the actual downloads, fonts and bot listeners:

| Service | DBFR probe | Result |
| --- | --- | --- |
| downloads | `http://127.0.0.1:8797/health` | 200 |
| cdn/fonts | `http://127.0.0.1:8796/health` | 200 |
| bot | `http://127.0.0.1:4010/healthz` | 200 |

HTTPS probes to DBFR loopback with each public hostname through curl
`--resolve` failed hostname verification (exit 60, status 000). No TLS
validation bypass was used. `/etc/nginx/sites-enabled` does not exist there;
the live ingress owner still needs identification. The repository route
catalog declares these three upstream ports, but that declaration does not
prove correct host selection or a deployed public certificate.

Before proxying these names, prepare the existing Infra ingress/catalog
plan for the actual service host, qualify certificates, apply through the
owner and verify each public endpoint. Audit creator/admin/mcp/nie separately;
do not redirect them to unrelated services or reactivate retired workloads.

## Publication and remaining work

The existing npm batch had live Bun processes 24788, 39548 and 4124 during
this observation. Its publication log remained empty, last written at
00:12:30 local time. This is neither successful publication nor a terminal
failure. Do not restart while the original process remains live; inspect its
terminal result and registry versions before claiming completion.

Pending: registrar completion and NS switch; active Cloudflare delegation;
strict TLS, qualified web proxy records and HSTS; approved R2 custom domains;
public subdomain routing/TLS; final npm publication evidence. The Cloudflare
[custom-domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/create/)
is the provider contract for attaching R2 bucket domains; bucket credentials
alone do not establish public domain activation.

## Receipt validation

The repository `bun run docs:check --skip-ecosystem` failed on existing stale
generated documents: STATE.md, README.md, docs/README.md and documentation.json.
Concurrent owners already have edits in that documentation batch; this receipt
does not regenerate or take ownership of those files. The new receipt's local
script reference exists, and scoped whitespace/integrity checks pass. No engine
build is required for this documentation-only batch. Global docs closure remains
pending.

## Guarded web activation adapter (historical)

At the time of this observation, a PowerShell adapter filled the installed
Infra CLI's Cloudflare coverage gap. Plan was the default. It verified exact
owner account/zone identities and the apex A / www CNAME, read SSL/HSTS
settings and both qualified R2 buckets' custom domains, and probed the origin
directly using curl `--resolve` with normal certificate validation. Snapshots
and a checksum-verified second copy stayed under the protected home. The adapter
is no longer present in the selected checkout; Cloudflare operations now use
the Cloudflare MCP owner. The results below are a historical receipt, not a
current command or procedure.

The live plan at 22:30 UTC proved apex TLS/status `0 200` and www `0 301`.
Cloudflare still had SSL `full`, disabled HSTS, a pending zone and no custom
domains on either `aphrody-assets` or `aphrody-dist`. An explicit Apply attempt
was refused before any mutation because the zone was pending; a subsequent
Plan confirmed unchanged settings. PowerShell parser validation passed.
The active-zone mutation path is not yet live-qualified.

Once the zone is active, Apply sets SSL `strict`, proxies only the qualified
apex/www records, enables HSTS for 30 days without include-subdomains/preload,
and reads back the exact settings and changed records. It checks unrelated
records against the snapshot. These settings use the official
[zone settings API](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/edit/).
HSTS does not extend to broken subdomain origins. This adapter does not attach
R2 domains or repair service ingress; those remain separate required tasks.

DBFR ingress was identified through Docker mount inspection as
`aphrody-gateway-1`. Aphrody ingress must be delivered through the
existing release/catalog owner, preserving this gateway and its TLS store.

## Follow-up: VPS catalog and public WASM, 22:39 UTC

The concurrent owner delivered the VPS ingress catalog in `c1eb4deb5b`.
Live SHA-256 matches the complete repository bytes for both
`tools/config/host/nginx/aphrody/aphrody.com.conf` and
`tools/config/host/nginx/aphrody/os.aphrody.com.conf`, and for
`tools/config/host/nginx/snippets/aphrody-security.inc`.
VPS `nginx -t` passes; native `aphrody infra validate --json` reports zero
errors/warnings, 28 services and 12 routes. Native Aphrody Web snapshots of
apex and OS render the product interface. This supersedes the earlier
apex-documentation-only routing observation. The full Rust/WASM UI migration
still requires its own qualification.

The web activation plan now includes the exact OS A record alongside apex/www;
all three direct origin TLS probes pass. The zone remains pending, so no proxy,
strict-mode or Cloudflare HSTS activation is claimed.

The CLI-WASM parity test formerly invoked Unix `mktemp`/`mkdir` and did not await
fixture writes. It now creates isolated native temporary directories, awaits
all fixture writes, and cleans up each owned directory. With the installed
native `aphrody` explicitly selected, all 8 tests / 58 assertions pass, with
zero skip or failure. Scoped TypeScript, oxlint and oxfmt pass.

`scripts/audit/live-cli-wasm-browser.ts --out <new-directory>` stages the
existing typed facade and WASM plus a qualification page and hash manifest.
It never replaces an existing stage. `--url` verifies the three public payload
hashes, the WASM MIME and rendered command results through
`aphrody web browser snapshot`. The native browser's private-IP guard was
retained after its loopback refusal; no browser policy was bypassed.

The owner-authorized R2 subagent uploaded four new keys under an isolated
qualification prefix and verified S3/public byte parity. Independent root
execution of the verifier on the
[public qualification page](https://pub-2a25b78efa294362ad9d988bb2deffeb.r2.dev/qualification/cli-wasm/715b7713e6f6e62-2f97ff566b71/index.html)
returns `WASM_BROWSER_PASS`: module version 1.0.0, RAG ABI 1, actual JSON repair
and HTML-to-Markdown execution. Module: 2,994,287 bytes, SHA-256
`715b7713e6f6e6237bc17269a3e289dd49928ec4e0a118e88c99bb63c4683fe2`.
This proves public browser command execution, not complete OS frontend migration
or signed source provenance for the pre-existing module. The qualification
manifest states that provenance limit explicitly; it is not an official release.

The separately owned [R2 domain receipt](r2-domains-2026-10-10.md) records the
real provider rejection of pending-zone custom-domain attachment. No assets/dist
custom domain activation is claimed while that dependency remains unresolved.

The native registry owner `aphrody pkg remote-info --source npm --version`
was run for all 28 exact `ready` versions from the existing publication plan.
Twelve are now present (runtime-sdk, agent-browser, api, update, bun,
drive-client, eslint-plugin-m3, fuzzy, identity, m3-fonts, m3-react and
m3-codemods). Sixteen remain absent, including cli-wasm 0.1.4 and product
0.3.1; no registry query was unavailable. This qualifies registry presence,
not package installation or all-publication completion. Original publisher
PID 24788 is still live and its output file remains empty; it was not restarted.

## Autonomous guarded continuation

The native PowerShell 7 run reproduced an unavailable
`System.IO.Directory.SetAccessControl` method in the cutover and web activation
adapters. Both now use `Set-Acl -LiteralPath`; live plans pass in PowerShell 5.1
and 7, with inheritance disabled and only the owner/SYSTEM access rules.

`scripts/tools/infra/domain-cutover-loop.ps1` resumes the existing guarded
adapters every five minutes for at most 288 attempts. `-Once` runs one check;
mutation requires `-Apply`. An exclusive protected-state lock prevents duplicate
loops. A nameserver request is recorded before POST, so an interrupted request
is not silently repeated. The loop waits for disabled DNSSEC and both parent DS
proofs, then delegation, then applies strict/proxy/HSTS and the R2 domain adapter.
It waits for both R2 ownership and TLS to become active before public byte parity
and native Aphrody Web verification. Unexpected adapter errors stop the loop;
they do not weaken a guard or trigger repeated mutations.

The offline orchestration gate passes on PowerShell 5.1 and 7: pending DNSSEC
never mutates, resumed NS requests occur once, pending R2 TLS never completes,
ready R2 proceeds to verification, and a web apply failure prevents R2 apply.
The real `-Once -Apply` run remains `waiting-dnssec`, with no mutation.

Background execution uses a checksum-recorded copy of the four adapters in the
protected Aphrody home, preserving its behavior despite concurrent repository
changes. State remains under `tasks/domain-cutover-loop/state.json` in that home.
`infra-verified` covers the provider settings and R2 public content checks;
consumer URL migration, executable rebuilds and official WASM source provenance
remain separate delivery work in the R2 receipt. The loop does not claim them.

## Verified source and public archive consumer

An isolated clean checkout at `96378fceaf5e8680cc6ac17b07a5cbba75ed5fdd`
was built natively through `cargo-serial.ts --msvc`, with locked dependencies,
the WASM target and the declared `wasm-release` profile. The existing packager
converged at 2,994,287 optimized bytes: exactly the public harness module hash
above. This now supplies rebuild provenance for those bytes. The existing
stage pipeline froze and checked all four generated inputs before producing
the versioned cli-wasm 0.1.3 archive; no mutable shared checkout was built.

The R2 subagent published the archive, manifest, checksums and build provenance
under a new versioned prefix; see the [distribution receipt](r2-domains-2026-10-10.md).
Independent root public download matched archive SHA-256
`dd005dc0230bb70832ff3578be41a89dbe3951905e4668b35c8c7e07ba9fc299`.
Every extracted package payload matched embedded provenance. Both async and
sync archive loaders executed actual RAG ABI, JSON repair, HTML markdown and
usage-error checks (`ARCHIVE_CONSUMER_PASS`). Native Aphrody Web also passed
the byte-identical rebuilt module/facade on the public qualification page.

The clean checkout's global test bootstrap initially failed because its
Happy DOM dependency was not installed; no clean-workspace installation gate
is claimed. The configured owner workspace's real native parity recheck then
exceeded Bun's five-second test default under load. Its integration timeout is
now sixty seconds for the sixteen native startups; all output checks remain,
and native exit codes are compared exactly rather than mapping arbitrary
crashes to usage errors. The rerun passed all eight tests / 58 assertions,
with no skips. Scoped TypeScript, oxlint, oxfmt and whitespace gates pass.

Publisher PID 24788 subsequently ended with `EXIT 124`. At the last complete
registry recheck, fourteen of the twenty-eight exact target versions were
present, with no unavailable queries. A separate concurrent publication
session resumed the work; it was preserved rather than duplicated. This
distribution receipt does not claim npm lot completion or OS UI migration.

The focused live OVH task API check found exactly one `DnssecDisable` task:
`719853951`, created 2026-10-09 22:22:03 UTC, status `doing`, with no completion
date. `canRelaunch`, `canCancel` and `canAccelerate` are all false. The declared
guard therefore continues waiting; no retry, cancellation, acceleration or
nameserver update was applied. The autonomous loop remains alive and its
second check still reports `waiting-dnssec` / Cloudflare `pending`.

The activation adapter now also exposes a read-only `Verify` action. Completion
requires live public TLS/status, Cloudflare edge identity, the declared HSTS and
nosniff response headers, the exact www redirect, and native Aphrody Web product
snapshots for apex/OS. The loop calls it before final R2 verification. Both
PowerShell orchestration gates pass, including an injected public-web failure
that prevents completion. The real pending-zone call refuses before public
verification; successful edge checks remain dependent on delegation/activation.

At 2026-10-09 23:02 UTC, the concurrent publisher's fourteen Tauri plugin
`3.0.0-alpha.5` producers were independently checked without source changes or
publication. Two consecutive native `bun pm pack --ignore-scripts` operations
per producer wrote only isolated qualification directories. All fourteen
archive pairs had identical SHA-256, and every package manifest was unchanged
across its pair. This does not reproduce per-pack nondeterminism on the current
inputs; it does not prove registry byte parity or publication completion.

## Native downloads publication, 2026-10-10

The cataloged native VPS publisher now copies qualified prebuilt payloads through
`node:fs`, removing its local dependency on Unix `cp`. Strict scoped TypeScript,
oxlint and oxfmt pass; all eighteen publisher tests / 160 assertions pass on the
isolated VPS qualification snapshot. Four native Windows host/stage checks also
pass on the installed fork `1.4.3-aphrody.4`.

A read-only plan retained all eleven non-WASM artifacts and increased retention
to six, preserving all five prior releases. The owner publisher then atomically
selected `20261009T232000Z-wasm-96378fceaf5e`. Installer assets came from clean
revision `1fa784f0b362ce9c4c6499237dbe85c65898fe2b`; only the WASM artifact group
was replaced. No service implementation was overwritten.

Independent public verification found twelve artifacts, with every inherited
name, SHA-256 and size unchanged. The [published WASM archive](https://downloads.aphrody.com/releases/20261009T232000Z-wasm-96378fceaf5e/files/aphrody-cli-wasm-0.1.3-96378fcea-wasm32-unknown-unknown.tar.gz)
matched 1,207,705 bytes and SHA-256
`dd005dc0230bb70832ff3578be41a89dbe3951905e4668b35c8c7e07ba9fc299`.
Its exact eight-file allowlist and embedded provenance passed. Both loaders
executed actual RAG ABI, JSON repair, HTML markdown and usage checks, returning
`ARCHIVE_CONSUMER_PASS`. Native Aphrody Web also read the public release manifest.
This qualifies this archive and catalog publication; other release artifacts
retain their original versions and qualification limits.

## npm visibility correction, 2026-10-10

The former publisher ended with EXIT 1. Its staged labels for agent-browser
1.0.0-canary.4 and plugin-log 3.0.0-alpha.5 were contradicted by live public
registry metadata. A read-only owner publisher recheck matched both local
archives to registry SHA-1 and reports current. Timestamp-only metadata now
means unverified visibility, not owner approval; only an explicit staged npm
response establishes staging. Pending visibility and staged versions block
dependent publication and completion. Ten tests / 29 assertions, scoped strict
TypeScript, oxlint and oxfmt pass. No versions were changed or republished.

The same live recheck confirms changed-content blockers for discord-kit,
m3-os-themes, timeline and web-to-tauri. The six m3 version violations
come from the actual root lockstep contract (3.3.9 versus selected 3.3.10
producers); committing alone cannot remove them. A coordinated family release
and dependency update is still required.
