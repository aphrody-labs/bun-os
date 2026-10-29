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
Pins on 2026-10-29: glib 2.90.1, gtk 4.24.1, pango 1.58.2, cairo 1.18.6, harfbuzz 15.0.0, gdk-pixbuf 2.90.3,
graphene 1.10.8, libepoxy 1.5.10, libadwaita 1.10.0, Qt 6.12.0 (LTS 6.8.3), KDE Frameworks 6.31.0,
Plasma 6.8.2, Gear/Kate 26.08.2.

Modes: `graph` builds each package and installs it in the prefix, in dependency order (levels printed by `plan`);
`mono` builds the top meson package with `--wrap-mode=forcefallback` so every dependency is a subproject of one
Ninja graph.

Targets: `x86_64-pc-windows-msvc` (default), `aarch64-pc-windows-msvc`, `x86_64-pc-windows-gnullvm`,
`aarch64-pc-windows-gnullvm` (llvm-mingw). Linux targets belong to the Linux-target agent's lane and are not handled.
