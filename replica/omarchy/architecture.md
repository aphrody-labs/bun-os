# Optional Omarchy-inspired Bun OS desktop architecture

This is a clean-room plan for integrating selected public Omarchy desktop patterns into Bun OS. It does not install Omarchy, run its installer, or reproduce its brand. Public site observations are separated from manual-documented flows. All desktop claims must be qualified on a native target.

## Stack

| layer | choice | why |
| --- | --- | --- |
| native composition and packages | Existing Bun OS root factory and Arch/pacman/libalpm owner | The root factory already owns composition. The Omarchy inventory is declarative and must resolve through signed common package sources. |
| runtime and native services | Aphrody Bun and existing Rust-first owners | Preserve Bun OS runtime and Rust subsystem ownership; no additional runtime or nested workspace. |
| native desktop session | Existing optional `omarchy-hyprland`/Quickshell profile after qualification | Keep it a distinct optional session beside COSMIC; the current profile is disabled, blocked, and unqualified. |
| browser shell | Existing Bun WebOS with actual Craft WebAssembly apps; v86 Alpine is a separate 32-bit guest | WebOS is the real browser workspace product: users work in real published Craft apps. v86's 32-bit Alpine guest cannot host the x86_64 Bun runtime or native Hyprland/COSMIC. |
| isolated Linux runtime candidate | Existing Bun OS VPS factory plus KVM/QEMU and Aphrody Bun's x86_64 musl artifact | `/dev/kvm` and `qemu-system-x86_64` are available per read-only VPS probe; the fork has a musl artifact/ABI staging path. An amd64 Alpine guest is a candidate for isolated browser-backed system sessions, pending boot, graphics, transport and session qualification. |
| UI system | Aphrody identity and existing M3 theme/tokens | Reuse the product's M3 baseline and app components; do not copy Omarchy brand assets, theme names, or its site palette literally. |
| settings/preferences | Existing desktop and user-settings owners | Store session/window/theme choices where their current owners expect them; avoid duplicate databases. |
| extension/catalog security | Existing Bun OS capability, package-signing and permission owners | Upstream shell plugins execute with user permissions; Bun OS must retain review, signature, isolation and explicit capability grants. |
| updates and recovery | Existing factory, image, boot and snapshot owners | Updates need a known package closure and pre-update bootable artifact; do not run upstream migrations or reset tooling. |
| hosting/release | Root release owners | Publish source catalogs, qualified native images and web demonstrations through their separate release paths. |

## Design system direction

Use M3 components and semantic color/type tokens from the existing Aphrody baseline. The Omarchy reference visually uses a very dark canvas, muted lavender text, a vivid lime action, thin outlines, sparse navigation, a wide centered hero and compact music controls. Treat these as product-positioning cues only: Bun OS should use its own Aphrody Identity and M3 tokens rather than copying those exact colors, marks or typography.

The M3 stack search recommends window size classes at 600, 840, 1200 and 1600 dp. The desktop must adapt navigation and window chrome by those classes instead of using arbitrary web breakpoints. Keyboard focus needs a 2 px visible outline that survives forced-colors; persistent bars and overlays must not cover focus. Every window drag action needs a keyboard and single-pointer alternative such as a move/resize menu. Status must include text/icons and labels, not color alone. Respect reduced motion and system contrast settings. If there is an interactive product demo, keep controls visible, provide captions/transcript and a static fallback; never autoplay motion.

## Product boundaries: WebOS, guest OS and native desktop

The browser destination is the Craft WebOS workspace, with its actual Craft WASM applications and shared Aphrody identity/Drive integration. It is not an app directory, static catalog, or product mock-up. Each app shown as ready must have a real built artifact, generated manifest/hash, and matching release health source commit. App visibility follows capability and artifact state; a missing/unqualified app must be called unavailable, not represented with a dead launch button. Public deployment is a separate release claim and must be verified at the real domain after publication.

Three execution environments remain explicit:

| environment | intended use | qualification boundary |
| --- | --- | --- |
| Browser WebOS | Real browser desktop and Craft WebAssembly creative/office apps using Drive | Browser release, app artifacts, identity/open/save, windows and public host must qualify independently. |
| Existing v86 Alpine | Lightweight browser-side emulation/compatibility sandbox | 32-bit x86; cannot execute the 64-bit musl Bun or COSMIC/Hyprland native sessions. |
| Isolated amd64 Alpine guest on VPS KVM/QEMU | Candidate for a real x86_64 musl Bun system session connected through a browser transport | KVM/QEMU presence and a musl artifact are availability evidence only. Guest boot, Bun execution, display/graphics, browser transport, input, audio, permissions and desktop session remain pending qualification. |
| Native Arch/Bun OS desktop | Optional Omarchy-inspired package/session composition | Existing source catalog only; signed pacman closure plus native boot/session/hardware qualification is still required. |

