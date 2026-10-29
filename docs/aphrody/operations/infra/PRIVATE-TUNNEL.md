<!-- SPDX-License-Identifier: Apache-2.0 -->

# Private WireGuard tunnel and Omar administrator access

> Autorité actuelle (2026-10-09) : Omar administre DBFR ; Yoyo / aphrody-dev administre tout Aphrody Labs. Les observations et accès historiques ci-dessous ne donnent pas une autorité plus large. La correction de déclaration ne prouve aucune modification des droits actifs.

The owner authorized deployment on 2026-10-07. SSH and WireGuard are active on VPS,
DBFR and WSL; MCP/A2A proxy units remain declared and were not activated by this batch.
The original 2026-10-06 observation remains in
`tools/config/host/inventory/private-tunnel-2026-10-06.json`.

## Verified activation on 2026-10-07

- Hub `51.77.147.152:51821`, VPN `10.200.77.1`; WSL `.2`, DBFR `.3`, Omar `.10`.
- VPS, DBFR and WSL have key-only `omar` accounts and validated root-owned sudoers.
  Real SSH sessions as `omar` from WSL to all three VPN addresses executed
  `sudo -n id -u` and returned `0`; existing host keys were checked strictly.
- VPS reports real WireGuard handshakes with WSL and DBFR. Omar's Windows peer is
  registered; its handshake remains zero until he activates his own private-key tunnel.
- Host private keys were generated on their own hosts, kept 0600, and never exported.
  The public hub key is `McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=`.
- Existing `wg0`, owner SSH access, databases, protected stores and foreign firewall rules remain.
  New rules admit private SSH to VPS/DBFR and route Omar SSH to WSL. No database ports
  were opened. The supplied shared SSH key is allowed from the authenticated VPN subnet
  as well as the declared public source; this allowed owner qualification from WSL `.2`.
- WSL required `wireguard-tools` and `openssh-server`; both were installed. Its SSH
  and `wg-quick@wg1` services, and both server VPN services, are enabled for boot.

Canonical fresh-install adapter: `python3 scripts/tools/apply-omar-private-access.py`
(plan), then `--apply`. It consumes the canonical generated plan, refuses an existing
interface/configuration and applies SSH/WireGuard only. An interrupted fresh install
requires inspecting the exact completed steps before continuing; do not remove keys
or reset a working tunnel to rerun it.

Omar keeps his own WireGuard private key and uses these public peer settings:

