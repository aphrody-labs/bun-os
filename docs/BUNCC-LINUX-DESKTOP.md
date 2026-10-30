# buncc linux: GNOME, KDE Plasma and Qt 6 for Linux targets

`buncc linux` builds and cross-compiles upstream GNOME (GNOME Shell, mutter, GTK 4, libadwaita, gjs,
gnome-session, gnome-settings-daemon, gnome-control-center), KDE Plasma 6 (plasma-workspace, kwin,
plasma-desktop, libplasma) and Qt 6 for `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, from a
Windows workstation, from CI or from a Linux host. Code: `packages/buncc/src/linux-target/`. Pins:
`factory/linux-desktop/closure-{gnome,qt6,plasma}.json`. Windows-native desktop (GTK, Qt, KDE apps on Windows) is
a different tool: `packages/buncc/src/desktop/`, `docs/BUNCC-DESKTOP.md`.

## What is and is not possible

| Goal | Windows host | CI (Arch container) | Notes |
| --- | --- | --- | --- |
| Run GNOME Shell / mutter / Plasma / kwin on Windows | no | no | They need DRM/KMS, libinput, logind/seat, PipeWire, systemd and a Wayland compositor stack. Only a Linux kernel provides these. |
| Cross-compile C/C++ libraries and apps (GLib, GTK 4, libadwaita, Qt apps) to a Linux sysroot | yes (measured) | yes | LLVM clang + lld, `--target`, `--sysroot` from Arch packages; `zig cc` is the alternative driver. |
| Cross-compile mutter, gnome-shell, kwin, plasma-workspace from Windows | blocked by host tools | not needed | They run code at build time (see below). Build them in the Arch container instead. |
| Build them natively | no | yes | `buncc linux container <target>` and the workflow. |
| Run them for validation | no (no WSL on this workstation) | headless smoke (`--version`, files present) | WSLg runtime validation uses the `aphrody-labs/wslg` artifacts and is a CI/other-machine step. |

Build-time code execution is the real limit for cross-compiling the shells. Each pin lists its own `hostRun`:

- `g-ir-scanner` (gjs, gnome-shell, anything with introspection) links and runs target binaries. It needs an
  `exe_wrapper` (qemu-user for another architecture) or a native Linux host of the same architecture. mutter and
  GTK can be built with introspection disabled, which removes this.
- `glib-compile-resources`, `glib-compile-schemas`, `gdbus-codegen`, `glib-mkenums` must run on the build host.
  Arch ships them as Linux ELF files, so a Windows host needs a Windows build of GLib (MSYS2/mingw) for them.
- Qt cross builds need a host Qt (`QT_HOST_PATH`) for `moc`, `rcc`, `uic`, `qsb`; KF6 code generators need
  `KF6_HOST_TOOLING`. A Windows host Qt of the same version is how Qt documents Windows to Linux builds; not tried here.
- `sassc` (libadwaita, GTK themes) must be on the build host.

## Closures (resolved 2026-10-29, newest stable)

Tags and commit SHAs come from `git ls-remote` on the upstream forges (peeled to the commit), dates from the GitLab
and GitHub APIs, build dependencies from the `dependency()` / `find_package()` calls and `option()` declarations of
the pinned `meson.build` / `CMakeLists.txt` (the options in the closure files are checked against them), sysroots
from the Arch `core`/`extra` databases (Arch builds the same tags, so its `depends`/`makedepends` are the oracle).
Regenerate with `bun factory/linux-desktop/resolve.ts`.

| Closure | Release | Sources pinned | Sysroot packages | Compressed | Installed |
| --- | --- | --- | --- | --- | --- |
| gnome | GNOME 51.1 (gnome-shell 51.1, mutter 51.1, GTK 4.24.1, libadwaita 1.10.0, gjs 1.90.1, GLib 2.90.1, gnome-session 51.0, gnome-settings-daemon 51.1, gnome-control-center 51.1, gnome-desktop 51.0, gsettings-desktop-schemas 51.0) | 11 | 550 | 665 MiB | 3037 MiB |
| qt6 | Qt 6.12.0 (qtbase, qtshadertools, qtdeclarative, qtsvg, qtwayland, qt5compat, qttools) | 7 | 301 | 496 MiB | 2251 MiB |
| plasma (extends qt6) | Plasma 6.8.2 (kwin, plasma-workspace, plasma-desktop, libplasma, kscreenlocker, ...), KF6 from sysroot packages | 17 | 627 | 887 MiB | 3647 MiB |

SpiderMonkey (mozjs-140 for gjs) comes from the sysroot (`js140`); KF6 frameworks come from the sysroot as Arch
packages; both are not rebuilt from source by default. `--deep` builds the source dependencies of a target (the
`needs` edges) first and installs them into the stage overlay before the target.

## Commands

```
buncc linux closure [gnome|qt6|plasma] [--packages]
buncc linux pins
buncc linux sysroot <closure|target|--roots a,b> [--arch x86_64|aarch64] [--dir d] [--cache d] [--full] [--run]
buncc linux cross <target> [--arch a] [--sysroot d] [--compiler clang|zig] [--deep] [--qt-host d] [--kf6-host d] [--run]
buncc linux build <target> [--deep] [--run]        native Linux host
buncc linux container <target> [--engine podman|docker] [--deep] [--run]
buncc linux hello <glib|gtk4|libadwaita> --sysroot d [--arch a]
```

Everything is a dry run until `--run`. `sysroot` downloads the Arch packages (sha256 checked against the repository
database), extracts them without `tar`, zstd binaries or symlink privilege (symlinks become copies; only development
paths are kept unless `--full`), and `hello` compiles a program against it. aarch64 uses the Arch Linux ARM mirror.
`cross` writes a Meson cross file and native file or a CMake toolchain file, then configures, compiles and installs
into `<dir>/stage/<target>` with Ninja. Targets: any source id of the closures (`buncc linux closure`).

## Measured

Windows 11 workstation, LLVM clang 23.1.4 / lld, Meson 1.12.1, Ninja 1.13.2, CMake:

- Sysroot of `libadwaita gtk4 glib2` + toolchain (glibc, gcc, linux-api-headers): 219 Arch packages, 290 MiB
  downloaded, 1266 MiB installed (development paths), 11 831 files extracted and 4 m 06 s end to end (download cached,
  extraction dominated by Windows file creation).
- Cross-compiled and linked to ELF64 `x86_64`: GLib+GIO program 2.07 s, GTK 4 program 2.52 s, libadwaita program
  3.10 s. `llvm-readobj` shows the expected `NEEDED` libraries (`libgtk-4.so.1`, `libadwaita-1.so.0`,
  `libglib-2.0.so.0`, `libc.so.6`, ...). Not executed on this workstation (no WSL rule); CI executes nothing either
  yet, the artifacts are checked structurally.
- The generated Meson cross file (with native file) and CMake toolchain file both configure, compile and link a C
  program to `elf64-x86-64` with clang + lld from Windows.
- No MSYS2 or native distro baseline was measured; no comparative claim is made.

- VPS (`ssh vps`, Ubuntu 26.10 x86_64, 12 cores, load average about 15 to 20, run under `nice -n 19`, everything in
  `~/build/bun-os-linuxdesktop`, no sudo, no system packages; docutils for `rst2man` in a venv inside that dir):
  GNOME sysroot (504 packages at that time, 20 671 files) downloaded and extracted in 1 m 49 s; mutter 51.1 (pinned
  SHA 9134e3a5869c) cross-built with `buncc linux cross mutter` (clang 22.1.8 + lld, Meson, introspection off) in
  2 m 22 s. Result: ELF64 x86-64 `usr/bin/mutter` and `libmutter-51.so.0` (12 MiB stage). Not executed: the
  extracted sysroot loses the exec bit, so `mutter --version` was not run there.
- Needed for that build, now automated: host-tool shims in `<sysroot>/usr/bin` (`glib-mkenums`, `wayland-scanner`, ...),
  makedepends of the roots in the sysroot, Meson wrap downloads, `-Dbash_completion=false`.

CI and VPS results are recorded in the workflow summaries of `.github/workflows/buncc-linux-desktop.yml` and below
once they ran.
