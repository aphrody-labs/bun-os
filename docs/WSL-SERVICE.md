# Bun OS on WSL as a Windows service

Owner request: WSL should behave as a real Windows service rather than a VM a user starts. This page records the design
of `crates/bunos-wsl-service` (`bunos-wsl-service.exe`), what was verified on the workstation (Windows 11 Pro
10.0.28120, WSL 3.0.4, Bun OS kernel `7.3.1-microsoft-standard-WSL2`, distro `bunos`) on 2026-11-03, the
measurements, and the decision on the "no VM" (WSL 1) option. Install and bundle: [WSL.md](WSL.md) (owned by the WSL
bundle work); this page only adds the service layer.

## 1. What it is

| Windows object | Role |
| --- | --- |
| `BunOSWsl` service, "Bun OS (WSL)" | Automatic start (not delayed), LocalSystem, depends on `WSLService`. Starts the distro as its owner at boot, before any logon, keeps it running, restarts it when it stops, reports `RUNNING` once systemd is up. Recovery: restart after 5 s, 15 s, 60 s, reset after 1 day, also on service-specific exit codes. Pre-shutdown timeout 30 s. |
| `BunOSWsl.<unit>` services, "Bun OS: <unit>" | One per mirrored systemd unit (manual start, depends on `BunOSWsl`). Start = `systemctl start`, stop = `systemctl stop`; the Windows state follows the unit (a unit started inside Linux starts its Windows service; a unit that stops stops it, exit code 0 for `inactive`, service-specific 1 for `failed`). |
| Event sources `BunOSWsl`, `BunOSWsl.<unit>` (Application log) | ID 1 lifecycle (start, ready time, restarts, stop), 2 unit state changes, 3 journal entries of the unit (syslog priority 0-3 error, 4 warning, else information; at most 200 per 10 s), 4 service errors. The executable carries its own message table (`build.rs`), so Event Viewer renders every entry. |
| `HKLM\SYSTEM\CurrentControlSet\Services\BunOSWsl\Parameters` | `Distro`, `User`, `TerminateOnStop` (1: stopping the service terminates the distro), `StatePeriod` (s); status written by the service: `LastReadyMs`, `LastSystemdState`, `LastGuestUptimeS`; `Units\<unit>` holds the last published state of each mirrored unit. |
| `%SystemRoot%\BunOS\wsl-service\bunos-wsl-service.exe` | The only binary (630 KB). `install` copies itself there: a LocalSystem service must not run from a user-writable path. |

Commands (`install`, `uninstall`, `export`, `unexport` need elevation, e.g. `sudo bunos-wsl-service ...`):

```text
bunos-wsl-service install [--distro bunos] [--user <owner>] [--terminate-on-stop true|false] [--start]
bunos-wsl-service units [--json] [--all]        # read-only: every service unit, its state, its Windows mirror
bunos-wsl-service export docker.service waydroid-container.service
bunos-wsl-service unexport docker.service       # removes the mirror only; the unit keeps running
bunos-wsl-service status [--json]
bunos-wsl-service uninstall                     # removes the services; the distro and its units are untouched
```

Then the usual Windows tools apply: `Get-Service BunOSWsl*`, `sc query BunOSWsl`, `Restart-Service BunOSWsl -Force`,
services.msc, `Get-WinEvent -ProviderName BunOSWsl.docker.service`.

## 2. Design and why it is not a wslservice patch

Facts from the WSL source (fork `aphrody-labs/WSL`, `master`, equal to `microsoft/WSL`;
`src/windows/service/exe/LxssUserSessionFactory.cpp`, `ServiceMain.cpp`):

- WslService refuses LocalSystem clients (`WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED` in `CreateInstanceForCurrentUser`) and
  keeps **one session, one utility VM, per user SID**. Distros are registered under that user's HKCU.
- On `WTS_SESSION_LOGOFF` it terminates the session **whose Windows session ID matches**; the code comment says a
  session created from session 0 is only terminated when the service stops.
- The default `InstanceIdleTimeout` is 15 s and `VmIdleTimeout` 60 s (`WslCoreConfig.h`); an instance stays up while a
  client process is attached.

So a service can own the instance through WSL's public interface, without touching wslservice:

1. LocalSystem obtains the owner's token by **S4U** (`LsaRegisterLogonProcess` + `LsaLogonUser` with
   `MSV1_0_S4U_LOGON`, batch logon, network fallback): no password stored, no logon session on the desktop. It loads the
   owner's profile (`LoadUserProfileW`, for HKCU) and environment.
2. It starts `wsl.exe -d bunos -u root --exec /bin/sh -c <monitor>` with `CreateProcessAsUserW` in session 0. That
   client (the keeper) is what keeps the instance and the VM up (no idle shutdown, whatever `.wslconfig` says), and
   because the WSL session is created from session 0, a user logoff does not end it. Later interactive `wsl.exe` calls of
   the same user join the same session and VM.
3. The monitor script waits for `systemctl is-system-running --wait`, prints `READY <state> <uptime>`, then prints
   `systemctl show` for the mirrored units every 2 s and follows their journal as JSON. One wsl.exe and one pipe carry
   everything; there is no polling from Windows.