```ini
[Peer]
PublicKey = McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

Set his existing tunnel interface address to `10.200.77.10/32`. SSH targets are
`omar@10.200.77.1` (VPS), `omar@10.200.77.3` (DBFR), and `omar@10.200.77.2` (WSL).
No replacement client private key is generated or provided.

## What is declared

| Piece                                                                  | File                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tunnel (subnet, hub, peers, services, grants, firewall policy)         | `tools/config/host/wireguard/aphrody-tunnel.json`                                                                                                                    |
| Forwarders for the loopback services (template units, instance = port) | `tools/config/host/systemd/aphrody/aphrody-wg-proxy@.{socket,service}`                                                                                               |
| `omar` account: key file (root-owned), sudoers drop-in, sshd drop-ins  | `tools/config/host/{ssh/omar.authorized_keys,sudoers/omar,ssh/omar-sshd.conf,ssh/postgres-no-login-sshd.conf}`, `accounts` in `tools/config/host/catalog.json`       |
| Generator, checks, plan                                                | `packages/engine/core/src/host/wireguard.ts` (`wg-plan`, `wg-client`), tests in `packages/engine/core/test/host-wireguard.test.ts`, catalog checks in `checkCatalog` |

```sh
bun packages/engine/core/src/host/cli.ts check                      # catalog, tunnel and account checks
bun packages/engine/core/src/host/cli.ts wg-plan                    # the plan, nothing contacted
bun packages/engine/core/src/host/cli.ts wg-plan --observe          # + read-only preflight on vps, dbfr and the WSL
bun packages/engine/core/src/host/cli.ts wg-client omar             # client sections, no key
bun packages/engine/core/src/host/cli.ts wg-client omar --format paste --hub-public-key <K>
```

`wg-plan --observe` runs only `check`, `warn` and `info` steps of the preflight phase; a `mutate` step is never executed
(tested with a recording runner). The generated mutation steps are plain root shell text with public apply-time inputs
named in `needs`; the fresh-install adapter above executes the SSH/WireGuard subset.

## Network design

- **Interface `wg1`, subnet `10.200.77.0/24`, hub = vps, UDP 51821.** `wg0` is not usable: it is a pre-existing live link
  (vps `10.8.0.1/24`, dbfr `10.8.0.3`, `51820/udp` open to the world) and ufw holds `Anywhere on wg0 ALLOW IN`
  ("acces complet aux services VPS") plus an admin trust of `10.8.0.0/24` (all ports, PostgreSQL `pg_hba`, MCP
  and site admin lists). A guest on `wg0` would inherit all of it. The new subnet overlaps nothing declared
  (`10.8.0.0/24`, Docker `172.16.0.0/12`, Mullvad `10.64.0.0/10`, CGNAT `100.64.0.0/10`, `192.168.0.0/16`, link-local; checked
  by `checkCatalog` and by `subnet-free` on each host).
- Addresses: hub `.1`, WSL `.2`, dbfr `.3`, aphro-pc `.4`, omar `.10`, all `/32` on the peers; the hub lists each peer with
  `AllowedIPs = <peer>/32`.
- **Split tunnel only.** Every client has `AllowedIPs = 10.200.77.0/24` (never `/0`, enforced by the check and the
  generator), no `DNS` line, `PersistentKeepalive = 25`, endpoint `51.77.147.152:51821`.
- **Keys.** Each private key is born on its own peer (`wg genkey` into a `0600` file on a host, the WireGuard app on
  Windows) and never enters the repository, the plan or a report; only public keys are declared. omar =
  `EXfatxgVFs8Lr9k7QoJ2wiznY5MYO4C19+4gLbGmCEw=`, aphro-pc = `VewVolGGwY3Lvp78jp9dKB7RIxg2xUR2pbVS+y+uj2I=` (distinct).
  The key announced earlier for omar was withdrawn (private key lost) and appears nowhere. The hub, WSL and dbfr keys
  are generated at apply.
- **Routing.** The hub routes peer to peer (`ip_forward` is already 1; the apply persists it). No NAT, no `FORWARD`
  accept: forwarding is what the ufw `route` rules allow.

### Firewall

- Rules carry the comment `aphrody-wg-<peer>`. Pre-existing admin ufw rules are never deleted by this tunnel, and
  the tunnel subnet never enters ufw, fail2ban or `pg_hba` admin lists.
- UDP 51821 on the vps: one rule, `allow from 92.170.252.46 ... proto udp comment 'aphrody-wg-omar'` (Omar's address). No
  rule for the owner's workstation (WSL and Windows share its address) or for dbfr: both are already all-ports sources of the vps
  (verified 2026-10-06), and the WireGuard key is the authentication. `wg-plan --observe` re-checks it (`vps.workstation-coverage`).
- Tunnel access: `allow in on wg1 from <peer> to 10.200.77.1 port P` for vps services, `route allow in on wg1 out on wg1
  from <peer> to <host> port P` for services of another peer. dbfr needs no ufw change (22/tcp is already open). Nothing is
  ever opened for `5432` or `6379`.

### Who reaches what

| Service  | Where                  | omar    | aphro-pc | wsl | How                                                                          |
| -------- | ---------------------- | ------- | -------- | --- | ---------------------------------------------------------------------------- |
| ssh      | vps `10.200.77.1:22`   | yes     | yes      | yes | sshd listener                                                                |
| ssh      | dbfr `10.200.77.3:22`  | yes     | yes      | yes | routed by the hub                                                            |
| MCP HTTP | vps `10.200.77.1:8789` | pending | pending  | yes | vps reduced to the build machine on 2026-10-09; DBFR MCP serves the tunnel   |
| A2A      | vps `10.200.77.1:8788` | pending | pending  | yes | same, `status: pending` in the declaration                                   |
| training | WSL `10.200.77.2`      | pending | pending  | n/a | ports not declared anywhere: no rule is generated until the owner names them |

`aphrody-wg-proxy@<port>` is a stock `systemd-socket-proxyd` behind a socket bound to the hub address only (`FreeBind`,
`IPAddressAllow=127.0.0.0/8 10.200.77.0/24`, `DynamicUser`, exposure 1.6 by `systemd-analyze security --offline`). The
loopback units of `aphrody-mcp-http` and `aphrody-a2a` stay untouched and loopback. Other internal services (8798 gemma4, 8796, 8797) are not exposed: they belong to other lots, one grant line adds them.

## The `omar` account (vps and dbfr)

- `useradd` without password, no extra group (not in `sudo`, `adm`, `docker`, `postgres`), key-only: sshd drop-in
  `60-omar.conf` (`Match User omar`: `publickey` only, keys from the root-owned `/etc/ssh/authorized_keys.d/omar`, no
  forwarding, no tunnel, `GatewayPorts no`, `LogLevel VERBOSE` so the key fingerprint is journaled).
- The key line is `from="92.170.252.46,10.200.77.0/24",restrict,pty ssh-ed25519 ...`: his public address and his tunnel
  address (through the tunnel sshd sees `10.200.77.10`; only his WireGuard key can originate it). Dropping the second
  address forces the public path.
- **sudo**: `/etc/sudoers.d/omar`, one rule `omar ALL=(ALL:ALL) NOPASSWD: ALL` (no Unix password exists), validated by
  `visudo -c -f` before install. Journaling: both hosts run **sudo-rs** (`/usr/bin/sudo` is `/usr/lib/cargo/bin/sudo`
  0.2.13), which sends every command to syslog/journald (persistent on both hosts): `journalctl -t sudo | grep 'omar :'`.
  sudo-rs has no I/O log (`log_input`, `log_output`, `sudoreplay`); the classic `sudo.ws` is installed but not the default
  and is not switched here.
- **dbfr and postgres.** `omar` is in no postgres group, no ssh key exists for the postgres login, a dbfr-only drop-in
  adds `DenyUsers postgres`, `pg_hba.conf` and ufw have no entry for the tunnel subnet, nothing opens 5432 to the tunnel:
  the role is reachable by `sudo -u postgres` (journaled) only. Preflight checks cover each point.

## Findings that need the owner

1. **Shared ssh key (owner's choice, kept).** omar's key is the same pair as `~/.ssh/id_ed25519.pub` of the owner's PC
   (`SHA256:8G22L1q/zD3aUYPRqYNIuIQg7c0NWfofpXsaqZHuM/s`). sshd and sudo logs distinguish the two people only by the Unix
   login, never by key. **That public key is also a line of `/home/ubuntu/.ssh/authorized_keys` on dbfr** (observed
   2026-10-06; not on the vps): the holder of the private key can log in as `ubuntu` there (NOPASSWD sudo, no `from=`),
   which bypasses the omar restrictions, the per-user journal and the postgres sudo-only rule. Recommendation: a distinct
   key for omar, a one-line change of `ssh/omar.authorized_keys`. `wg-plan --observe` reports it (`key-not-on-other-logins`).
2. **`92.170.252.46` already holds an all-ports ufw rule** on vps and dbfr, hence `pg_hba` scram reachability
   of dbfr:5432 from that address: remove the address from that list for "no direct postgres access" to hold. The narrow
   `aphrody-wg-omar` rule keeps the tunnel working without it.
3. **MCP HTTP is unauthenticated** (`MCP-A2A.md`, finding 2): through the tunnel every tool, including `aphrody_mcp_call`, is
   open to the three granted peers. Port 8789 on the vps is also held today by the WSL compute reverse tunnel (sshd,
   `GatewayPorts yes`), so `10.200.77.1:8789` would reach the WSL MCP. `port-free.8789` fails until the owner frees or moves
   it. A2A runs in dry-run with no authentication layer.
4. **sudo-rs**: journal only, no session recording.
5. vps `sshd` keeps `PasswordAuthentication yes` and `PermitRootLogin yes` (`00-hardening.conf`): pre-existing, not changed
   here; omar is key-only through his `Match` block.
6. The installed `aphrody infra validate` cannot validate the catalog at this revision: `aphrody-creator` had no `unit`
   (fixed here with `unitSource: system-package`, `nginx.service`), and the route `creator.aphrody.com` uses a `static:`
   upstream that `crates/infra/infra/src/validate.rs` rejects ("upstream sans host:port"): open, a Rust change.

## Client side

The official WireGuard for Windows app **refuses to import a `.conf` that has no `PrivateKey`** (`conf/parser.go`: "An
interface must have a private key"), so a key-less file cannot be a one-click import and the key must be born in the app
("Add empty tunnel"). The generator therefore gives the sections, and a paste block that goes under the `PrivateKey` line
the app writes. Where a key file exists (the owner's PC), `--format conf --private-key-file F --out FILE` writes a complete
file, refused inside the checkout.

Client sections (no private key; `<HUB_PUBLIC_KEY>` is read on the vps after the apply with `sudo wg show wg1 public-key`):

```ini
# omar
[Interface]
Address = 10.200.77.10/32

