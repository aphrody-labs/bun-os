<!-- SPDX-License-Identifier: Apache-2.0 -->

# Server management with `yolo host`

`yolo host` manages a Linux server end to end from the `yolo` CLI: inventory, reclaim, archive with
verification, services, kernel tuning, network checks and read-only mounts. It runs on `--host vps|dbfr`
through the Aphrody transport (`aphrody-infra ssh exec`, `ssh service`, `ssh tune`) and on `--host local`
by running the commands directly. Decision: D26 in [DECISIONS.md](../../decisions/runtime/DECISIONS.md).

```sh
yolo host audit    --host vps [--json]                  # read-only: inventory, findings, prioritized plan
yolo host reclaim  --host vps [--apply]
yolo host archive  /home/ubuntu/apps/old /home/ubuntu/apps/other --to /mnt/backup/arc [--pull ./arc] [--pg-dump DB --pg-user postgres] [--remove-source] [--apply]
yolo host services --host vps [--stop UNIT] [--disable] [--apply]
yolo host tune     --host vps [--apply]
yolo host net      --host vps [--size 50000000] [--apply]
yolo host mount    /dev/sdb13 --host vps [--rw --i-know-this-is-a-backup] [--fstab] [--apply]
yolo host journal  --host vps [--tail 20] [--json]
just host audit --host vps                              # same thing through the justfile
```

## How it works

- **Plan by default.** Without `--apply` a command collects facts with one read-only script (`yolo host audit
  --print-script` prints it), then prints the numbered steps with the exact command of each step, the
  undo hint, and what was left alone and why. `--json` prints the same plan as data. `--apply` runs those
  same command strings in that order (a test asserts that the executed commands equal the listed ones).
- **Transport.** Remote commands go through `aphrody-infra ssh exec --json`; a sentinel keeps the real exit
  code and stdout when the remote command fails (the owner tool drops stdout on a non-zero exit). Scripts
  travel as base64 so quoting and length are not an issue. Service changes use `aphrody-infra ssh service
  --action stop|disable --confirm`, tuning uses `aphrody-infra ssh tune`. The ssh user must have passwordless
  sudo for root-only steps; without it those steps are shown as BLOCKED instead of being attempted.
- **Journal.** Each applied step appends one line to `var/host/<host>/journal.jsonl` (ignored by git):
  timestamp, run id, command, step, exact command, status (`ok|failed|skipped|refused`), exit code,
  duration, metrics before and after (free bytes of the touched filesystem, available RAM, swap, load) and
  an undo hint. `yolo host journal` shows it. A torn last line never hides the rest.
- **Policy.** `host-policy.toml` (or `--policy FILE`, `$YOLO_HOST_POLICY`, `./host-policy.toml`) holds the
  service keep-list and stop-candidates, extra lock files, protected paths, reclaim ages, journal limits,
  scan roots and tuning targets, with `[hosts.<name>.*]` overlays. Lists are unioned with the built-in
  defaults and the file can only make the tool more conservative: it cannot empty the hard-coded rules.

## Safety invariants (hard-coded in `packages/engine/yolo/src/host-safety.ts`, tested in `test/host.test.ts`)

1. Nothing is deleted unless it is regenerable (apt cache, rotated logs, journal, stopped containers and
   dangling images, docker build cache, build output found with its project marker, listed cache
   directories, an unused swap file) or archived **and** verified.
