# Factory repository guide

This directory contains factory configuration, source catalogs and build
scripts. The root command entry point is `src/cli.ts`; factory composition and
target selectors are declared in `distribution.json`. A declared selector or
recipe is not evidence of a built package, root filesystem, image or release.

## Relevant paths

- `arch/`: Arch-related factory configuration and catalogs.
- `profile.json`: shared factory profile input referenced by
  `distribution.json`.
- `ubuntu.ts` and `ubuntu-profile.json`: separate Ubuntu compatibility path.
- `images/`: image definitions and supporting files.
- `arch/qualification/`: stored qualification records. Check each record's
  source revision, timestamp, target and gates before treating it as current.

## Read-only planning

```sh
bun src/cli.ts factory arch --action plan --composition server --snapshot YYYY-MM-DD
bun src/cli.ts workspace graph --profile full --target linux-x64
```

Planning reports inputs for the selected composition and snapshot. It does not
build or qualify an artifact.

## Execution ownership

Repository instructions require builds and qualification to run on the
configured VPS. Inspect the current host, active jobs, storage and coordination
before starting work. The Windows workstation is for source edits and
synchronization; do not start WSL here. Use the existing factory and serialized
Cargo owners rather than adding another build queue or Cargo wrapper.

## Qualification

Keep source validation, package resolution, compilation, tests, rootfs/image
assembly, boot/hardware checks and release qualification separate. A saved
receipt is evidence only for the exact revisions, target and gates it records.
The root `distribution.json` currently labels qualification as `development`.

See [the root README](../README.md), [repository architecture](../docs/architecture.md)
and [qualification guide](../docs/qualification.md).
