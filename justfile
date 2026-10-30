# Bun OS: the single human entry point. Every recipe delegates; none re-implements a tool.
#   buncc   (packages/buncc)        toolchains and the Cargo workspace build   -> `just build`, `just toolchains`
#   turbo   (turbo.json)            JS/TS task graph                           -> `just build-js`
#   bunos   (src/cli.ts)            the product CLI: setup, doctor, factory, release
#   makepkg (factory/kernel, factory/bunos/pkgbuilds)  Arch packages, on an Arch host only
#   factory/distro/cli.ts           migrations, hardware profiles, repo layers, kernel variants, COSMIC defaults
# Runner: casey/just >= 1.40 (workstation: 1.58.0; newest release 1.59.0, 2026-10-15). `just --list` shows the groups.

set windows-shell := ["pwsh.exe", "-NoLogo", "-NoProfile", "-Command"]
set dotenv-load := false

distro := "bun factory/distro/cli.ts"

[private]
default:
    @just --list --unsorted

# ---- everyday ---------------------------------------------------------------------------------------------------

[group('everyday')]
[doc('Install dependencies, submodules and shared setup')]
setup:
    bun run setup

[group('everyday')]
[doc('Cargo workspace build through buncc (extra args: -p crate, --release, --affected)')]
build *args:
    bun run buncc build {{ args }}

[group('everyday')]
[doc('JS/TS task graph through turbo (extra args: --filter=...)')]
build-js *args:
    bun x turbo run build {{ args }}

[group('everyday')]
[doc('Distro unit tests, workspace tests and cargo tests')]
test: test-distro
    bun test packages/bun-workspace/test/cargo.test.ts
    bun run cargo:test

[group('everyday')]
[doc('Type check, component manifest consistency and cargo check')]
check: components
    bun run check
    bun run cargo:check

[group('everyday')]
[doc('Format JS/TS (write); use `just fmt-check` to verify only')]
fmt:
    bun run format

[group('everyday')]
fmt-check:
    bun run format:check

[group('everyday')]
lint:
    bun run lint

[group('everyday')]
[doc('The one doctor: buncc toolchains, repository consistency, workspace, product CLI and distro files')]
doctor:
    bun run buncc doctor --all

# ---- images, kernel, desktop, release -------------------------------------------------------------------------------

[group('distro')]
[doc('Plan an Arch composition (server|desktop|gaming); action plan|host|resolve|rootfs. Images build on a Linux host.')]
iso composition="server" action="plan":
    bun src/cli.ts factory arch --action {{ action }} --composition {{ composition }}

[group('distro')]
[doc('Print the linux-bun config fragment of a variant (desktop|server)')]
kernel variant="desktop":
    {{ distro }} kernel fragment {{ variant }}

[group('distro')]
[doc('List linux-bun kernel variants')]
kernel-list:
    {{ distro }} kernel list

[group('distro')]
[linux]
[working-directory('factory/kernel/linux-bun')]
[doc('Build the linux-bun package with makepkg (Arch host; Phase 0 gate, never run in CI so far)')]
kernel-build:
    makepkg --syncdeps --cleanbuild

[group('distro')]
[windows]
[macos]
kernel-build:
    @echo "kernel-build needs an Arch Linux host with makepkg (the VPS factory)." ; exit 1

[group('distro')]
[doc('Plan the COSMIC desktop composition and stage the COSMIC defaults under build/distro')]
desktop out="build/distro/usr/share/cosmic":
    bun src/cli.ts factory arch --action plan --composition desktop
    {{ distro }} cosmic install --out {{ out }}

[group('distro')]
[doc('Arch packages through the Bun package-converter tool')]
pkg *args:
    bun run packages {{ args }}

[group('distro')]
[doc('Build and publish a release (see scripts/release.ts)')]
release *args:
    bun run release {{ args }}

# ---- distro mechanisms (docs/DISTRO-INSPIRATION.md) ----------------------------------------------------------

[group('distro')]
[doc('Apply pending migrations (factory/distro/migrations); `just migrate --pending` lists them')]
migrate *args:
    {{ distro }} migrate {{ args }}

