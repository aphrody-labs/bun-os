# Host environment: workstation and VPS

Environment, MCP and A2A client settings for the two Bun OS hosts. Repository sync is in [SYNC.md](SYNC.md), and the
A2A hub (server, identities, mailboxes) is in [A2A-AGENTS.md](A2A-AGENTS.md). Cleaned and verified on 2026-10-31.

## Runtime

| Host | Bun | Notes |
| --- | --- | --- |
| Workstation | `C:\Users\aphro\.local\opt\bun-upstream-canary\bin\bun.exe` | First `bun` on PATH (machine PATH). `~\.bun\bin\bun.exe` is a copy of the same canary, so the global-install shims there (`gcloud-mcp`, `firebase`, ...) also run upstream Bun. |
| VPS | `~/.local/share/bun-upstream-canary/bun-linux-x64/bun` | `~/.bun/bin/bun`, `~/.local/bin/bun` and `bun-canary` link to it; `bun --revision` prints `1.4.4-canary.1+11c367163`. |

The retired `aphrody-labs/bun` fork binaries (Windows `~\.bun\bin\bun.exe` 1.4.5, VPS `bun-1.4.6-debug`) are no longer
referenced. `BUN_BIN`, `APHRODY_BUN_BINARY` and `APHRODY_BUN_BIN_DIR` point at the canary. `BUN_OS_ROOT` is the
checkout: `C:\src\bun-os` on Windows, `~/src/bun-os` on the VPS.

Only feature flags that upstream Bun reads stay set: `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT`, `_HTTP3_CLIENT`,
`_FORCE_IO_POOL`, `_FORCE_WINDOWS_JUNCTIONS`, `_NO_ORPHANS` and `_VERBOSE_WARNINGS`, all set to `1`. Before adding a flag,
check that the canary reads it: `rg -a -o "BUN_FEATURE_FLAG_[A-Z0-9_]+" <bun binary>`.

## Removed as legacy

These must not come back:

- Fork-only variables: `BUN_MCP_*` (`bun mcp`), `BUN_VIDEO_FFMPEG` (`Bun.Video`), `BUN_BROWSER_PASSWORDS_FILE`,
  `BUN_LSP_*`, `BUN_PYTHON_*`/`BUV_*`, `APHRODY_BUN_CHECKOUT=C:\bun`, the `bun agent-plugin` marketplace
  (`bun@aphrody-bun` in Claude Code and Codex), and every `BUN_FEATURE_FLAG_*=0` (no-ops).
- Retired checkouts: `APHRODY_ROOT`, `APHRODY_MONOREPO_ROOT` and `APHRODY_PY_ROOT` (`C:\src\aphrody`, `C:\aphrody`,
  `~/src/aphrody`, all gone). The nushell `setup.nu` and the PowerShell `sccache-env.ps1` / `fleet-worktrees.ts` hooks
  went with them.
- Banned flows: `APHRODY_WORKTREE_FLEET_HOSTS`, `WORKTRUNK_MAX_CONCURRENT_COMMANDS`, the `git-wt` shell init, the bxc
  MCP and `BXC_*`, and the NTFS index Redis variables.
- Dead paths: `IECODE_*`, `NIE_FFI_PATH`, `NIERS_REPO`, `PROTOC_INCLUDE`, `GRADLE_HOME`, `EMSDK`,
  `BUN_STEAM_DEPOT_BIN`; empty variables (`CC=`, `CXX=`, `DOTNET_ROOT=` and similar); dead or duplicate user PATH
  entries.

Backups taken before the change: Windows `C:\Users\aphro\.aphrody\backup\` (`hkcu-env-*.reg`, `hklm-env-*.reg`,
`profiles-20261031\`, `codex-config-20261031.toml`, `claude-20261031.json`, `fork-bun-1.4.5\`), VPS
`~/.aphrody/backup/env-20261031/`.

## Profiles

- Windows: `Documents\PowerShell\*.ps1` (pwsh 7), `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`,
  `%APPDATA%\nushell\env.nu`, `~\.bashrc` and `~\.bash_profile` for Git Bash. The persistent values live in
  `HKCU\Environment`, and the profiles only add aliases and session helpers.
- VPS: `~/.bashrc` (versioned as `infra/config/host/shell/bashrc`) sources `~/.config/aphrody/host.sh` and
  `~/.config/aphrody/shell.sh`. `~/.profile` sources `~/.bashrc`. systemd user services get the A2A settings from
  `~/.config/environment.d/50-aphrody-a2a.conf`. `/etc/environment` keeps only Ghidra and the Vertex settings.

## MCP

`aphrody mcp` with no arguments is the stdio MCP server.

| Client | Server | Command |
| --- | --- | --- |
| Claude Code, workstation (user scope) | `aphrody` | `C:\Users\aphro\AppData\Local\Aphrody\bin\aphrody.exe mcp` |
| Claude Code, VPS (user scope) | `aphrody` | `~/.local/bin/aphrody mcp` |
| Codex, workstation | `[mcp_servers.aphrody]` | `aphrody.exe mcp` |
| Codex, VPS | `[mcp_servers.aphrody]` | `~/.local/bin/aphrody-mcp` with the hub settings in its env |

Other entries on the workstation:

- `plugin:iecode:nie` runs `ssh vps ~/.local/bin/nie mcp`.
- `plugin:re:re` runs `bun vendor/rea/scripts/rea.mjs mcp`. It needs a built `vendor/rea/dist`: build it on the VPS
  with `bun run build:cached` and copy `dist/` over. rea loads the fork-only `bun:windows` lazily, so it starts on
  upstream Bun.
- `gcloud` and `firebase` run the binaries that `bun add -g @google-cloud/gcloud-mcp firebase-tools` installed in
  `~\.bun\bin`, not `bunx`. They are disabled for this project.
- `deskvnc` was removed because its `dvv.exe` is gone.

To check the servers, run `claude mcp list`.

## A2A client

| Host | `APHRODY_A2A_HUB_URL` | `APHRODY_A2A_TOKEN_FILE` |
| --- | --- | --- |
| VPS | `http://127.0.0.1:8788` (the hub itself) | `~/.aphrody/private/a2a/bearer` |
| Workstation | `http://127.0.0.1:24888` | `C:\Users\aphro\.aphrody\private\a2a\bearer`, a copy of the VPS bearer whose ACL is restricted to the owner |

On the workstation, the user scheduled task **Aphrody A2A Tunnel** keeps
`ssh -N -L 127.0.0.1:24888:127.0.0.1:8788 vps` open. It starts at logon and restarts every minute. The default
workstation identity is `claude-windows`; set `APHRODY_A2A_PEER_ID` per agent topic. The old `23888` hub and its
`hub-tunnel` task are retired.

Round trip, tested on 2026-10-31:

```sh
# Windows
aphrody a2a peers
APHRODY_A2A_PEER_ID=windows aphrody a2a send --target env-cleanup "ping"
# VPS
APHRODY_A2A_PEER_ID=env-cleanup aphrody a2a inbox --ack
APHRODY_A2A_PEER_ID=env-cleanup aphrody a2a send --target windows "pong"
# Windows
APHRODY_A2A_PEER_ID=windows aphrody a2a inbox --ack
```

## Verification

`bun --revision`, `claude mcp list`, `aphrody doctor`, then the round trip above, on each host. `aphrody doctor`
reads the hub through `APHRODY_A2A_HUB_URL`, treats an absent winclean file mailbox as optional, and needs the
repository-root `ai.json`.
