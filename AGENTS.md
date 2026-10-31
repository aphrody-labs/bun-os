# Bun OS workspace

One product: the unified Bun OS image (Android 17, ChromiumOS components, the COSMIC UI and the Bun OS Rust base, with
Gemini at the centre), shipped as a bootable image and as the WebOS session on aphrody.com. The single checklist is
[docs/PRODUCT.md](docs/PRODUCT.md); work that does not feed it is out of scope.

## Git

- `main` on GitHub `aphrody-labs/bun-os` is the only branch. Normal `git push origin HEAD:main`, never forced.
- One checkout per host (VPS `~/src/bun-os`, workstation `C:\src\bun-os`): no extra clones, copies or worktrees.
  Commit and push each coherent change as soon as it compiles; never leave uncommitted work behind. The sync saves
  leftover dirty state to `refs/wip/*` and fast-forwards. Details: [docs/SYNC.md](docs/SYNC.md).
- Commit as `aphrody-dev <contact@aphrody.com>`, without co-authors.
- Agents coordinate and help each other through `aphrody a2a` ([docs/A2A-AGENTS.md](docs/A2A-AGENTS.md)).
- Every recurring step (delivery, health, dependencies, the agent loop, nightly qualification) is automated:
  [docs/AUTOMATION.md](docs/AUTOMATION.md). Status: [aphrody.com/status](https://aphrody.com/status).

## Build

- Builds and qualification run on the VPS ([docs/VPS-BUILD.md](docs/VPS-BUILD.md)); the workstation edits and syncs.
  Cargo goes through the build-lane wrapper, at most four compiler jobs per lane, shared caches.
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
