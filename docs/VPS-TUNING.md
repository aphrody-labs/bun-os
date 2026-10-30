<!-- SPDX-License-Identifier: Apache-2.0 -->

# VPS low-level tuning

The VPS runs Ubuntu 26.10 on kernel 7.3, with 12 Haswell vCPUs, 45 GiB of RAM and no GPU (OVH KVM). Its whole configuration
is host config under `infra/config/host/`. Two idempotent scripts apply it from the VPS checkout. They never reboot
and never restart other services:

```bash
infra/config/host/vps/tuning/apply.sh      # kernel, sysctl, udev, THP/KSM, systemd, Docker, nginx, firewall
infra/config/host/systemd/slices/apply.sh  # interactive.slice / build.slice priority classes
```

`apply.sh` backs up every file it replaces under `/var/backups/aphrody/vps-tuning-<ts>/`, and `/etc/nginx` as
`/var/backups/aphrody/nginx-<ts>.tar`. If `nginx -t` fails, it restores that backup.

## Kernel and virtualisation (`vps/tuning/etc`)

- Modules (`modules-load.d/aphrody-vps.conf`): `kvm_intel` (nested=1), `vhost_net`, `vhost_vsock`, `vsock`,
  `macvtap`, `binder_linux`, `vkms`, `tcp_bbr`, `sch_fq`, `zram` and `ntsync`. `tun`, `udmabuf` and `memfd` are built in.
  `modprobe.d` sets `softdep vkms pre: cirrus_qemu`, so the Cirrus VGA stays `/dev/dri/card0` for Hyprland and vkms
  takes card1. `kvm ignore_msrs=1` is set for Windows and macOS guests.
- binderfs is mounted at `/dev/binderfs` by `aphrody-binderfs.service`. ashmem left the kernel in 5.18; redroid 17
  uses memfd. The running 7.3 kernel is kept: no LTS kernel is needed for Android, because NetBpfLoad's LTS check only
  logs. `kernel.unprivileged_bpf_disabled` stays at 1 on the host.
- udev (`65-aphrody-vps.rules`): `/dev/kvm`, `/dev/vhost-net` and `/dev/vhost-vsock` are 0660 `kvm`. `/dev/udmabuf` is
  0666, for lavapipe and gamescope in containers. The disks use the `none` scheduler with 1 MiB read-ahead.
  `ubuntu` is in the `kvm`, `render` and `video` groups. `kvm-ok` passes and nested virtualisation is on.
- Docker containers reach KVM with `--device /dev/kvm`: the gamescope sessions pass it, and redroid and the emulator
  run privileged.
- Memory (`tmpfiles.d/aphrody-vps-mm.conf`): THP is `madvise`, defrag `defer+madvise`, shmem `advise`. KSM is on, with
  the scan-time advisor (200 s target, at most 30 % of one CPU) and `use_zero_pages`. hugetlb keeps a 512 × 2 MiB
  reserved pool plus 8192 overcommit pages. A fragmented live system allocates part of the pool; the rest comes at boot.
- Boot parameters (`default/grub.d/90-aphrody-vps.cfg`): `transparent_hugepage=madvise`. Mitigations keep the kernel
  default. cgroup v2 is the only hierarchy. The `user@.service` drop-in delegates cpu, cpuset, io, memory, pids,
  hugetlb, rdma and misc, which takes effect at the next user-manager start.

## sysctl and system

`sysctl.d/99-zz-aphrody-vps-tuning.conf` sorts last and wins over the older overlapping files. It is applied with
`systemd-sysctl`, because `sysctl --system` errors on the ignorable `-net.core.default_qdisc` line in `/usr/lib/sysctl.d`.

- Network: BBR with fq, somaxconn 65535, a 65536 backlog, rmem/wmem max 32 MiB (QUIC and WebRTC need at least 7.5 MiB),
  tcp_fastopen 3, tw_reuse, notsent_lowat 128 KiB, ports 10240–65535, no slow start after idle.
- Memory: swappiness 100 with page-cluster 0, because zram is the first swap tier. dirty ratios 5/10, overcommit 1,
  max_map_count 2147483642 (the SteamOS value, above the 1048576 Android needs).
- Files: file-max and nr_open at 4M, 2M inotify watches, 8192 instances. systemd uses DefaultLimitNOFILE 1048576
  (`95-aphrody-limits.conf`) and DefaultLimitMEMLOCK infinity, which applies at the next daemon-reexec or boot.
- zram: `zram-swap.service` provides 12 GiB of zstd (about 25 % of RAM) at priority 100, ahead of `/swapfile2`.
- No cpufreq on this KVM guest, so there is no governor to set. irqbalance and fstrim.timer are enabled.
- btrfs `/home` (sdb1 and sdc1) is already mounted `noatime,compress=zstd:1,discard=async,space_cache=v2`.
- journald: 500 MiB cap, 4 GiB kept free, 7-day retention. OOM: earlyoom only, with systemd-oomd off. It spares sshd,
  nginx, dockerd, containerd, bun and Hyprland, and prefers rustc, cc1plus and linkers.
