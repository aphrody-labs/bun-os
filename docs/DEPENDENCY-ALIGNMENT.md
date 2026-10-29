# Cargo dependency alignment

Audit date: **2026-10-14**. This is a source and resolved-graph audit, without
Cargo execution, native compilation or tests.

## Qualified graph snapshots

| Snapshot | Workspace members | Resolved packages | Names with multiple versions |
| --- | --- | --- | --- |
| Previous source snapshot `51ee0193` (metadata receipt) | 20 | 559 | 49 |
| Current `build/cargo-metadata-24.json` | 24 | 564 | 49 |

Both files describe metadata qualification completed by the root owner.
The current audit read all 24 member manifests, including their target-specific
dependency tables, and checked their resolved direct edges. All **92 dependency
declarations** inherit an existing root workspace dependency. No dependency
name resolves to different versions between direct workspace consumers.

The font owners are now centralized too: `craft-fonts` at source revision
`8855577a452c6d2536674e7e0a705bb933110ef5` and `craft-fonts` tests at
`29111fb27a8338ff220ad87395f70ca0cbbf80dc`. The latter inherits `craft-fonts`
and `skrifa =0.48.0`, requesting the published `default` feature for skrifa.

This establishes direct dependency alignment. It does not establish a single
version for every transitive dependency, or native compatibility of the new
four-crate batch. Compilation and native tests of that batch remain unexecuted.

## Root consumers and incompatible transitive constraints

Ten multiversion names also have direct workspace consumers: `base64`,
`miniz_oxide`, `moxcms`, `objc2`, `objc2-app-kit`, `roxmltree`, `rustix`,
`sha2`, `skrifa` and `thiserror`. Their workspace consumers agree on the root
version; older versions remain because other packages require different ranges.

Four versions have only workspace members as their immediate parents:

| Root version and consumer | Other resolved version | Upstream owner and constraint |
| --- | --- | --- |
| `moxcms 0.9.1`, craft-cms | `0.8.1` | image 0.25.10 requires `^0.8.0` |
| `roxmltree 0.21.1`, craft-print | `0.20.0` | usvg 0.45.1 requires `^0.20` |
| `sha2 0.11.1`, craft-fonts | `0.10.9` | sigstore-crypto 0.6.6 requires `^0.10` |
| `skrifa 0.48.0`, craft-fonts | `0.44.0` | epaint 0.36.2 and glifo 0.2.0 require `^0.44.0` |

For these pre-1.0 packages, the indicated minor ranges are incompatible.
Changing the common root pin cannot make the upstream declarations accept the
newer line. Keep the recent root versions; migrate the upstream owner and its
APIs deliberately, then resolve and qualify that change.

## Owners of the remaining version families