[Peer]
PublicKey = <HUB_PUBLIC_KEY>
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

```ini
# aphro-pc
[Interface]
Address = 10.200.77.4/32

[Peer]
PublicKey = <HUB_PUBLIC_KEY>
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

### Guide pour Omar (5 lignes)

1. Installe l'application officielle WireGuard (wireguard.com/install) et ouvre-la.
2. Clique « Ajouter un tunnel » puis « Ajouter un tunnel vide... » : nomme-le `aphrody`.
3. Dans la fenêtre, garde les deux premières lignes (`[Interface]` et `PrivateKey = ...`) et colle sous elles le bloc de texte reçu (`aphrody-omar.txt`).
4. Clique « Enregistrer » puis « Activer » : le tunnel doit passer à « Actif ».
5. Pour couper : « Désactiver » ; ne partage jamais la ligne `PrivateKey`.

## SSH mesh (2026-10-08)

Owner directive of 2026-10-08: full SSH between the owner (`aphro-pc`, GitHub `aphrody-dev`), `vps`, `dbfr` and Omar
(GitHub `KyrioFox`, confirmed by the owner the same day; `tools/config/host/omar-admin.json`). Every link rides `wg1`
(`10.200.77.0/24`); nothing new is exposed publicly. Declared by the `ssh-*` services and grants of
`tools/config/host/wireguard/aphrody-tunnel.json` (new `ssh-omar`; grants `omar -> ssh-aphro-pc`,
`aphro-pc -> ssh-omar`, `dbfr -> ssh-vps`), which generate the routed ufw rules below. Record:
`tools/config/host/inventory/ssh-mesh-2026-10-08.json` (public keys only).

| Link                  | Alias (client)                                      | Login, key                                                        | State 2026-10-08                |
| --------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| aphro-pc → vps / dbfr | `vps`, `dbfr`, `vps-wg`, `dbfr-wg`                  | `ubuntu`, `id_ed25519_aphrody` (`aphrody-owner-pc`)               | tested                          |
| vps → dbfr            | `dbfr-wg` (vps `~/.ssh/config`)                     | `ubuntu`, vps `id_ed25519`                                        | tested                          |
| dbfr → vps            | `vps-wg` (dbfr `~/.ssh/config`), `aphrody-vps-wg`   | `ubuntu`, `aphrody_fleet_vps` (`aphrody-fleet:dbfr-vps`)          | tested                          |
| vps / dbfr → aphro-pc | `aphro-pc`                                          | `aphro`, `id_ed25519_aphro_pc`, `from=` the host's tunnel address | tested                          |
| omar → vps / dbfr     | `vps`, `dbfr` (Omar's config)                       | `omar`, `/etc/ssh/authorized_keys.d/omar`                         | waits for Omar's own key        |
| omar → aphro-pc       | `aphro-pc` (Omar's config)                          | `aphro`, `administrators_authorized_keys`, `from="10.200.77.10"`  | waits for Omar's own key        |
| aphro-pc → omar       | `omar-pc` (owner config, `User` from Omar's report) | `aphrody-owner-pc` / `aphrody-dev@github`                         | waits for Omar's sshd (step 12) |
| vps → omar            | `ssh -i ~/.ssh/id_ed25519_omar_pc`                  | `aphrody-vps-to-omar-pc`, `from="10.200.77.1"`                    | waits for Omar's sshd (step 12) |

- **vps / dbfr.** sshd listens on `0.0.0.0:22`. Omar's keys live in the root-owned `/etc/ssh/authorized_keys.d/omar`
  (the `AuthorizedKeysFile` of `Match User omar`, `60-omar.conf`); `/home/omar/.ssh` exists (`700 omar:omar`) for his
  client files only, sshd never reads an `authorized_keys` there. `/etc/sudoers.d/omar` is installed and passes
  `visudo -c`. ufw: `aphrody-wg-omar` input/route rules to `10.200.77.1:22`, `10.200.77.3:22` and now
  `10.200.77.4:22`; `aphrody-wg-aphro-pc` route to `10.200.77.10:22`; `aphrody-wg-dbfr` input to `10.200.77.1:22`.
  vps-originated traffic (to dbfr or Omar) needs no rule. `wg0` and existing admin rules are untouched.
- **aphro-pc.** OpenSSH Server (`ListenAddress 10.200.77.4`, key only, `AllowUsers edjez aphro`; `aphro` is an
  administrator, so keys come from `C:\ProgramData\ssh\administrators_authorized_keys`, ACL Administrators + SYSTEM
  only). sshd was stopped: it still depended on the retired `WireGuardTunnel$aphrody` service; the dependency was
  removed, start type is delayed automatic and recovery restarts it after 10 s / 30 s / 60 s (the bind to
  `10.200.77.4` fails until the scheduled task `\Aphrody\Aphrody WG aphro-pc` brings the tunnel up). The interface
  profile is Public while the stock `OpenSSH-Server-In-TCP` rule is Private-only, so the rule
  `Aphrody-SSH-In-Tunnel` (group `Aphrody tunnel`, any profile, local `10.200.77.4`, remote `10.200.77.0/24`) admits
  the tunnel. The GitHub keys `github_aphrody_dev` (`Host github.com`) and `github_aphrody_code`
  (`Host github-aphrody-code`) were copied from the hosts into `~/.ssh` and loaded in `ssh-agent`; sleep and
  hibernation are off.
- **Omar's key.** `github.com/KyrioFox.keys` is empty; step 12 of [OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md)
  has his Codex generate an ed25519 pair and post the public line in the admin channel. The owner then runs
  `~/.aphrody/run/install-omar-ssh-key.ps1 '<public line>'` (elevated PowerShell 7 on aphro-pc, idempotent): it appends
  the key with the declared `from="92.170.252.46,10.200.77.0/24",restrict,pty` options to
  `/etc/ssh/authorized_keys.d/omar` on vps and dbfr (backup `*.before-kyriofox-<stamp>`) and with
  `from="10.200.77.10"` to the aphro-pc administrators file, then the line is declared in `ssh/omar.authorized_keys`.
  The shared `windows-aphro` key stays until the owner removes it.
- **Rollback.** Hosts: `ufw delete` the two routed `:22` rules to `10.200.77.4` / `10.200.77.10`, drop the key line;
  aphro-pc: `Remove-NetFirewallRule -Name Aphrody-SSH-In-Tunnel` and `Stop-Service sshd`; client configs keep
  `*.before-ssh-mesh-20261008` backups.

## Remote control: one target model (2026-10-08)

`aphrody infra remote` (`crates/infra/infra/src/remote.rs`) drives every remote-control channel through one target
model and one credential store, both in `aphrody-remote-desktop`:

- **Targets** (`src/target.rs`): `local`, `mcp-http`, `vnc`, `ws` (browser desktop), `shell`. A spec is a tunnel member
  (`omar`, `aphro-pc`, aliases `owner`, `hub`), `<member>-forward` / `<member>-tunnel` (loopback, declared port + 10000),
  `host[:port]` or a URL (`vnc://`, `rfb://`, `http(s)://`, `mcp://`, `ws(s)://`, `shell://`). Addresses and ports come
  from the declared services of `aphrody-tunnel.json` (compiled-in copy when no checkout is found); defaults: MCP 8793,
  desktop 8795, VNC 5900, shell 8790.
