# Bun OS workspace

One product: the unified Bun OS image (Android 17, ChromiumOS components, the COSMIC UI and the Bun OS Rust base, with
Gemini at the centre), shipped as a bootable image and as the WebOS session on aphrody.com. The single checklist is
[docs/PRODUCT.md](docs/PRODUCT.md); work that does not feed it is out of scope.

## Git

- `main` on GitHub `aphrody-labs/bun-os` is the only branch. Normal `git push origin HEAD:main`, never forced.
- One checkout per host (VPS `~/src/bun-os`, workstation `C:\src\bun-os`): no extra clones, copies or worktrees.
  Commit and push each coherent change as soon as it compiles; never leave uncommitted work behind. The sync saves
  leftover dirty state to `refs/wip/*` and fast-forwards. Details: [docs/ops/SYNC.md](docs/ops/SYNC.md).
- Commit as `aphrody-dev <contact@aphrody.com>`, without co-authors.
- Agents coordinate and help each other through `aphrody a2a` ([docs/A2A-AGENTS.md](docs/A2A-AGENTS.md)).
- Every recurring step (delivery, health, dependencies, the agent loop, nightly qualification) is automated:
  [docs/ops/AUTOMATION.md](docs/ops/AUTOMATION.md). Status: [aphrody.com/status](https://aphrody.com/status).

## Fleet

- Hosts, mesh, SSH and firewalls are declared once in `infra/fleet/fleet.toml` ([docs/ops/FLEET.md](docs/ops/FLEET.md)).
  Reach servers by name over the WireGuard mesh (`ssh vps`, `ssh dbfr`, `ssh prod`; `<host>-public` only for
  recovery); host keys are pinned, never `accept-new`. `bun infra/fleet/fleet.ts audit` must stay clean.
- Change a host by changing the repository and applying it (`fleet.ts apply-firewall`, sync, automation), never by
  hand edits on the host. Shenron (`dbfr`, `prod`) keeps its own release pipeline; the fleet owns access only.

## Build

- Builds and qualification run on the VPS in ordered stages ([docs/ops/BUILD.md](docs/ops/BUILD.md)); releases are
  built once and promoted by receipt ([docs/ops/DEPLOY.md](docs/ops/DEPLOY.md)); the workstation edits and syncs.
  Cargo goes through the build-lane wrapper and shared caches. Size lanes and compiler workers to use all available
  host CPUs; `BUNCC_SLOTS` and `CARGO_BUILD_JOBS` are operator controls, not repository ceilings.
- Runtime: upstream Bun canary `1.4.4-canary.20261028.1`. The `aphrody-labs/bun` fork is migrated: its additions
  live on as Bun OS plugins (`packages/bun-os-plugins`) running on upstream Bun.
- Quality: `bun check`, `bun lint`, `bun format` (repo wrapper with `bun-format.json`), `cargo check --workspace --locked`.
- Tools: Bun, the Bun OS plugins and CLIs, and Rust tools (`rg`, `fd`, `sd`, `nu`, `bat`, `eza`, `dust`, `procs`,
  `hyperfine`, `just`, `tokei`). PowerShell only where a Windows-only API needs it. Do not start WSL on the workstation.

## Code

- Rust first, iced/libcosmic for UI. Upstream projects (COSMIC, Redox, Rio, nushell, Obscura, Helium, Waydroid, ...)
  live in the repo as pinned, patched aphrody-labs forks and are built from source, never installed as binaries.
- One canonical owner per capability, one direct child per member under `crates/`, `packages/` and `apps/`.
- Keep every upstream license and notice, and first-party attribution.
- Product documentation in English. Resolve paths from the checkout or configuration, never hard-coded.

## Safety

- Credentials stay in the protected stores; never print them. Preserve `.local` stores, sessions, databases and model
  weights.
- Cloudflare account and domain changes go through the Cloudflare MCP.