| Family | Resolved lines | Owners constraining coexistence |
| --- | --- | --- |
| Base64 | 0.22 / 0.23 | pem, usvg and Sigstore require `^0.22`; reqwest/hyper-util require `^0.23` |
| GPU/test bit sets | bit-set 0.10 / 0.11; bit-vec 0.9 / 0.10 | naga/wgpu use older lines; proptest 1.12.0 requires newer lines |
| bitflags | 1 / 2 | core-graphics, png 0.17 and redox_syscall 0.4 retain 1.x |
| SHA/digest support | digest 0.10 / 0.11; block-buffer 0.10 / 0.12; crypto-common 0.1 / 0.2; const-oid 0.9 / 0.10; cpufeatures 0.2 / 0.3 | Sigstore and SHA 0.10 use the old digest stack; root SHA 0.11 uses the new stack |
| Randomness | getrandom 0.2 / 0.4; rand_core 0.6 / 0.10 | ring requires getrandom `^0.2.10`; signature requires rand_core `^0.6.4`; UUID/rand use current lines |
| Hash tables | hashbrown 0.16 / 0.17 | accesskit_consumer and gpu-allocator retain 0.16; current GPU/indexmap owners require 0.17 |
| Android JNI | jni-sys 0.3 / 0.4 | ndk/ndk-sys retain 0.3; current jni and the 0.3 shim also depend on 0.4 |
| Vector geometry | kurbo 0.11 / 0.13 | svgtypes/usvg retain 0.11; peniko requires 0.13 |
| Window/event platform | calloop 0.13 / 0.14; rustix 0.38 / 1; linux-raw-sys 0.4 / 0.12 | winit 0.30.13 retains older event/platform dependencies; smithay and current rustix users require newer lines |
| macOS foundation | core-foundation 0.9 / 0.10 | winit/core-graphics/system-configuration retain 0.9; current security-framework/platform-verifier require 0.10 |
| Objective-C bindings | objc2 0.5 / 0.6; block2 0.5 / 0.6; objc2-app-kit/foundation/metal/quartz-core/ui-kit 0.2 / 0.3 | winit retains the older bindings; current egui/wgpu/muda/arboard use newer bindings |
| PNG/compression | png 0.17 / 0.18; miniz_oxide 0.8 / 0.9 | tiny-skia requires png `^0.17`; current image/muda use 0.18; both PNG lines still require miniz `^0.8`, while flate2/root print use 0.9 |
| Font parsing | skrifa 0.44 / 0.48; read-fonts 0.41 / 0.45 | epaint/glifo/harfrust retain the older stack; root font tests use skrifa 0.48 |
| Error helpers | quick-error 1 / 2; thiserror and thiserror-impl 1 / 2 | rusty-fork retains quick-error 1; tiff uses 2; calloop 0.13 and ndk retain thiserror 1 |
| Redox support | redox_syscall 0.4 / 0.5 / 0.9 | winit, parking_lot_core and libredox each constrain a different line |
| Hash implementation | rustc-hash 1 / 2 | naga/wgpu-core require 1.x; quinn/type-map require 2.x |
| Proc-macro syntax | syn 1 / 2 / 3 | proc-macro-error retains 1; numerous derive owners require 2; current Serde/thiserror/Tokio/async-trait macros require 3 |
| TLS parsing | untrusted 0.7 / 0.9 | aws-lc-rs requires `^0.7.1`; ring/webpki require 0.9 |
| Windows API | windows-sys 0.52 / 0.59 / 0.60 / 0.61 | ring/winit require 0.52; rustix 0.38 accepts only through 0.59; arboard accepts only below 0.61; current Tokio/eframe use 0.61 |
| Windows target artifacts | windows-targets 0.52 / 0.53 and eight architecture artifact names on those lines | Different windows-sys generations require their corresponding target families |

No Windows API downgrade is proposed to reduce this count. Even where an
upstream range permits an older version, the product contract prioritizes
recent dependencies and native Windows builds are reserved. Migrating winit,
arboard, ring and their API consumers is the relevant owner work; it requires
separate native qualification.

## Follow-up ownership

The root owns common dependency declarations, one lockfile and vendor
regeneration. Each imported child owns its use-site features and API calls.
An external package's dependency declarations remain its upstream owner's
contract. A root workspace pin does not override incompatible transitive
requirements, and no forced same-name replacement is qualified here.

The main migration candidates are the image/color stack, usvg/SVG stack,
Sigstore crypto stack, epaint/glifo/font stack and winit/platform stack.
Each must use a current compatible upstream release or a reviewed source
migration; simply forcing newer pre-1.0 dependencies is insufficient.

## Primary version references

Exact published versions and features were checked against the primary
crates.io version API during the source audits:

- [async-trait 0.1.92](https://crates.io/api/v1/crates/async-trait/0.1.92)
- [axum 0.8.9](https://crates.io/api/v1/crates/axum/0.8.9)
- [pretty_assertions 1.4.1](https://crates.io/api/v1/crates/pretty_assertions/1.4.1)
- [similar 3.2.0](https://crates.io/api/v1/crates/similar/3.2.0)
- [proptest 1.12.0](https://crates.io/api/v1/crates/proptest/1.12.0)
- [regex 1.13.1](https://crates.io/api/v1/crates/regex/1.13.1)
- [skrifa 0.48.0](https://crates.io/api/v1/crates/skrifa/0.48.0)
- [windows-sys 0.52.0](https://crates.io/api/v1/crates/windows-sys/0.52.0)
- [windows-sys 0.59.0](https://crates.io/api/v1/crates/windows-sys/0.59.0)

These references establish published version/feature definitions. They are
not evidence that upstream migrations, native tests or a fully single-version
transitive graph have been completed.