4. If the keeper exits (`wsl --terminate`, `wsl --shutdown`, a crash), the service starts it again after 2-16 s; after 5
   failures in 2 minutes it exits with an error and the SCM recovery actions take over.

Why not patch the fork's wslservice: the same behaviour would need a new "system-owned instance" concept in
`LxssUserSessionFactory` (sessions are keyed by the client token), a rebuild of the whole MSI/MSIX package, and
replacing the Microsoft-signed WSL installed on the machine (Store/winget updates would overwrite it). The public path
already gives boot start, session independence and SCM control; the WSL source was used to confirm the behaviour it
relies on. A patch becomes worth it only for something the client interface cannot do (for example a VM with no
user owner at all); nothing in this request needs that.

The service name is `BunOSWsl` because `BunOS` is already the bunos.sys driver service (`install.ts --driver` runs
`sc start BunOS`).

## 3. Verified (2026-11-03, workstation)

- `install` created the service as described (`sc qc`, `sc qfailure` read back: AUTO_START, LocalSystem, dependency
  `WSLService`, three restart actions, reset 86400 s).
- S4U from LocalSystem works for the Microsoft-account-linked local account `aphro`: event "up as APHRODY\aphro";
  keeper `wsl.exe` and `bunos-wsl-service.exe` run in **session 0**.
- `sc start BunOSWsl` reached RUNNING only after systemd reported `running` (numbers below).
- Restarts: while another agent repeatedly terminated the distro (07:07-07:18), the service brought it back each time
  (seven restarts, 1.4-32.1 s each from respawn to systemd ready) and logged the wsl.exe exit code and stderr.
