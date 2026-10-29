# OVH — accounts, zones, records and procedures

Measured on this VPS (`51.77.147.152`) on **2026-09-07** with `scripts/ops/ovh.py` (not in repo), `dig`,
`curl` and `openssl`; the OVH zone-list result was rechecked on **2026-09-29** after rotating
the local and VPS API credentials. Where this file and a plan disagree, this file is right.
[`docs/reference/infra/TOPOLOGY.md`](../TOPOLOGY.md) says what answers on which port; this one says
what DNS and the registrar hold, and how to change it without breaking mail or TLS.

> Update 2026-10-05: the Python script `scripts/ops/ovh.py` (not in repo) (kept as `py/tools/infra/scripts/ops/ovh.py` (not in repo)) was
> removed as superseded by the Rust CLI. Use `aphrody ovh dns <zones|info|records|add|delete|refresh|export|backup>`
> with `--profile <domain>` (see `aphrody ovh profiles`) in place of `--account`; `info` replaces `zone`. Writes keep
> requiring `--apply`. The command examples below are the measured 2026-09-07 procedure and keep the old
> script names for provenance.

## 1. Disjoint sets of zones per account

Confusing them is the single most expensive mistake here, because the failure mode lies:
**an account that cannot see a zone returns `404` on it, not `403`.** That reads as "this zone
does not exist" and sends you to the registrar instead of to the other key file.

| Account | Credentials file | Format | Nichandle | Zones it can see |
|---|---|---|---|---|
| `aphrody` | `~/.bash_secrets` | `export OVH_APPLICATION_KEY=…` (+ `_SECRET`, `OVH_CONSUMER_KEY`) | *(the `/me` call is not authorised)* | `aphrody.com`; API also currently lists `rpbey.fr`, which remains outside the managed profile |

The credential files are secrets: never print them, never copy a value into a document, a log or a
commit. `scripts/ops/ovh.py` (not in repo) reads them and prints only the answers.

The python `ovh` module is **not** installed and there is no plan to install it. Requests are
signed by hand:

```text
X-Ovh-Signature: "$1$" + SHA1(secret + "+" + consumer + "+" + METHOD + "+" + url + "+" + body + "+" + timestamp)
```

with `X-Ovh-Application`, `X-Ovh-Consumer` and `X-Ovh-Timestamp` alongside. `body` is the empty
string on a `GET`. Endpoint: `https://eu.api.ovh.com/1.0`.

## 2. The tool

`scripts/ops/ovh.py` (not in repo) — read-only by default; **every write requires `--apply`** and is followed
by a zone refresh, because a record created without a refresh is invisible to resolvers.

```bash
scripts/ops/ovh.py zones                        # aphrody account, the default
scripts/ops/ovh.py zone    aphrody.com          # SOA, nameservers, DNSSEC flag
scripts/ops/ovh.py export  aphrody.com          # the whole zone as a BIND file
scripts/ops/ovh.py records aphrody.com          # id, type, subdomain, ttl, target
scripts/ops/ovh.py add    aphrody.com CNAME foo aphrody.com. --ttl 300 --apply
scripts/ops/ovh.py delete aphrody.com 5432864457 --apply
scripts/ops/ovh.py refresh aphrody.com --apply
```

`records` prints the **record id**, which is the only handle a deletion accepts — there is no
"delete by name" in the API.

## 3. `aphrody.com` — the full zone

`dnssecActivated: true`, `hasDnsAnycast: true`, nameservers `dns200.anycast.me` /
`ns200.anycast.me`, SOA `2088787537`. **DNSSEC is on: never move this domain's nameservers
without disabling it first**, or resolution fails everywhere at once and no reload on this
machine will fix it.

Twenty-two records. Ids are stable and are the ones to use in a `delete`.

### Serving — eleven names, all of them ours

| id | type | name | ttl | target |
|---|---|---|---|---|
| 5432864457 | `A` | `@` | 300 | `51.77.147.152` |
| 5432881314 | `A` | `n2b` | 300 | `51.77.147.152` |
| 5432875215 | `CNAME` | `www` | 300 | `aphrody.com.` |
| 5432878735 | `CNAME` | `nie` | 300 | `aphrody.com.` |
| 5432875901 | `CNAME` | `api` | 300 | `aphrody.com.` |
| 5432877451 | `CNAME` | `cdn` | 300 | `aphrody.com.` |
| 5432877450 | `CNAME` | `mcp` | 300 | `aphrody.com.` |
| 5432878734 | `CNAME` | `bxc` | 300 | `aphrody.com.` |
| 5432875903 | `CNAME` | `downloads` | 300 | `aphrody.com.` |
| 5432877452 | `CNAME` | `bot` | 300 | `aphrody.com.` |
| 5432877453 | `CNAME` | `admin` | 300 | `aphrody.com.` |

**The invariant to preserve**, verified on 2026-09-07:

```text
DNS names  ==  nginx server_name  ==  certificate SAN  ==  11
```

