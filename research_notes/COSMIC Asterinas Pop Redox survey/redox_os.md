# Redox OS (gitlab.redox-os.org/redox-os) — research notes, as of 2026-10-30

Method note: ~12 fetches/searches. GitLab group/project pages render poorly through the fetcher (no repo list, no README body), so repo ownership is partly drawn from the `redox` README summary and monthly news posts. Items I could not verify are in Gaps.

## What are the main repos under gitlab.redox-os.org/redox-os and what does each own?

### Takeaway
The `redox` repo is the build system (a Podman-based `make` flow) and the entry point. It lists the kernel, base (system components and drivers), RedoxFS, relibc, Ion, Termion, pkgutils, Orbital, Redoxer, the Book and the website as its components. The old `cookbook` repo is archived, with recipes merged into `redox`.

### Cited Findings
- `redox-os/redox` is "Redox: A Rust Operating System", created 2018-06-09, with about 10.4k commits, 28 tags and 27 releases at fetch time, under an MIT license — [GitLab redox](https://gitlab.redox-os.org/redox-os/redox)
- Its README calls it the Build System repo and lists these components: Kernel, Base (essential system components and drivers), RedoxFS (default filesystem), relibc (C POSIX library in Rust), Ion (default shell), Termion (terminal library), pkgutils (package manager), Orbital (display server and window manager), Redoxer (Redox dev tool on Linux), the Redox Book and the website. Builds use Podman. Most are maintained by @jackpot51 (Jeremy Soller) — [redox README](https://gitlab.redox-os.org/redox-os/redox/-/raw/master/README.md)
- `redox-os/cookbook` is archived and read-only. Its contents were merged into `redox`. MIT, created 2018-06-10, 3,844 commits — [GitLab cookbook](https://gitlab.redox-os.org/redox-os/cookbook)
- Recipe layout: each recipe is a directory under `recipes/` with `recipe.toml`. Legacy `recipe.sh` cannot be used as a dependency. Build output is under `recipes/<recipe>/target/${TARGET}/` (`source`, `build`, `stage`, `sysroot`, `toolchain`, `stage.pkgar`, `stage.toml`). The Redox page does not mention git submodules. `make repo-lock` and `make repo-unlock` pin or unpin recipe commit hashes. Recipes fetch git repos or tarballs, and `make rebuild` checks out each git recipe's `master` — [Redox Book build system reference](https://doc.redox-os.org/book/build-system-reference.html)
- Recipe conversion from shell scripts to TOML was completed by Sep 2025 — [This Month in Redox, Sep 2025](https://www.redox-os.org/news/this-month-250930/)
- Config files: `mk/config.mk` (defaults), root `.config` (overrides, git-ignored), `config/*.toml` image variants (`base`, `minimal`, `server`, `desktop`, `dev`, `demo`, plus `acid` and `os-test`), and per-arch and per-board configs. Output is `build/$ARCH/<config>/harddrive.img` and `redox-live.iso`. `make prefix` downloads the Rust and GCC forks and builds relibc, while `make all` downloads the Redox toolchain (patched rustc, GCC, LLVM) — [Redox Book build system reference](https://doc.redox-os.org/book/build-system-reference.html)
- A new test-results repository for os-test and Open POSIX Test Suite results was created in Sep 2025 — [This Month in Redox, Sep 2025](https://www.redox-os.org/news/this-month-250930/)

### Inferences
- The "base" repo appears to bundle drivers and core daemons, which were formerly many separate repos. This is inferred from the README wording, so verify before pinning.
- For a pinned-owner model, the practical pins are `kernel`, `relibc`, `redoxfs`, `base`, `orbital`, `pkgutils` and `redox` (for recipes and configs).

### Gaps
- I could not retrieve the full group repo list (the fetcher returned only the group name). Whether `drivers`, `ion`, `orbital` and `pkgutils` are still standalone repos or merged into `base` is unconfirmed.
- I found no submodule list for `redox`. The Book does not mention submodules, and the fetched README gave no detail.

## What is the current release/maturity state and what software runs?

### Takeaway
The latest numbered release is still 0.9.0 (2024-09-09). No release newer than 0.9.0 was found as of Oct 2026. Progress ships as monthly reports and daily server/desktop images. COSMIC components, Node.js, Vulkan (software) and a server stack run.

### Cited Findings
- 0.9.0 was released 2024-09-09. It was the first release since 0.8.0 and the first since the nonprofit was created. It brought NLnet-funded process/signal rework, faster syscalls and context switching, the `p2buddy` allocator, COSMIC Files/Editor/Terminal, relibc almost entirely Rust (except libm), and about 1,700 WIP ports. USB did not make it, VirtualBox was broken, and NVMe boot was supported — [Redox 0.9.0](https://redox-os.org/news/release-0.9.0)
- The release images were Demo (1536 MiB), Desktop (512 MiB) and Server (512 MiB), and x86_64 was the primary target — [Redox 0.9.0](https://redox-os.org/news/release-0.9.0)
- The news index (fetched Oct 2026) shows monthly posts through Sep 2026, and the latest release post is still 0.9.0. Other recent posts: "Ring Buffers Project Summary" (2026-10-25, NLnet-looking URL), RSoC 2026 EEVDF scheduler (Akshit Gaur), and "Capability-based Security: Namespace and CWD as capabilities" (2026-03-17) — [Redox news](https://www.redox-os.org/news/)
- Sep 2026: users are told to test the daily `server` or `desktop` images, though some may be outdated and a source build may be needed. COSMIC apps got more dynamic linking (Wildan Mubarok) and faster compiles through recipes on `-sys` crates — [This Month in Redox, Sep 2026](https://www.redox-os.org/news/this-month-260930/)
- Feb 2026: `cosmic-comp` ran as a winit window (proof of concept, no input yet). COSMIC Settings ran with limited options. COSMIC Store moved to OpenSSL 3. Lavapipe (Mesa software Vulkan) works. Node.js 21.7.3 runs (npm, Vite). os-test runs on multi-core QEMU. A Lenovo IdeaPad 710S booted to Orbital — [This Month in Redox, Feb 2026](https://www.redox-os.org/news/this-month-260228/)
- Aug 2025: COSMIC Reader ported — [This Month in Redox, Aug 2025](https://www.redox-os.org/news/this-month-250831/). OSNews also covered COSMIC Reader — [OSNews](https://www.osnews.com/story/143242/redox-gets-cosmic-readers-and-tons-of-bugfixes/)
- Sep 2025: multi-threading on by default on x86. RedoxFS got inline small-file data, LZ4 compression and a clone feature (install about 10x faster). Ports include OpenSSH, Nginx, PHP, Neovim, CPython 3.12, OpenSSL 3, rsync and a "Server Demo". Pixel 3 (screen only) and BlackBerry KEY2 LE (keyboard missing) are targets. Compile-time ordered-lock deadlock detection was added, and the kernel moved to Rust 2024 edition — [This Month in Redox, Sep 2025](https://www.redox-os.org/news/this-month-250930/)
- Sep 2026 package versions: uutils 0.11.0, OpenSSH 10.5p1, SDL2 libs updated — [This Month in Redox, Sep 2026](https://www.redox-os.org/news/this-month-260930/)

### Inferences
- Maturity is hobby-to-early-product: a daily-image, rolling model with no release since 2024, and real hardware is hit-or-miss. A pinning workflow would track git commits and not release tags.
- Servo: I did not verify the current Servo status. See Gaps.

### Gaps
- Servo on Redox: not confirmed in the sources I fetched.
- Whether a 0.10 or 1.0 is scheduled: no source found.
- Secondary mentions of a "Vulkan, Node.js, COSMIC" article and a laseroffice.it article ("Oct 2025 to Jul 2026") surfaced in search but were not fetched ([lavx](https://news.lavx.hu/article/redox-os-makes-major-strides-with-vulkan-node-js-and-cosmic-desktop-integration), [laseroffice](https://www.laseroffice.it/blog/)). Treat them as unverified aggregators.

## Architecture, kernel, relibc, drivers, RedoxFS, Orbital, pkg

### Takeaway
Redox is a Rust Unix-like microkernel OS with a "everything is a scheme/URL-like resource" API. Since 0.9 paths are Unix-style. relibc is the planned stable ABI surface, and drivers run in userspace and are moving to a Linux-DRM-style graphics API.

### Cited Findings
- General-purpose Unix-like OS in Rust on a microkernel design, modest POSIX compatibility, inspired by Minix and Plan 9, and also seL4, Linux, FreeBSD and OpenBSD — [Redox Book](https://doc.redox-os.org/book/)
- 0.9.0: the Unix path format replaced the URI format in system interfaces. The kernel image is bootloader-agnostic. RedoxFS got "records". Orbital is supported by Slint, Iced and winit. The Contain sandbox driver was expanded. An Ion language server was added — [Redox 0.9.0](https://redox-os.org/news/release-0.9.0)
- Stable ABI policy: only libredox is to be ABI-stable. relibc is unstable during heavy development, `redox_syscall` stays unstable even after 1.0, the goal is a stable ABI through all 1.x versions, and a break means 2.x. Stable ABI, a server version, self-hosting (rustc is the blocker) and performance were the 2023/24 priorities — [Libraries and APIs](https://doc.redox-os.org/book/libraries-apis.html); [Development Priorities 2023/24](https://redox-os.org/news/development-priorities-2023-09/)
- Sep 2026 drivers: video and graphics drivers moved to the Linux DRM API (bjorn3) with DRM events. Intel Tiger Lake external display hotplug (Soller). VirtIO-GPU multi-display fixed and a basic network block device driver added. Intel HDA panic and PS/2 boot hang fixed — [Sep 2026](https://www.redox-os.org/news/this-month-260930/)
- Sep 2026 relibc: added `getentropy`, `gethostbyname2` (AF_INET only), `readv`/`writev`, `posix_madvise`, `getrlimit`/`setrlimit` (first step), plus ARM64 TLS/weak symbol fixes — [Sep 2026](https://www.redox-os.org/news/this-month-260930/)
- Feb 2026 kernel/relibc: filesystem ops unified under `SYS_CALL`, a position-independent dynamic linker, real-time signals, and byte-range `fcntl` locks — [Feb 2026](https://www.redox-os.org/news/this-month-260228/)
- Mar 2026: capability-based namespace and CWD work (Ibuki Omatsu). 2026 projects: EEVDF scheduler (RSoC, Akshit Gaur) and ring buffers (NLnet-linked) — [Redox news](https://www.redox-os.org/news/)
- Aug 2025: xHCI/NVMe interrupt cleanup, ARM virtual timer, GDB debugging for drivers, Orbital fullscreen — [Aug 2025](https://www.redox-os.org/news/this-month-250831/)
- Package manager: the README lists pkgutils. The recipe output is `stage.pkgar`, and the pkgar format is used. I fetched no `pkg` documentation — [Build ref](https://doc.redox-os.org/book/build-system-reference.html)

### Inferences
- A Rust-centric distribution would gain mostly from relibc, redoxfs and the kernel and drivers. Note the kernel and drivers rely on the Redox scheme model, so they are not drop-in for another kernel.

### Gaps
- Exact kernel crate layout, the pkg command interface and the repo server model were not retrieved.

## Targets, hardware and VM support

### Takeaway
x86-64 is the primary and best-supported target. ARM64, RISC-V and i586 are packaged and CI-tested with caveats.

### Cited Findings
- Sep 2026: packages exist for x86-64, ARM64, RISC-V and i586. RISC-V boot testing is on CI, and RISC-V and i586 testing are enabled in Redoxer. Page-fault handling works only on x86-64 and i586. i586 dynamic linking was fixed, though few programs target it — [Sep 2026](https://www.redox-os.org/news/this-month-260930/)
- 0.9.0: partial Raspberry Pi 3B+ support and Orbital on ARM64 in QEMU. VirtIO drivers added. A VM is recommended first — [Redox 0.9.0](https://redox-os.org/news/release-0.9.0)
- Feb 2026: frame pointers on for x86-64, ARM64 and RISC-V, giving crash stack traces — [Feb 2026](https://www.redox-os.org/news/this-month-260228/)
- Build config names use `aarch64`, `riscv64gc` and `x86_64` — [Build ref](https://doc.redox-os.org/book/build-system-reference.html)

### Gaps
- No current hardware compatibility list was retrieved. USB status after 0.9 is only indirectly known (Sep 2025 xHCI and hotplug fixes).

## Funding, governance, licensing, toolchain

### Takeaway
Redox is a nonprofit with a board, funded by donations, Patreon, merch, crypto, NLnet grants and sponsors. The project is MIT licensed. It needs a patched Rust and GCC toolchain from its own static server.

### Cited Findings
- First Board of Directors elected 2023-06-21 — [Redox news](https://www.redox-os.org/news/)
- Crypto donations accepted since 2024-03; merch fundraising 2024-01 — [Redox news](https://www.redox-os.org/news/)
- Sep 2026: Ron Williams says donors are needed especially for Redox Summer of Code. The project seeks corporate sponsors and takes donations via Donate, Patreon and merch — [Sep 2026](https://www.redox-os.org/news/this-month-260930/)
- 0.9.0 process rework was NLnet-funded — [Redox 0.9.0](https://redox-os.org/news/release-0.9.0)
- Aug 2025: part-time build engineer hired (Wildan Mubarok), and the project was still seeking a kernel/core engineer — [Aug 2025](https://www.redox-os.org/news/this-month-250831/)
- License: MIT on `redox` and `cookbook` — [redox](https://gitlab.redox-os.org/redox-os/redox), [cookbook](https://gitlab.redox-os.org/redox-os/cookbook)
- Toolchain: Redox uses patched rustc, GCC and LLVM downloaded as the "Redox toolchain". The Book page does not state a nightly channel — [Build ref](https://doc.redox-os.org/book/build-system-reference.html). The kernel is on the Rust 2024 edition (so recent toolchain) — [Sep 2025](https://www.redox-os.org/news/this-month-250930/)

### Inferences
- Reusing individual crates under MIT is permissive. Ports in recipes keep their own upstream licenses (GPL, etc.), so a distribution must track per-recipe licenses.
- The cross-compile toolchain and relibc-linked builds mean a Windows-hosted or non-Podman flow is a constraint. Builds are Podman or Linux-oriented.

### Gaps
- Licenses of relibc, kernel, redoxfs, and Orbital individually (assumed MIT; not verified). The exact nightly pin (rust-toolchain.toml) was not retrieved. The Redox Summer of Code budget and the annual funding figures were not found. The release cadence for any 0.10 or 1.0 is unknown.
