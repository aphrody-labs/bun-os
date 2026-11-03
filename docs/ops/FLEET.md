# Fleet: hosts, SSH and network

`infra/fleet/fleet.toml` is the only description of the Bun OS hosts. SSH access, pinned host keys, host firewalls
and the audit are generated from it by `bun infra/fleet/fleet.ts`. Change the TOML, regenerate, commit.

| Host          | Role                                                                                                                                   | Mesh           | OS           | Provider  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ | --------- |
| `vps`         | The single Bun OS host: build farm (`build.slice`) and production (`interactive.slice`: aphrody.com, api.aphrody.com, WebOS); mesh hub | `10.200.77.1`  | Ubuntu 26.10 | OVH       |
| `bunos`       | Retired 2026-11-03 (merged into `vps`); reachable until the subscription ends                                                          | `10.200.77.3`  | Ubuntu 26.10 | OVH       |
| `prod`        | Shenron (dragonballfr.com), fully migrated here, behind Cloudflare                                                                     | `10.200.77.5`  | Arch Linux   | Hostinger |
| `omar`        | Collaborator workstation (Windows), mesh client                                                                                        | `10.200.77.10` | Windows      | —         |
| `workstation` | Owner workstation (Windows): edits, syncs, drives the fleet                                                                            | `10.200.77.4`  | Windows      | —         |

`bun infra/fleet/fleet.ts hosts` prints the live table from the TOML.

## SSH

```sh
bun infra/fleet/fleet.ts ssh-config     # writes infra/fleet/generated/* and installs ~/.ssh/fleet/{ssh_config,known_hosts}
ssh vps | ssh prod                         # over the WireGuard mesh, strict host-key checking against the pinned keys
ssh vps-t                               # same host, attached to the persistent tmux session `main`
ssh prod-public                         # recovery path over the public address when the mesh is down
```

- `~/.ssh/config` starts with `Include fleet/ssh_config`; the path is relative to `~/.ssh`, so Windows OpenSSH,
  Git/MSYS OpenSSH and Linux OpenSSH all resolve it. Anything after the Include (GitHub, personal hosts) is kept.
- Every server is reached by its short name over the mesh. Host keys are pinned in `fleet.toml` and checked with
  `HostKeyAlias <name>`, so the mesh and public paths share one key and a key change is a reviewed commit, never
  `accept-new`.
- Windows OpenSSH cannot multiplex (no Unix sockets); the Unix variant (`ssh_config.unix`) adds
  `ControlMaster auto` and `ControlPersist 10m`.
- One identity per operator (`~/.ssh/id_ed25519_aphrody`), `IdentitiesOnly yes`, `BatchMode yes`: an agent never
  hangs on a password or host-key prompt.
- Restricted keys (rrsync pulls, backups) use `from="<mesh address>",restrict,command="..."` in
  `authorized_keys`; they never rely on a public address.

## Network

- **Mesh**: WireGuard `wg1`, `10.200.77.0/24`, hub `vps` (UDP 51821). Clients route the whole /24 through the hub;
  the hub forwards `wg1 -> wg1` through `fleet-mesh-forward.service` (Docker's `DOCKER-USER` chain, because Docker
  sets the iptables `FORWARD` policy to `DROP`).
- **Firewall**: one nftables table, `inet fleet`, generated per host (`bun infra/fleet/fleet.ts firewall <host>`)
  and loaded by `fleet-firewall.service` from `/etc/fleet/firewall.nft`. Only the public interface is filtered:
  mesh, loopback and container bridges are trusted; the fleet's own public addresses are trusted; everything else
  reaches only `public_tcp`/`public_udp`. It coexists with Docker's iptables-nft tables and replaces ufw (retired on
  2026-11-03 on `vps` and `bunos`; `prod` had no firewall at all).
- **Public entry**: nginx on 80/443 (aphrody.com on `vps`, dragonballfr.com on `prod`) or Cloudflare tunnels.
  Services bind loopback or the mesh; a service listening on `0.0.0.0` is still unreachable from outside, but the
  audit lists it so it gets fixed at the source.

Apply a firewall change (a dead-man switch removes the new table after 180 s unless a fresh SSH session succeeds):

```sh
bun infra/fleet/fleet.ts firewall vps          # review
bun infra/fleet/fleet.ts apply-firewall vps    # stage, prove a fresh SSH session, commit, enable at boot
```

## One host for build and production

`vps` runs builds and production side by side. cgroup v2 keeps them apart (kernel `cgroup-v2.rst`,
`systemd.resource-control(5)`): `interactive.slice` (production) has CPU and I/O weight 1000 and `MemoryMin=8G`;
`build.slice` has weight 100, `MemoryHigh=34G`, `MemoryMax=38G` and `ManagedOOMMemoryPressure=kill`, so builds take
every idle CPU, yield 10:1 under contention, and systemd-oomd kills a build, never a production service, under
memory pressure. Off-site backups go to `prod` (another provider): `/srv/offsite/vps/`.

## Audit

```sh
bun infra/fleet/fleet.ts audit         # every managed host; exit 1 on any drift
bun infra/fleet/fleet.ts audit prod
```

It reports, read-only: OS and size against the TOML, mesh address, firewall loaded, legacy ufw or `wg0` still
present, public listeners beyond the declared ports, SSH password authentication, failed units and root disk use.

## Rebuilding a host from scratch

A host is cattle: its desired state is this repository, its data is backed up off-host. To reinstall one:

1. **Data first.** List the host's stateful paths (databases, object stores, `.local` stores, model weights) and
   copy them to another fleet host over the mesh; verify checksums. Nothing is reinstalled before that copy exists.
2. **Install the base OS** from the provider console (Ubuntu for build hosts, Arch for `prod`), with the operator
   key from `fleet.toml` as the only authorized key.
3. **Bootstrap**: user, sudo, WireGuard `wg1` with the address from `fleet.toml` (new keypair on the host; update the
   hub peer), then `bun infra/fleet/fleet.ts apply-firewall <host>`.
4. **Pin the new host key** in `fleet.toml`, run `ssh-config`, commit.
5. **Converge** the role: `vps` runs `bun factory/sync/install.ts` and `bun factory/automation/auto.ts install`
   ([SYNC.md](SYNC.md), [AUTOMATION.md](AUTOMATION.md)); Shenron hosts follow Shenron's own release pipeline.
6. **Restore data**, then `bun infra/fleet/fleet.ts audit <host>` must be clean.

## Recovery

- Mesh down: use `<host>-public`. If WireGuard on the hub is down, every mesh path is down; `vps-public` first.
- Locked out by a firewall: wait 180 s for the dead-man switch, or stop `fleet-firewall.service` from the provider
  console.
- Full `/home` on `vps` (btrfs metadata ENOSPC, 2026-10-29: SSH answered `Permission denied (publickey)` because
  `/home` was read-only): from the console, `mount -o remount,rw /home`, then `btrfs balance start -dusage=5 /home`
  (then `-dusage=20`), free derived data only (cargo targets, Docker build cache), check
  `btrfs filesystem usage /home` shows unallocated space, then fix `~/.ssh` modes (0700/0600) if StrictModes
  complains.