- Docker (`infra/config/host/docker/daemon.json`): live-restore, `local` log driver (20m × 5), nofile 1M and unlimited
  memlock, the BuildKit GC keeping 40 GB, the containerd snapshotter on ext4 `/`, and the wasmtime runtime. It is applied with
  `systemctl reload docker`. Options that cannot be reloaded take effect at the next daemon start.

## Priority classes (`systemd/slices`)

- `interactive.slice` (CPU/IO weight 1000): nginx, the aphrody gateways, Hyprland, wayvnc, WebOS, store and site.
  Their drop-in `90-aphrody-interactive.conf` moves each unit into the slice at its next restart; the weights apply live
  now. Session containers (redroid, bunos-android, gamescope, auto-*, webos-db) get cpu.weight 1000 through
  `docker update --cpu-shares 17620`, which persists with the container. gamescope starts with
  `--cgroup-parent interactive.slice`.
- `build.slice` (weight 20): every 30 s, `aphrody-priority.timer` adopts build commands started from user sessions,
  with their descendants, into a transient scope of the slice. It also renices them to 10 and sets ionice best-effort 7.
  Build containers (buildx, bunos-native, helium) get cpu.weight 20 (`--cpu-shares 126`). These are weights, not caps:
  builds use every idle core.
- `aphrody-iocost.service` turns on blk-iocost (auto QoS) on every disk. Without it, IOWeight does nothing under
  the `none` scheduler.
- runc 1.2 and later map cpu-shares to cpu.weight non-linearly (1024 gives 100); the values above match that mapping.

## nginx (`nginx/shared`, `nginx/aphrody/aphrody.com.conf`)

- Workers: `auto` with `worker_cpu_affinity auto`, 65535 connections each, `worker_rlimit_nofile` 262144, epoll and
  multi_accept. sendfile, tcp_nopush, tcp_nodelay, open_file_cache and `aio threads` are on.
- TLS: TLS 1.2/1.3, a 50 MiB shared session cache, and session tickets (keys rotate on every reload). aphrody.com
  accepts 0-RTT; early POST, PUT, PATCH and DELETE requests get `425`, and upstreams see the `Early-Data` header.
  There is no OCSP stapling: Let's Encrypt ended OCSP in 2025.
- HTTP/3: aphrody.com listens on `443 quic` (play.aphrody.app owns `reuseport`), with `quic_gso on` and
  `Alt-Svc: h3=":443"`. UFW allows 443/udp.
- Compression: zstd (level 3), then brotli (5), then gzip (5). The brotli modules come from Ubuntu. zstd is
  tokers/zstd-nginx-module, pinned, and built against the packaged nginx by
  `/usr/local/libexec/aphrody-nginx-zstd build`. An APT hook disables zstd before an nginx package upgrade and
  rebuilds it afterwards, so the configuration stays valid. `application/wasm` comes from the Ubuntu mime.types.
- WebOS headers: nginx sets COOP `same-origin`, COEP `credentialless` and CORP `same-site` on every response, so
  `crossOriginIsolated` is true and wasm threads and SharedArrayBuffer work. Content-hashed assets get
  `max-age=31536000, immutable`.
- Proxying: an `aphrody_webos` keepalive pool (64). `$aphrody_connection_upgrade` passes Upgrade through for
  WebSocket and WebRTC signalling and sends an empty Connection header otherwise. The shell location has 1 h timeouts
  and no buffering. The Wayland gateway keeps its own 1 h unbuffered location, and the public API is rate-limited to
  60 r/min with a burst of 20.
- Drift fixed: the live `01-tuning.conf` carried an unversioned `ssl_session_cache`, and
  `/etc/nginx/snippets/aphrody-google.inc` was missing. That snippet and `aphrody-google.service` pointed at
  127.0.0.1:8796, which belongs to aphrody-fonts-proxy (cdn.aphrody.com); they now use 8802.

### Benchmark (2026-10-30, h2load on the VPS against https://aphrody.com/, load average 55–70)

| Run | Before | After |
| --- | --- | --- |
| HTTP/2, 50 connections × 10 streams, 5000 requests | 1050 req/s | 1514 req/s |
| HTTP/2, a new connection per request (100 clients, 2000 requests) | 1141 req/s | 1634 req/s |
| styles.css bytes (identity / gzip / br / zstd) | 106676 / 20491 / – / – | 106676 / 20491 / 19311 / 23301 |
| WebOS gateway 127.0.0.1:8790, p50 / p95 / max (with slices) | 1.9 / 6.4 / 525 ms | 0.8 / 1.8 / 5.1 ms |
| Wayland gateway 127.0.0.1:8793, p50 / p95 / max (with slices) | 0.9 / 3.7 / 4.3 ms | 0.5 / 2.0 / 3.4 ms |
| https://aphrody.com/ full request, p50 / p95 | 27.1 / 43.8 ms | 13.6 / 38.4 ms |

The h3 throughput was not measured: Ubuntu's h2load and curl and Alpine's curl are built without QUIC. The QUIC
sockets are bound by every worker, and Alt-Svc is advertised.