Since 2026-09-28, `bot.aphrody.com` is an active Discord development endpoint
on the VPS, with a dedicated Nginx vhost and Certbot certificate at
`/etc/letsencrypt/live/bot.aphrody.com`. Its HTTP-01 renewal uses
`/var/www/letsencrypt`; the permanent port-80 vhost keeps that challenge path
available. The apex and bot certificates are managed separately.

The certificate `/etc/letsencrypt/live/aphrody.com` has `CN=aphrody.com` and exactly those
eleven `DNS:` entries; the four hosts with no block of their own (`downloads`, `bot`, `admin`,
`n2b`) are named on the shared `:8084` block at `conf.d/aphrody.com.conf:205`, not served by a
catch-all — a `server_name` continued on a second line is easy to miss with `grep`, use
`grep -Pzo` or read the block.

A twelfth name broke that equality: `ftp.aphrody.com`, a `CNAME` created by OVH with the domain,
with no vhost, no certificate coverage, no FTP listener, and not one mention in any repository.
**Deleted on 2026-09-07.** Restoring it is one call:
`scripts/ops/ovh.py add aphrody.com CNAME ftp aphrody.com. --ttl 0 --apply`.

### Mail and infrastructure — do not touch

| id | type | name | target |
|---|---|---|---|
| 5432868577 / …79 / …80 / …78 | `MX` | `@` | `1 mx0`, `5 mx1`, `50 mx2`, `100 mx3` `.mail.ovh.net.` |
| 5432864460 | `SPF` | `@` | `v=spf1 include:mx.ovh.com ~all` |
| 5432875905 | `TXT` | `_dmarc` | `v=DMARC1; p=none; adkim=s; aspf=s` |
| 5432868585 / …86 | `CNAME` | `ovhmo-selector-{1,2}._domainkey` | `…dp.dkim.mail.ovh.net.` |
| 5432868576 | `SRV` | `_autodiscover._tcp` | `0 0 443 zimbra1.mail.ovh.net.` |
| 5432864455 / …56 | `NS` | `@` | `dns200.anycast.me.`, `ns200.anycast.me.` |

Breaking any of these is **silent**: mail keeps being accepted and starts being filed as spam
elsewhere. Note the apex SPF uses OVH's legacy `SPF` record type, not `TXT` — a `dig TXT` shows
it because OVH publishes both, but the API lists it under `fieldType: "SPF"`.

## 4. The other zones

### `rpbey.fr` — no records

On 2026-10-09, on the owner's decision, its six `A` records (`@` twice, `www`, `api`, `cdn`, `play` → `51.77.147.152`) were deleted with `aphrody infra ovh dns delete`. The zone itself and the domain registration are untouched. No nginx, certificate, catalogue or profile entry references it.

## 5. Certificates — the OVH API is not in the loop

Every certificate on this VPS renews over HTTP, not DNS: `aphrody.com` uses
`authenticator = nginx` (and `installer = nginx`), as do the other hosts of
this VPS (some use `webroot`). **No renewal needs
an OVH key**, so a rotated API key cannot break TLS here.

Two consequences:

- The `return 308` on the apex does **not** break the ACME challenge — `certbot renew --dry-run`
  was green on all eleven `aphrody.com` names on 2026-09-07, verified rather than assumed.
- Adding a subdomain costs two things, not one: the DNS record **and** a certificate that covers
  it. That is why every arbitration on this domain reuses an existing host instead of minting a
  new one.

`certbot renew` reporting *"Another instance of Certbot is already running"* is a **lock**, not a
failure — typically your own backgrounded dry-run. Re-read the real run's output before
concluding anything.

## 6. Checking this file is still true

```bash
scripts/ops/ovh.py records aphrody.com
echo | openssl s_client -connect 127.0.0.1:443 -servername nie.aphrody.com 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
for h in aphrody.com www api mcp downloads cdn bot admin bxc nie n2b; do
    fqdn=$([ "$h" = aphrody.com ] && echo aphrody.com || echo "$h.aphrody.com")
    printf '%-24s %s\n' "$fqdn" "$(curl -sI --max-time 8 "https://$fqdn/" | head -1)"
done
```

The three counts must stay equal at **11**. If a `curl` returns `200` on a host you were about
to reuse, that host is **not** free: `cdn.aphrody.com` was serving `bxc-site` on `:8084` right
up to the day it was given to `nie-model-serve`.

## 7. Drift found on this machine

`/etc/nginx/sites-enabled/aphrody.com` still proxies the apex to `127.0.0.1:8083` — a port
nothing listens on, `aphrody-site.service` being `inactive` **and** `disabled`. It is inert:
`nginx.conf` includes `conf.d/*.conf` only and never reads `sites-enabled`. It is left in place
because deleting a file under `/etc` is outside this repository's scope, but it is the first
thing that will mislead the next reader of that directory.

`conf.d/` also holds twenty-odd `.bak-*` / `.avant-*` copies of vhosts. They do not load (they
do not end in `.conf`), and they are **not** backups of anything current — the versioned files
now under `tools/config/host/nginx/aphrody/` are. The 2026-09-07 verification compared
the then-versioned files byte-for-byte with the live `conf.d/aphrody.com.conf` and
`conf.d/bxc.aphrody.com.conf`; it establishes their state on that date.
