# Owners

One implementation owns each concept. Surfaces bind that implementation and
retain its errors, limits and qualification.

Owner directive, 2026-10-16: deliver one unified Bun OS product. AI,
infrastructure, workspace orchestration, libraries and applications converge on
canonical implementations. Source still awaiting transfer is migration work,
not an additional permanent product owner.

The unified Bun Libraries session report records the source inventory,
per-library owners, native Bun quality commands, app artifact contract and
qualification boundaries at commit
[`15cd85a`](https://github.com/aphrody-labs/bun-libraries/blob/15cd85a497dbd7d9e07e4e01aad08109f04fdea8/docs/session-report.md).
Treat it as integration history; current owner declarations in this workspace
and each pinned source repository govern subsequent changes.

| Concept                                                                                            | Owner                                                                                              | Consumers                                                                             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Source pins and library roles                                                                      | Bun OS `aphrody.config.json` / `sources.lock.json`                                                 | Workspace, desktop, app packaging                                                     |
| App IDs, capability labels and presentation                                                        | Bun OS `packages/bun-workspace/src/capabilities.ts`                                                | Desktop, artifacts, deployment                                                        |
| Checkout discovery and native artifact discovery                                                   | Bun OS `packages/bun-workspace/src/runtime.ts`                                                     | Checkout tools and source adapters                                                    |
| Bun provenance and selected compiler                                                               | Bun OS `packages/bun-workspace/src/runtime.ts`; runtime source is Bun                              | Tools and compiled app manifests                                                      |
| Content digests and shared asset identity                                                          | Bun OS `packages/bun-workspace/src/hash.ts` / `assets.ts`                                          | App payloads and shared R2 assets                                                     |
| Child lifetime, cancellation, signals and captured output                                          | Bun OS `packages/bun-workspace/src/process.ts`                                                     | Cargo tools, native video transport, factories and standalone launchers               |
| Video project, timeline and commands                                                               | Bun OS pinned FilmCraft Rust source                                                                | Typed Bun Video adapter; media codecs remain Bun runtime capabilities                 |
| JavaScript runtime and native APIs (`Bun.Video` was fork-only)                                     | Upstream oven-sh/bun (fork abandoned)                                                              | Bun OS factories and Aphrody product consumers                                        |
| Shared Rust primitives and native libraries                                                        | Their pinned Craft source owners                                                                   | Bun OS library engines                                                                |
| Licensed font sources                                                                              | Pinned Craft font owner                                                                            | Bun OS shared asset manifest and native engines                                       |
| App payload extraction and manifest verification                                                   | Bun OS `packages/bun-artifacts`                                                                    | Standalone Bun apps                                                                   |
| Distribution and app-build admission                                                               | Bun OS distribution and factory owners; lock admission in `infra/app-build.ts`                     | Runtime, APT and product artifacts; shared lock in `infra/apps.json`                  |
| Package and source conversion                                                                      | Bun OS `packages/package-converter` / `src/apt.ts`                                                 | Winget and Bun package outputs; source package identity and license metadata          |
| Debian APT implementation                                                                          | Official APT fork, pinned by Bun OS                                                                | Bun OS distro build and conversion adapter; no second APT implementation in consumers |
| Hosts, services, boot and deployment authority                                                     | Bun OS Infra `crates/aphrody-infra` and `infra/config/host/`                                       | Bun OS deployment adapter and controller                                              |
| Git forge and workflow execution                                                                   | Bun OS `infra/config/host/apps/vps/gitea-runner/` and deployed forge/runner                        | Bun OS and Bun source workflows                                                       |
| Bun runtime SDK artifacts and `bun-lib` R2 domain                                                  | Bun fork `scripts/aphrody/media-sdk-publish.ts` and `packages/web/cloudflare/scripts/provision.ts` | Bun OS and Aphrody consumers use verified published URLs                              |
| Cloudflare zone defaults, CDN cache rules, site CAA/mail policy, Worker rules and R2 configuration | Bun fork `packages/web/cloudflare/scripts/provision.ts`                                            | Bun OS Infra host-record catalog and domain/asset contracts                           |
| Registrar state, app-host DNS intent and OVH host-record profiles                                  | Bun OS Infra `tools/aphrody/config/cloudflare/` and `infra/config/host/`                           | Bun OS and Bun site host consumers                                                    |
| Live DNS, proxy, Worker and object-storage state                                                   | Cloudflare                                                                                         | Bun site provisioning and Bun OS Infra reconciliation                                 |
| Public app IDs, domain aliases and artifact routing                                                | Bun OS Infra product configuration and `docs/APP-DOMAINS.md`                                       | Existing Worker routes and standalone app owners                                      |
| M3 tokens, shared components and `libm3`                                                           | Material workspace and its pinned crates                                                           | Aphrody product surfaces and Bun OS desktop/app-ui consumers                          |
| Native quality commands and formatter policy                                                       | Bun OS `package.json` / `bun-format.json`; runtime quality stays in Bun                            | Bun OS owned source only; no duplicate formatter/config in Aphrody                    |
| Product routes and sites                                                                           | Bun/Bun Libraries product owners                                                                   | Bun OS app capability manifest                                                        |
| App activation, hosts, deployment, services, pipelines and cloud policy                            | Bun OS Infra                                                                                       | Product capabilities and applications                                                 |
| Models, agents, memory, A2A and MCP                                                                | Canonical AI implementations integrated into Bun OS                                                | Product capabilities and applications                                                 |

The video process module translates workspace errors into its public video
errors. It has no child management implementation. Captured and discarded
streams share an output cap; interactive children may inherit streams and
forward terminal signals through the shared process owner. The Ubuntu factory's
detached Docker engine is a separate finite service whose launcher receipt owns
its PID, log, socket and data root.
Source adapters use one native binary discovery API and retain their own protocol
and version checks. Compiled apps use verified manifests without Cargo or Git.

The source doctor checks tracked implementation, Cargo workspace members and
native target paths. Dirty checkout state is reported separately from pin and
coverage failures, so active owner work remains visible without being overwritten
or treated as a missing source. Release and artifact builders still require
exact target runtime pins. On 2026-10-13 the 16 library checkouts contain 423 Cargo
packages, 11,528 Rust files and 1,659 TypeScript files. No declared workspace
member or declared library/binary target is missing. Source coverage does not
prove operational support.

Generation still contains unsupported provider branches. Vendor GUI and parsing
code also contains panic placeholders. These source facts are not full app
qualification. Provider state stays in its protected owner stores.

Independent Cargo workspaces retain their histories and package identities.
Do not merge unrelated formats into one engine or copy codec implementations.
The Windows wrapper owns only its native admission mutex. Its worker delegates
argv, streams, deadlines and child teardown to the same workspace process core.
The Bun Cargo source owner retains its own checkout lock; the active host build
slot remains serialized by owner coordination.
Bun OS assembles distribution inputs, images and package conversions; it does
not own a second APT implementation. Package/source conversion and generated
installers must preserve the upstream package identity and license metadata.
Material owns the transferred M3 Rust components and tokens. Bun OS pins Bun
`f0f2891ea743ce4d32596b0b32670fbb81155842` from `origin/main` and Material
`e858361dfd2597b067eea56d471ff4caab7442f8` from `origin/os`; both source trees
pin M3 to `393d397037dace7a13eb2bee29e43a3a67d176f8`. The source lock includes
the M3 themes gitlink in both complete source graphs. Native M3 builds remain
routed through the Material checkout.

The `toolchains/bun` fork submodule (Bun revision `939c835adf6479bc1014da3843cda4ae29851dbd`, with an older nested M3 pointer) was removed with the abandoned fork; the runtime is now upstream Bun.

Bun OS Infra declares and actuates desired DNS, host, route and app lifecycle
state. Cloudflare's live records/R2 and application health require direct
qualification; a checked-in hostname or successful source build is not live
activation evidence. Bun OS owns app identity, host naming, shared asset
manifests and artifact verification consumed by the Infra adapter.

Source repositories preserve provenance: Bun supplies runtime and native SDK
source, Material supplies shared UI/framework source and APT supplies Debian's
package manager implementation. Bun OS integrates these with its product
capabilities, distribution assembly and package adapters. Consumers pin or import
the owner's interface; they do not copy its implementation. Keep each quality
gate scoped to its owner and record source, build, artifact and deployment
qualification independently.
