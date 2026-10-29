# @aphrody/yolo-cli

The `yolo` command line, run from source (`bun packages/engine/yolo/src/index.ts`) or as the compiled standalone
binary. Commands load on demand; `yolo help` lists them and `docs/cli/HELP.md` holds every `-h` output
(`bun run cli:help` at the repository root regenerates it).

| Area         | Commands                                                                         |
| ------------ | -------------------------------------------------------------------------------- |
| Workspace    | `status`, `scan`, `parse`, `docs`, `generate`, `import`, `rename`, `verify`      |
| Servers      | `mcp` (stdio MCP server), `api` (REST/OpenAPI on `Bun.serve`)                    |
| Frontend     | `web build                                                                       | dev`, `create <dir> --with web,desktop` (templates/)                             |
| Runtime      | `version`, `doctor`, `runtime install                                            | list                                                                             | verify                                       | rollback                         | info`, `upgrade`, `uninstall` |
| Operations   | `host ... --host vps                                                             | dbfr                                                                             | local`(plan unless`--apply`), `ship`, `infra | workflow                         | git                           | ssh` (aphrody-infra) |
| Bun packages | `ops`, `workspace`, `optimize` (@aphrody/bun-workspace), `update`, `google drive | fonts`, `doc-ai`, `forge`(Bun fork builds): in-process,`src/package-commands.ts` |
| M3           | `m3 [dev                                                                         | build                                                                            | compile                                      | desktop                          | tokens                        | check                | new]`(framework CLI) and`m3 <tool>`: `next`, `bun`, `os-themes`, `next-migrate`, `svg-to-ico`, `web-to-tauri`, `scaffold`. A first argument naming a tool selects it; tool names never shadow a framework command (tested). The published packages keep their npm `bin` for external consumers |
| Ecosystem    | `plugin create                                                                   | status                                                                           | check                                        | purge`, `awesome`, `py`, `bench` |

Every command takes `--json` (strict schema) or `--md` where it reports. Sources: `src/index.ts`
(dispatch and help) and one module per command; shared logic lives in `@aphrody/yolo-core`.

Scripts: `bun test` (the CLI suites under `test/`), `bun check -p tsconfig.json --noEmit`.
