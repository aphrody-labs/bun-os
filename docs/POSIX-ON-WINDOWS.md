# POSIX on Windows: decision table

Owner order: `buncc` and `@aphrody/windows` replace or unify MSYS2, MinGW, GnuWin32, Cygwin, Wine and Proton. Rule: adopt
existing projects, drive them through `buncc` providers, do not reinvent them. Versions and dates were read on 2026-10-29
(`gh api repos/<owner>/<repo>/releases/latest`, project documentation, Microsoft Learn, Bun docs and direct runs of Bun 1.4.4).

Decisions: **REPLACE** = bun-os stops depending on it, a pinned replacement exists. **UNIFY** = one `buncc` provider
detects, pins and drives it. **DROP** = no provider; only detection and removal. **KEEP** = unchanged, not ours.

## Table

| Project | Latest checked | Decision | Measurable reason |
|---|---|---|---|
| MSYS2 runtime and `usr/bin` userland | installer 2026-09-27 | REPLACE for scripts | Scripts need `ls cat sed grep find diff tar`, which `provider posix` supplies natively (smoke-tested here). The only repo user left is `scripts/aphrody/tools/toolchain-sync.ps1` (rsync, pigz): audit below |
| MSYS2 package repos (ucrt64, clang64, clangarm64) | same | UNIFY (`msys2` provider) | Native Windows binaries, no `msys-2.0.dll`. Managed copy is the pinned `msys2-base-x86_64-20260927.tar.xz` (sha256 from GitHub) driven by MSYS2's own pacman. An existing install is detected read-only and never put on PATH |
| pacman of bun-os | `vendor/pacman` (fork) | not used to drive MSYS2 | `crates/bun-os-pkg` is a content-addressed store, not libalpm; the pacman sources are the `vendor/pacman` submodule and the TS readers in `packages/package-converter/src/{alpm,pacman-db}.ts`. Nothing here can install into an MSYS2 root, so MSYS2's pinned pacman is used. Revisit when a libalpm Windows build exists |
| mingw-w64 (upstream) | v14.0.0 | UNIFY via llvm-mingw | Source project, no binary releases and no GitHub releases; consumed through the distributions below |
| llvm-mingw (mstorsjo) | 20261020, ucrt | UNIFY, managed default | Ships clang+lld+mingw-w64 for x86_64 and aarch64 (also i686, armv7), hosts Windows/Linux/macOS, zip asset, GitHub digest. Compiled and ran x86_64 here, built an ARM64 PE (not run) |
| winlibs (brechtsanders) | 16.2.0 / LLVM 23.1.3 r3 | UNIFY, detect only | 263-404 MB per archive, 7z; GCC users point `WINLIBS_HOME` at it |
| w64devkit (skeeto) | v2.10.1 | UNIFY, detect only | Asset is a self-extracting `.7z.exe`; buncc does not execute downloaded installers, set `W64DEVKIT_HOME` |
| GnuWin32 | abandoned (~2010) | REPLACE | Repo references: 0. Replaced by uutils coreutils 0.12.0, findutils 0.10.0, diffutils v0.6.0, busybox-w32 FRP-6354 (sed, awk, grep, tar), ripgrep 15.2.0, fd v10.5.0, sd v1.1.0. `uutils/util-linux` has no releases: `vendor/uutils/util-linux` stays a source |
| Cygwin | n/a | DROP | Emulation DLL, no consumer in bun-os build or tests (matches are third-party headers). Detection and removal only |
| Git for Windows bash and `usr` tools | v2.56.0.windows.4 | KEEP, protected | The user's git. `posix uninstall` refuses any path that is, contains or sits inside it. CI keeps `shell: bash` only for bootstrap |
| Wine | Kron4ek/Wine-Builds 11.20 | UNIFY (`wine`), Linux/macOS | Cannot be replaced. Pinned staging build, prefixes owned by buncc, `buncc wine run|prefix|doctor`. Fork sources: `vendor/wine-cachyos` |
| Proton | proton-cachyos cachyos-11.0-20261015-slr | UNIFY (`proton`), Linux | Same; GE-Proton11-11 and Valve proton-11.0-2 (no assets) are alternatives. Fork sources: `vendor/proton`, `vendor/proton-cachyos` |
| dxvk, vkd3d-proton | v3.1.1, v3.1 | UNIFY with wine | Installed into a prefix by `--dxvk --vkd3d` |
| Zig cc | n/a | DEFER | Used by profile `glibc-gnu`; no provider added, nothing measured against clang here |
| clang + lld cross sysroots | `cargo-xwin` provider | KEEP | Already a provider (`xwin`) |

Counts (15 rows): REPLACE 2, UNIFY 8, DROP 1, KEEP 2, DEFER 1, not used 1.

## Providers (packages/buncc)

- `posix`: `buncc env posix --ensure` downloads uutils, ripgrep, fd, sd (GitHub sha256) and busybox-w32 (sha256 pinned in code from `frippery.org/files/busybox/SHA256SUM`, whose `.sig` was not checked), and builds one shim directory (81 shims on Windows). `buncc sh` runs a script with Bun Shell.
- `mingw`: `buncc install mingw --run`; profile `win32-mingw`; env sets `CC_*`, `CARGO_TARGET_*_LINKER` for `*-pc-windows-gnullvm`.
- `msys2`, `wine`, `proton`: as above. On Windows `buncc wine ...` and the wine/proton detection print "not applicable".
- `buncc posix uninstall <msys2|mingw|gnuwin32|cygwin|all> [--yes]`: dry run by default.

