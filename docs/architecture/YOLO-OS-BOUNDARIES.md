# Bun OS and YOLO: repository boundary and migration map

Status reviewed: 2026-11-04. This is the ownership contract for the Bun OS source repository and the YOLO engineering repositories. It separates operating-system integration from reusable engineering projects without claiming that a source has moved before its files, history, manifests, package ownership, and CI have moved.

## The reference model

Bun OS follows the Linux distribution boundary. Linux is a kernel; a usable distribution also assembles the boot chain, init, system services, libraries, user-space tools, desktop/session, package sources, installer, updates, and release images. Bun OS owns that composition and the minimum first-party code required to build, install, boot, update, and operate it.

YOLO is the current engineering organization and reusable software layer. It owns cross-platform build/toolchain projects and general-purpose standards, UI, web, reverse-engineering, and developer tooling that can be released independently of the Bun OS image. This is analogous to the GNU ecosystem around Linux in the sense of separately owned userland and development projects; it does not claim that YOLO is GNU, is part of GNU, or follows GNU governance.

Aphrody is the legacy organization and compatibility namespace. Existing Aphrody repositories, package scopes, forks, and attribution remain valid historical source identities until each project has an explicit transfer or successor. Do not rewrite old source URLs, Git history, npm package names, licenses, or notices as if a transfer had already happened.

## Evidence from the reference projects

| Reference | Useful boundary principle | What Bun OS / YOLO adopts |
| --- | --- | --- |
| Linux kernel and kernel.org | The kernel is one component of a complete distribution; kernel source and kernel documentation have their own maintainers and review process. | Keep kernel source/pins and OS configuration separate from distribution assembly. Do not call a kernel download a complete OS. |
| Linux From Scratch (LFS) and BLFS | LFS documents an ordered, reproducible path from toolchain and base system to a bootable system; BLFS extends that base with optional software. | Keep the base image dependency closure explicit. Add optional apps through composition profiles rather than making every workspace project an OS requirement. |
| Asterinas | Kernel work uses distinct kernel/runtime/tooling layers, with layered crates and dedicated build/run/test tooling. | Keep kernel-facing abstractions and target-specific code behind small crates; keep build orchestration outside kernel policy. |
| uutils | Portable user-space utilities can be developed independently from the kernel and can target multiple operating systems. | Treat portable utilities and command-line developer tools as userland/toolkit projects; include them in an image only when a composition requests them. |
| GNU documentation and software catalog | A software ecosystem needs discoverable package ownership and manuals; documentation is part of the maintained deliverable. | Give each YOLO project an owner, source, license, build/use guide, API/CLI reference, and migration state. |
| Linux Foundation / LF Engineering | These organizations provide project hosting and engineering services; organization membership or repository popularity does not determine technical ownership. | Use GitHub organization identity for ownership and contribution routing, not as a substitute for manifests, maintainers, licenses, or build evidence. |

Stars are a discovery signal only. They do not establish quality, compatibility, security, license compatibility, or inclusion in an OS release.

## Target ownership and paths

| Domain | Canonical owner | Bun OS treatment | Target home / path |
| --- | --- | --- | --- |
| Boot, image factory, install/update, distro config, host services | Bun OS | Keep; these are the product integration core. | Bun OS root: `factory/`, `infra/`, `src/`, `distribution.json`, image manifests |
| Kernel source and kernel-specific integration | Upstream kernel maintainers plus Bun OS integration | Pin upstream source; keep only Bun OS patches/configuration here. | `vendor/` pins and `factory/` kernel recipes; YOLO only for independent cross-build helpers |
| OS init, OS service clients, hardware/ABI adapters required at runtime | Bun OS when required to boot/operate; otherwise YOLO | Keep the minimal runtime closure in Bun OS. Move reusable implementations to versioned YOLO libraries and consume them as dependencies. | OS-specific adapters under `crates/bunos-*`; reusable code in YOLO repositories |
| Cross compilation, compiler/toolchain orchestration, Windows/Linux interop, Android/WASM build pipelines | YOLO | Keep no second implementation in Bun OS; consume a pinned release or workspace source while developing. | `yolo-cross` (`crates/`, `packages/`, `src/native/`) |
| Standards, schemas, compatibility matrices and portable system abstractions | YOLO | Reference published schemas/specs; keep only the OS profile/configuration in Bun OS. | `yolo-standards` |
| Generic browser, web automation and WebOS tooling | YOLO | Keep only the session integration and required image packages in Bun OS. | `yolo-web` |
| Binary analysis, reverse engineering and emulator frameworks | YOLO | Keep only hardware enablement or applications selected by an OS composition. | `yolo-re` and project-specific repositories |
| Shared Rust UI and rendering frameworks | YOLO | Keep the selected desktop/session and image integration, not a second framework owner. | `yolo-ui` |
| Craft/productivity apps, hosted services, AI/search/agent products, demos and marketing sites | Product-specific repositories (YOLO when reusable/current; Aphrody when legacy) | Exclude from the base OS and its mandatory build graph. Keep an app only as an optional image composition with a declared runtime dependency closure. | Existing product repositories or an explicit `src/yolo-*` source export during migration |
| Imported third-party source | Upstream project | Keep as a pinned source only when an image or build target consumes it. | `vendor/`, `.gitmodules`, `sources.lock.json`; record license and provenance |