2. Protected paths (`/`, `/home`, `/etc`, `/boot`, `/var/lib`, `/home/ubuntu/apps/*/shared`, database and container
   state, other users' directories, the build factory cache and artifact roots) are never reached by a
   reclaim rule. They can only shrink through `archive` + verification. Even then `--remove-source` refuses
   `/`, system directories, `/etc`, `/usr`, the home directory, `~/.ssh`, `/etc/ssh`, mount points, and
   database state (use `--pg-dump`).
3. Reusable caches kept on purpose are never cleaned: `~/.cache/sccache`, `~/.cargo/registry`, `~/.cargo/git`,
   `~/.bun`, `~/.rustup`, `~/.cache/uv` (AGENTS.md, build factory `retention.preserve`).
4. **Nothing is formatted or wiped; there is no code path for it.** A final gate rejects any command that
   looks like `mkfs`, `wipefs`, `sgdisk`, `dd of=/dev/...`, `blkdiscard`, `cryptsetup luksFormat`, `docker
   volume prune`, `--volumes`, or `rm` of `/`.
5. No mutation while a build lock is held. The lock is read from `/proc/locks` (inode of the lock file, so
   nothing is acquired); the Aphrody build factory `lockPath` is added automatically for its host. The check
   runs before the first mutating step and again before a source removal. A build process (cargo, rustc,
   bun install/build, ...) whose working directory is in or above a candidate path blocks that candidate.
6. `ssh` and the base system (`systemd-*`, `dbus`, `cron`, ...) are never stopped, even with an explicit
   `--stop`; neither is anything in the keep-list. Unknown services are reported, never stopped on their own.
7. `--remove-source` runs only after, in the same run: `zstd -t`, source entry count equal to archive entry
   count, `sha256sum -c` of a manifest, `pg_restore -l` of a requested dump, and (with `--pull`) a SHA-256
   of the pulled copy (Bun.CryptoHasher) equal to the host manifest. Any failure keeps the source.
8. Mounts are read-only (`ro,nosuid,nodev,noexec`, plus `noload`/`norecovery` so no journal is replayed)
   unless `--rw` **and** `--i-know-this-is-a-backup` are given; a disk without a filesystem is refused
   (never formatted); whole disks, system disks, volume layers (LUKS, LVM, RAID) and mount points outside
   `/mnt`, `/media`, `/home/ubuntu/apps/mnt` are refused. fstab entries always carry `nofail` and `/etc/fstab` is copied
   first.
9. Every apply is idempotent: archives of the same name are reused and re-verified, `rm` of a missing path
   succeeds, the sysctl drop-in is only replaced when its content changes, an active swap file is never
   removed (re-checked on the host at run time).

## Subcommands

| Command | Reads | Plans / does |
| :--- | :--- | :--- |
| `audit` | lsblk (UNMOUNTED disks, filesystems already present, unallocated space), df, df -i, findmnt, swapon, zramctl, `/proc/meminfo`, load, nproc, `systemctl` (running, failed, timers), `ss`, `ps` (userland vs kernel threads, zombies, top RSS), docker, `du`, cron, build locks and build processes, journal and apt sizes, rotated logs, build output, swap files | Findings by severity and a reclaim plan ordered regenerable-first, then the large directories that only archive + verify may reduce. Never mutates. |
| `reclaim` | the audit | apt-get clean, journalctl vacuum (size and age from the policy), rotated logs older than the policy age, docker `container prune` (stopped, >24 h), `image prune` (dangling), `builder prune` (>7 d), old `target`/`node_modules`/`.next` next to their `Cargo.toml`/`package.json`, listed cache dirs, unused swap files. Never `docker volume prune`. |
| `archive` | disk space, tools, entry counts | `nice -n 19 ionice -c3 tar \| zstd` to `<to>/<label>-<date>.tar.zst.part`, renamed when complete; `zstd -t`; entry count; `sha256sum` manifest; optional `pg_dump -Fc` + `pg_restore -l`; optional off-host `--pull` (rsync `--partial --append-verify`, or rclone `--checksum`) with in-process SHA-256 compare; optional `--remove-source`. |
| `services` | running units | Classification keep / candidate / unknown from the policy; stop (and `--disable`) of candidates or named units through `aphrody-infra ssh service ... --confirm` (local: `systemctl`). |
| `tune` | `sysctl`, THP, cpufreq, nginx, memory/swap/zram | Current vs target table. Owner settings go through `aphrody-infra ssh tune --apply`; the rest (BBR, fq, tcp buffers, backlog, THP `madvise`, nginx `worker_processes auto`, nofile limits) through `/etc/sysctl.d/99-yolo-tune.conf`, `tmpfiles.d`, `limits.d`. A higher existing ceiling is never lowered. A swap file is created only when the host has no swap and no zram. |
| `net` | `ssh -G`, curl on the host | TCP connect latency to the ssh port (Bun.connect), ssh exec round trip, download of a known size on the host and from this machine, in ms, MB/s and Mbit/s. Measurement only; runs with `--apply` because it generates traffic. |
| `mount` | lsblk | Read-only mount of a partition at `/mnt/yolo/<name>`, optional fstab entry. |
| `journal` | `var/host/<host>/journal.jsonl` | Shows what was applied. |
| `space <path..>` | `find -printf '%D %i %n %b'`, `df -B1` | What deleting the paths really frees, and whether `--fs` (default `/`) keeps `--min-free` (default 0.5). Read-only; exit 3 when the floor would not be reached. Details below. |

## Space accounting (`yolo host space`)

`du` over several directories counts a hard-linked file once per name, and a file whose other links stay outside
the deleted set frees nothing. A deletion of a stale checkout copy, predicted at 43 GiB from `du`, freed 12 GiB
on 2026-10-03. `host space` applies the exact rule instead: unlinking a set of paths returns the allocated blocks
(`%b`, 512 bytes) of an inode if and only if every one of its links (`%n`) is inside the set. It reports the sum per
name, the unique bytes, the bytes really freed and the bytes kept alive from outside, then checks the free-space
floor on the result: free >= ceil(total x ratio), in integer arithmetic. The functions are pure
(`packages/engine/yolo/src/host-space.ts`); `test/host-space.test.ts` checks freed <= unique <= naive on 300 seeded random sets
and the stale-copy case, and a real run on hard-linked files gave 9.5 MiB freed and 47.7 MiB kept for a copy that
shared 50 MB with a live one, matching `du`.

The floor is a variable, not a constant (the first version fixed it at 50 %, which was only meant to be temporary).
It is resolved in this order, and an invalid value is an error, never a silent fall-through to a laxer source:
`--min-free` (`0.3`, `30` or `30%`), the `YOLO_MIN_FREE` environment variable, `[space] min_free` of
`host-policy.toml` (a `[hosts.<name>.space]` table overrides it for one host), then the built-in 0.2, which is also
the point where `audit` already warned. It is enforced in two places: `yolo host audit` raises a critical
`free-floor:<mount>` finding for every real filesystem below it, whose action is the ready-to-run `yolo host space`
command for the three largest non-nested directories of that filesystem; `yolo ship --apply` probes the free space
of the build host's workspace filesystem first (walking up to the nearest existing parent) and exits 3 below the
floor, or when the probe cannot be read.

`host space` scans recursively and concurrently, with no human step: directories down to `--depth` levels
(`split_depth`, default 2) become independent `find` runs, the loose files of each level are batched, and one
limiter bounds the commands in flight (`--parallel`, `parallel`, default 8). Records are merged by (device, inode),
so the answer equals a single `find`'s; `test/host-space.test.ts` checks that on a real tree with hard links across
sibling subtrees at depths 0, 1, 2 and 5 and parallelism 1 and 4, and that the limiter never exceeds its limit.
Measured on 79 000 files with a warm cache on this machine (16 CPUs): about 200 ms serial, about 120 ms with
parallel 8 and depth 2 (1.7x), and about 340 ms with parallel 16 and depth 3 because each command's start-up then
dominates; identical results. The remote case, where one command costs an ssh round trip, was not measured. The
refusal of `ship` itself was not run against a really full disk.

Two operating facts from the same cleanup, not enforced by code: reformatting a disk that only holds a copy takes
seconds where `rm -rf` takes hours (the 193 GiB backup disk: about 56 s for wipe and mkfs), and splitting a
directory tree three levels deep over 24 `rm` workers removed 55 GiB of build output in 8 s on 12 CPUs. Long remote
jobs run detached (`nohup`) because the ssh exec transport times out after about a minute.

## Bun feature map

"Verified" means the API is present in the fork's `packages/bun-types` (not in repo) and documented under `docs/` of the
[fork](../../reference/upstream-bun/APHRODY-FORK.md) (page paths below are relative to that `docs/` directory), and `typeof` was checked at runtime on this Bun 1.4.2 build. Status: **used** = in
`crates/infra/aphrody/src/host*.ts` today; **planned** = fits server management, not implemented; **n/a** = verified to
exist but not relevant to server management.

| Bun feature | Verified in | Use for server management | Status |
| :--- | :--- | :--- | :--- |
| `Bun.spawn` / `spawnSync` (`timeout`, `killSignal`, `maxBuffer`, `cgroup`, `signal`) | `runtime/child-process.mdx`, `bun.d.ts` | `LocalTransport.exec`, the `aphrody-infra` calls, `ssh -G`, local rsync for `--pull`; per-command timeouts. `cgroup` limits for heavy jobs on the server itself | used; cgroup planned |
| `Bun.$` shell | `runtime/shell.mdx`, `shell.d.ts` | Not used on purpose: plans are POSIX text that must run identically on a remote shell and be printed verbatim. Fits an on-host agent | planned |
| `Bun.file` / `Bun.write` / `FileSink` | `runtime/file-io.mdx` | Journal size/torn-line check, streaming read of the pulled archive, policy and fixtures | used |
| `Bun.serve` (TCP and `unix:`) | `runtime/http/server.mdx` | Health/metrics endpoint of an on-host `yolo host` agent on a unix socket | planned |
| `Bun.connect` / `Bun.listen` (TCP, unix) | `runtime/networking/tcp.mdx` | `net`: TCP connect and first-byte latency to the ssh port. Unix sockets for local daemons (docker.sock) | used (connect); listen planned |
| `Bun.udpSocket` | `runtime/networking/udp.mdx` | UDP reachability probes (DNS, QUIC on 443) | planned |
| `Bun.dns` (`lookup`, `prefetch`, `getCacheStats`) | `runtime/networking/dns.mdx` | Resolution timing in `net`, `prefetch` for the repeated ssh endpoint | planned |
| `Bun.sql` (PostgreSQL, MySQL, SQLite) | `runtime/sql.mdx`, `sql.d.ts` | Database health in the audit (connections, size, replication lag). Dumps stay `pg_dump -Fc`, checked with `pg_restore -l` | planned |
| `Bun.redis` / `RedisClient` | `runtime/redis.mdx`, `redis.d.ts` | `PING` and `INFO memory` for the redis services found by the audit | planned |
| `bun:sqlite` | `runtime/sqlite.mdx`, `sqlite.d.ts` | Indexed history of audits and journal entries (the JSONL stays the source of truth) | planned |
| `Bun.zstdCompress*` / `zstdDecompress*`, `gzipSync`, `deflateSync` | `bun.d.ts` | One-shot, in memory: not used for archives (those stream through `tar \| zstd` on the host). Journal rotation and small payloads | planned |
| `CompressionStream("zstd")` | `bun.d.ts` (`CompressionFormat`) | Streaming zstd for a local archive path without the `zstd` binary | planned |
| `Bun.Archive` (tar create/extract/`files()`; gzip only, no zstd) | `runtime/archive.mdx` | Listing entries of a small pulled archive in-process; not for multi-GB streams | planned |
| `Bun.CryptoHasher` (sha256, blake2b, ...) | `bun.d.ts`, `runtime/hashing.mdx` | SHA-256 of the pulled archive compared with the host manifest (streaming) | used |
| `Bun.secrets` | `runtime/secrets.mdx` | On Linux it needs a secret-service daemon (libsecret), absent on a headless server. Secrets stay on the host-local private stores | n/a on servers |
| `Bun.cron` (in-process, OS-level `crontab` registration, `Bun.cron.parse`) | `runtime/cron.mdx` | Scheduled `audit` and reclaim plans on the server; next-run computation | planned |
| `Bun.semver` | `runtime/semver.mdx` | Version thresholds in the audit (kernel, docker, postgres) | planned |
| `Bun.which` | `bun.d.ts` | Tool detection in tests; `aphrody.ts` still uses `command -v` | used (tests) |
| `Bun.sleep` / `Bun.nanoseconds` | `bun.d.ts` | `nanoseconds`: step timings and latency samples. `sleep`: retry backoff | used (nanoseconds); sleep planned |
| Worker threads | `runtime/workers.mdx` | Parallel audits of several hosts | planned |
| `Bun.build --compile` | D20/D21, `bundler` | `yolo host` ships in the standalone `yolo`; copy it to a server and run `--host local` there | used (distribution) |
| `Bun.Terminal` / spawn `terminal` (PTY) | `runtime/child-process.mdx` | Not needed: the transport is non-interactive and uses `sudo -n` | n/a |
| `fetch` with `unix:` | `globals.d.ts` (`BunFetchRequestInit.unix`) | Docker Engine API over `/var/run/docker.sock` instead of parsing `docker system df` | planned |
| `Bun.TOML` | `bun.d.ts` | `host-policy.toml` | used |
| `Bun.JSONL`, `Bun.YAML` | `bun.d.ts` | JSONL journal parsing (a tolerant manual parser is used today); compose files | planned |
| `Bun.Glob` | `bun.d.ts` | Service keep-list and swap file patterns | used |
| `Bun.stringWidth` | `bun.d.ts` | Table alignment | used |
| `Bun.randomUUIDv7` | `bun.d.ts` | Run ids in the journal | used |
| `Bun.markdown` | `runtime/markdown.mdx` | Audit report as HTML for the mdBook | planned |
| `Bun.S3Client` | `runtime/s3.mdx`, `s3.d.ts` | Off-site archive target in place of `--pull` | planned |
| `Bun.Image`, `Bun.WebView`, `Bun.password`, `Bun.CSRF`, `Cookie`, `Bun.mmap`, `Bun.peek`, `Bun.gc` | `runtime/image.mdx`, `webview.mdx`, `bun.d.ts` | Not relevant to server management | n/a |

## Evidence: what was and was not run

- `bun test test/host.test.ts`: parsers (lsblk, df, swapon, zramctl, systemctl, ps, ss, docker, locks, probes),
  plan generation for every subcommand, the safety invariants above, the journal, and real `--apply`
  runs on host `local` in temporary directories (archive with removal after verification, idempotent re-run,
  source kept when `zstd -t` fails or the entry count differs, `--pull`, reclaim of old build output). The
  suite never contacts a remote host.
- `tune --apply` against `vps` (2026-10-03, journaled in `var/host/vps/journal.jsonl` (not in repo)): the five
  `aphrody-infra ssh tune` sysctls, transparent hugepages to `madvise`, nginx `worker_processes` to `auto`,
  and `/etc/security/limits.d/99-yolo.conf`; nginx was backed up and `nginx -t`-checked first. `reclaim`,
  `services`, `archive` and `mount --apply` are otherwise read-only/plan-only against `vps`: `yolo host audit`,
  and the plan output of `reclaim`, `services`, `archive` and `mount`, which only collect facts. No `--apply` was
  run against `dbfr`. The measurement commands of `net` were run by hand on `vps` (an `ssh exec` of curl for 2 MB,
  and a TCP connect from this machine); the `net --apply` path was run on `local` only.
- Not verified: `services --apply` against a real systemd unit, `mount --apply`, `archive --pull` over ssh with
  rsync, `--pg-dump` against a live PostgreSQL, and the rclone fallback. These steps are covered by
  plan-generation tests only.
- The audit of a 45 GB host takes about 40 s because of `du` and `find` at idle I/O priority (each bounded by
  `timeout`). A long `tar | zstd` runs inside one ssh exec (limit 24 h); if the connection drops, the `.part`
  file is removed on the next run and nothing is removed from the source.
