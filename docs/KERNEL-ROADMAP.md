# Bun and the Linux kernel: roadmap

Status: planning, 2026-10-29. Nothing in this document has been built, booted or submitted upstream by this repository. It summarizes the research report `bun-in-kernel.md` (dated 2026-10-29, kernel reference tree `origin/master` `c339f4010dea`, Bun reference `oven-sh/bun` `11c367163a4b`). Labels follow the report: VERIFIED means confirmed by at least two primary sources the researcher opened (kernel git history counts as one); UNVERIFIED means a single source, a search summary, a claim that was not reproduced, or inference.

## Architecture this roadmap sits on

- The runtime is unmodified upstream Bun: npm `bun@1.4.4-canary.20261028.1`, gitHead `11c367163a4b`. `bun --revision` prints `1.4.4-canary.1+11c367163`. The `aphrody-labs/bun` fork is abandoned.
- Bun OS is an Arch-inspired Linux distribution (pacman/libalpm, Server, COSMIC Desktop and Gamescope Gaming compositions).
- Final goal: Bun integrated into the Linux kernel the way Rust was.

## What "the way Rust was" means (VERIFIED)

Rust entered the kernel as a build-time toolchain plus a small optional subsystem (`CONFIG_RUST`, default off). Timeline from the kernel git history and LWN: first public RFC 2021-04-14, v1 2021-07, merge into mainline `8aebac82933f` on 2022-10-03 (Linux 6.1, released 2022-12-11), about 17.5 months from RFC to merge; first in-tree driver in 6.8 (2024-03-10); "the Rust experiment" concluded 2025-12 (commit `9fa7153c31a3`, in v7.0). The preconditions the tree imposed: a named champion maintainer and route, numbered public revisions, a minimal default-off first merge, a pinned and checkable toolchain, documentation, a boundary rule protecting C maintainers, honest platform coverage, GPL-2.0-compatible licensing, and an explicit experiment clause with an exit criterion.

## What Bun cannot be, and what it can be

Bun is a userspace runtime that links C++ JavaScriptCore, ICU, BoringSSL and glibc/musl. The report concludes it cannot run in ring 0: x86 kernel code is built with `-mno-sse -mno-mmx -mno-sse2 -mno-3dnow -mno-avx` (`arch/x86/Makefile`), kernel stacks are 16 KiB, there is no C++ runtime, and JSC needs user mappings for its JIT and GC (these kernel facts VERIFIED; the feasibility judgement is the report's analysis). No embedded general-purpose scripting engine exists in the tree (VERIFIED by path search over 97,310 tracked paths), and the usermode-driver framework that shipped user ELF blobs inside the kernel was removed (`98e20e5e13d2` in v6.8, `b7b3500bd4ee` in v6.17-rc1; VERIFIED). The report therefore does not pursue an in-kernel JavaScript engine. Four tracks remain:

- Distribution kernel: a Bun OS kernel package forked from Arch's `linux` PKGBUILD (Arch's kernel already builds with `CONFIG_RUST=y`; VERIFIED against four PKGBUILDs and `config.x86_64`).
- Small, Rust-written, upstream-submitted kernel features that Bun benefits from (the `bun_accel` pattern).
- Bun as `/init`, initramfs payload or service manager: the kernel only needs an executable.
- Bun driving BPF and `sched_ext` from userspace.

## Phases

Phase 0 (weeks 0-4): make the owned kernel real; no upstream approval needed.
1. Create `linux-bun` (`pkgbase=linux-bun`) from Arch's `linux` PKGBUILD with the `aphrody-bun` config merged, built through the factory and published to a signed `[bunos]` repository. This lifts the `kernelSelection: blocked` state. Gate: image boots under QEMU/OVMF with Limine, artifact hashes recorded.
2. Split an upstream-shaped branch of the three original `bun_accel` commits (driver, helper, selftest) on current `master`, with one identity, `checkpatch.pl --strict`, a benchmark, and the AI-assistance disclosure that `Documentation/process/generated-content.rst` requires; post as RFC. Expect the review question "why not an io_uring opcode" (UNVERIFIED, inference).
3. Qualify Bun as `/init` (PID 1 duties: reaping, signals, mounts, switch_root, shutdown) with a boot receipt on QEMU and real hardware. The claim in older fork documents that a 6.18.55 kernel booted into the fork's Bun as `/init` is UNVERIFIED.

Phase 1 (months 1-3): packaging and reliability. Weekly rebuilds against Arch kernel updates, CI with `make LLVM=1 rustavailable`, `CLIPPY=1` and the selftests in QEMU, a Secure Boot/UKI decision, rollback test results.

Phase 2 (months 3-9): upstream engagement. Iterate the RFC (Rust took 8+ posted revisions), find a second maintainer, offer an io_uring-opcode variant. Success is acceptance into a subsystem tree or a documented NAK, after which the module stays in `linux-bun`. Upstream-reception predictions in this phase are UNVERIFIED (inference).

Phase 3 (months 6-12): Bun as the control plane for kernel extensibility: `sched_ext` schedulers tuned for the Bun event loop (`CONFIG_SCHED_CLASS_EXT=y` in Arch's 7.2.11 config; VERIFIED), BPF LSM policies, cgroup and PSI management, all driven from userspace.

Phase 4 (12+ months, optional research): a Rust/BPF-hosted policy language or Wasm-in-BPF experiments, only if earlier tracks succeed and a kernel maintainer asks. Not JavaScriptCore.

Success metrics mirror the Rust experiment's exit criteria: real users (Bun OS images running `linux-bun`), contributors beyond one person, a maintainer outside the organization reviewing, an upstream subsystem accepting a patch.

## Consequence of the upstream pin

Upstream `oven-sh/bun` does not reference `bun_accel` (VERIFIED by grep in the upstream checkout). The only userspace consumer of `/dev/bun_accel` was the fork's installer. With an unmodified runtime, the `bun_accel` ioctl has no consumer until one exists outside Bun's source (for example a Bun OS helper), so Phase 0 step 2 and Phase 2 have no in-tree user to justify them. This is the inference of this document, not of the report.

## Claims that remain UNVERIFIED

- Every `aphrody-labs/linux` qualification claim (QEMU boot, 7 selftests, NVIDIA module builds): taken from repository documents, nothing was rebuilt or booted.
- ISRG/Google funding of the Rust effort, the 2020 Plumbers details, v5 to v7 dates, and LWN-only statements (Debian enabling Rust, "fivefold growth", Greg KH's safety remarks).
- Non-Linux in-kernel interpreters (NetBSD Lua, wasmjit, Cervus and others): search summaries only.
- Legal conclusions about LGPL-2 JavaScriptCore or BoringSSL inside a kernel image: not analysed by counsel.
- Whether upstream has already discussed an io_uring copy opcode; only the absence of one in the current opcode list is verified.
