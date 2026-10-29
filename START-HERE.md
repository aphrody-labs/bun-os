# Start here

Read AGENTS.md, GOAL.md, PLAN.md and MEMORY.md.

This checkout owns distribution assembly. The runtime is the unmodified upstream Bun canary
(npm `bun@1.4.4-canary.20261028.1`, gitHead `11c367163a4b`, pinned in `package.json` and
`sources.lock.json`; `bun --revision` prints `1.4.4-canary.1+11c367163`); runtime
changes belong to upstream oven-sh/bun. Bun OS is an Arch-inspired Linux
distribution whose final goal is Bun integrated into the Linux kernel the way
Rust was ([roadmap](docs/KERNEL-ROADMAP.md)). The Material
framework and other imported projects retain their own source and license
boundaries. README.md documents repository entry points. PLAN.md distinguishes
declared/prepared inputs from build and qualification evidence.

## Entry points

- Source topology: sources.lock.json and [source export](docs/SOURCE-EXPORT.md).
- Profiles and target ABIs: distribution.json.
- Distribution factory: src/cli.ts and src/distribution.ts.
- Primary Arch/pacman factory: factory/arch/, factory/profile.json and
  [distribution architecture](docs/architecture/arch-distribution.md).
- Ubuntu compatibility factory: factory/ubuntu.ts and factory/ubuntu-profile.json.
- Kernel/WSL/APT recipes: [native targets](docs/NATIVE-TARGETS.md).
- Bun-in-kernel roadmap: [docs/KERNEL-ROADMAP.md](docs/KERNEL-ROADMAP.md).
- Package/source conversion: src/apt.ts and packages/package-converter/.
- Standalone compiler and assets: [app builds](docs/APP-BUILDS.md).
- Public routing: [app domains](docs/APP-DOMAINS.md).
- Control plane and workflows: [deployment control](docs/DEPLOYMENT-CONTROL.md).

Start with the native help and read-only plan:

```sh
bun src/cli.ts --help
bun src/cli.ts factory arch --action plan --composition server --snapshot <YYYY-MM-DD>
bun src/cli.ts workspace graph --profile full --target linux-x64
bun src/cli.ts build plan --profile full --target linux-x64
bun infra/app-build.ts plan apt --config infra/apps.json --target windows-x64
```

Use explicit existing checkout paths in a local configuration. Paths resolve
from that configuration; the runtime owner can also be discovered from the
selected executable. Choose fresh artifact outputs and the existing host lock.
Do not treat a snapshot's reported release URL as archive authentication or
as a build from the distribution's locked runtime revision.

Inspect permissions, running jobs, storage and current coordination
before starting a factory operation. Never start workstation WSL, confuse
the VPS with the local MCP context, or delete protected .local/provider stores.

---

Install the repository's declared Bun runtime, then run `bun run setup`.
Invoke the upstream `bun check`, `bun lint` and `bun fmt` as documented in
README.md. Fork-only commands (`bun mcp`, `bun n2b`, `bun agent-plugin`,
`bun wasm`) do not exist on upstream Bun. Native binaries require separate host qualification.
