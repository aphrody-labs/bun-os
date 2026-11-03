# Bun OS Windows userland

A complete native Windows equivalent of the Unix command line: Rust tools from pinned aphrody-labs forks,
cross-compiled on the build host with cargo-xwin for `x86_64-pc-windows-msvc`, optimised for the workstation CPU,
statically linked against the MSVC CRT (no VC++ redistributable, no MSYS2/Cygwin runtime DLL), signed with the Bun OS
test certificate and installed into the Windows directory next to `cmd.exe`.

Owners: `factory/windows/userland/` (tools.json, build.ts, stage.ts, install-system.ps1, uninstall-system.ps1,
verify.ts). Related: [POSIX-ON-WINDOWS.md](POSIX-ON-WINDOWS.md) (buncc providers, MSYS2/Cygwin decisions),
[WINDOWS.md](WINDOWS.md).

## Tool set

| Need | Tool (fork under `vendor/`) | Pinned at | Commands | Licence |
| --- | --- | --- | --- | --- |
| coreutils | uutils coreutils (`uutils/coreutils`, multicall, `--features windows`) | 0.12.0+843 | `coreutils` and its applets (`ls cp mv rm cat head tail wc sort tr cut ...`) | MIT |
| find, xargs | uutils findutils (`uutils/findutils`) | main | `find` (as `ufind`), `xargs` | MIT |
| diff, cmp | uutils diffutils (`uutils/diffutils`, multicall) | aphrody | `diffutils`, `diff`, `cmp` | MIT OR Apache-2.0 |
| sed | uutils sed (`uutils/sed`) | 0.3.0 | `sed` | MIT |
| grep | uutils grep (`uutils/grep`) | main | `grep` | MIT |
| bash-compatible shell | brush (`brush`) | main 18d616f3 | `brush` | MIT |
| structured shell | nushell (`nushell`) | 0.116.1+168 | `nu` | MIT |
| fast grep | ripgrep (`ripgrep`, with PCRE2) | 15.2.0 | `rg` | Unlicense OR MIT |
| fast find | fd (`fd`) | v10.5.0 | `fd` | MIT OR Apache-2.0 |
| replace | sd (`sd`) | v1.1.0 | `sd` | MIT |
| cat with syntax, pager front end | bat (`bat`) | v0.26.1 | `bat` | MIT OR Apache-2.0 |
| ls | eza (`eza`) | main | `eza` | EUPL-1.2 |
| du | dust (`du-dust`, bootandy/dust; `vendor/dust` is the DS emulator) | v1.2.7 | `dust` | Apache-2.0 |
| ps, top | procs (`procs`) | v0.14.12 | `procs` | MIT |
| benchmark | hyperfine (`hyperfine`) | v2.0.0 | `hyperfine` | MIT OR Apache-2.0 |
| make | just (`bun-just/vendor/just`, aphrody-labs/just branch bun) | 1.58.0 | `just` | CC0-1.0 |
| line counts | tokei (`tokei`) | v15.0.0 | `tokei` | MIT OR Apache-2.0 |
| cd | zoxide (`zoxide`) | v0.10.0 | `zoxide` | MIT |
| curl, wget | xh (`xh`) | v0.26.3 | `xh`, `xhs` (HTTPS default) | MIT |
| tar, zip, gzip, xz, bzip2, zstd, 7z, rar | ouch (`ouch`) | 0.8.3 | `ouch` | MIT |
| prompt | starship (`starship`) | v1.27.0 | `starship` | ISC |
| editor | helix (`helix`) | 25.07.1 | `hx` | MPL-2.0 |

