# Legacy: the Aphrody Bun fork archive

Everything under `docs/aphrody/` was written while the runtime was the Aphrody fork `aphrody-labs/bun`. The fork is abandoned (2026-10-29). Bun OS now runs on the unmodified upstream `bun` npm package:

- pin: `bun@1.4.4-canary.20261028.1` (the `packageManager` field of the root `package.json`)
- upstream commit (npm `gitHead`): `11c367163a4b`
- check: `bun --revision` prints `1.4.4-canary.1+11c367163`

Consequences for these documents:

- Fork-only commands do not exist on upstream Bun: `bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun bd` outside an upstream checkout, and others. Upstream has `bun check`, `bun lint`, `bun fmt` and `bun compile` (see `bun --help`).
- Fork-only modules and APIs are not available: `bun:windows`, `bun:linux`, `bun:nginx`, `Bun.Video` and similar.
- Release URLs, installers and container images of the fork (`github.com/aphrody-labs/bun/releases`, `ghcr.io/aphrody-labs/bun`) are not the source of the runtime any more.
- Markdown files here that name the fork or one of those commands carry a "Legacy fork notice" at the top. JSON, YAML and shell files cannot carry one and are history as well (for example `ecosystem/ecosystem.json`, `reference/upstream-bun/SOURCE.json`, `github/workflows/*.yml`).

Current instructions are in the root `README.md`, `START-HERE.md`, `GOAL.md`, `PLAN.md` and `AGENTS.md`.
