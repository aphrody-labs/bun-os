# OS standards alignment

Owner direction, 2026-10-31. This is the product target and migration order;
it is not a claim that each target is already built or qualified.

## Decisions

| Reference | Decision | Bun OS application |
| --- | --- | --- |
| System76 / Pop!_OS | Adopt | Linux userland and package-source baseline; release-specific Ubuntu/Pop repositories and update behavior. Keep Bun OS identity and release ownership. |
| systemd | Adapt | Native units, explicit ordering/readiness, restart policy, service identities, state directories, credentials and least-privilege sandboxing. Follow the supported version shipped by Pop!_OS. Feature-gate directives and qualify them in the real service context. |
| COSMIC | Adopt | Primary Linux desktop: coherent session, portals, settings, accessibility, app metadata and upstream-compatible Rust component boundaries. Keep graphical session dependencies out of server images. |
| itch.io Butler | Adapt | Channel-based release tracks and efficient resumable/delta delivery for application artifacts. Keep OS package repositories, signing, bootable updates and rollback under Bun OS control. |
| Redox | Adopt as a separate target; adapt for sharing | Build a separately booted Redox image. Share portable Rust libraries and app logic only where the Redox target, dependencies and licenses permit. Keep its kernel, Scheme/IPC, drivers, services and package/boot pipeline target-specific. |

Redox is a Rust microkernel operating system and uses its own userspace and
service communication model. COSMIC being Rust-based does not make Linux
desktop services or systemd units portable to Redox automatically. Keep the
Linux and Redox contracts separate and measure source reuse crate by crate.

## Migration order

1. Correct the product contract and default manifests from Arch/pacman to
   Pop!_OS/Ubuntu with systemd; inventory every consumer before changing
   package conversion or repository code.
2. Make systemd unit files the source of truth for Linux services. Add
   hardening by service and verify kernel/container support rather than
   copying a one-size-fits-all sandbox block.
3. Treat COSMIC as the supported desktop session and align package, portal,
   launcher, settings and accessibility integration around its upstream
   interfaces.
4. Define Redox target triples, source owners, supported shared crates, IPC
   boundaries, boot image and qualification receipt separately from Linux.
5. Add Butler-compatible app artifact channels where useful. Keep signed,
   atomic system release and rollback flows independent.

## Current gaps

- `distribution.json`, `factory/profile.json`, `factory/usr/manifest.json`,
  `src/distribution.ts` and `factory/arch/` still encode Arch/pacman. This is
  the highest-priority configuration migration; the Pop!_OS-based unified
  image is a real implementation path, but does not yet make the root factory
  contract consistent.
- The unified session container runs COSMIC without a systemd user manager.
  Keep that as a WebOS container arrangement; do not treat it as proof that the
  installed Linux system's systemd service lifecycle is qualified.
- The current WebOS session protocol serves the unified COSMIC/Android
  container. Redox browser sessions and the other OS targets remain separate
  work until their owners and end-to-end receipts are present.
- No current source inventory establishes complete Redox port coverage or
  Butler-based product delivery. Track those as planned integration, not as
  completed capability.

## Primary references

- [systemd execution and sandboxing](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
- [Pop!_OS sources](https://github.com/pop-os/pop)
- [COSMIC Epoch](https://github.com/pop-os/cosmic-epoch)
- [itch.io Butler: pushing builds](https://itch.io/docs/butler/pushing.html)
- [Redox OS goals and security model](https://github.com/redox-os/book/blob/master/src/our-goals.md)