[group('distro')]
[doc('Hardware profile plan from sysfs (chwd model, read-only)')]
hw *args:
    {{ distro }} hw plan {{ args }}

[group('distro')]
[doc('pacman repository layers for a CPU tier: detect | layers --tier x86-64-v3 --bunos-server URL')]
repos *args:
    {{ distro }} repo {{ args }}

[group('distro')]
[doc('Render a theme (colors.toml + templates) into build/distro/theme')]
theme name="bunos" out="build/distro/theme":
    {{ distro }} theme render {{ name }} --out {{ out }}

[group('distro')]
[doc('Install the CachyOS-Settings derived system files into a root: just overlay build/rootfs')]
overlay root="build/distro/rootfs":
    {{ distro }} overlay install --root {{ root }}

[group('distro')]
test-distro:
    bun test factory/distro

[group('distro')]
[doc('Repository consistency: component manifest, generated pins and map, one owner per capability (buncc doctor --repo)')]
components:
    bun run buncc doctor --repo

[group('distro')]
[doc('Regenerate docs/ARCHITECTURE-MAP.md and the pin table of docs/BUNCC.md from the repository')]
map:
    bun factory/bunos/generate-map.ts

# ---- inventory and plans -----------------------------------------------------------------------------------------

[group('plans')]
metadata:
    bun run cargo:metadata

[group('plans')]
apps-plan:
    bun run apps:plan

[group('plans')]
apps-build:
    bun run apps:build

[group('plans')]
frontend-build:
    bun run frontend:build

[group('plans')]
install-plan:
    bun scripts/node-modules.ts --plan

# Select imported packages explicitly; all outputs belong to build/packages.
[group('plans')]
packages-plan selection:
    bun run packages:plan --package "{{ selection }}"

[group('plans')]
packages-build selection:
    bun run packages:build --package "{{ selection }}"

[group('plans')]
source-workspace:
    bun run workspace:source

# Run the product through its canonical app-host owner.
[group('product')]
server-serve:
    bun packages/bun-app-host/src/cli.ts serve

[group('product')]
server-build output:
    bun packages/bun-app-host/src/build.ts build . "{{ output }}"

# Check a binary with a temporary loopback process.
[group('product')]
server-verify binary:
    bun packages/bun-app-host/src/cli.ts verify "{{ binary }}"

[group('plans')]
crate-inventory:
    bun scripts/crate-inventory.ts

# `vendor/cargo` is not committed: `vendor-prepare` regenerates it with `cargo vendor` (docs/vendor/README.md).
[group('plans')]
vendor-plan:
    bun scripts/vendor-cargo.ts plan

[group('plans')]
vendor-prepare:
    bun scripts/vendor-cargo.ts prepare

[group('plans')]
vendor-verify:
    bun scripts/vendor-cargo.ts verify

# Inspect sources without compiling, then build through the same native owner.
[group('plans')]
cargo-build-plan:
    bun scripts/cargo-build-proof.ts plan

[group('plans')]
cargo-build-status:
    bun scripts/cargo-build-proof.ts status

[group('plans')]
cargo-build:
    bun scripts/cargo-build-proof.ts build

# ---- Bun OS C (docs/BUNOS-C.md) -----------------------------------------------------------------------------------

[group('c')]
[doc('Bun OS C: tools found on this host and the Microsoft licence state')]
c-doctor:
    bun packages/buncc/src/cli.ts c doctor

[group('c')]
[doc('Bun OS C: target catalog (factory/c/c-env.json)')]
c-targets:
    bun packages/buncc/src/cli.ts c targets

[group('c')]
[doc('Bun OS C: smoke matrix, hello.c for every target, header check, run where a runner exists')]
c-test *args:
    bun packages/buncc/src/cli.ts c test {{ args }}

[group('c')]
[doc('Bun OS C: compile-time and size benchmark across the installed compilers')]
c-bench *args:
    bun factory/c/bench/bench.ts {{ args }}

[group('everyday')]
[doc('m3 benchmark harness: bun scripts/m3/bench/run.ts (--check enforces docs/material/m3/reports/perf-budget.json)')]
m3-bench *args:
    bun scripts/m3/bench/run.ts {{ args }}

import 'factory/wasmos/wasmos.just'