SSH stays Windows OpenSSH (`System32\OpenSSH\ssh.exe`, already first-party on Windows); `vendor/bun-ssh` is a Bun
plugin, not a standalone client. Licence and notice files of every fork ship in `BunOS\userland\licenses\<tool>\`.

Shell choice: **brush** (reubeno/brush, MIT) is the bash-compatible shell. It is the only maintained Rust shell that
targets bash compatibility (functions, arrays, `[[ ]]`, brace expansion, `case`, `set -euo pipefail`, here-docs,
job control on Unix) and builds for windows-msvc upstream (Windows fixes through #1492, PATHEXT resolution, `/dev/null`
compatibility). GNU bash (`vendor/bash`) only builds for Windows on the MSYS2/Cygwin runtime, which this userland
rules out; nushell is kept as the structured shell but is not bash-compatible. brush is pinned to `main`
(brush-v0.4.0 + 336 commits) because the Windows fixes postdate the last release.

## Build (build host)

```sh
ssh vps
cd ~/src/bun-os && git submodule update --init --depth 1 vendor/brush vendor/ripgrep ...   # paths from tools.json
free -g                                                    # one big job at a time
bun factory/windows/userland/build.ts [--only a,b] [--keep-going]
```

`build.ts` re-executes itself in `build.slice` (`systemd-run --user --scope`), waits until `USERLAND_MIN_FREE_GIB`
(10) GiB are available before each tool, and builds one tool at a time through the build-lane wrapper
(`scripts/aphrody/build/rust/cargo-serial.sh`, shared sccache, per-tool target directory under
`~/build/cargo/windows-userland/<tool>`). Each tool is built with:

- `cargo xwin build --release --locked --target x86_64-pc-windows-msvc` at the fork's pinned commit;
- profile from tools.json through `CARGO_PROFILE_RELEASE_*`: `opt-level=3`, `lto=fat`, `codegen-units=1`,
  `panic=abort`, `strip=symbols`, `debug=false`. Exceptions: `panic=unwind` for brush, nushell, starship and helix
  (they catch panics to keep an interactive session alive); helix uses `lto=thin` (fat LTO of helix-term
  is the slowest link and thin measured within noise for an editor);
- `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-Ctarget-cpu=raptorlake -Ctarget-feature=+crt-static"` (merged by
  cargo-xwin with its own linker flags; target-only, so build scripts still run on the build host's CPU). The
  workstation is a 13th Gen Intel Core i7-13700F (Raptor Lake, AVX2/AVX-VNNI, no AVX-512). `USERLAND_TARGET_CPU=x86-64-v3`
  makes a build that runs on any AVX2 machine; the default binaries need a Raptor Lake/Alder Lake-class CPU;
- C dependencies (pcre2, libgit2, oniguruma, zstd, bzip3, unrar, ...) compile with clang-cl through a PATH shim that
  prepends `/clang:-march=raptorlake` (cargo-xwin owns `CC`/`CFLAGS`; cc puts sources after `--`, so the flags must
  be prepended). crt-static makes cc use `/MT`.

Output: `~/build/out/windows-userland/userland-<UTC stamp>-<repo rev>/` (`bin/`, `licenses/<tool>/`,
`share/helix/runtime/`, `logs/`, `manifest.json`), the tarball `<dir>.tar.gz` with `.sha256`, and the `latest`
symlink. `manifest.json` is the receipt: per tool the fork path, origin and upstream, commit, `git describe`,
version, licence, profile, build seconds, every file with sha256 and size, and the command names it provides; plus
rustc, cargo-xwin and clang-cl versions, target CPU, flags and failures.

## Stage, sign, install (workstation)

```sh
bun factory/windows/userland/stage.ts            # scp from vps, verify tarball + per-file sha256, sign, re-hash
C:/Windows/System32/sudo.exe pwsh -NoProfile -File factory/windows/userland/install-system.ps1
bun factory/windows/userland/verify.ts           # from a fresh shell
```

`stage.ts` extracts to `%LOCALAPPDATA%\bunos\userland\staging\<build>`, signs every `.exe` with the Bun OS test
certificate (`factory/windows/signing/test-signing.ps1 sign`, SHA-256 + RFC 3161 timestamp, through `sudo.exe`),
checks each signature is `Valid` with one signer, and rewrites the manifest: `sha256` is the signed file,
`buildSha256` the build host's, and `signing` records subject and thumbprint.

### Layout

