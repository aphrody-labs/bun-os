# Start here

Read AGENTS.md, GOAL.md, PLAN.md and MEMORY.md.

This checkout owns distribution assembly. Runtime implementation changes
belong to upstream oven-sh/bun (pinned in `package.json`, `sources.lock.json`); the Material
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
- Package/source conversion: src/apt.ts and packages/package-converter/.
- Standalone compiler and assets: [app builds](docs/APP-BUILDS.md).
- Public routing: [app domains](docs/APP-DOMAINS.md).
- Control plane and workflows: [deployment control](docs/DEPLOYMENT-CONTROL.md).

Start with the native help and read-only plan:

```sh
bun src/cli.ts --help
bun src/cli.ts factory --action plan --composition server --snapshot <YYYY-MM-DD>
bun src/cli.ts graph --composition server
bun src/cli.ts plan --profile full --target linux-x64
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
Invoke `bun check`, `bun lint`, `bun fmt` and `bun n2b` directly as documented
in README.md. Native binaries require separate host qualification.
