// SPDX-License-Identifier: Apache-2.0
// Descriptions for inventory members whose manifest, README and source header say nothing about them (inventory.ts
// reads this last). The coverage gate fails when a member still has no description, so a new member must either
// describe itself (manifest description, README, header comment) or be listed here.

/** Well-known file names, whatever directory they sit in. */
export const FILE_DESCRIPTIONS: Record<string, string> = {
  "LICENSE": "License text of this repository.",
  "LICENSE-APACHE": "Apache-2.0 license text of this repository.",
  "bun.lock": "Bun lockfile pinning every JavaScript and TypeScript dependency of the root workspace.",
  "bunfig.toml": "Bun configuration of the workspace: install, test and runtime settings.",
  "tsconfig.json": "TypeScript project configuration.",
  "tsconfig.base.json": "Shared TypeScript compiler options extended by every workspace project.",
  "turbo.json": "Task pipeline definition for the workspace build orchestration.",
  "clippy.toml": "Clippy lint configuration of the Rust workspace.",
  "rustfmt.toml": "rustfmt formatting rules of the Rust workspace.",
  "rust-toolchain.toml": "Pinned nightly Rust toolchain shared by every crate.",
  "distribution.json": "Bun OS distribution definition: runtime kernel, desktop, toolkit and the Server, COSMIC and Gaming profiles.",
  "sources.lock.json": "Pinned upstream source revisions and mount points of the external owners.",
  "tsconfig": "TypeScript project configuration.",
};

/**
 * Members listed by `kind/id`. Intentionally empty: a description must come from the member itself (manifest, README or a
 * header comment). Add the header to the member rather than text here.
 */
export const MEMBER_DESCRIPTIONS: Record<string, string> = {};
