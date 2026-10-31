# Bun OS Omarchy integration (public-product recon)

Scope: map Omarchy's public product and interaction patterns to an optional, native Bun OS desktop composition. This is a clean-room UX and capability integration plan, not a reproduction of Omarchy's brand, assets, scripts, private interfaces, or upstream installer.
For: Bun OS users who want a keyboard-first, customizable Linux work desktop and its optional gaming/developer tools.
Date: 2026-10-21

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | product homepage | https://omarchy.org/ | Public positioning, hardware coverage, install CTA, agent/plugin/theme features and desktop overview. Read in browser. Homepage claim of “thousands” of plugins conflicts with live catalogue count; do not treat it as verified availability. |
| 2 | public manual | https://omarchy.org/manual/ | Describes Omarchy as Arch-based, Hyprland + Quickshell, with included productivity and developer apps. Read. |
| 3 | getting started | https://omarchy.org/manual/getting-started/ | ISO download, disk selection, encryption/security, dual boot, first-run choices. Read. These are Omarchy behaviors, not proposed Bun OS installer steps. |
| 4 | navigation manual | https://omarchy.org/manual/navigation/ | Keyboard launcher, workspaces, tiling/stacking/floating, grouping, scratchpad, multi-monitor, dock and persistent workspace layouts. Read. |
| 5 | theme manual | https://omarchy.org/manual/themes/ | 22 themes; theme selection updates multiple desktop and application surfaces; custom themes supported. Read. |
| 6 | public plugins catalogue | https://plugins.omarchy.org/ | Catalogue facets, sort, browse and plugin details; page showed 0 community plugins at observation time, conflicting with homepage marketing. Read. |
| 7 | plugin development guide | https://plugins.omarchy.org/develop.html | Public manifest, validation, enable/reload and publish workflow; its shell plugins run with user permissions. Read. Bun OS must use its own reviewed, permissioned capability model. |
| 8 | French manual (Quattro, observed ref) | https://github.com/omacom/omarchy/tree/ce39c5e9e9e4f5db7e023a07d0eeda9351ef9c80/manual/fr | Reviewed public docs: getting started, navigation, themes, GUI apps, updates, troubleshooting and system snapshots. The repository API reported this branch head at observation time; this is manual evidence, separate from the root package-source pin. No installation was performed. |
| 9 | dual boot install guide (Quattro) | https://github.com/omacom/omarchy/blob/ce39c5e9e9e4f5db7e023a07d0eeda9351ef9c80/manual/fr/50-dual-boot-install.md | Free-space install and BitLocker constraint; full disk/free-space effects are explicitly documented. |
| 10 | Bun OS Omarchy inventory | `factory/arch/omarchy/README.md` and adjacent declarative catalogs | Existing pinned package, recipe, source, Rust and configuration inventory. Local repo evidence; inventory is not a resolved package closure, installed desktop or qualification. |
| 11 | Bun OS desktop boundary | `docs/architecture/alpine-browser-desktop.md` | Local documentation distinguishes 32-bit browser Alpine guest from native Linux desktop. |
| 12 | Bun OS distribution profile | `factory/profile.json`, `factory/arch/omarchy/integration.json` | Existing root factory profile: COSMIC default, Omarchy/Hyprland optional and blocked/unqualified. No desktop default changes implied. |
| 13 | VPS virtualization capability | owner read-only probe reported `/dev/kvm` and `qemu-system-x86_64` present | Makes an isolated amd64 guest an architectural candidate. Guest boot, graphics, Hyprland/COSMIC session and hardware behavior are not qualified. |

## Core loop

Choose an optional desktop profile in Bun OS, resolve its signed package closure through the root pacman owner, boot a qualified native target into a keyboard-first workspace, then launch, arrange and theme work apps while retaining the normal Bun OS identity, update and recovery controls.