`buncc sh` is Bun Shell, not bash: no `for`, `case`, `if`, arrays or `[[`. `$NAME` is expanded by Bun; `${NAME}` is not
(measured on 1.4.4), so buncc rewrites the plain braced form and reports operator forms (`${X:-d}`) it cannot. Scripts using
those constructs stay `.sh` for a real bash or become TypeScript.

## Path translation

`cygpath` (MSYS2, Cygwin) and `wslpath` (WSL) already translate paths and are the owners; the unused TypeScript copy under `packages/windows/src/posix` (no importer, not exported by the package) was deleted.

## Migration proof

`bun scripts/posix-deps-audit.ts [ref]` counts the dependants with `git grep`.

| Pattern | before (HEAD 403006fa7c) | after |
|---|---|---|
| msys2 / msys64 | 15 lines, 6 files | 7 lines, 5 files |
| hard-coded `C:\msys64` | 7 lines, 3 files | 1 line, 1 file (default of `$msysRoot`, overridable by `MSYS2_ROOT`) |
| CI `shell: bash` | 12 lines, 4 files | 6 lines, 3 files |
| mingw | 46 lines | 53 lines: higher because new text names the buncc `mingw` provider, not new dependence |
| cygwin | 27 lines | 27 lines (third-party headers) |
| gnuwin32 | 0 | 0 |

Changed: `setup-workspace` action (7 steps) runs `buncc sh`; `tools.ts` gcc/g++ stop installing MSYS2 and use the managed mingw
directory; `driver.ts` likewise; `toolchain-sync.ps1` takes `MSYS2_ROOT`. Residual: rsync and pigz in `toolchain-sync.ps1` still
need an existing MSYS2 (no pinned portable rsync was chosen), and `setup-bun` and `release.yml` keep `shell: bash`
(bootstrap before Bun exists; GNU `tar`, `sha256sum` on the Windows runner).

## Uninstalling the old stacks

`buncc posix uninstall all` detects (read-only) installer, winget, Scoop, Chocolatey and portable installs, then prints: folders,
PATH entries (user, machine, process), registry keys, shortcuts, dependents (VS Code, Windows Terminal, cargo, git config that
mention the root; `*-pc-windows-gnu` Rust toolchains) and the steps. With `--yes` it first writes a backup (PATH, `pacman -Qqe`
and `-Qqm`, MSYS2 home dotfiles and `pacman.d`, `reg export` of each key, `cygcheck -c`), then runs the smoke test of the
replacements (uutils, busybox, ripgrep, and a mingw compiler when MSYS2 or MinGW is being removed; an MSYS2 mingw tree does not
count), and only then removes. A failing smoke test stops before any removal. Every step is checked after it ran (registry query, file system, PATH re-read, polling up to 60 s for uninstallers) and is printed "done" only when its effect is observed, else "FAIL <reason>" and the run stops. Without an elevated token, steps on HKLM, Program Files or the machine PATH are marked "needs elevation" in the plan and are never attempted; buncc does not elevate itself. Inno Setup uninstallers (`unins000.exe`, `_is1` keys) get `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` (jrsoftware.org/ishelp, "Uninstaller Command Line Parameters"; the page does not say whether the process returns before the work is done, hence the polling). winget uninstalls use `--id <Publisher.Package> --exact --source winget --silent --disable-interactivity` (never `--name`, which matches substrings) and run only if `winget list --id` finds the package; Scoop installs are looked for per user (`$env:SCOOP`, `%USERPROFILE%scoop`) and global (`$env:SCOOP_GLOBAL`, `%ProgramData%scoop`, removed with `scoop uninstall -g`, elevated), and `--purge` (persisted data) is only passed when you give `--purge` to `buncc posix uninstall`. Deletion is limited to the detected roots and
shortcuts; Git for Windows is never touched. Rollback: restore PATH from `path.json`, `reg import` the `.reg` files,
reinstall MSYS2 and `pacman -S --needed - < msys2-pacman-Qe.txt`, restore `msys2-home`, rerun Cygwin setup with the saved package list.

## Not verified

Wine, Proton, dxvk, vkd3d-proton provisioning and prefixes (no Linux host here); ARM64 execution; the GitHub runner behaviour of
`shell: bun packages/buncc/src/cli.ts sh {0}` (the step bodies were run locally through `buncc sh` with a temporary
`GIT_CONFIG_GLOBAL` and fake `rustup`/`node`, not on a runner); uninstall execution on a real MSYS2/MinGW/Cygwin (tested on fake
directories and a simulated registry). The syntax `uninstall.exe pr --confirm-command` is documented by MSYS2 (msys2.github.io, installer
documentation, per the Microsoft Learn audit); what stays unverified is running it on a real install, as for the Inno switches and the winget and
Scoop commands; the busybox `.sig`.