- **Credentials** (`src/tokens.rs`): environment variable, then `<aphrody home>/private/<member>/<file>`, then
  `<aphrody home>/private/<file>` (`APHRODY_HOME`, else `~/.aphrody`; outside any repository, mode 0600 on Unix).
  `remote`: `APHRODY_REMOTE_TOKEN` / `remote.token`; `mcp`: `APHRODY_REMOTE_MCP_TOKEN` / `mcp.token`; `vnc`:
  `APHRODY_VNC_PASSWORD` / `vnc.password`; `shell`: `APHRODY_OS_AUTH_TOKEN` / `shell.token`. Without a VNC password the
  server derives one from the remote token (SHA-256, 8 characters). Values are never printed, only their source.
- **Consumers**: `aphrody infra remote serve|status|open|connect|token`, the agent `computer` tool
  (`RemoteComputerTarget::resolve` and the bearer of `RemoteComputerBackend`, `VncComputerBackend`) and the MCP tool
  `aphrody_remote_vnc`. WinClean, OS and shell tools stay in their owner crates; they are reached through the
  `mcp-http` or `shell` target of a member.

### VNC (RFB)

`aphrody infra remote serve` also starts an RFB server (`rustvncserver` 2.2.1, Apache-2.0) fed by the same capture and
injection as the browser desktop (Windows SendInput, X11 XTEST). It binds the `--bind` address on port 5900 (`--vnc
<ip:port>` to change, `--no-vnc` to disable), never `0.0.0.0`, and admits loopback plus `--vnc-allow` (addresses, CIDRs,
`any`); the default allowlist is the members granted the `vnc-*` service bound to that address (`vnc-omar` admits `aphro-pc`,
`vnc-aphro-pc` admits `omar`). `vnc-omar` (`10.200.77.10:5900`) is granted to `aphro-pc`; the generated vps rule is:

```sh
ufw route allow in on wg1 out on wg1 from 10.200.77.4 to 10.200.77.10 port 5900 proto tcp comment 'aphrody-wg-aphro-pc'
```

Not applied by this change (plan before apply, see [OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md) section 2.8 for
the Windows rule). Any viewer works (`vnc://10.200.77.10:5900`, TigerVNC, RealVNC, Remmina); the native client is
`aphrody infra remote connect omar --screenshot shot.jpg [--click x,y] [--type text] [--key ctrl+s]`.
`aphrody infra remote status` aggregates the local capture backend, the `wg1` handshakes (alive below 180 s) and the
reachability of every declared desktop, VNC, MCP and shell service.

Limits: RFB VNC authentication is DES over the first 8 password characters, so the tunnel stays the security boundary;
the RFB stream is not encrypted outside WireGuard. `rfb-encodings` 0.1.7 is integrated under `crates/compat` with a
pixel-format fix (BGRA viewers had red and blue swapped), provenance in `tools/config/upstream-sources.json`.

## Bidirectional control and dev mesh (2026-10-09)

Owner decisions of 2026-10-09: full two-way control between Omar, the owner and both VPS, as many ports as possible.
Windows Defender and the Windows Firewall are disabled on purpose on both dev PCs; access control rests on the wg1
binding, the hub's routed ufw rules, bearer tokens and the VNC allowlist.