## Screens and surfaces

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Product overview | `https://omarchy.org/` | Explain the OS, its desktop, hardware, agent and customization story | hero, install CTA, feature groups, theme/plugin links, media, hardware sections | public page content observed; responsive states not exhaustively tested |
| S02 | Install entry | Homepage > install | Offer ISO and setup information | download, checksum/signature links, install choices | public instructions observed; no installation performed |
| S03 | Installer and first boot | ISO boot > configuration > select install target | Choose language/layout and target disk; full-disk or free-space dual boot; default full-disk encryption; first-owner or unattended setup | setup questions, disk chooser, install confirmation, progress, completion | documented by manual; no live installer state exercised; full-disk option erases selected drive; Secure Boot/TPM prerequisites are stated by upstream manual |
| S04 | Keyboard launcher/menu | `Super+Space` per navigation manual | Search/open apps and reach desktop actions/settings | searchable menu, app list/actions, setup/update/style sections | documented; not run on a live system |
| S05 | Desktop workspace | native desktop navigation | Arrange and switch windows across workspaces | dwindle tiling, scrolling, floating, focus, workspace switch, monitor layouts, fullscreen | documented; no screenshot/live desktop captured; layouts can persist per workspace |
| S06 | Dock and app switcher | desktop navigation manual | Pin/open apps and switch among running apps | pinned/running apps, app grid, groups, pop-out, scratchpad | documented; exact behavior varies by manual section |
| S07 | Theme selection | `Super+Space` > Style > Theme, or `Super+Ctrl+Shift+Space` | Apply a theme across shell and listed supported apps; choose wallpapers separately | 22 themes, theme chooser, wallpaper picker, unlock-screen variants, custom-theme route | documented in pinned manual; Tokyo Night selected on site at observation |
| S08 | Plugin catalogue | `https://plugins.omarchy.org/` | Discover community extensions | search, facets, sorts, result cards, detail/split view | public catalogue observed with 0 community plugins at the time |
| S09 | Plugin authoring/publishing | catalogue > develop/publish | Validate and distribute a plugin | manifest, lint/validation, enable/status/reload, publish workflow | public guide observed; no account or publishing performed |
| S10 | Agent and developer choices | homepage feature sections and manual | Explain available harnesses, editors and terminal tools | app lists, harness choices, documentation links | homepage/manual list options; runtime permissions not verified |
| S11 | Update center | menu > Update > Omarchy; update indicator | Update OS/app packages through a guarded channel; firmware has its own action | update available, channel selector (stable/RC/edge/dev), progress, firmware and restart prompt | documented in pinned manual; no update executed |
| S12 | Recovery and troubleshooting | bootloader snapshot entry or menu > Hardware; troubleshooting guide | Restore a pre-update system snapshot or diagnose/restart a subsystem | timestamped snapshots, restore prompt, hardware restart actions, debug/reinstall guidance | documented; root snapshot restores system filesystem, not `/home`; depends on Limine setup |
| S13 | Gaming and Windows VM information | homepage feature sections | Explain Steam/Proton, retro tools and VM limits | gaming list, Windows VM clipboard/folder sharing note | marketing information observed; no gaming/VM behavior tested |
| S14 | Bun OS profile and session selection | existing factory profile; target UI not observed | Present a truthful optional native desktop choice | COSMIC vs Hyprland session choice, dependency and qualification status | repository catalog exists; an installed, qualified Omarchy session was not observed |

## Flows

```
F01 Evaluate the desktop and install
    S01 -> S02 -> boot installer -> S03
    happy path clicks: not counted; steps are manual-documented, not operated
    edge: selected full-disk install erases that drive; dual-boot requires free space and disabling BitLocker; Secure Boot/TPM requirements; encryption unlock needs a pre-boot-capable keyboard; unsupported hardware, bad signature, insufficient disk

F02 Navigate and arrange a work session
    S04 -> S05 -> S06 -> S05
    happy path: invoke launcher, choose an app, switch workspace/focus, optionally tile/group/pop out
    edge: app unavailable, no keyboard alternative, stale layout after restart, multiple displays change

F03 Apply a theme
    S07 -> choose theme -> shell and supported app surfaces -> choose wallpaper if desired
    happy path: open the style menu or direct shortcut, select a theme
    edge: unsupported app theme, missing wallpaper, contrast or focus failure, partial theme application

F04 Discover and add an extension
    S08 -> inspect manifest/source -> validate -> explicitly enable -> status/reload
    edge: untrusted code or dependency, malformed manifest, excessive capability request, removal/rollback

F05 Integrate as a Bun OS native profile
    S12 -> inspect package plan -> approve a signed closure -> build image -> qualify boot/session -> publish profile
    edge: unresolved dependency, signing mismatch, unsupported target/libc/GPU, failed boot/input/audio/session gate

F06 Update and recover
    S11 -> check/update -> pre-update snapshot -> S12 if the new system fails -> restore known-good snapshot
    happy path: use the OS update owner, retain a bootable prior system, restore only after inspecting the snapshot
    edge: `/home` and user configuration are outside the documented root snapshot restore; non-Limine boot paths lack this snapshot flow; reinstall/reset can overwrite user configuration
```

## Components and interaction patterns

