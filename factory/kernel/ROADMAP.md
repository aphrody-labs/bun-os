# Bun in the kernel "the way Rust was": roadmap

Source: the research report `bun-in-kernel.md` (2026-10-29, kernel reference tree = torvalds/linux
`origin/master` `c339f4010dea`, `v7.3-17997-gc339f4010dea`; Bun reference = oven-sh/bun canary
`11c367163a4b`). Labels are kept from the report: VERIFIED = confirmed by at least two independent primary
sources that were opened; UNVERIFIED = one source, a search summary, a repository claim that was not
reproduced, or an inference. Nothing below was re-verified for this file except where it says "checked
here".

## What "Bun in the kernel" means here

Rust is a language for writing kernel code; Bun is a userspace runtime that links C++ JavaScriptCore, ICU,
BoringSSL and glibc/musl. It cannot run in ring 0: no C++ runtime, SSE/AVX disabled in kernel code
(`-mno-sse -mno-mmx -mno-sse2 -mno-3dnow -mno-avx`, `arch/x86/Makefile`), 16 KiB kernel stacks, JIT needs
user mappings (VERIFIED in the kernel tree). No embedded general-purpose scripting engine exists in the
kernel tree (path search over 97,310 tracked paths; only eBPF, the ACPICA AML interpreter and the nftables
VM; VERIFIED). The one mechanism that shipped userspace code inside the kernel tree, the usermode-driver
framework, was removed (`98e20e5e13d2` bpfilter, v6.8; `b7b3500bd4ee` umd, v6.17-rc1; VERIFIED).

So the roadmap copies Rust's process, not its scope, and pursues four tracks: (F) a distro kernel package,
(E) Bun as `/init`, (B/G) small Rust-written, upstream-submitted kernel enablers, (C/D) Bun as the
userspace control plane for BPF and sched_ext. It does not pursue an in-kernel JavaScript engine
(interpretation A in the report: "Do not pursue").

## Phases

### Phase 0 (weeks 0-4): make the owned kernel real (tracks F and E, no upstream approval needed)

1. **`linux-bun` package from Arch's `linux` PKGBUILD.** Status: first cut is in `linux-bun/` (see
   `README.md` for what is and is not verified). Remaining gate from the report: image boots under
   QEMU/OVMF with Limine, `bun_accel.ko` loads, selftests pass, artifact hashes recorded; build through
   `bun factory` on the VPS and publish to a signed `[bunos]` repo. That lifts the
   `kernelSelection: blocked` state in bun-os (report section 4.3; UNVERIFIED by the report author, taken
   from repository documents).
