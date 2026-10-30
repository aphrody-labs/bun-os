# buncc desktop: GNOME/GTK4, Qt6 and KDE on Windows

`buncc desktop` builds upstream GTK4/libadwaita, Qt6 and KDE Frameworks natively on Windows with MSVC or clang-cl,
Meson/CMake, Ninja and sccache, into one shared prefix per target. Recipes: `factory/desktop/recipes.json`.
Code: `packages/buncc/src/desktop/`. CI: `.github/workflows/buncc-desktop.yml`.

Facts below were checked on 2026-10-29 (GitHub API, `git ls-remote`, Qt 6.12 docs). Nothing here is claimed
beyond what the "Measured" and "Not verified" sections say.

## Inventory and decisions

| Piece | Evaluated (state on 2026-10-29) | Decision | Why |
| --- | --- | --- | --- |
| wingtk/gvsbuild | Python builder of GTK on Windows, MSVC, release 2026.10.0 (2026-10-26), pushed 2026-10-28; ~50 project definitions (glib, gtk, pango, cairo, libadwaita, librsvg, ffmpeg, openssl, ...) | Adopt as recipe reference and cross-check; do not run | Its project list and per-project meson options are the best map of what GTK needs on MSVC. Its pipeline is a Python tool with its own source tree; buncc already owns download, env and cache |
| KDE Craft (KDE/craft) | Official KDE Windows builder, pushed 2026-10-28, no GitHub releases (tag v1.3), blueprints in a separate repo, supports MSVC and MinGW, CMake/Meson/autotools/QMake backends, 7z/NSIS/AppX packagers | Adopt as the source of truth for what a KDE project needs (blueprint deps, patches); extend: buncc recipes mirror it as JSON | Craft needs its own Python environment, MSYS and writes to a prefix of its own; buncc keeps one prefix and one toolchain |
| KDE Windows CI | Runs Craft on MSVC 2022 images (`ci-utilities`) | Reference only | Confirms MSVC is the supported compiler for KDE Windows binaries |
| Qt official (qt.io installer, download.qt.io) | Qt 6.12.0 (qtbase tag v6.12.0), 6.11.3, LTS 6.8.3. Docs: Windows x86_64 MSVC 2022 and Mingw-w64 13.1, Windows on ARM64 MSVC 2022. clang-cl is not on the supported list | Adopt the source build (CMake, `configure.bat`) with MSVC; clang-cl is an opt-in `--cc clang-cl`, unsupported by Qt | Qt needs cmake >= 3.25, ninja, python 3, no external libs: qtbase vendors zlib, freetype, harfbuzz, pcre2 |
| aqtinstall (miurahr) | v3.3.0 (2025-06-02), last push 2026-09-11, downloads official binaries | Reference; prebuilt binary path is out of scope for v1 | Good for time-to-first-build, but cannot change compiler, flags or target. The comparison with source builds is part of the benchmark plan |
| vcpkg qt/gtk ports | microsoft/vcpkg pushed daily; ports build with MSVC/clang | Reference for patches and feature flags; do not adopt | Manifest mode installs each library into its own tree and rebuilds on any ABI hash change, and has no KDE Frameworks |
| MSYS2 mingw-w64 PKGBUILDs | msys2/MINGW-packages pushed today | Recipe source for Windows patches of glib, gtk4, pango, librsvg, libadwaita; binaries used as the benchmark baseline only | PKGBUILDs assume a POSIX shell, GCC/Clang mingw ABI (not MSVC ABI) |
| Meson WrapDB and project wraps | WrapDB updated 2026-10-27; glib ships wraps for libffi, pcre2, zlib, proxy-libintl, gvdb; gtk4 ships wraps for cairo, pango, harfbuzz, fribidi, gdk-pixbuf, graphene, libepoxy, libpng, libjpeg-turbo, libtiff | Adopt: `meson --wrap-mode` is the leaf-library mechanism; `buncc` shares one `MESON_PACKAGE_CACHE_DIR` | No second package manager for leaf libraries |
| GNOME gnome-build-meta / BuildStream | GNOME's Linux image build, pushed today | Reference for the dependency order only | Targets Linux (freedesktop-sdk); no Windows |
| Meson cross files, CMake toolchain files | Meson 1.12.1 (2026-09-22), CMake 4.4.5 | Adopt; buncc generates both for the gnullvm and arm64 targets | Standard mechanism |
| extra-cmake-modules | v6.31.0, KDE/extra-cmake-modules | Adopt as a recipe (`ecm`), installed into the shared prefix | KDE projects require it |
| pkgconf | 3.0.10 (2026-10-19) | Adopt, built from source with Meson in the private tool dir | Same tool Meson/GLib use |
| meson, ninja | PyPI wheels in a private venv | Adopt | No MSYS2 python needed |
| winflexbison | v2.5.25 (2022-01-11, last release) | Adopt, sha256 pinned | Only maintained win_flex/win_bison zip; needed by some KDE/GNOME generators |
| gettext tools | mlocati/gettext-iconv-windows v1.0-v1.19 (static x64 zip, sha256 pinned) | Adopt | msgfmt/xgettext for KI18n and translations without MSYS2 |
| gperf, perl, python | perl: git-for-windows perl or Strawberry; python: system | Detect, do not install | `doctor` reports them |
| coreutils/util-linux (uutils), Bun Shell, LLVM binutils | `buncc env posix`, `buncc sh` (existing providers) | Reuse: not rewritten here | `desktop env` composes with them; no desktop recipe needs a POSIX shell so far |
| cargo-xwin, @aphrody/windows | existing buncc xwin provider | Reuse for arm64 MSVC sysroot when VC.Tools.ARM64 is absent | Not exercised in this change (see Not verified) |
| Recipe engine, tag resolver, graph, shared prefix, cross files, bench | no existing tool combines these for Windows | Write (`packages/buncc/src/desktop`) | Smallest glue between the adopted pieces |