| Link            | Services                                                                                           | State 2026-10-09                      |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| aphro-pc → omar | `ssh-omar`, `ssh-omar-wsl` 2222, `remote-desktop-omar` 8795, `vnc-omar` 5900, `mcp-http-omar` 8793 | rules applied, waits for Omar         |
| omar → aphro-pc | `ssh-aphro-pc`, `remote-desktop-aphro-pc` 8795, `vnc-aphro-pc` 5900, `mcp-http-aphro-pc` 8793      | aphro-pc side serving, waits for Omar |
| vps → PCs       | `ssh-aphro-pc`, `ssh-omar`, `ssh-omar-wsl`, `mcp-http-aphro-pc`, `mcp-http-omar`                   | aphro-pc tested from the vps          |
| dbfr → PCs      | `ssh-aphro-pc`, `ssh-omar`, `ssh-omar-wsl` and the `dbfr-to-pcs` mesh                              | aphro-pc 22/445/8793 tested           |
| PCs → dbfr      | `mcp-http-dbfr` 8793 (aphro-pc), `ssh-dbfr`                                                        | aphro-pc tested (healthz, 401)        |

The `mesh` array of the declaration opens every port between members: `dev-pcs` (aphro-pc ↔ omar),
`pcs-to-build-hub` (aphro-pc, omar, dbfr → vps) and `dbfr-to-pcs`. `firewall.meshDenied: ["dbfr"]` forbids any
all-ports rule towards dbfr (PostgreSQL, Redis): it is reached only through named services, and the generator check
rejects a mesh that targets it. Rules from the hub itself are not generated (OUTPUT is allowed).