`src/yolo-*` is a migration/export namespace, not a permanent catch-all. Each such tree must have a README, owner, license/provenance record, standalone manifest, CI/build command, dependency boundary, and a named destination repository. When a destination repository owns the complete source and CI, remove the duplicate from Bun OS in a history-preserving migration. Never copy a subtree and describe it as transferred ownership.

## Keep, move, or remove rules

1. **Keep in Bun OS** a source only if the image factory, installer, boot process, update path, OS runtime, or an explicitly selected image profile consumes it. Record the consuming manifest and command.
2. **Move to YOLO** generic toolchains, cross-platform libraries, standards, reusable developer CLIs, web/reverse-engineering frameworks, and build/interop code. Move a complete dependency closure, not a leaf whose workspace dependencies remain behind.
3. **Keep as an optional product** user applications that are intentionally shipped in a named composition. They must not become implicit base-system dependencies.
4. **Remove from the Bun OS build graph** abandoned experiments, duplicate forks, unreferenced demos, unpinned downloads, and code with no declared owner, consumer, tests/build path, or legal provenance. Preserve license and attribution records for retained imports.
5. **Do not purge local state**: `.env`, `.local/`, local databases, caches, build outputs, model weights, and untracked or ignored files are not source-cleanup targets. This checkout has extensive local changes, so file moves require a verified path map and reference updates; broad `clean`, reset, or recursive deletion is prohibited.

## Migration record

The current Bun OS checkout has a large, modified workspace with interdependent root Bun/Cargo workspaces and nested vendor workspaces. Therefore this change establishes the target ownership contract and documentation routes; it does **not** claim that the full 571-crate / 139-package / 62-app inventory has already been split or that external organization transfers have occurred.

Already present in the separate `yolo-cross` checkout are the cross-compilation monorepo and selected Bun OS compiler/build/interop packages. A separately usable Rust retrieval core has also been extracted to `C:\src\yolo-ai\crates\yolo-rag-core` as `yolo-rag-core`; its source compiles in the new workspace. The Bun OS copy remains archived only because legacy consumers still reference its old path. The Aphrody app, CLI, MCP, infra, chat, and WebOS products are explicitly excluded from YOLO migration success. The `yolo-rs` organization already has independent Rust projects such as [`yolo-zig`](https://github.com/yolo-rs/yolo-zig); this Bun OS audit moved no additional crate there because remaining candidates have product/OS dependencies or lack a standalone build boundary. See the yolo-cross migration guide and each target README for current ownership.

Organization status checked 2026-11-04: GitHub `aphrody-labs` exposes public repositories; GitHub `yolo` exists but currently shows no public repositories. GitHub `yolo-rs` is a separate organization with published Rust work, including [`yolo-zig` v0.1.2](https://github.com/yolo-rs/yolo-zig/releases/tag/v0.1.2). npm organization scope availability and package transfer rights were not verifiable from public pages in this review; the separate session reports `@yolo-rs/posix-bun@0.1.2`. Until the owner confirms `@yolo` scope access and repository transfers, preserve `@aphrody/*` names and Aphrody URLs for legacy releases; new YOLO-owned repositories should use confirmed GitHub/npm namespaces only after ownership and release automation are ready.

## Documentation and qualification contract

Every maintained project documents: purpose and non-goals; owner and source repository; supported hosts/targets; dependencies and generated artifacts; setup/build/use commands; configuration/schema; tests and qualification evidence; license/provenance; migration or deprecation state. Keep four claims distinct: source is present, target is configured, artifact builds, and target boots/runs/qualifies.

## Research sources

Reviewed 2026-11-04:

- [Linux kernel documentation and mainline source guidance](https://www.kernel.org/doc/html/latest/process/submitting-patches.html)
- [What Linux is, and why a distribution is more than the kernel](https://kernel.org/linux.html)
- [Linux From Scratch](https://www.linuxfromscratch.org/) and [Beyond Linux From Scratch](https://linuxfromscratch.org/blfs/view/stable-systemd/)
- [Asterinas organization](https://github.com/asterinas) and [Asterinas book](https://asterinas.github.io/book/)
- [uutils organization](https://github.com/uutils) and [uutils/coreutils](https://github.com/uutils/coreutils)
- [GNU software directory](https://www.gnu.org/software/software.html), [GNU manuals](https://www.gnu.org/manual/manual.en.html), and [GNU documentation guidance](https://www.gnu.org/prep/standards/html_node/GNU-Manuals.html)
- [Linux Foundation](https://www.linuxfoundation.org/) and [LF Engineering repositories](https://github.com/orgs/LF-Engineering/repositories?q=sort%3Astars)
- [Aphrody GitHub organization](https://github.com/aphrody-labs) and [YOLO GitHub organization](https://github.com/yolo)
- [npm organization scopes and packages](https://docs.npmjs.com/about-organization-scopes-and-packages/)
