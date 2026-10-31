# A2A for the Bun OS agents

Every agent talks to every other agent through the `aphrody a2a` hub on the VPS. The hub is `aphrody-a2a.service`,
listening on `127.0.0.1:8788` (loopback only). Mailboxes are durable under `~/apps/aphrody/shared/coord`.

## Setup (already done on the VPS)

`~/.bashrc`, `~/.profile` and `~/.config/environment.d/50-aphrody-a2a.conf` export these settings for every shell and
user service:

```sh
APHRODY_A2A_HUB_URL=http://127.0.0.1:8788
APHRODY_A2A_TOKEN_FILE=$HOME/.aphrody/private/a2a/bearer   # protected 0600 file; never print it
APHRODY_HOST_ID=vps
```

The client reads the bearer token from the file itself. Do not copy the token into commands, logs, commit messages or
other files.

## Identity

Each agent has one peer id: its topic name. Set it on every call:

`blockers`, `sessions`, `android`, `googlebook`, `google`, `unified-image`, `rust-base`, `redox-cosmic`, `jvm-flutter`,
`aphrody-app-purge`, `fork-migration`, `discord-purge`, `store`, `emulators`, `bun-ui`, `architect`, `native-apps`,
`product`.

Shared channel: `help-wanted`. Post to it when you are blocked or need a hand. Read it when you have spare capacity.

## Commands (VPS shell)

```sh
export APHRODY_A2A_PEER_ID=<your-topic>             # once per shell, or prefix each command

aphrody a2a register                                 # check in (online for 3 minutes); prints your identity
aphrody a2a peers                                    # who exists and who is online
aphrody a2a inbox --ack                              # your messages, newest first, with read receipts to senders
aphrody a2a send --target <peer> "message"           # direct message to one agent
aphrody a2a send --target help-wanted "message"      # ask everyone
aphrody a2a inbox --id help-wanted                   # read the shared channel
```

From the Windows workstation, run the same commands over SSH (no tunnel and no token on Windows needed):

```sh
ssh vps 'APHRODY_A2A_PEER_ID=<your-topic> aphrody a2a inbox --ack'
ssh vps 'APHRODY_A2A_PEER_ID=<your-topic> aphrody a2a send --target <peer> "message"'
```

## Conventions

- Check in with `register` when you start, and read `inbox` between tasks.
- Commit and push small, coherent changes directly to `main` as soon as they compile. The shared checkout's sync saves
  any leftover changes to `refs/wip/<host>/<stamp>` (see [SYNC.md](SYNC.md)). If your work landed in a WIP ref, message
  its owner with the ref name.
- When a gate fails (`vps-gate/*` commit statuses, `~/.local/state/bunos-sync/gate.json`), the report names the commit
  and author. Message that owner directly, or post to `help-wanted` when nobody owns it.
- Keep messages short and actionable: what, where (path or ref), and what you need.

Verified on 2026-10-31: `blockers` sent a message to `help-wanted`, and `inbox --id help-wanted` returned it.
