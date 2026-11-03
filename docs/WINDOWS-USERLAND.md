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
| ps, pgrep, ... | uutils procps (`uutils/procps`) | main | see Gaps | MIT |
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

## Verification

<!-- verification -->

## Benchmarks

<!-- benchmarks -->

## Gaps

<!-- gaps -->
