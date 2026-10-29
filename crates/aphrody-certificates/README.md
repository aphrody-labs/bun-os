# Native certificate owner

`aphrody-certificates` issues DNS01 certificates exclusively for
`vps.aphrody.com`. OVH credentials remain in the existing native profile store.
No shell subprocess, certificate bot, account credential or PEM is printed.

## Qualification and use

Source API verified against the downloaded crates.io release `instant-acme
0.8.5`, specifically `examples/provision.rs`, `src/account.rs` and
`src/order.rs`; upstream reference:
<https://docs.rs/instant-acme/0.8.5/instant_acme/>.
Cargo check, unit tests, strict Clippy, main help and actual staging issuance
remain integrator gates. Production issuance must follow those gates.

Create an explicit protected directory outside the selected source checkout.
The owner restricts it and its generated files to owner/SYSTEM on Windows,
0700/0600 on Unix. Use separate staging and production directories so the
current certificate pointer cannot accidentally select a staging generation.

```text
aphrody-certificates --output <absolute-protected-directory> --workspace <absolute-checkout> issue --agree-tos
aphrody-certificates --output <absolute-production-directory> --workspace <absolute-checkout> issue --agree-tos --production
aphrody-certificates --output <absolute-production-directory> --workspace <absolute-checkout> renew --agree-tos --production
aphrody-certificates --output <absolute-production-directory> --workspace <absolute-checkout> inspect
```

Contact is `mailto:contact@aphrody.com`. Staging is the default. Production
requires an explicit flag; ToS agreement is always explicit. SAN scope cannot
expand to the apex or another name. Delay before challenge activation defaults
to 60 seconds; the delay is not proof of DNS propagation. Issuer validation is
the actual acceptance gate. Whole issuance is bounded to 900 seconds.

## Protected lifecycle

Reusable account credentials are saved separately per issuer. New certificate
generations hold `private-key.pem` and `fullchain.pem`; `current.json` selects a
completed generation and contains public metadata plus certificate SHA256.
Previous generations remain available for explicit rollback. Renewal submits a
fresh order; scheduling and expiry-based renewal policy remain Infra work.
Inspection validates chain checksum, not X509 validity dates or deployment.
On overwrite the previous content is backed up and checksum verified first.
Windows pointer replacement currently has a brief remove/rename gap: consumers
must retain the loaded generation, retry pointer reads and activate only after
both generation files exist. This is not an activation or atomic hot reload API.

Before each DNS mutation the owner exports and verifies the zone checksum.
Existing TXT values are preserved, including identical borrowed challenges.
Cleanup requires matching zone, subdomain, type, target and recorded record ID.
An issuance lock prevents concurrent runs in the same output directory. Process
crashes retain lock/receipts for manual review, never infer permission to delete.
There is an explicit pre-add intent because the existing DNS manager performs
refresh before returning the newly created record. Failure or interruption in
that window leaves an intent and fails closed until exact-ID reconciliation.
It never deletes a guessed record or removes unrelated TXT values.

No HTTPS listener, host firewall, proxy mapping, H2/H3 acceptance, automated
renewal service or certificate deployment is implied by successful issuance.
