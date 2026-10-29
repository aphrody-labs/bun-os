# Aphrody Discord plan

The executable blocker and release plan for the next autonomous session is
[`PLAN-DISCORD.md`](./PLAN-DISCORD.md). This page records the architecture
baseline and high-level migration sequence.

## Goal

Make this Bun/TypeScript monorepo the shared Discord framework and transport
source for Aphrody applications. Centralize reusable Discord protocol/runtime
code; keep bot commands, product policy, databases, and domain models in their
own applications.

## Completed baseline — 2026-09-28

- Ported the Aphrody AI common channel contract and Discord REST adapter to
  Bun-first TypeScript as `@aphrody/messaging`. It supports message/file sends,
  DM creation, room enumeration, and cancellable inbox polling; it has no direct
  runtime package dependencies. Its typecheck passes.
- Added this repository's shared architecture boundary and migration sequence
  to [`architecture/README.md`](../../architecture/discord/architecture/README.md).
- Configured and deployed `bot.aphrody.com` as the Carbon development example.
  The Gateway is healthy, the HTTP interactions endpoint is set, and `/ping`
  is registered in the test guild. Dedicated TLS renewal and automatic Nginx
  reload are configured and the Certbot dry run succeeded.
- Registered `https://bot.aphrody.com/oauth/callback` in the Discord
  application's redirect allowlist. Discord API readback confirms the URI is
  present, and `/oauth/login` responds with the expected `302` authorization
  redirect.
- Expanded Carbon's authorization-code/advanced-bot request to the documented
  standard scopes requested for the development app. Installation is pinned to
  the configured test guild and asks for permission bitfield `8` (Administrator);
  consent is forced so Discord displays newly requested scopes. Unsupported or
  approval-gated scopes and the distinction between consent and implemented
  capabilities are listed in [`carbon-oauth.md`](../../guides/discord/carbon-oauth.md).
- Deployed release `30f49b8913c01ef5cbc92e7ff557e757e20b776e`. Live checks
  confirm `/healthz` reports Gateway readiness and `/oauth/login` returns 302
  with the expected scopes, test guild, `permissions=8`, `integration_type=0`,
  consent prompt, state parameter, and state cookie.

OAuth login is now enabled. Re-register the callback in Developer Portal →
OAuth2 → Redirects when creating or replacing the Discord application; the bot
API cannot change that redirect allowlist. The app reports missing registration
instead of starting a broken OAuth flow.

## Next work

1. Stabilize the public contracts and package exports in `@aphrody/messaging`;
   add focused mocked-Fetch checks for Discord REST behavior and error handling.
2. Implement shared lifecycle packages for Discord REST rate limits, Gateway
   reconnect/readiness/sharding, signed HTTP interactions, command registration,
   and health contracts. Make Gateway vs HTTP interaction delivery an explicit
   per-application mode.
3. Add thin adapters for selected upstream frameworks. Reuse maintained
   Discord.js/DiscordX capabilities instead of maintaining parallel REST or
   Gateway implementations.
5. Add import-boundary and dependency-duplication checks; migrate old entry
   points through temporary facades, then retire duplicate clients.
6. For each consumer, require Bun typecheck/lint, package export validation,
   focused adapter tests, and a test-guild smoke run before publishing shared
   package versions.
7. Build the OAuth capability layer that consumes authorized scopes: persist
   and revoke user grants safely, retain incoming webhook credentials in a
   protected store, and implement the corresponding API operations. The current
   callback only fetches and displays the profile; a requested scope is not
   evidence that its capability has been implemented.

## Boundaries

- Never copy secrets, app `.env` files, or production database access into this
  framework repository.
- Do not infer that NIE `main` contains a current Wonderbot implementation; the
  audit found the published package to be historical and not reproducible from
  its manifest alone.
- Keep HTTP interactions signature-verified and mutually exclusive with
  Gateway-delivered interactions for the same Discord application.
- Keep DNS, certificates, Nginx, systemd, releases, and VPS state owned by
  [`aphrody-infra`](https://github.com/aphrody-labs/aphrody).
