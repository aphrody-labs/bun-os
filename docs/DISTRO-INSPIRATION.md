# Distribution inspiration: Omarchy, COSMIC, CachyOS, just

Status: 2026-10-29. Reading of source code, not of READMEs. Every fact names its repository, file path and
commit; shallow clones were read under `C:\Users\aphro\src\ref\` on the workstation (outside this repository).
UNVERIFIED marks anything that was not read in code or not reproduced. Nothing here was built, booted or run on
a Linux host; the implementations in `factory/distro/` are unit-tested on Windows with fixtures only.

The runtime stays unmodified upstream Bun (see [`PLAN.md`](../PLAN.md)). The kernel goal in
[`KERNEL-ROADMAP.md`](KERNEL-ROADMAP.md) is the north star: the distro hooks added here (`bunos-scx.service`,
the `sched-ext` hook name, linux-bun variants) are control points for Phase 3 and claim no kernel integration.

## Source revisions

| Source                                                   | Revision read                                              | Note                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `omacom/omarchy` (`basecamp/omarchy` redirects)          | `84782475aeb8` (2026-10-29), newest tag `v4.5.0-rc2`       | Latest release `v4.0.6` (2026-10-19). `version` file still says `4.0.0.alpha`. |
| `omacom/omarchy-iso` (`omacom-io/omarchy-iso` redirects) | `4df07efa12c3` (2026-10-28)                                | No tags, no releases.                                                        |
| `pop-os/cosmic-epoch` and 8 component repos              | tag `epoch-1.11.0` = `e98f8289a2` (2026-10-20)             | Components pinned by the epoch tree: comp `8cb1802caa`, settings `f1d00fc06e`, session `4b0a0a24e9`, greeter `80e8a104b7`, applets `328d142faa`, panel `ca20ce3185`, settings-daemon `655b14fb95`. |
| `pop-os/libcosmic`                                       | master `95236a944bfd` (2026-10-27)                         | No epoch tags (newest tag `v0.12`); consumers pin a git rev (cosmic-comp `430f3d48a97d`). |
| `CachyOS/linux-cachyos`                                  | master `523baf9cc1e3` (2026-10-23)                         | No 2026 tags; kernel source tag `CachyOS/linux` `cachyos-7.3.0-4` = `6f1d90319ee9`. |
| `CachyOS/CachyOS-Settings`                               | tag `1.4.1` = `764693fe2863`; HEAD `f79b237defab` (2026-10-22) |                                                                          |
| `CachyOS/chwd`                                           | tag `1.25.0` = `4c61525942aa` (2026-10-23)                 | `chwd-db` is dead (2023); profiles live in `chwd/profiles/`.                 |
| `CachyOS/cachyos-repo-add-script`                        | `e2c90c6` (2026-10-17)                                     | No tags.                                                                     |
| `CachyOS/cachyos-calamares`                              | `e6c22095c3ed` (2026-10-25)                                |                                                                              |
| `sched-ext/scx`                                          | tag `v1.1.4` = `e7b3a219617472cf78880ac424714e52c932db61` (2026-10-15) | `scx-loader` `v1.1.3` = `eab0ea02`.                              |
| `casey/just`                                             | release `1.59.0` (2026-10-15), ref `86955cf7350674082802c8e886f36769537e0d22` | `gh api repos/casey/just/releases/latest`. Workstation has 1.58.0. |
| `aphrody-labs/bun-just`                                  | `23ef9ebdaa` (last push 2026-10-25), pinned at `vendor/bun-just` | Imported from the abandoned fork.                                      |

## A. `just`: bun-just versus casey/just

`aphrody-labs/bun-just` is the `bun-just` executable that the fork's `bun just` command dispatched to (its
README: "the `bun-just` executable that `bun just` dispatches to", source `src/runtime/cli/plugin_command.rs` of
`aphrody-labs/bun`). Its workspace path-depends on crates of the Bun fork checkout, and its build is
`bun bd --target=plugins`, so it cannot be built or used with the pinned upstream canary. Context7 also only
indexes `/casey/just` up to 1.43.1; the attributes used below (`[group]`, `[doc]`, `[linux]`/`[windows]`,
`[working-directory]`, `set windows-shell`) were checked against its README snippets and by running
`just 1.58.0` here.

Decision: **reject bun-just as the runner; adopt upstream `casey/just` directly.** The `vendor/bun-just` pin stays
as provenance (`factory/bunos/components.json`, `submodule:vendor/bun-just`); removing it needs the vendor audit in
`PLAN.md`, not this change.

The root [`justfile`](../justfile) already existed (plan/inventory recipes); it is extended, not replaced. It is
the one human entry point and holds no logic of its own: each recipe forwards to `buncc` (`build`, `doctor`),
`turbo` (`build-js`), `bunos` (`setup`, `doctor`, `iso`, `desktop`, `release`), `bun fmt/lint/check`, `makepkg`
(`kernel-build`, Linux only) and `factory/distro/cli.ts`.

| Recipe                            | Delegates to                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| `setup`                           | `bun run setup`                                                     |
| `build`, `build-js`               | `bun run buncc build ...`, `bun x turbo run build ...`              |
| `test`, `check`, `fmt`, `lint`    | distro tests + workspace/cargo tests; type check + component check; `bun run format`, `bun run lint` |
| `doctor`                          | component check, `bun run doctor`, `buncc doctor`, `factory/distro` doctor |
| `iso`, `desktop`                  | `bun src/cli.ts factory arch --action <plan\|...> --composition <...>`; `desktop` also stages COSMIC defaults |
| `kernel`, `kernel-list`, `kernel-build` | `factory/distro` fragments; `makepkg` in `factory/kernel/linux-bun` (Linux only) |
| `release`, `pkg`                  | `bun run release`, `bun run packages` (package converter)           |
| `migrate`, `hw`, `repos`, `theme`, `overlay` | `factory/distro/cli.ts`                                  |

The `bun_pkg` crate (`crates/bun-os-pkg`) is a library without a binary target in this tree, so no recipe
wraps them yet (UNVERIFIED that a binary is planned).

## B. Comparison and decisions

Legend: adopt = taken over as designed; extend = Bun OS owner exists, upstream idea added to it; reject = studied,
not taken.

### Omarchy (`omacom/omarchy` @ `84782475aeb8`)

| Mechanism (upstream path)                                                                                                    | Bun OS state before                            | Decision | Implemented in                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------- | -------------------------------------- |
| Migrations: `migrations/<unix-ts>.sh`, markers in `~/.local/state/omarchy/migrations/`, marker only after exit 0, `bin/omarchy-migrate` | none (`factory/arch/omarchy` is metadata only) | adopt    | `factory/distro/migrate.ts`            |
| Fresh install seeds all markers (`omarchy-provision-user`, `--first-install`)                                               | none                                           | adopt    | `seedMigrations`                       |
| `omarchy-update`: lock, snapshot, `-Syu` under `systemd-run --scope`, migrate, hooks; pacman guard hook `00-omarchy-update-guard.hook` | none                                | reject for now | needs snapper/limine decision and a Linux host (UNVERIFIED design) |
| Hooks: `bin/omarchy-hook` (`<name>` then `<name>.d/*`, failure does not abort)                                               | none                                           | adopt    | `factory/distro/layers.ts` (`runHook`) |
| Package-owned `default/` vs user `~/.config`, `omarchy-refresh-config` with `.bak.<epoch>`                                  | none                                           | adopt    | `refreshConfig`                        |
| Themes: `colors.toml` + `default/themed/*.tpl`, tokens `{{ k }}`, `_strip`, `_rgb`, `mix` (`bin/omarchy-theme-set-templates`) | design system is `design-system/`, not OS-level | adopt (engine) | `factory/distro/theme.ts`, `themes/bunos`, `themed/` |
| Atomic theme swap, parallel app retints, 20+ `theme-set-*` apps                                                              | none                                           | reject   | app-specific; add per app when it exists |
| `install/` stage order (`config`, `hardware`, `login`, `post-install`), `run_logged` leaves                                 | `factory/arch` plans packages only             | extend later | order recorded here; the Bun OS installer owner decides (UNVERIFIED) |
| Hardware leaves + deferred first-boot provisioning (`install/helpers/image-target.sh`)                                      | none                                           | reject for now | superseded by the chwd-style planner below |
| ISO: archiso profile, offline `[offline]` mirror, `omarchy-iso-install` orchestrator (`omarchy-iso`)                         | `factory/images/bunos-disk`, Containerfiles    | reject   | Bun OS already has image recipes; offline mirror idea noted for a later ISO gate |
| Limine + snapper snapshots (`default/snapper/root`, `etc/limine-entry-tool.d/omarchy-defaults.conf`)                         | `factory/kernel/linux-bun/limine-linux-bun.conf.template` | extend later | rollback tests are a Phase 1 item of KERNEL-ROADMAP |
| Quickshell UI, Hyprland Lua config                                                                                           | COSMIC is the default session                  | reject   | Omarchy Hyprland stays blocked per PLAN.md |

Not read (UNVERIFIED): the `omarchy-pkgs` PKGBUILDs, `phases_impl.py` of omarchy-iso (3892 lines), `omarchy-shell`.

### COSMIC (`pop-os/*` @ `epoch-1.11.0`)

| Mechanism (upstream path)                                                                                                            | Bun OS state before                    | Decision | Implemented in                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------- | --------------------------------- |
| cosmic-config layout: `~/.config/cosmic/<AppId>/v<N>/<key>`, system defaults `/usr/share/cosmic/<AppId>/v<N>/<key>`, one RON file per key (`libcosmic/cosmic-config/src/lib.rs` @ `95236a944bfd`) | only "COSMIC pending" in PLAN.md | adopt | `factory/distro/cosmic.ts`, `cosmic/defaults/` |
| Layering: user v`N`, then user v`N-1`, then system v`N` only (same file, `Config::get`)                                              | none                                   | adopt    | `resolveKey` (a reading, not a binding to cosmic-config; UNVERIFIED against a running session) |
| Shipped defaults as plain files (`cosmic-panel/data/default_schema`, `cosmic-settings/resources/default_schema`, `cosmic-applets/cosmic-app-list/data/default_schema`) | none | extend | two keys: `CosmicTheme.Mode/v1/is_dark`, `CosmicAppList/v1/favorites` (upstream list minus `firefox`: the desktop closure in `factory/profile.json` has no browser) |
| Session: `start-cosmic` -> `cosmic-session` hardcoded ordering; `cosmic.desktop` in `/usr/share/wayland-sessions` (cosmic-session `4b0a0a24e9`) | none                      | note     | cosmic-comp's bare session ships a second `cosmic.desktop` at the same path; an image must pick one |
| Greeter: greetd + `cosmic-greeter-start` (`exec cosmic-comp cosmic-greeter`), system user `cosmic-greeter`                           | none                                   | note     | Arch PAM stack for `greetd` is not in the repo (UNVERIFIED) |
| Applets: one multicall `cosmic-applets` binary + symlinks, `X-CosmicApplet=true` desktop entries                                    | none                                   | note     | packaging detail for the COSMIC closure |
| Packaging with `just` (`rootdir`/`prefix`, `vendor`, `build-vendored`; epoch `justfile` builds 31 components)                         | none                                   | adopt (tooling) | confirms `just` as the entry point; epoch's recipes are the model for a `cosmic-epoch` PKGBUILD set |
| Rust-first stack (libcosmic/iced), `cosmic-comp` Smithay compositor                                                                   | Rust is the repo's systems language    | adopt (as consumed dependency) | no code here; closure remains unqualified |
| Accent colour as RON (`CosmicTheme.Dark/v2/accent`, 12 colour fields)                                                                 | none                                   | extend   | `themed/cosmic-accent.ron.tpl` renders it; whether COSMIC accepts these derived shades is UNVERIFIED |

### CachyOS

| Mechanism (upstream path)                                                                                                                                   | Bun OS state before                                           | Decision | Implemented in                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------- | ----------------------------------- |
| ISA-tier repositories: `cachyos-v3`, `-core-v3`, `-extra-v3` then `cachyos`; v4; znver4 (uses the v4 mirrorlist) (`cachyos-repo-add-script/cachyos-repo.sh`, `install*-repo.awk` @ `e2c90c6`) | `factory/arch/cachyos/integration.json` lists base + v3 only; `factory/images/bunos-disk/cachyos-repo.sh` hardcodes v3 | extend | `factory/distro/repos.ts` (`detectIsa`, `cachyosLayers`, `bunosLayers`, `applyLayers`) |
| ISA detection: `ld.so --help` "x86-64-v4 (supported, searched)"; `gcc -march=native -Q --help=target` for znver4/5                                         | none                                                          | adopt    | `detectIsa`                         |
| `Architecture = auto` requires CachyOS's pacman fork (`pacman-7.1.0.r9.g54d9411-5`)                                                                         | `bunos-disk/cachyos-repo.sh` already installs it              | note     | not qualified on a host             |
| Kernel options (`linux-cachyos/PKGBUILD`): `_HZ_ticks`, `_tickrate`, `_preempt`, `_hugepage`, `_cpusched`, `_processor_opt`, `_cc_harder`, `_use_llvm_lto`, `_tcp_bbr3` | `aphrody-bun.config` pins Rust/BPF/sched_ext only | extend | `factory/distro/kernel-variant.ts`, `factory/kernel/linux-bun/variants/{desktop,server}.config` |
| BORE, `X86_64_VERSION`, `CC_OPTIMIZE_FOR_PERFORMANCE_O3`                                                                                                    | n/a                                                           | reject until patches | absent from the linux 7.2.11 Kconfig files (extracted from `linux-7.2.11.tar.xz`); come from CachyOS's patch set. The generator throws unless `cachyosPatches` is set. |
| `_processor_opt=generic` leaves X86_64_VERSION=1 (a bare `GENERIC` matches no case)                                                                         | n/a                                                           | note     | distribution builds must set the level explicitly |
| sched_ext: kernel has `SCHED_CLASS_EXT=y` in `config`; there is no `_cpusched` value for it; `scx-scheds` is an optdepend; `services/scx.service` reads `/etc/default/scx` | `SCHED_CLASS_EXT` pinned in `aphrody-bun.config`              | extend   | `overlay/usr/lib/systemd/system/bunos-scx.service`, `overlay/etc/default/bunos-scx` (own names, no clash with `scx-scheds`); disabled by default |
| chwd: TOML profiles, match on PCI class/vendor/device + DMI + virt, `priority`, `driver_conflict_group`, packages/hooks (`chwd/src/profile.rs`, `data.rs`, `profiles/pci/graphic_drivers`) | catalogued, "unused" (`docs/FORKS-EXPLOITATION.md`)       | adopt (planner) | `factory/distro/hw.ts`, `hw/profiles.toml` (8 profiles, Arch package names) |
| chwd blacklist fields, `cpu_family`/`gc_versions`/`ai_sdk`, nvidia/nouveau id lists (`ids/*.ids`)                                                          | n/a                                                           | not implemented | blacklist semantics were not traced upstream (UNVERIFIED); the NVIDIA open profile needs an `ids/nvidia-open.ids` that is not shipped, so NVIDIA devices fall back to Mesa until it exists |
| `cachyos-settings`: sysctl, udev I/O schedulers, zram, THP tmpfiles, journald and systemd limits (`usr/lib/**` @ `f79b237defab`)                           | none                                                          | adopt (subset) | `factory/distro/overlay/**`; `kernel.unprivileged_userns_clone` and `kernel.sysrq=1` left out on purpose |
| Calamares sequence incl. `chwd` module (`cachyos-calamares/settings_online.conf`)                                                                          | `factory/images/bunos-disk/installer`                         | reject for now | the Bun OS installer owner decides; order noted: `pacstrap`, ..., `chwd`, `packages`, ..., `initcpio`, `users`, `bootloader` |
| CachyOS-Settings package, hooks (`cachyos-hooks` `2026.10.23`), `scx-scheds` 1.1.4                                                                         | not packaged                                                  | later    | a `bunos-settings` PKGBUILD should own `overlay/` (not written: no makepkg here) |

### Findings about the existing CachyOS inventory (not changed here)

- `factory/arch/cachyos/README.md` and `integration.json` pin kernel recipe `cachyos-7.2.11-1`; `linux-cachyos`
  master is at `cachyos-7.3.0-4` (`CachyOS/linux` `6f1d90319ee9`, 2026-10-23); only the `-hardened` variant is
  still 7.2.11 upstream. `linux-bun` itself builds Arch's 7.2.11 on purpose, so this is a catalog refresh, not a bug.
- `integration.json` lists `mirror.cachyos.org` as an active server; the current `cachyos-mirrorlist` has it
  commented out ("disabled due Netcup issues", CachyOS-PKGBUILDS `cachyos-mirrorlist`). `cdn77.cachyos.org` is active.
- Unpinned upstreams that the adopted code cites: CachyOS-Settings, chwd, cachyos-repo-add-script, cachyos-hooks,
  sched-ext/scx.

## C. What was implemented

All under `factory/distro/` (Bun/TypeScript, no dependencies, tests in `distro.test.ts`), registered as seven
`factory-module` entries in `factory/bunos/components.json` and verified by `bun factory/bunos/check-components.ts`:
`migrate`, `hw`, `repos`, `kernel-variants`, `cosmic`, `theme` (with config layering and hooks), `overlay`.
CLI: `bun factory/distro/cli.ts help`; humans use `just`.

## What only CI or a Linux host can confirm

- That linux-bun builds with a variant merged (the variants are not wired into `factory/kernel/linux-bun/PKGBUILD`:
  new `source` entries need b2sums and a `makepkg` run) and that `check-config.sh` passes on the merged `.config`.
- That pacman with the generated layers resolves packages (needs CachyOS's pacman fork and network).
- That the hardware planner matches real PCI/DMI data (only fixtures were used) and that the chosen Arch packages exist.
- That COSMIC reads the staged defaults and the rendered accent file.
- That `bunos-scx.service` starts a scheduler on a sched_ext kernel.
- That the overlay files are accepted by systemd/udev/sysctl on an installed system.