## Commands

```
buncc desktop doctor
buncc desktop plan [--pin] [what...]    newest stable upstream tag per package; --pin rewrites recipes.json (commit sha recorded)
buncc desktop fetch <what>              private meson/ninja/pkgconf/flex-bison/gettext + sha-verified clones
buncc desktop build <what> [--mode graph|mono] [--cc cl|clang-cl] [--target T] [--jobs N] [--lts]
buncc desktop env [--shell cmd|pwsh|sh|json]
buncc desktop pack <what> [--runtime]
buncc desktop bench <hello-gtk4|hello-qt|hello-qml|hello-kcoreaddons>
```

`<what>`: `gtk4`, `libadwaita`, `qt6`, `kf6`, `plasma-libs`, `app:<name>` or any recipe id. Work dir:
`%LOCALAPPDATA%\buncc\desktop` (override with `BUNCC_DESKTOP_DIR`; keep it short, Qt asks for short paths).

Tag rules: GTK/GLib/Cairo use even minor numbers only (stable series); Qt uses the highest `v6.x.y` and records the
newest 6.8 LTS next to it (`--lts`); KDE Frameworks, Plasma and Gear use the highest release tag.
Pins on 2026-10-29: glib 2.90.1, gtk 4.24.1, pango 1.58.2, cairo 1.18.6, harfbuzz 15.0.0, gdk-pixbuf 2.44.8,
graphene 1.10.8, libepoxy 1.5.10, libadwaita 1.10.0, Qt 6.12.0 (LTS 6.8.3), KDE Frameworks 6.31.0,
Plasma 6.8.2, Gear/Kate 26.08.2.

Modes: `graph` builds each package and installs it in the prefix, in dependency order (levels printed by `plan`);
`mono` builds the top meson package with `--wrap-mode=forcefallback` so every dependency is a subproject of one
Ninja graph.

Targets: `x86_64-pc-windows-msvc` (default), `aarch64-pc-windows-msvc`, `x86_64-pc-windows-gnullvm`,
`aarch64-pc-windows-gnullvm` (llvm-mingw). Linux targets belong to the Linux-target agent's lane and are not handled.

## Measured (2026-10-29, this workstation: Windows 11, 24 logical CPUs, MSVC 19.51, Meson 1.12.1, CMake 4.4.4)

Baseline: official MSYS2 `clang64` prebuilt packages (`mingw64` has no gtk4; its Qt6 targets libstdc++), downloaded
into a fresh directory, SHA256 verified, hello apps compiled with llvm-mingw 20261020 (gtk4 4.24.1, glib 2.90.1,
qt6 6.12.0). Same upstream versions as the buncc pins. buncc side: `x86_64-pc-windows-msvc`, `cl`, release,
one shared prefix. Single runs for builds, medians of 10 runs (after one warm-up) for startup; every startup
figure includes the app's own 1 s self-quit timer.