| component | variants | states | used on |
| --- | --- | --- | --- |
| Global docs/site navigation | News, Manual, Plugins, Themes, Search, language/theme controls | current, hover, keyboard focus, compact | S01-S02, S08-S09 |
| Desktop launcher | search, app result, action result | closed, open, query, empty, loading, unavailable | S04 |
| Workspace switcher | named/numbered workspace, monitor context | active, inactive, empty, restored | S05-S06 |
| Window arrangement controls | tile, stack, float, group, pop-out, scratchpad | available, selected, unavailable, focus-visible | S05-S06 |
| Dock | pinned app, running app, app grid | idle, running, focused, grouped, minimized | S06 |
| Theme chooser | built-in theme, custom theme | current, preview, applying, partial, failed | S07 |
| Plugin card/detail | verified/community, installed/not installed | discoverable, incompatible, permission review, enabled, failed | S08-S09 |
| Profile status card (Bun OS target) | optional session/profile | catalogued, blocked, resolvable, built, qualified, published | S12 |
| Update status/action | stable owner channel | available, downloading, applying, restart-required, failed | S11 |
| Recovery snapshot chooser | bootable snapshot | listed, selected, restored, failed, unavailable | S12 |

## Inferred data model

```
DesktopProfile  id, target_arch, session/compositor, package-source identity,
                optional capabilities, conflicts, qualification state
                evidence: S12 and factory/arch/omarchy/integration.json
                confidence: high for catalog structure; unqualified for installed behavior

PackageClosure  profile_id, signed repository snapshot, resolved package versions,
                dependency graph, signature/checksum proof
                evidence: root factory qualification requirements and pacman model
                confidence: high that it is required; no closure currently verified

QualificationReceipt  target, libc/toolchain, kernel/build identity, boot/session,
                      display/input/audio/GPU results, image hash, signer
                      evidence: factory/arch/omarchy/README.md qualification section
                      confidence: high as required evidence; none currently present

ThemePreference  user/session, theme id, supported surfaces, application status
                 evidence: S07 public manual; implementation storage not observed
                 confidence: medium; in Bun OS this must use the existing settings owner

UpdateChannel  profile, channel (stable | RC | edge | dev), source snapshot,
               previous-system snapshot reference, completion/failure status
               evidence: S11-S12 Quattro manual; Bun OS channels are not implied
               confidence: high for the reference flow, target policy remains unassigned

RecoverySnapshot  image/system root state, creation time, package-set identity,
                  boot entry, restore status and excluded data boundary
                  evidence: S12 snapshot docs; no local snapshot implementation presumed
                  confidence: high for the reference's root-vs-home limitation

ExtensionManifest  id, publisher, version, source/artifact digest, capabilities,
                    dependencies, compatibility and signature
                    evidence: S08-S09 public plugin guide; Bun OS schema is not Omarchy's
                    confidence: medium for extension metadata; Bun OS policy is target design
```

Relationships: profile selects package recipes which resolve to a signed closure; a qualification receipt binds the exact closure and image to a target. User theme preferences reference supported theme assets/surfaces. Updates operate on an identified profile and retain a prior qualified system snapshot; recovery scope must explicitly state excluded home/user data. Extensions declare requested capabilities and must pass the existing Bun OS review/install policy.

## Feature matrix

See `features.csv`. Values in the `original` column describe the public Omarchy reference; `clone` describes Bun OS status. Prefer adapting interaction patterns through existing owners instead of importing Omarchy orchestration.

## Out of scope

- Copying Omarchy's name, marks, visual assets, copy, exact theme files, scripts or proprietary content.
- Running upstream installers, reset/migration/provisioning scripts, importing home skeletons or provider account templates, auto-enabling services, or changing boot/users/encryption/signing policy.
- Treating the package/source inventory or the 32-bit browser Alpine guest as a qualified native x86_64 desktop.
- Advertising an Omarchy-compatible desktop, package, plugin or hardware path as installable before signed closure, build, boot and session evidence exists.
- Claiming game support, Windows VM acceleration, GPU passthrough, or plugin safety beyond public evidence.

## Size

14 reference/target surfaces, 6 flows, 7 inferred record types, no new database recommended. Hard parts: signed and reproducible pacman closure, native boot/session qualification across GPUs and hardware, safely composing an optional Hyprland/Quickshell session beside COSMIC, system update and recovery consistency, extension trust/capability enforcement, and accurately separating browser demo from native OS. The VPS has KVM and QEMU available as a possible isolated amd64 test target, but the guest is unqualified. Size: XL for a complete optional OS composition; L for a truthful profile planner and first qualified native target.