- Read-only view: `units` listed every service unit with active/sub/enabled state and the Windows mirror state.
- Unit mirroring with `docker.service`, `containerd.service`, `dm-event.service`: state events, journal entries
  attributed to the right source (systemd's own "Stopping/Stopped" messages via the `UNIT` field), and all four control
  paths on `dm-event.service`:

  | Action | Result | Time |
  | --- | --- | --- |
  | `sc start BunOSWsl.dm-event.service` | unit `active` | 1.4 s to RUNNING |
  | `sc stop BunOSWsl.dm-event.service` | unit `inactive` | 3.2 s to STOPPED |
  | `systemctl start dm-event` in the distro | Windows service started by `BunOSWsl` | 2.1 s |
  | `systemctl stop dm-event` in the distro | Windows service stopped itself | 8.1 s |

- Upgrade path: `install` over a running installation sets `Parameters\Detach=1`, stops the unit services (no
  `systemctl stop`) and `BunOSWsl` (no `wsl --terminate`, even with `TerminateOnStop=1`), replaces the binary and
  restarts `BunOSWsl`, which restarts the unit services of running units. Verified with two signed reinstalls:
  `docker.service` kept its `ActiveEnterTimestamp`, and the service was ready again in 93-275 ms.

Not verified (needs a reboot or a logoff, which were not done on this machine): start before logon after a real boot,
and survival of the instance across a logoff of the interactive session. Both follow from the configuration and the
WSL source above, not from a test.

## 4. Measurements

Machine: 24 logical CPUs, 32 GiB; `.wslconfig` from the bundle (`memory=16GB`, `processors=24`, `swap=8GB`,
`networkingMode=mirrored`, `dnsTunneling=true`, `guiApplications=true`, `autoMemoryReclaim=gradual`). Distro with
Docker (`docker.service` enabled) and the Waydroid container service.

Cold start, service start to systemd `running` (from the service's own event, `LastReadyMs`):

| Case | Service start to ready | Guest uptime at ready | systemd userspace |
| --- | --- | --- | --- |
| VM stopped (`wsl --shutdown`, `vmmemWSL` gone), `sc start` | 35.4 s (37.9 s to RUNNING via `sc`) | 30.7 s | 5.8 s |
| VM running, distro terminated, `sc start` | 28.2 s | (VM up 106 s) | 20.1 s |
| Respawns after external terminate/shutdown (7 events) | 1.4, 7.7, 11.6, 24.5, 28.6, 31.4, 32.1 s | 11.6-30.4 s (where logged) | - |
| Distro already running (attach only) | 0.63 s | - | - |
| S4U logon + profile load | 44-137 ms | - | - |

Where the cold boot goes (kernel log of the 35.4 s boot): VM creation to kernel ~4.6 s; kernel and mini_init ready at
2.2 s guest time; **11.7 s** until the mirrored-networking interface appears (`loopback0: renamed from eth2`, 13.9 s);
**7.4 s** more of failing connectivity checks (`CheckConnection: getaddrinfo() failed`) until the distro disk is
attached (21.2 s); systemd from 24.2 s; `docker.service` alone takes 4.8-14.1 s of the userspace time
(`systemd-analyze blame`, three boots) and is on the critical chain of `multi-user.target`.

Memory (distro idle, Docker + Waydroid container running):

| Item | Value |
| --- | --- |
| `vmmemWSL` working set / private | 1.59-1.78 GB / 1.65-1.84 GB |
| Guest `used` (`free -m`), page cache | 774 MB, 620-760 MB |
| Reserved at boot (`Memory: ... 411932K reserved`) | 412 MB: `struct page` for 16 GB is ~256 MB, swiotlb 64 MB |
| Guest anon / slab / root cgroup | 128 MB / 130 MB / 191 MB |
| `bunos-wsl-service.exe` per process (instance + each unit service) | 6-7 MB working set, 1.1-1.3 MB private |
| Keeper `wsl.exe` | 8.4 MB working set, 1.4 MB private |

What can be trimmed (ordered by gain; none applied here, they belong to the bundle and `.wslconfig` owned by the WSL
bundle work):

1. **Readiness: socket-activate Docker** (`docker.socket` enabled, `docker.service` not): removes 4.8-14 s from every
   boot; the first `docker` call pays it instead.
2. **Networking: mirrored mode costs ~19 s of every VM cold boot** on this host (interface mirroring plus failed DNS
   checks before the distro disk is attached). `networkingMode=nat` should remove most of it; it was not switched here
   because the `.wslconfig` belongs to the bundle and mirrored mode was chosen for localhost parity. Needs an A/B run.
3. **Memory floor follows `memory=`:** `struct page` costs 1.6 % of the configured size up front (256 MB at 16 GB).
   `memory=8GB` would save ~128 MB of floor; Docker builds were the reason for the larger size.
4. swiotlb (64 MB) is unused without confidential VMs; `kernelCommandLine=swiotlb=noforce` (or a smaller size) can be
   tried with our kernel.
5. Host return of freed guest memory: WSL boots with `page_reporting.page_reporting_order=5` (128 KB chunks); together
   with `autoMemoryReclaim=gradual` this explains the 0.4-1 GB gap between `vmmemWSL` and guest `used`. `dropCache`
   returns more, sooner, at the cost of cache hits.
6. Service overhead is already small (one 1.3 MB-private process per Windows service and one wsl.exe); mirroring many
   units adds one process per unit only while that unit runs.

## 5. The "no VM" option (WSL 1 or a WSL 1-style path)

WSL 1 runs Linux ELF binaries as pico processes on the NT kernel through `lxcore.sys`: no VM, no Linux kernel. Checked
against the requirements:

| Requirement | WSL 1 |
| --- | --- |
| Our patched Linux 7.3 kernel (Rust, dxgkrnl, our patches) | No kernel at all; `lxcore.sys` emulates the syscall ABI. Our kernel work does not apply. |
| systemd as PID 1 | Not supported (`systemd=true` is WSL 2 only); no cgroups, no real PID 1. |
| Docker | No cgroups, namespaces or overlayfs as Docker needs: Docker requires WSL 2. |
| Waydroid (Android 17) | Needs binder/ashmem/LXC in the kernel: impossible without a Linux kernel. |
| GPU (`/dev/dxg`, Mesa d3d12, WSLg) | `/dev/dxg` is a WSL 2 kernel driver; WSLg is WSL 2 only. |
| Kernel modules, eBPF, nftables, FUSE | Not available or partial. |
| Source available to patch | `lxcore.sys` is not in the open-sourced WSL tree (checked: the fork's tree has no lxcore sources), so a WSL 1-style path would mean writing our own NT-side Linux syscall layer. |
| Gains | No VM memory floor (~0.8-1.8 GB above), faster access to Windows files, process start in milliseconds. |

**Decision: keep WSL 2.** WSL 1 fails five of the six hard requirements (own kernel, systemd, Docker, Waydroid, GPU),
and the component that would have to be patched is closed. What the request asks for operationally (boot start, no
logon, no idle shutdown, SCM control, event log, Linux services as Windows services) is delivered by the service on top
of WSL 2. The cost of the VM is addressed by the trims in section 4, not by removing the kernel.

## 6. Integration with install.ts (proposal to the WSL bundle work)

`factory/wsl/windows/install.ts` stays owned by the bundle work; the proposed interface is one flag:

- `--service[=<unit>,<unit>...]`: after a successful install and the `uname -r` check, run
  `%SystemRoot%\BunOS\wsl-service\bunos-wsl-service.exe install --distro <name> --start` elevated (the binary ships
  next to the other `%SystemRoot%\BunOS` files from `setup-elevated.ps1`, signed), then `export <units>` when units
  are given (suggested default: `docker.service,waydroid-container.service`). `--dry-run` prints both command lines.
- Uninstall: `bunos-wsl-service uninstall` before unregistering the distro.

## 7. Remaining

- Reboot and logoff tests (section 3) on the next planned reboot.
- A/B of the trims in section 4 (socket-activated Docker, NAT vs mirrored, `memory=`), owned by the bundle.
- Release build of `bunos-wsl-service.exe` in the Windows build lane and its place in the `%SystemRoot%\BunOS`
  manifest of `setup-elevated.ps1`.
- Domain accounts: S4U uses MSV1_0 (local and Microsoft-account users). Domain users need `KERB_S4U_LOGON`.