aphro-pc serves through self-healing scheduled tasks under `\Aphrody\` (logon trigger, 5-minute repetition, restart on
failure): `Aphrody Remote Desktop` (`aphrody infra remote serve --bind 10.200.77.4`, desktop 8795 and VNC 5900),
`Aphrody MCP HTTP` (aphrody-mcp `http` on loopback 8793 with the WinClean `computer_*` catalog, published on
`10.200.77.4:8793` by `netsh portproxy`) and `Aphrody WG aphro-pc`. From Omar: `aphrody infra remote open aphro-pc`,
`vnc://10.200.77.4:5900`, MCP `http://10.200.77.4:8793/mcp` with the bearer token handed over out of band.

The owner workstation's Windows Device Portal stays on port 50080. The VPS reaches it directly at
`http://10.200.77.4:50080` while wg1 is healthy, and through the durable loopback-only reverse SSH fallback at
`http://127.0.0.1:25080`. The `\Aphrody\Aphrody Device Portal Tunnel` logon task owns that fallback; no public VPS
listener is permitted.

Omar's PC also runs a WSL2 Ubuntu with its native OpenSSH: `ssh-omar-wsl` (`10.200.77.10:2222`, WSL networking
`mirrored`, no WireGuard inside WSL). Windows OpenSSH keeps port 22; setup and compatibility rules in
[OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md) section 2.9.

### Network map

`bun packages/engine/core/src/host/cli.ts net-env [--member M] [--probe] [--write [--ssh-config]]` renders the map of
the declaration (members, services, grants, mesh, reachable set of the member, hub rule count, probe results) as `NET_*`
variables between the `aphrody-net-map` markers of `<aphrody home>/private/network.env`. Only that block is rewritten;
the secrets around it are never read out or printed. `--ssh-config` mirrors `~/.ssh/config` into `SSH_CONFIG`. The
scheduled task `\Aphrody\Net Env Probe` refreshes it every 10 minutes on aphro-pc.

## Order, validation and rollback

`wg-plan` prints the sequence: owner's order, dbfr and WSL keygen, vps keygen and hub, ufw and forwarders, client start,
the `omar` account, Windows tunnels, verification. Each host has `verify` steps (interface up, UDP listening, forwarders
bound to the hub address only, handshakes, no ufw rule with an `Anywhere` source, effective `sshd -T -C user=omar`, `sudo -n
-l -U omar`, no direct postgres login) and one `rollback` step that removes only what this lot created (tunnel, units, the
`aphrody-wg` ufw rules, `omar` locked, grants removed; `wg0`, existing admin rules, the home directory and databases stay).

## Maillage ouvert sur tous les ports (décision du propriétaire, 2026-10-09)

Le propriétaire a ouvert tous les ports entre les membres du maillage wg1 (PC propriétaire, PC d'Omar et son WSL, vps, dbfr)
et le réseau Docker, sans ouvrir quoi que ce soit à Internet.

- vps et dbfr : règles ufw `aphrody-wg-mesh-all` (entrée depuis 10.200.77.0/24 sur wg1), `aphrody-docker-bridge-all`
  (entrée sur docker0), `aphrody-wg-mesh-forward`, `aphrody-wg-to-docker` et `aphrody-docker-to-wg` (routage wg1 et docker0).
- PC propriétaire : règles `Aphrody wg1 mesh (tous ports)` (entrée et sortie, 10.200.77.0/24, groupe Aphrody) ; Pare-feu Windows et
  Defender restent désactivés exprès.
- PostgreSQL et Redis de dbfr n'écoutent que sur loopback : ils ne sont donc pas joignables par le maillage ; ne les rebinde pas
  hors loopback (`firewall.neverOpen`).
- PC d'Omar et son WSL : ses ports se règlent de son côté (accord n°2) ; l'API Docker TCP 2375 du PC propriétaire écoute sur loopback
  seulement.
- Retrait : `ufw delete` des règles portant ces commentaires, `Remove-NetFirewallRule -Group Aphrody`.
