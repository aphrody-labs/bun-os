# Patch series for the pinned Rust userland

Layout: `patches/<tool>/NNNN-subject.patch` (`git format-patch` output), `<tool>` being a key of `../pins.json`.
`bun factory/rustbase/check.ts --patches` applies every series with `git am --3way` to a shallow clone of the pinned SHA
and fails when one does not apply. A patch is committed only after that passes. No series exists yet.

| Tool | Candidate patch | Status | Reason |
|---|---|---|---|
| uutils coreutils | WSL-aware `uname -r/-v`, `hostname`, `open` | not needed | WSL owner (2026-10-29): not needed today; the WSL kernel string already reports `microsoft-standard-WSL2` through `uname(2)` |
| uutils coreutils | `/proc` path handling for WSL2 | TODO | no failing case observed; add a patch only with a reproducing test from a built WSL rootfs |
| uutils util-linux | applets missing for systemd/WSL init (`mount`, `hostname`) | not a patch | out of scope for the fork's `feat_common_core`; GNU util-linux stays |
| sudo-rs | PAM service names | package content | `pam-login` feature is off on purpose; `/etc/pam.d/sudo{,-i}` ship in `bunos-sudo-rs` |
| nushell | login-shell and Bun integration | package content | `bunos-nushell-default` (`env.nu`, `/etc/shells`, `useradd` default) |