| Metric | MSYS2 clang64 | buncc desktop | Verdict |
| --- | --- | --- | --- |
| Time to a usable GTK4 dev prefix | 57 s for the 89-package closure shared with Qt (download 29 s + extract 28 s, 180 MB) | 156 s setup (wrap downloads) + 711 s build = 867 s from source (`--mode mono`, whole GTK4 stack incl. cairo, pango, harfbuzz, gdk-pixbuf, graphene, epoxy, accesskit Rust crates; sccache cold; another process was running during part of it) | MSYS2 is about 15x faster to first build: it ships binaries. Not an improvement |
| Time to Qt6 Widgets dev prefix | included above | 461 s (qtbase configure + build) | MSYS2 faster |
| Qt Quick (qtshadertools + qtdeclarative) | included above | 68 s + 979 s | MSYS2 faster |
| KDE: ECM + qttools + KCoreAddons 6.31.0 | not packaged in MSYS2 clang64 for this test | 48 s (qttools) + 20 s (kcoreaddons) + 4 s hello; `hello-kcoreaddons` prints `KCoreAddons 6.31.0` | Works; no baseline |
| Incremental rebuild of the hello app (touch main, rebuild) | 0.8 to 1.0 s (gtk), 1.9 to 3.0 s (qt) via a shell script | 2.9 s (gtk, meson/ninja), 1.0 s (qt, ninja, incl. cmake re-run check) | Different tools, one-file apps: no conclusion |
| Disk footprint, GTK4 | 780 MB installed (82 packages) | 90.9 MiB, 1911 files (shared prefix right after GTK4 + hello) | Smaller, but not equal content: buncc builds only what GTK4 needs (no gstreamer, cups, introspection, docs, locales, jpeg/tiff) |
| Disk footprint, Qt6 base + Quick | 869 MB installed (40 packages) | qtbase + hello: about 108 MiB; with shadertools + qttools + qtdeclarative the whole shared prefix (GTK4 + Qt6 + Quick + KF6 base) is 499.6 MiB, 9270 files | Smaller; same caveat on features (qtbase built without sql, dbus, testlib, printsupport) |
| Runtime pack (GTK4 + Qt6 + KDE base, no headers or import libs) | n/a | `desktop pack --runtime`: 60.3 MiB zip | informational |
| hello GTK4 startup to exit | 2.79 / 3.70 / 6.90 s (min / median / max), 59 DLLs, 45.1 MB | 2.75 / 3.13 / 4.72 s, 39 DLLs | Within noise of each other; not proven faster |
| hello Qt Widgets startup | 1.27 / 1.32 / 1.46 s | 1.23 / 1.24 / 1.34 s | About 5 percent lower median; not proven (one machine, interleaved with other load) |
| hello QML startup | 1.44 / 1.72 / 5.66 s | 1.66 / 1.72 / 1.76 s | Equal median |

What can be said: with these options buncc produces smaller prefixes (disk), the same startup within noise, and
it builds MSVC-ABI binaries that MSYS2 does not offer. What cannot be said: that it is faster to first build
(it is not) or that incremental rebuilds are better. "More optimized than MSYS2" is therefore **not proven** for
build time; it is shown only for disk footprint with a reduced feature set. A warm sccache rebuild and the clang-cl
variant were not measured.

Findings that changed the code:
- Qt picks up GLib's pcre2 header from a shared prefix when `system_pcre2` is auto: the qtbase recipe forces every
  `FEATURE_system_*` OFF. A shared prefix needs this care for every CMake consumer.
- Disabling `FEATURE_network` breaks `windeployqt`; ECM's `ecm_process_po_files_as_qm` needs `Qt6LinguistTools`, so
  `qttools` is a dependency of every KDE Framework.
- `gui_app: true` in meson needs a `WinMain`; the hello app is a console-subsystem exe that still opens a window.

## Where each piece ran

| Piece | Local (this machine) | CI only | Not verified |
| --- | --- | --- | --- |
| `desktop doctor/plan/fetch/env/pack/bench` | yes | | |
| GLib (MSVC) | yes (41 s alone, wraps libffi, pcre2, zlib, proxy-libintl) | | |
| GTK4 full stack in one Ninja DAG (`--mode mono`) + hello-gtk4 | yes | | |
| GTK4 graph mode (package by package into the prefix) | glib only | workflow `buncc-desktop.yml` | pango, cairo, harfbuzz, gdk-pixbuf, graphene, epoxy, gtk4 in graph mode were not run; recipe options for them are untested |
| libadwaita 1.10.0 | | | not built anywhere (needs sassc/appstream wraps; `status` is a recipe only) |
| Qt 6.12.0 qtbase, qtshadertools, qttools, qtdeclarative, hello-qt, hello-qml | yes (MSVC) | | clang-cl (`--cc clang-cl`, unsupported by Qt) not run; Qt LTS 6.8.3 not built |
| ECM, KCoreAddons 6.31.0, hello-kcoreaddons | yes | | KI18n: recipe and gettext zip pinned, not built |
| Plasma workspace, Kate (Gear) | | | plan-only; Linux-centric, not buildable here |
| glib for `x86_64-pc-windows-gnullvm` (llvm-mingw cross) | yes (90 s) | | executables not run (cross) |
| glib for `aarch64-pc-windows-gnullvm` | yes (68 s) | | not run (no ARM64 host) |
| glib for `aarch64-pc-windows-msvc` | failed: `iphlpapi` not found, ARM64 MSVC libraries are not installed | | needs VC.Tools.ARM64 or an xwin splat |
| Cross GTK4/Qt (needs host tools for glib-compile-resources, moc, rcc via `QT_HOST_PATH`) | | | not wired |
| Linux targets | | | out of scope (Linux-target lane) |
