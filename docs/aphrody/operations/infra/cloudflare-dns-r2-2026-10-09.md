<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cloudflare DNS and R2 readiness, 2026-10-09

Declared state: [tools/config/cloudflare/aphrody.com.json](../../../../tools/aphrody/config/cloudflare/aphrody.com.json).
Read-only parity audit: `bun scripts/audit/live-domain-dns.ts` (exit 0 = declared records match every nameserver set).
Domain qualification and the OVH plan: [domain-unification-2026-10-09.md](domain-unification-2026-10-09.md).

## Verified state

- Cloudflare account `ca22c1a5…` (owner `contact@aphrody.com`, plan Free Website) holds zone `aphrody.com`
  (id `963461271f885bc3f3c2bfd586f2b7ba`), status `pending`, nameservers `duke.ns.cloudflare.com`, `veda.ns.cloudflare.com`.
- 25 record sets imported from the OVH zone, all DNS only (`proxied=false`). The OVH export is kept at
  `~/.aphrody/backup/dns/2026-10-09/aphrody.com.zone` (sha256 `3a14c272…e1d8e`). The duplicate `resend._domainkey` row in the export
  is a single answer on OVH and is created once.
- Parity: the audit reports 0 diffs on the OVH nameservers and on both Cloudflare nameservers.
- DNSSEC enabled at Cloudflare, status `pending`: `DS 2371 13 2 7E73A5E0016202714CC58E56D2A4310062910D65BED2931CD9D7709453D3C871`.
- Live delegation is still the OVH registrar (`dns200`/`ns200.anycast.me`). Nothing public has changed.
- R2 (WEUR, default jurisdiction): `aphrody-m3-assets`, `aphrody-pet-assets`, `aphrody-vital-artifacts`. All private: r2.dev managed
  domain disabled, no custom domain, no CORS, default multipart lifecycle only. No repository code consumes these buckets yet.
- `~/.aphrody/config/cloudflare.env`: `CLOUDFLARE_ACCOUNT_ID` and `AWS_ENDPOINT_URL_S3` filled (identifiers, not secrets).
  `CLOUDFLARE_API_TOKEN` and the R2 S3 keys remain empty.

## Blockers (not resolvable in this session)

1. **Registrar scope.** The OVH application key returns `403 This call has not been granted` on `GET /domain/aphrody.com`.
   The nameserver change and the registrar DS cannot be applied. The zone API (`/domain/zone/*`) works.
2. **Cloudflare token.** The Cloudflare plugin session can read zones, records and R2, but cannot list permission groups
   (`9109 Unauthorized`), so it cannot mint an API token or R2 S3 keys.

## Cutover (run once blocker 1 is cleared)

Order matters: DNSSEC on OVH must be removed from the parent before the nameservers change, or validating resolvers return SERVFAIL.

1. OVH registrar: disable DNSSEC for `aphrody.com`. Wait until the `.com` parent no longer publishes DS `62047 8 2`
   (DoH `https://cloudflare-dns.com/dns-query?name=aphrody.com&type=DS` returns no answer; the TTL is 86400).
2. OVH registrar: set nameservers to `duke.ns.cloudflare.com` and `veda.ns.cloudflare.com`.
3. `bun scripts/audit/live-domain-dns.ts` must print `delegation (system resolver): cloudflare` and `0 diffs`.
4. OVH registrar: add DS `2371 13 2 7E73A5E0016202714CC58E56D2A4310062910D65BED2931CD9D7709453D3C871`.
   Confirm the DS at the parent and Cloudflare DNSSEC status `active`.
5. Rollback at any step: restore OVH nameservers and re-enable DNSSEC at OVH. The OVH zone is kept intact and is not deleted.

## R2 remaining

- Create an R2 S3 token scoped to the three buckets (Object Read & Write), write `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY` into `~/.aphrody/config/cloudflare.env`, and never print them. The token needs an owner
  dashboard action or a token with permission-group rights.
- Choose public access per bucket before any custom domain. `aphrody-m3-assets` and `aphrody-pet-assets` are not consumed
  by the repository; `cdn.aphrody.com` (dbfr nginx) already serves the shared static assets, so a second public origin
  would be a duplicate.

## Out of scope in this batch

- Orange-cloud proxying of web records: needs origin TLS and route parity first (dbfr nginx, certbot).
- `www` to apex redirect: nginx change on dbfr through the Infra catalog.
- Other zones on the OVH account (`rpbey.fr`)  and the other OVH profiles.
- `aphrody-infra ovh dns info` crashes on the `isSigned` field: owned by claim `domain-cloudflare-ovh` (`crates/infra/ovh/src/dns.rs`).
