# Bun OS goal: a Googlebook-class experience

Owner decision, 2026-10-29: the ultimate goal of Bun OS is the experience of
[Googlebook](https://googlebook.google/intl/fr_fr/) (Google's laptop platform "designed for Gemini Intelligence"), built from open
parts and our own stack. This page maps each Googlebook promise (read from that page on 2026-10-29) to the real building blocks
Bun OS uses. A line is "built" only when a test proves it; everything else is a plan.

| Googlebook promise | Bun OS building block | Status |
| --- | --- | --- |
| Shell with Material look, apps, widgets | Material 3 (`packages/m3-*`), shell in `apps/webos` and the wasm compositor (`packages/wasmos`) | partial, see `docs/WASMOS.md` |
| Gemini everywhere, "wiggle the pointer to ask" | assistant overlay triggered by a pointer-shake gesture in the compositor; model backend is pluggable (local model through llama.cpp via `aphrody-llama-sys`, or a hosted API with the user's own key) | not built |
| Improved dictation (filler words removed, text formatted) | local speech-to-text (whisper.cpp) plus a cleanup pass by the assistant | not built |
| "Hey Google" voice conversation, share screen | wake word + streaming speech, screen capture through the compositor | not built |
| AI file descriptions, search by content | Spacedrive on the web side, COSMIC Files / Nautilus / Dolphin on the desktop, content indexing with local embeddings | not built |
| Phone sync: apps, handoff, files | KDE Connect protocol (open), Android apps through Waydroid or the Android runtime crates (`android-native`) | not built |
| Play Store, millions of apps | Flathub and F-Droid on the distro, Waydroid for Android apps; Play Store needs Google's licence and is out of scope | not built |
| Games: mobile and PC via streaming | `bun-engine` emulation stack, Steam/Proton (`bunos-compat`), cloud streaming clients | in progress, see `docs/EMULATION.md` |
| Titan C security chip, fingerprint / face unlock | TPM 2.0, passkeys, `fprintd`, Howdy-style face unlock, secure boot on the Arch variant | not built |
| Hardware: 16 GB RAM, 256 GB, 14 h battery | out of scope for the software project; tuned power profiles in `factory/distro` | not built |

## Rules

- Open parts first; no stub apps. Every row above ends in a real library or application with an integration test.
- The wasm line (Bun OS in a browser or in Bun) and the Arch/Omarchy line (Hyprland-style tiling shell) share the Material 3 design
  system; the craft apps carry the Fluent / Windows 11 look.
- Google trademarks, the Play Store and Gemini model weights are not available to us. Where Googlebook uses them, Bun OS uses open
  or user-supplied equivalents and says so.
