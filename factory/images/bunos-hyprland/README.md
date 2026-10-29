# Hyprland composition (opt-in, not enabled)

Status on 2026-10-29: `hyprland.packages` is a package intent list derived from `factory/wayland/closure.json`
(Arch core/extra metadata plus the pinned upstream tags). It is not selected by `server`, `desktop` (COSMIC) or
`gaming`, it is not wired into `factory/profile.json` and nothing in it was built, booted or qualified.
PLAN.md keeps Omarchy Hyprland blocked until a package subset, a signed closure and boot/session qualification
exist; this list does not lift that block.

- Names marked `(source)` need a local package because Arch ships another version than the pin; the PKGBUILD
  stubs in `factory/wayland/pkgbuilds` are UNVERIFIED (never built).
- `bun factory/wayland/verify-closure.ts` checks the pins against their remotes; `bun factory/bunos/check-components.ts`
  checks the submodule mounts offline.
