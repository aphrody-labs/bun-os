# Product crate ownership

Product crates live directly in `crates/<package-name>` as pinned Git
submodules. Each manifest inherits the parent workspace via `workspace =
"../.."`; no child workspace or toolchain is created. Crate repositories
are source components of Bun OS and require the parent checkout to compile.

The root owns Cargo and Bun lockfiles, shared dependency versions, the nightly
toolchain, `build/rust`, `target`, `node_modules`, and `install`. Use `just setup`,
`just check`, and `just test`. Setup initializes direct submodules without
recursively fetching unrelated upstream asset repositories.

The root currently contains 37 flat crate owners, including thirteen CADCraft
crates `cadcraft-cli`, `cadcraft-color`, `cadcraft-geom`, `cadcraft-doc`,
`cadcraft-constraints`, `cadcraft-dxf`, `cadcraft-dwg`, `cadcraft-fonts`,
`cadcraft-render`, `cadcraft-io`, `cadcraft-engine`, `cadcraft-mcp` and
`cadcraft-ui-egui`.
Every crate tracks its forge `os` branch. The CADCraft consumer workspace
resolves its migrated edges to these root owners in version 1.4.4; 3 other
members remain to migrate. Source histories, licenses and notices remain with
each component. Licensed font assets remain in `fonts/`.

Source is plain git over GitHub. Private credentials
remain in protected workstation or host secret stores, outside Git.
