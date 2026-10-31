# Asterinas (asterinas/asterinas) as of 2026-10-30

## What is the framekernel and how does OSTD separate unsafe from safe code?

### Takeaway
Framekernel = single-address-space, monolithic-performance kernel split by Rust's type system into a small privileged unsafe "frame" (OSTD) and all other kernel services in 100% safe Rust. The paper puts the memory-safety TCB at about 14.0% of the codebase; the OSTD book page says the core `ostd` crate is about 10K lines.

### Cited Findings
- README: aims to be a "production-grade Linux alternative, memory safe, high-performance"; combines "monolithic-kernel performance with microkernel-inspired separation"; unsafe Rust is confined to OSTD, the rest is safe Rust. Also uses a new memory-management scheme, CortenMM. — [GitHub](https://github.com/asterinas/asterinas)
- USENIX ATC 2025 paper: framekernel gives "intra-kernel privilege separation" so the TCB stays minimal and sound; memory-safety TCB is about 14.0% of the codebase; performance "on par with Linux" (abstract gives no figures); then supported over 210 syscalls. — [USENIX ATC25](https://www.usenix.org/conference/atc25/presentation/peng-yuke)
- OSTD offers high-level safe APIs that use unsafe internally. Design goals are expressiveness, minimalism, efficiency and soundness. Syscalls, filesystems, network protocols and Virtio drivers are all safe Rust on OSTD. Core crate about 10K LoC. Soundness is argued by design analysis and community review; formal verification is called the gold standard but not an immediate priority. — [OSTD book](https://asterinas.github.io/book/ostd/index.html)
- OSTD provides: memory management, tasks, user-space entry, interrupts, timers, DMA/MMIO driver support, boot info, locking/sleeping. — [OSTD book](https://asterinas.github.io/book/ostd/index.html)
- The 100-line example kernel uses `#![deny(unsafe_code)]`. Physical memory is reachable only via `UFrame`/`USegment`. The entry point is `#[ostd::main]`. — [Book](https://asterinas.github.io/book/ostd/a-100-line-kernel.html)
- 0.19.0 added hypervisor support in OSTD (RFC-0003): mechanism in OSTD, policy in the kernel. Intel VMX/VMCS/EPT. All unsafe code sits in an OSTD virtualization module of about 2,000 lines. A 100-line safe-Rust hypervisor example exists. A KVM-compatible /dev/kvm is planned, not delivered. — [0.19.0 announcement](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html)
- The codebase is over 250,000 lines, about 200,000 of them Rust. Over 100 contributors overall; 55 in the 0.19 cycle, 31 of them first-time. — [0.19.0 announcement](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html)
- Book lists six publications, including the ATC 2025 paper and a SOSP 2025 Best Paper for CortenMM. — [Book](https://asterinas.github.io/book/)

### Inferences
- The TCB figure of 14% is a ratio of the whole kernel at paper time. As the kernel grows (about 250K LoC now) while OSTD stays small, the ratio is probably lower today, but I found no current figure.
- The two OSTD size figures (about 10K LoC for `ostd`, and the paper's 14% ratio) cannot be reconciled from these sources. They may measure different things or different dates.

### Gaps
- Exact current OSTD unsafe-line count and how the 14% is computed; I did not read the paper PDF.
- No formal verification result for OSTD soundness; the book says it is not an immediate priority.

## How mature is Linux binary compatibility and what runs on it today?

### Takeaway
Linux ABI-compatible (not kernel-module compatible) with 240+ syscalls on x86-64. Runs substantial real software on Asterinas NixOS (100+ packages including Firefox and QEMU, Xorg, and self-hosted builds). It is still pre-production and many syscalls are partial.

### Cited Findings
- README: "240+ Linux system calls"; Tier 1 x86-64 (full test suite on every PR); Tier 2: x86-64 with Intel TDX, ARM64, RISC-V 64; Tier 3: LoongArch 64. The 2026 priority is production readiness for standard and confidential VMs on x86-64. — [GitHub](https://github.com/asterinas/asterinas)
- Compatibility page: no loading of Linux kernel modules, and this will not change. Most syscalls also work on ARM, RISC-V and LoongArch. — [Book: Linux compatibility](https://asterinas.github.io/book/kernel/linux-compatibility/)
- Unsupported per that page: SysV shm and msg, POSIX mq, io_* AIO, mlock family, splice/tee/vmsplice, perf_event_open, fanotify, recvmmsg, keyctl, kexec_load, swapon/off, settimeofday, clock_settime, times, syslog. Many others are partial (open, mmap, ioctl, fcntl, clone, ptrace, futex, mount, sockets). — [Book: Linux compatibility](https://asterinas.github.io/book/kernel/linux-compatibility/)
- Caution: that page may be stale. It lists filesystems as devfs, devpts, ext2, procfs and ramfs, and sockets as TCP/UDP over IPv4 plus Unix only. The 0.18 and 0.19 notes below report more.
- 0.18.0 (June 2026): ptrace implemented (GDB and strace work), pidfd_getfd, pidfd_send_signal, pivot_root, O_TMPFILE, ARCH_GET_GS/SET_GS (enables Firefox), IPC/cgroup namespaces, a cgroup PID controller and a partial CPU controller, capabilities and an initial LSM framework. Over 100 popular packages verified on Asterinas NixOS, including Codex, QEMU and Firefox. Test suites run: kselftest, xfstests, and the Go, Python and JDK unit tests. — [0.18.0 announcement](https://asterinas.github.io/2026/06/04/announcing-asterinas-0.18.0.html)
- 0.19.0 (2026-10-13): mount propagation, the fsopen syscall family, X.Org on the modesetting driver with Mesa software GL (two 3D games demoed), and first self-hosted build (Nix, Cargo, rustc and QEMU run on Asterinas, and it builds itself in nested QEMU). — [0.19.0 announcement](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html); [Phoronix](https://www.phoronix.com/news/Asterinas-0.19-Released)
- Phoronix describes DRM and AArch64 as "initial" and makes no production-readiness claim. — [Phoronix](https://www.phoronix.com/news/Asterinas-0.19-Released)

### Inferences
- "240+ syscalls" counts implemented syscalls, not full semantics. The compatibility table shows many partial flag sets, so unusual workloads may hit gaps.
- Running Firefox, QEMU and Go/JDK/Python suites suggests general userland is viable. The lack of SysV IPC, splice and AIO could break databases and some servers; this is my inference, not a source claim.

### Gaps
- Current compatibility-page syscall list may be older than 0.19; I did not diff against source.
- No independent third-party compatibility assessment found.
- No published benchmark numbers beyond "on par with Linux" (paper); the 0.19 post gives none.

## What would it take to use Asterinas/OSTD in or alongside a Rust-centric OS distribution?

### Takeaway
Feasible, with caveats. `ostd` and `cargo-osdk` are published on crates.io (MPL-2.0, a release roughly every 1 to 2 months), but the project pins a specific Rust nightly (nightly-2026-07-21 with rust-src, rustc-dev and llvm-tools-preview) and expects its Docker or Nix dev environment. MPL-2.0 is file-level copyleft, so it can link with proprietary code.

### Cited Findings
- `rust-toolchain.toml` pins `nightly-2026-07-21` with components rust-src, rustc-dev, llvm-tools-preview. Targets: x86_64, riscv64, loongarch64 and aarch64 bare-metal. The header says to also update `osdk/src/commands/new/rust-toolchain.toml.template`. — [rust-toolchain.toml](https://raw.githubusercontent.com/asterinas/asterinas/main/rust-toolchain.toml)
- `ostd` on crates.io: latest 0.19.0 (2026-10-12), MPL-2.0, 41 versions, about 34K total downloads. Recent releases: 0.17.0 2025-12-13, 0.17.1 2026-03-12, 0.17.2 2026-05-09, 0.18.0 2026-06-03, 0.18.1 2026-08-18, 0.19.0 2026-10-12. — [crates.io API](https://crates.io/api/v1/crates/ostd)
- OSDK is a Cargo extension for creating, building, testing and running OSTD projects: `cargo install cargo-osdk`. Its install page states x86_64 Ubuntu and Rust 1.75+ with QEMU, grub, ovmf and xorriso; it does not mention nightly, which conflicts with the pinned nightly, so that page looks stale. — [OSDK guide](https://asterinas.github.io/book/osdk/guide/index.html); [Book](https://asterinas.github.io/book/)
- Build: Docker dev container (tag `0.19.0-20261012`, `linux/arm64` images exist) or a Nix flake (toolchain, QEMU and firmware prebuilt on Cachix). Commands: `nix develop`, `make kernel`, `make run_kernel`, `make nixos`, `make run_nixos`. Development hosts are x86-64 and ARM64. — [GitHub](https://github.com/asterinas/asterinas); [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html)
- Boot: PVH direct boot (QEMU, Cloud Hypervisor, Firecracker), runs as a Firecracker guest, Intel TDX boot; Multiboot, Multiboot2, Linux 32-bit boot protocol, EFI handover (deprecated), PE/COFF entry. — [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html); [Book: compat](https://asterinas.github.io/book/kernel/linux-compatibility/)
- Asterinas NixOS: experimental distro with ISO installer, replaces Linux kernel in NixOS; not an official NixOS project and no affiliation with the NixOS Foundation. — [GitHub](https://github.com/asterinas/asterinas); [Book](https://asterinas.github.io/book/)
- Drivers and devices: new `aster-device` (safe-Rust driver model, sysfs, driver matching), `aster-drm` (DRM core, /dev/dri, GEM dumb buffers, KMS), virtio-fs, virtio-rng, NVMe (0.18), multiple TTYs. AArch64 on QEMU virt: GICv3, generic timer, PL031, PL011, virtio-mmio. — [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html); [0.18.0](https://asterinas.github.io/2026/06/04/announcing-asterinas-0.18.0.html)
- Filesystems (0.18 and 0.19): ext2 rewritten, virtio-fs (mmap, O_DIRECT, xfstests in CI), overlayfs reimplemented (doubled xfstests passes), devtmpfs, procfs, ramfs; page cache refactor. — [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html); [0.18.0](https://asterinas.github.io/2026/06/04/announcing-asterinas-0.18.0.html)
- Networking: TCP/UDP over IPv4 and Unix sockets (compat page); 0.18 added a rewritten vsock and initial IPv6. — [Book: compat](https://asterinas.github.io/book/kernel/linux-compatibility/); [0.18.0](https://asterinas.github.io/2026/06/04/announcing-asterinas-0.18.0.html)
- License: mainly MPL-2.0, with more permissive licenses on some components (see `.licenserc.yaml`). No CLA. The book notes MPL allows linking with proprietary code, unlike GPL. — [Book](https://asterinas.github.io/book/); [GitHub](https://github.com/asterinas/asterinas)
- Governance: described as independent and community-led, with a public RFC process, CODEOWNERS and triagebot. About 5.0k stars, 406 forks, 4,824 commits, four years of development. Top 0.19 committers: Ruihan Li (145), Chen Chengjun (52), Jianfeng Jiang (42), Qingsong Chen (40), Bet4 (38). — [GitHub](https://github.com/asterinas/asterinas); [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html)
- 0.19 also added an AI code-review skill (`aster-code-review`, 81 guidelines, 58-problem benchmark). — [0.19.0](https://asterinas.github.io/2026/10/13/announcing-asterinas-0.19.0.html)
- Release cadence: minor releases 0.17.0 (Dec 2025), 0.18.0 (June 2026) and 0.19.0 (Oct 2026) at roughly 4 to 6 months apart, with patch releases between. — [crates.io API](https://crates.io/api/v1/crates/ostd); [0.18.0](https://asterinas.github.io/2026/06/04/announcing-asterinas-0.18.0.html)

### Inferences
- For a Rust-centric distro, the lowest-friction paths are: (a) ship Asterinas as an alternative kernel for VM/container guests (Firecracker, Cloud Hypervisor, Kata), where PVH boot and virtio support are strongest; (b) depend on `ostd` and `cargo-osdk` to write new safe-Rust kernel components. Replacing a bare-metal desktop kernel is not realistic yet (virtio-centric drivers, software GL only, DRM "initial").
- Nightly pinning means the distro must carry that exact nightly (or a close one) for the kernel build, separate from any stable toolchain. Release cadence of a few months means OSTD APIs probably still change between minors (0.x versioning), though I found no stability policy.
- Linux driver and module reuse is impossible by design (no module loading, own device model), so hardware coverage must come from Asterinas's own drivers.
- MPL-2.0 file-level copyleft is compatible with mixing in other-licensed code. Modified MPL files must stay MPL.

### Gaps
- Governance affiliation: I did not find a source for Ant Group's role in these pages. The README says only "independent and community-led." The Ant Group involvement is from background knowledge, not confirmed here.
- Real-hardware support list (beyond QEMU/virtio and NVMe) not found.
- Whether the OSDK install page (Rust 1.75+, Ubuntu only) is out of date; it conflicts with the pinned nightly.
- No stable-API or semver policy for `ostd` found.
- Benchmarks: no figures; the paper's "on par with Linux" is the only claim, from the abstract alone.
- I did not verify the "fourth architecture" count. The README tiers list five (x86-64, TDX, ARM64, RISC-V, LoongArch), and the 0.19 post calls AArch64 the fourth CPU architecture, which is consistent for four CPU architectures.
