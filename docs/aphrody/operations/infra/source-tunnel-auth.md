# Source tunnel authentication

Observed on 2026-10-14. Aphrody Infra owns the host configuration and the
[private network declaration](../../../../infra/config/host/wireguard/cloudflare-private-network.json).

## Active server configuration

- Source uses the existing Gitea 28.1.0 service and `aphrody-dev` identity.
- Nginx maps original TCP peers in `10.200.77.0/24` to that identity. It overwrites
  client identity headers; the public Git alias always clears them.
- Gitea trusts the qualified Docker proxy gateway `172.18.0.1/32`, disables
  reverse-proxy API authentication and account auto-registration.
- Source HTTPS uses the issued Let's Encrypt certificate, with the existing
  Certbot timer, webroot and Nginx renewal hook. No local CA trust was installed.
- Cloudflare routes the full `/24` through the existing healthy dbfr
  tunnel. Its public ingress was preserved. The account profile includes exactly
  this private subnet by subtracting it from the old `10.0.0.0/8` exclusion.
- The new `aphrody-labs.cloudflareaccess.com` organization permits WARP enrollment
  only for `contact@aphrody.com`, authenticated as a Cloudflare account member.
  Gateway blocks other identities from the private subnet and overrides Source
  DNS to `10.200.77.1` for Gateway clients. Public DNS remains unchanged.

## Qualification and limits

Direct WireGuard requests from `.3` and `.4` return HTTP 200 for `/user/settings`;
the Windows `.4` response identifies `aphrody-dev`, including when a different
identity header is forged. Native Windows and Linux both validate HTTPS.
Public Source and Git requests with forged identity headers return HTTP 303
without an authenticated profile. Nginx validation and Gitea version/ENV
qualification pass. The initial post-recreation helper probe failed, but the
subsequent qualification passes without another container recreation; the
original failure cause is not proven.

Cloudflare route, profile, organization, enrollment policy and DNS rules were
applied through the Cloudflare MCP API and read back. The Windows device is enrolled;
client traffic through Cloudflare is not yet verified. Cloudflare One Client
2026.8.2110.0 is installed and its signed service is Running/Automatic. Native
Windows UAC authority was qualified through WinClean. Disk cleanup and SSD
reallocation passed; C: had 131,708,145,664 bytes free at final qualification.
The SSO registration completed asynchronously: managed=true and organization
`aphrody-labs`. WARP subsequently reported Connected but unstable, and private
Source HTTPS failed. Disconnecting WARP restored ordinary hostname HTTP 200
immediately. WARP is left disconnected pending coexistence qualification.
Peer `.10` did not respond to connectivity probes.
The whole CIDR is routed; every peer is not claimed reachable.

## Owned activation helpers

[`source-tunnel-auth.ts`](../../../../scripts/aphrody/tools/infra/source-tunnel-auth.ts)
provides separate ACME, proxy and Gitea authentication phases. It patches only
the live forge blocks and selected environment keys. It does not deploy the
source Compose storage migration or the pending product API include.
[`issue-source-certificate.sh`](../../../../scripts/aphrody/tools/infra/issue-source-certificate.sh)
reuses the existing certificate owner.
[`source-private-dns.ps1`](../../../../infra/config/host/windows/source-private-dns.ps1)
provides an alternative direct WireGuard hosts mapping only after real Windows
elevation, route and TLS qualification. It was applied: ordinary hostname
resolution returns `10.200.77.1`, and `/user/settings` returns HTTP 200 with
native TLS verification. This proves the direct WireGuard path.
