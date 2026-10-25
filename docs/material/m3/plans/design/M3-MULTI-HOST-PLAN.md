<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 framework and host qualification

## Goal and authority

Share Material 3 roles, theme inputs, interaction expectations and adaptive rules
across the framework's renderers. Qualify each browser, native renderer and
installed host independently. The private M3 repository is the design submodule;
product UI and native integrations follow Aphrody's
[PLAN](../../../../PLAN.md), [GOAL](../../../../GOAL.md) and
[AGENTS](../../../../AGENTS.md). Runtime/SDK production follows
[Yolo's plan](../../../../../yolo/PLAN.md).

The framework packages expose reusable APIs. `apps/web` is the small web example;
`apps/m3-showcase` exercises packages with mobile, desktop and TV layouts, local
fixtures and a Bun API. Product navigation, persistent stores, RPC and platform
privileges stay under their application owners.

## One design contract, several renderers

| Layer | Current owner | Contract and boundary |
| --- | --- | --- |
| Rust design roles | Aphrody `crates/aphrody-m3-tokens` | Typed tokens, HCT, palettes and CSS-sheet generation. Native parity needs its own runtime receipt. |
| Web projection | `m3-tokens`, `m3-theme`, `m3-tailwind` | CSS roles, TypeScript inputs and Tailwind aliases; JavaScript dynamic colour uses Material Color Utilities. |
| React DOM | `m3-primitives` family and `m3-motion` | Base UI behaviour, Tailwind styling and M3 motion. This also applies inside webviews. |
| Custom elements | `material-web`, `m3-front`, `m3-react` | Lit components and React wrappers consuming shared roles. |
| Web hosts | `m3`, `m3-bun`, `m3-next` | Bun and Next adapters; no platform authority is inferred from a component import. |
| Host generation | `scaffold`, `m3-next-migrate` | Pinned Tauri 3 shell generation; migration rejects unsupported host adapters before activation. |
| Native host | Aphrody `crates/ui/m3-showcase`, `crates/ui/app`, rendering crates | Native process, permission and resource ownership stay in the parent workspace. |

Base UI renders React DOM and Tailwind emits CSS; native widgets require separate
interaction and accessibility evidence. Active dependencies come from manifests
and the lockfile. Retain upstream notices even when compatibility wrappers replace
their behaviour; do not infer a dependency's removal from the renderer choice.

## Customization contract

Existing theme APIs expose seed, variant, light/dark/system mode and contrast.
Next's static shell, preference cookie and lazy colour engine have unit/DOM
contracts. Recheck the same seed/mode/contrast across JavaScript, Lit and the native
renderer before claiming cross-host parity.

Typography/font overrides, shape, density, RTL/localization, text scaling,
persistence and high contrast each require a documented default and host-specific
proof. Responsive width/height classes and showcase layout preferences cover web
layout. Installed mobile qualification also needs safe areas, virtual keyboard,
touch, suspend/resume and platform process cleanup.

## Delivery matrix — 2026-10-04

The [scoped UI receipt](./M3-PLAN.md#verified-ui-batch) totals **211 pass, 1 skip**.
It establishes the named software contracts on Linux with Bun 1.4.2.

| Target | Source/test evidence available | Qualification remaining |
| --- | --- | --- |
| Bun browser app | Framework/example source; showcase unit/API contracts pass | Production browser build, interactions, offline assets and visual/accessibility receipt for the chosen app. |
| Next.js web | 49 unit pass, 10 isolated DOM pass; theme/proxy/export/runner contracts | Browser receipt, asynchronous DOM gate stability and the skipped Rust parity check. |
| Tauri desktop | `apps/m3-showcase` host contracts pass; native owner is Aphrody `crates/ui/m3-showcase` | Factory-admitted native build, bundle, install, API lifecycle, permissions and real host interaction receipt. |
| Mobile browser and TV layout | Showcase adaptive contracts and three D-pad DOM tests pass | Real browser keyboard/touch, viewport/safe-area, text scaling and screen-reader checks. Layout presets do not establish a mobile installation. |
| Android/iOS installed app | Scaffolder mobile entry/capability contracts and host diagnostics exist | Actual SDK/toolchain, build, install, lifecycle and interaction checks. iOS needs a macOS/Xcode host. |
| Standalone Rust desktop GUI | Rendering/token crates exist in Aphrody | Native widget, focus/accessibility, packaged app and installed-host receipt. No Rust gate ran in this UI audit. |
| React Native/native Rust mobile | No delivered framework adapter was qualified by this batch | A separately scoped adapter and its platform qualification. |

Tauri versions follow the specific host's manifests. The scaffolder's
[TAURI_3 pins](../../../packages/scaffold/src/pins.ts) and parent workspace
dependencies must not be described as universal Tauri v2 support. Desktop sidecars
and broker behaviour do not establish Android/iOS equivalence. Cross-compilation,
generated configuration and source tests remain distinct from installation.

## Delivery order and release bar

1. Close the owned framework source batch with existing manifest/import, asset,
   docs, TypeScript, lint/format, tests and build gates from
   [M3-PLAN](./M3-PLAN.md#existing-gates).
2. Qualify the chosen web examples in a browser, including theme persistence,
   offline assets, focus/labels, keyboard/touch and reduced motion.
3. Have the native integrator qualify each intended installed host through the
   declared build factory and Cargo serialization. Record artifact, revision,
   target, installation, permissions, cancellation and shutdown evidence.
4. Check customization/accessibility parity and record comparable performance
   measurements per renderer. Keep fork bases, Aphrody deltas and notices traceable.

Consumer examples and package APIs stay private under current authority. Public
publication or deployment requires the owner's scope; successful local tests do
not activate a service or close the parent runtime milestones.