The WebOS browser shell and a virtualized Linux guest can be integrated as separate windows/services after the guest protocol is qualified. Do not describe a browser window as the native desktop, or let the guest claim WebOS file access without explicit scoped transport permissions. The browser remains useful and functional when no guest is available.

## Schema and data ownership

New tables: **0**. Do not add a database. Existing root factory JSON/catalog files own source pins and declared profile structure; the common package owner owns signed repository snapshots and resolved package closures; the image/build owner owns immutable image artifacts; native qualification owners emit boot, session, hardware and release receipts; user settings own theme and workspace preferences. A profile cannot transition to installable until these receipts bind to the same source, package closure, target and image hash.

Conceptual records used by the existing owners:

| record | owning source | required fields |
| --- | --- | --- |
| DesktopProfile | root factory profile + registered session capability | stable id, target architecture, selected session, conflicts, source pins, optional package set, enabled/qualified/executable state |
| PackageClosure | common pacman owner | signed repository snapshot, resolved package/version graph, architectures, source and signature/checksum evidence |
| QualificationReceipt | native build/boot/session owners | target hardware, libc/toolchain, kernel identity, image hash, boot/session/display/input/audio/GPU results, signer and timestamp |
| GuestQualificationReceipt | existing runtime/image/browser-transport owners | KVM/QEMU host, amd64 musl Bun hash, Alpine image, boot log, graphics and transport protocol versions, input/audio/security results |
| UpdateTransaction | existing image/update owner | source channel, starting and target image hashes, pre-update rollback reference, result, restart requirement |
| ThemePreference | existing user/desktop settings owner | theme id, chosen M3 token set, supported surfaces, wallpaper reference and per-app application status |
| ExtensionManifest | existing package/agent capability owner | publisher, version, artifact digest/signature, requested capability set, dependencies, compatibility, review and enable state |

The source catalog's package counts are inventory, not a resolved install graph. The current Omarchy integration is not enabled, qualified, or executable. Root profile defaults remain separate: COSMIC and Hyprland are not one session and must not be merged by relabeling configuration.

## Interfaces and route matrix

No new public API route or user database is required in the first milestone. Existing root factory commands and files are the source of truth; WebOS can render their generated status when an appropriate capability feed exists. The precise command/API identifiers must be taken from the owning implementations. This plan does not invent endpoints or mark a proposed UI as an existing feature.

| action | existing owner / interface | caller and result | flow |
| --- | --- | --- | --- |
| Inspect profile source inventory | root `factory/graph.ts` and `factory/arch/omarchy/*` | read-only; shows declared source evidence and blocked/unqualified status | F05 |
| Resolve common packages | root Arch/pacman owner | authorized profile build; produces signed snapshot and exact dependency closure | F05 |
| Build image/profile | root factory and serialized VPS build owner | release lane; produces immutable image and build evidence | F01, F05 |
| Qualify native session | native target, kernel, display/session owners | target matrix; produces boot/session/hardware receipts | F02, F05 |
| Qualify isolated Alpine guest | existing VPS KVM/QEMU, musl runtime, guest graphics/transport owners | isolated amd64 guest; produces a separate guest receipt and browser capability status | F02 |
| Publish WebOS Craft workspace | central WebOS/Craft release owners | actual qualified Craft WASM artifacts, registry/source SHA, domain health and open/save evidence | F02, F03 |
| Apply user theme | existing M3 and desktop settings owner | signed/built theme or token reference; persist per-user preference | F03 |
| Update/rollback | existing package/image/boot owners | authorized system update; bind pre-update snapshot and result to the image transaction | F06 |
| Discover/install extensions | existing permissioned capability/package owners | verified catalog entry, explicit permission review, signed artifact | F04 |

## Update and recovery contract

The Omarchy manual documents four update channels and a pre-update system snapshot. Bun OS must not mirror upstream channel commands or migration scripts. It should use the central release policy and root factory to identify the previous/current image, verify the target signed closure, produce a rollback artifact before applying the update, and retain a clear restart/restore state. Recovery must declare its exact scope: restoring the system image does not imply restoring `/home`, personal files, or all user configuration. Preserve protected state and route data recovery through its owning storage service.