2. **Upstream-shaped `bun_accel` series.** Rebase only the three original `bun_accel` commits (driver,
   helper, selftest) of `aphrody-labs/linux` on current `origin/master`; drop the Alpine-derived patches and
   the NVIDIA HMM option from that series; one identity; `scripts/checkpatch.pl --strict` and
   `scripts/get_maintainer.pl`; a benchmark in the commit message against `copy_file_range`/`FICLONE` and an
   `io_uring` OPENAT/CLOSE chain using Bun's `FileCopier.rs` workload; AI-assistance disclosure as required
   by `Documentation/process/generated-content.rst`; humans add `Signed-off-by` (rules VERIFIED, the
   commit-level facts are the owner's). Post as RFC to linux-fsdevel, io-uring and rust-for-linux; expect
   the review question "why not an io_uring opcode" (inference, UNVERIFIED). Not started; `aphrody-labs/linux`
   is not touched by this directory.
3. **Qualify "Bun as `/init`".** `bun build --compile` PID 1 plus initramfs (mkinitcpio hook or
   `CONFIG_INITRAMFS_SOURCE` for appliance images); PID 1 duties (zombie reaping, signals, mounts,
   switch_root, shutdown) in a documented module (`bun-supervisor` is the natural owner); a boot receipt
   (kernel hash, initramfs hash, boot log, idle memory) on QEMU and real hardware. The repository claim of a
   6.18.55 kernel booting into a Bun `/init` under QEMU/KVM (`docs/aphrody/merge/M-osbun.md`, status
   partial) is UNVERIFIED. The `linux-bun` config fragment already builds overlayfs, squashfs, erofs and
   virtio-net into the kernel for this step; the third Limine entry in
   `linux-bun/limine-linux-bun.conf.template` is its placeholder and is NOT QUALIFIED.

### Phase 1 (months 1-3): packaging and reliability

Weekly rebuild against Arch `linux` PKGBUILD updates; CI with 0-day-style `make LLVM=1 rustavailable`,
`CLIPPY=1`, kselftest `bun_accel` in QEMU; track `rust-version-policy`; decide Secure Boot or UKI;
publish rollback test results. (Checked here: kernel.org already lists 7.2.12, 7.2.13 and 7.3 while Arch's
packaging is at 7.2.11.arch1-1, so the first rebuild task is a real one.)

### Phase 2 (months 3-9): upstream engagement (track B)

Iterate the RFC to v3-v5 as Rust did; find a second maintainer (Rust-for-Linux or filesystem people);
offer the io_uring-opcode variant. Success: accepted into a subsystem tree, or a documented NAK with
reasons, after which the module stays in `linux-bun` as an out-of-tree Kbuild/DKMS module. The fallback is
functional because Bun degrades gracefully without `/dev/bun_accel` (UNVERIFIED by the report author;
upstream oven-sh/bun does not reference `bun_accel` at all, VERIFIED by grep in the report).
Upstream-reception predictions (io_uring-opcode preference, co-maintainer requirement, ioctl-number
objection) are inference, UNVERIFIED.

### Phase 3 (months 6-12): Bun as the control plane for kernel extensibility (tracks C and D)

sched_ext schedulers tuned for the Bun event loop (Rust `scx` schedulers ship in Arch; `CONFIG_SCHED_CLASS_EXT=y`
in Arch's 7.2.11 config, VERIFIED, and re-checked here against `linux-bun/config.x86_64`), BPF LSM policies,
cgroup/PSI management, all driven from Bun in userspace; kernel tooling kept `tools/`-style, never a kernel
build dependency. That `bun:linux` already has eBPF/netlink/perf bindings is UNVERIFIED (skill description
only).

### Phase 4 (research, 12+ months, optional)

Only if the earlier tracks succeed and a kernel maintainer asks for it: a Rust/BPF-hosted policy language or
Wasm-in-BPF experiments. Not JSC. The non-Linux and out-of-tree precedents (NetBSD Lua 2010, wasmjit,
Cervus, the HPI Wasm module, Riptides, a 2004 LKML thread) are all UNVERIFIED search summaries; Lunatik
(Lua in the Linux kernel, never upstreamed, Tom Herbert: "an uphill struggle") is VERIFIED.

### Exit metrics (mirror the Rust experiment's own exit criteria)

Real users (Bun OS images running `linux-bun`), contributors beyond one person, a maintainer outside the
org reviewing, an upstream subsystem accepting a patch, distribution adoption (Arch ships `bun_accel` only
if it is upstream; otherwise only Bun OS).

## The Rust-for-Linux precedent: what was actually required

### Timeline (VERIFIED unless marked)

| Date | Event |
|---|---|
| 2021-03 | Rust tree in linux-next (LWN 849849; merge commit message of `8aebac82933f` links it) |
| 2021-04-14 | first RFC `[PATCH 00/13] [RFC] Rust support`, Miguel Ojeda |
| 2021-07-03/04 | v1, 17 patches, 141 files, +33,003/-45, "still to be considered experimental" |
| 2021-12-06 | v2; stable rustc 1.57.0, edition 2021 |
| 2022-01-17 | v3 (UNVERIFIED, one source) |
| 2022-02 | v4 (date per LWN only) |
| 2022-08-02 | v8, 31 patches, 198 files, +43,688/-75; rustc 1.62.0 |
| 2022-09-15 | Maintainers Summit, Dublin: Linus will take Rust for 6.1 unless strong objections, wants a minimal infrastructure merge routed through Kees Cook |
| 2022-10-03 | merge `8aebac82933f` "Pull Rust introductory support from Kees Cook", "the absolute minimum to get Rust code building in the kernel", 173 credited people |
| 2022-12-11 | Linux 6.1, first release with Rust |
| 2023-10-18 | "The Rust experiment" section added to `Documentation/rust/index.rst` (`3857af38e57a`) |
| 2024-03-10 | 6.8: first Rust driver (Asix AX88796B PHY, `cbe0e4150896`) |
| 2025-02-20 | Linus on the DMA dispute: maintainers may stay out of Rust but then have no say over Rust users of their C API |
| 2025-12-13 | experiment concluded (`9fa7153c31a3`), in v7.0; 2026-02-10 merge `a9aabb3b839a` |

Elapsed: first RFC to merge about 17.5 months with 8+ revisions; merge to first in-tree driver 15 months;
merge to "experiment concluded" about 38 months; RFC to concluded about 4 years 8 months.

### Preconditions of the initial merge (checked by the report in the v6.1 tag, VERIFIED)

- Strictly opt-in: `CONFIG_RUST` depended on `HAVE_RUST`, `RUST_IS_AVAILABLE`, `!MODVERSIONS`,
  `!GCC_PLUGINS`, `!RANDSTRUCT`, `!DEBUG_INFO_BTF`; default off. (Checked here in 7.2.11: the symbol now
  reads `depends on HAVE_RUST`, `RUST_IS_AVAILABLE`, `!MODVERSIONS || GENDWARFKSYMS`, `!RANDSTRUCT`,
  `!DEBUG_INFO_BTF || (PAHOLE_HAS_LANG_EXCLUDE && !LTO)` and more.)
- Toolchain pinned exactly: `scripts/min-tool-version.sh` => rustc 1.62.0, bindgen 0.56.0 at v6.1; one
  rustc per kernel release; `make rustavailable` with `scripts/rust_is_available.sh`. (Checked here in
  7.2.11: rustc 1.85.0 (s390: 1.96.0), bindgen 0.71.1, LLVM 17.0.1.)
- Architecture honesty: `Documentation/rust/arch-support.rst` listed x86_64 only at v6.1 (checked here in
  7.2.11: arm, arm64, loongarch, riscv, s390, um, x86 listed with constraints).
- Scaffolding only: 28 `.rs` files under `rust/` and `samples/rust/`, none under `drivers/`: `alloc`
  adapted, `compiler_builtins`, `core` build, `macros`, `bindings` (bindgen) and `kernel` crates, Kbuild
  rules, kallsyms/`%pA`/checkpatch/decode_stacktrace changes, docs, `rust_minimal.rs`, a `MAINTAINERS` entry.
- Documentation-defined architecture: `Documentation/rust/general-information.rst` "Abstractions vs.
  bindings" (leaf modules such as drivers must not use C bindings directly), `no_std`, rustdoc, Clippy.
- Process: public linux-next soak (about 19 months), 173 credited contributors, Reviewed-by tags, CI by
  0-day, KernelCI and GitHub CI, cooperation with bindgen, the Rust language and the GCC front ends.
- "Experimental" status in every cover letter from v1; explicit docs section from 2023-10-18; removed
  2025-12-13.

### Acceptance criteria derived by the report (derived, not written down anywhere; "inference" where marked)

1. A named champion maintainer, an agreed upstream route and tree (Ojeda + Kees Cook, `rust-next`,
   `MAINTAINERS` entry, a mailing list); Linus accepts through someone he trusts.
2. A public, versioned review process: RFC, numbered revisions with changelogs, a long linux-next soak.
3. A minimal first merge: infrastructure only, default off, no behaviour change for anyone who does not
   enable it, no users required at first.
4. A precisely specified toolchain: exact then minimum versions, a build-time availability check, kernel
   docs of the requirements (`Documentation/process/changes.rst`), CI by 0-day/KernelCI plus upstream
   toolchain pre-merge CI.
5. Documentation in `Documentation/` and a coding style (`Documentation/rust/*`).
6. A boundary rule protecting C maintainers: leaf use first; opting out costs a C maintainer their say
   over the foreign-language side; the foreign-language side handles the fallout of C changes.
7. Honesty about platform coverage (arch-support table) and no regression on unsupported configs.
8. GPL-2.0-compatible licensing with SPDX tags (`Documentation/process/license-rules.rst`: GPL-2.0
   preferred; MIT, BSD-2/3, LGPL-2.0/2.1 allowed; Apache-2.0 only as a dual license).
9. An explicit "experiment" clause, a review forum (Maintainers Summit) and a defined exit criterion (real
   drivers, real users, a growing contributor base, distribution adoption).
10. Real in-tree users after the scaffolding: 15 months for the first driver, 3.5 years for Binder and Nova.
11. AI-assisted contribution rules: `Documentation/process/coding-assistants.rst` (2025-12-23) and
    `generated-content.rst`: AI agents must not add `Signed-off-by`; the human submitter certifies the DCO;
    disclose tools and prompts in cover letters and changelogs; bug-fix patches need reproducers;
    maintainers may reject a series outright.
12. Sustainability (inference): more than one maintainer, a funded lead (Google via ISRG Prossimo,
    UNVERIFIED), conference presence (LPC Rust MC, Kangrejos). A single-maintainer submission such as the
    `BUN_ACCEL` `MAINTAINERS` entry will be asked for co-maintainers.

### Objections the precedent had to survive (selected, from the report)

Architectures LLVM does not cover (partly open); learning curve and Rust not forced on C maintainers
(maintainers may decline; Rust side maintains the bindings, Linus 2025-02-20); language-spec instability
(fixed rustc first, then a minimum-version policy from 6.11 tied to Debian stable in 7.1); locking semantics
(Rust wrappers over kernel primitives, no semantic change to C locks); cross-language maintenance burden
(Hellwig, DMA mapping, 2025; fallout UNVERIFIED); undefined trial length (answered by the in-tree
"experiment" section, closed at the 2025 Maintainers Summit).

## Claims in this file that stay UNVERIFIED

Everything labelled so above, plus: every aphrody-labs qualification claim (QEMU boot, 7 selftests, NVIDIA
module builds, "6.18.55 boots into Bun /init"); legal conclusions about LGPL-2 JSC or BoringSSL inside a
kernel image and NVIDIA module licensing (not analysed by counsel); whether upstream has already discussed
an io_uring copy opcode (only the absence of such an opcode in the 7.4-window list was verified).