| What | Where |
| --- | --- |
| Binaries (multicall and single), licences, helix runtime, manifest, install record, both scripts | `%SystemRoot%\BunOS\userland\` |
| Commands | `%SystemRoot%\System32\<name>.exe`, hard links to the payload (same volume; copy fallback) |
| `HELIX_RUNTIME` | machine environment, `%SystemRoot%\BunOS\userland\share\helix\runtime` (hx resolves its runtime next to the executable, which is System32 for a link) |

No PATH change: System32 is already the first PATH entry, so the tools work in cmd, PowerShell, Windows Terminal,
brush and nu like `cmd.exe` does, and they win over older copies elsewhere on PATH (Git for Windows `usr\bin` is not on
PATH here; winget or cargo copies of rg/fd/hyperfine come later in PATH).

### Collision rules (never shadow Windows)

`install-system.ps1` decides per command name, on the target machine, before changing anything:

1. A name that exists with any `PATHEXT` extension in System32, SysWOW64, `%SystemRoot%`, Wbem,
   WindowsPowerShell\v1.0 or OpenSSH (and is not a file this installer recorded) gets the uutils `u` prefix:
   `ufind`, `usort`, `uwhoami`, `uhostname`, `uexpand`, `umore`, `utimeout`, ... The coreutils and diffutils multicalls
   dispatch on the name suffix, so `usort` runs `sort`. If `u<name>` also exists, the command stays only inside its
   multicall (`coreutils <name>`).
2. `link` (would shadow the MSVC linker for anything resolving `link.exe` through PATH) and names Windows' installer
   detection auto-elevates (`install`, `setup`, `update`, `patch`) are never linked: `coreutils install`.
3. WSL's `System32\bash.exe` stays; the shell is `brush.exe`. No `sh.exe` is installed (CMake's "MinGW Makefiles"
   generator and some build scripts change behaviour when `sh.exe` is on PATH).
4. Built-ins still win in their own shell: cmd's `dir`, `echo`, `mkdir`, `rmdir`, `type`, ... and PowerShell's
   aliases (`ls`, `cat`, `cp`, `mv`, `rm`, `sort`, `tee`, `sleep`, `echo`). Use `ls.exe` in PowerShell, or brush/nu.
   In a POSIX session that wants GNU names for the renamed ones, put a directory of `find.exe`/`sort.exe` links first
   on PATH (verify.ts does this for its brush script).

The install is idempotent (unchanged files are skipped), refuses to overwrite any file it does not own (planned for
all files before the first write), verifies every sha256 and Authenticode signature (thumbprint from the manifest),
and writes `install-record.json` (every file with hash and kind, environment changes with previous values, and the
decision for every command). Upgrades replace only recorded files whose hash still matches. `-Plan` prints the
decisions without writing; `-Root`/`-LinkDir` install the same way into a staging directory without elevation.

Uninstall (removes exactly what the record lists, hash-checked, restores `HELIX_RUNTIME`):

```sh
C:/Windows/System32/sudo.exe pwsh -NoProfile -File C:/Windows/BunOS/userland/uninstall-system.ps1
```

32-bit processes see `SysWOW64` instead of `System32` (file system redirection) and do not find the tools; use
`%SystemRoot%\Sysnative\<name>.exe` from them.

Upgrades: `stage.ts` keeps the signed copy of every binary whose build hash did not change, so re-staging the same
build re-signs nothing and the reinstall is a no-op. A replaced file that is running (Windows cannot delete a running
executable) is renamed into `BunOS\userland\.trash\`, emptied at the next install or uninstall.

## State on 2026-11-03

Build `userland-20261103T061842Z-0d67c465ff` on the build host (`~/build/out/windows-userland/`, tarball 71.8 MiB):
22 tools, 23 binaries (183 MiB), 1037 payload files, signed by `CN=Bun OS Test Signing, O=Aphrody`, thumbprint
`1E67DBDB0D46A61CF57D286A5562DD76675D4E87`. Toolchain: rustc 1.99.1 (nushell, helix and brush use their pinned
toolchains), cargo-xwin 0.23.1, MSVC CRT 14.44 + Windows SDK 10.0.26100 (xwin splat). Imports of the binaries are
only Windows system DLLs (`kernel32`, `ntdll`, `bcryptprimitives`, `api-ms-win-core-*`); no `vcruntime140.dll` or
`ucrtbase.dll`. Build times on the build host (fat LTO, one tool at a time): nushell 28 min, helix 9.5 min, brush 8 min,
starship 7 min, the rest 0.5 to 5 min each; the first run also splats the SDK (about 30 min, CPU bound).

Installed with `C:\Windows\System32\sudo.exe pwsh -NoProfile -File factory\windows\userland\install-system.ps1`
(Windows Sudo, inline): 117 commands in System32 (hard links, 92 of them to `coreutils.exe`), 8 renamed or
multicall-only:

| Command | Installed as | Reason |
| --- | --- | --- |
| `find` | `ufind` | `System32\find.exe` |
| `sort` | `usort` | `System32\sort.exe` |
| `more` | `umore` | `System32\more.com` |
| `expand` | `uexpand` | `System32\expand.exe` |
| `hostname` | `uhostname` | `System32\hostname.exe` |
| `timeout` | `utimeout` | `System32\timeout.exe` |
| `whoami` | `uwhoami` | `System32\whoami.exe` |
| `link` | `coreutils link` | MSVC `link.exe` |

## Verification

`bun factory/windows/userland/verify.ts`, run from a fresh environment (machine + user PATH read from the registry,
no Git Bash PATH): all checks passed. 109 linked commands answer `--version` (or `--help`; `[`, `test`, `true`,
`false`, `yes`, `xhs` and the diffutils trio, which has no `--version` upstream, are exercised otherwise). Real work:
`mkdir -p`, `cp -r`, `ls -la`, `ufind -name -type f`, `sed -i`, `diff -u`, `cmp`, `usort`, `rg`, `fd`, `grep -c`,
`wc -l` from stdin, `ouch` tar.zst round trip, `nu -c "ls | length"`, and a brush script with `set -euo pipefail`,
a function with `local`, an indexed array, `$(...)` pipelines, `[[ ]]`, brace expansion and `case`. `hx --health`
finds the runtime through `HELIX_RUNTIME`; Authenticode status of every installed binary is `Valid`.

## Benchmarks

`bun factory/windows/userland/bench.ts`: hyperfine 2.0 (the installed one), `-N`, warmup 2, at least 5 runs, output
piped (with output to NUL GNU grep exits after the first match). Baseline: the GNU tools of Git for Windows 2.56
(`C:\Program Files\Git\usr\bin`, MSYS2 runtime). Input: a generated 2,000,000-line, 56 MB file and the
`vendor/nushell` tree. i7-13700F, Windows 11 build 28120.

| Case | GNU (Git for Windows) | Bun OS userland | GNU / ours |
| --- | --- | --- | --- |
| sort 56 MB | 517.3 ± 11.6 ms | 1486.2 ± 30.0 ms | 0.35x |
| wc -l 56 MB | 39.9 ± 3.5 ms | 22.2 ± 3.3 ms | 1.80x |
| sha256sum 56 MB | 154.1 ± 6.2 ms | 50.3 ± 4.1 ms | 3.06x |
| grep -c gamma (uutils grep) | 124.0 ± 3.9 ms | 46.7 ± 3.4 ms | 2.66x |
| grep -c gamma (ripgrep) | 126.1 ± 5.0 ms | 81.4 ± 5.5 ms | 1.55x |
| sed s/alpha/omega/g 56 MB | 1519.0 ± 21.9 ms | 834.8 ± 62.0 ms | 1.82x |
| cut -d' ' -f2 | 1319.3 ± 18.5 ms | 72.1 ± 3.1 ms | 18.29x |
| find tree -name *.rs (uutils find) | 75.5 ± 6.4 ms | 35.0 ± 3.2 ms | 2.16x |
| find tree -name *.rs (fd) | 73.6 ± 5.8 ms | 20.9 ± 3.5 ms | 3.52x |
| ls -laR tree | 265.6 ± 14.3 ms | 78.4 ± 4.4 ms | 3.39x |
| grep -r fn tree (ripgrep) | 313.2 ± 12.8 ms | 53.6 ± 4.0 ms | 5.84x |
| shell startup: -c true (bash vs brush) | 17.3 ± 3.6 ms | 12.7 ± 3.1 ms | 1.37x |
| shell loop 20k iterations (bash vs brush) | 105.3 ± 5.7 ms | 89.5 ± 5.3 ms | 1.18x |

The one regression is uutils `sort` on a large file (2.9x slower than GNU sort); for big sorts use `nu`
(`open --raw f | lines | sort`) or GNU sort until uutils closes the gap.

## Gaps

- **procps**: uutils procps builds for Windows only with a feature subset, and those utilities read `/proc`: `ps`
  and `pidof` panic, `pgrep` finds nothing, `free` prints wrong numbers; `top` needs libsystemd. It is not installed.
  Use `procs` (ps/top), `nu` (`ps`, `sys mem`) or `Get-Process`. `uutils/util-linux` is Linux-only and not built.
- **coreutils applets**: the `windows` feature set has 92 applets; the Unix-only ones are absent (`chmod`, `chown`,
  `chgrp`, `chroot`, `id`, `groups`, `install`, `logname`, `mkfifo`, `mknod`, `pinky`, `stat`,
  `stty`, `users`, `who`). `install` is not built for Windows, so the installer-detection rule never triggers today.
- **awk**: no Rust awk builds for windows-msvc with gawk compatibility (frawk needs LLVM or Cranelift JIT and is
  not maintained for Windows); use `nu`, or busybox-w32 awk from the buncc `posix` provider.
- **less**: no Rust `less`; `bat` pages only through an external pager (falls back to plain output), so use
  `bat --paging=never`, `hx` for reading, nu `explore`, or Windows `more.com`.
- **tar, curl, wget, ssh, make**: no drop-in Rust CLI. `ouch` (tar, zip, gz, xz, bz2, bz3, zstd, 7z; no RAR, the UnRAR
  licence is not open source) and `xh` (HTTPie syntax) have their own CLIs; Windows' `tar.exe` (bsdtar) and
  `curl.exe` stay. SSH stays Windows OpenSSH. `just` is not Makefile-compatible; GNU make (`vendor/make`) is C on
  the MSYS2/MinGW stack.
- **bash**: brush covers the tested bash constructs but is not complete bash (job control and some `shopt`s behave
  differently on Windows); there is no `sh.exe`/`bash.exe` (see the collision rules).
- **helix grammars**: the runtime ships themes and queries, not compiled tree-sitter grammars (each is a C/C++
  library fetched by `hx --grammar fetch` and built by `hx --grammar build` with a local C compiler).
- **CPU**: binaries target Raptor Lake (`-Ctarget-cpu=raptorlake`); for other machines build with
  `USERLAND_TARGET_CPU=x86-64-v3`.
- **32-bit processes**: see SysWOW64 above.