Do not ship a “restore” control until its rollback image and boot entry have been tested on that native target. If the active bootloader or image format cannot guarantee rollback, show recovery as unavailable and guide users through the qualified Bun OS recovery owner.

## Security boundaries

- Never run upstream install, provisioning, migration, reset, user-home copy, service-enable, kernel-selection or boot/encryption scripts.
- Keep hardware changes, package updates and system recovery behind existing authorization and audit owners; show the exact target and irreversible effects before applying them.
- Verify source pins, repository signatures, checksums and artifact hashes before build or activation. Do not treat web catalog entries as installable packages.
- Do not execute community plugin shell code just because its upstream manifest validates. Require Bun OS artifact signing, dependency review, capability declaration and explicit grant under the existing extension owner.
- Preserve licenses, notices and source attribution. Redistribution decisions remain separate for firmware, proprietary apps and assets.
- Do not claim Hyprland, Quickshell, COSMIC, GPU or native multi-window behavior inside browser Alpine/v86. Browser and native desktop qualification are separate.

## Build order

1. **Real WebOS Craft delivery:** publish the built Craft WASM apps as a working browser workspace, with honest capability manifests and Aphrody identity/Drive flows. Verify domain routing, generated source SHA, artifact hashes, multi-window behavior, and at least one real file open/edit/save. Do not gate the browser product on a native desktop build.
2. **Truthful Linux capability planner (S12):** render the current Omarchy catalog as blocked/unqualified; distinguish native Arch composition from the KVM amd64 Alpine guest candidate. No OS installation action until a target is qualified.
3. **Isolated guest candidate:** verify the exact Aphrody x86_64 musl artifact in Alpine, then qualify guest boot, graphics, browser transport, input/audio, permissions and recovery on VPS KVM/QEMU. Keep each gate visible and fail closed.
4. **One signed native Arch target:** resolve the package closure through the central pacman owner, build on VPS, qualify boot plus Hyprland/session/display/input/audio/GPU, then retain immutable receipts and the exact image hash.
5. **Desktop interactions (S04-S06):** keyboard launcher, window focus/switching, tiling/floating, workspace layout persistence and dock; add accessible move/resize alternatives and keyboard-only qualification.
6. **Theme and settings (S07):** M3-token theme choice across shell and supported apps; report unsupported surfaces and partial application. Do not import upstream theme files.
7. **Update and rollback (S11-S12):** stage an update to a new image, verify its signature, retain the prior image, restart, then test restore on the same target. Document user-data boundaries.
8. **Extensions and native app composition (S08-S10):** only register apps that are built and qualified; introduce signed permissioned extensions after capability enforcement and rollback are proven.
9. **Release:** publish each surface after its own evidence is complete. Browser WebOS app qualification, Alpine guest qualification and native Arch desktop qualification are separate release states.

## Risks and acceptance gates

| risk | required evidence before ship |
| --- | --- |
| Inventory mistaken for install-ready closure | signed repository snapshot and full resolved runtime/build dependencies |
| Browser Alpine confused with native Linux | UI/docs state v86 32-bit, isolated amd64 guest candidate and native Arch as separate targets; each receives its own test receipt |
| Craft WebOS reduced to a catalog or demo | public `craft.aphrody.app` serves actual Craft WASM apps; real file workflow and app artifacts/source SHA are checked after deploy |
| Guest candidate mistaken for qualified product | separate guest receipt covers boot, x64 musl runtime, graphics, browser transport, input/audio and permission boundaries |
| Optional desktop breaks COSMIC or server targets | explicit mutually exclusive session/profile matrix and target qualification |
| Update leaves machine unbootable | exact pre-update image, boot entry and restore test receipt |
| Rollback overstates what is restored | tested system/home boundaries and protected data preserved |
| Theme or window UI is inaccessible | M3 focus/forced-colors, keyboard-only, contrast and non-drag alternatives verified |
| Extension compromises user session | signature, permission review/grant, compatibility gate and disable/removal rollback |

## UI-UX Pro Max application

Searched design system for “desktop operating system productivity workspace keyboard-first”; used the M3 stack query for “keyboard-first desktop multi-window workspace” and targeted UX queries for “focus not obscured” and “dragging keyboard alternative.” The generated generic teal palette does not match the existing Aphrody identity, so retain only the applicable guidance: restrained flat surfaces, M3 semantic tokens/window classes, visible focus, non-drag alternatives, reduced motion, and a static/captioned alternative to any product demo. Omarchy's observed black/lavender/lime page styling is a reference cue, not Bun OS color-token instruction.
