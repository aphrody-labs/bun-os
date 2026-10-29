<!-- SPDX-License-Identifier: Apache-2.0 -->

# Claude Code provider: plugins, skills, MCP

Research input for the centralized plugin/skill/MCP manager. Captured 2026-10-03.

- Installed: `claude` **2.1.288 (Claude Code)** at `~/.nvm/versions/node/v24.20.0/bin/claude`
  (the generated `TOOLS.md` still lists 2.1.286).
- Verified by `claude <cmd> --help` and read-only `claude plugin validate`/`list`/`marketplace list`/`mcp list`.
  Nothing was installed, removed or reconfigured.

## Primary sources

- Plugin manifest: <https://code.claude.com/docs/en/plugins-reference>
- Marketplace creation: <https://code.claude.com/docs/en/plugin-marketplaces>
- Marketplace reference: <https://code.claude.com/docs/en/plugins/marketplace-reference>
- Install and scopes: <https://code.claude.com/docs/en/plugins/install>
- MCP: <https://code.claude.com/docs/en/mcp>
- Skills: <https://code.claude.com/docs/en/skills>
- Docs index: <https://code.claude.com/docs/llms.txt>

The `aphrody docs search` query returned only the `anthropics/claude-plugins-official` README (marketplace id
`claude-plugins-official`, `/plugin install <name>@claude-plugins-official`).

## Native CLI surface (2.1.288)

| Purpose                                                                        | Command                                                                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validate plugin dir, marketplace root/file, or a dir of skills/agents/commands | `claude plugin validate <path> [--json] [--strict]`                                                                                                  |
| Add marketplace                                                                | `claude plugin marketplace add <source> [--scope user\|project\|local] [--sparse <paths...>] [--claudeai] [--json]`                                  |
| List/update/remove marketplace                                                 | `claude plugin marketplace list [--json]`, `update [name]`, `remove\|rm <name>`                                                                      |
| Install                                                                        | `claude plugin install <plugin>[@marketplace] [-s user\|project\|local] [--config k=v] [-y] [--accept-command <sha256>] [--registry <url>] [--json]` |
| Lifecycle                                                                      | `list`, `details <name>`, `enable`, `disable`, `update`, `uninstall\|remove`, `prune`, `configure <plugin>`                                          |
| Authoring                                                                      | `init\|new <name>` (scaffolds `~/.claude/skills/<name>/`, loads as `<name>@skills-dir`), `tag [path]`, `test [dir]`, `eval [target]`                 |
| MCP                                                                            | `claude mcp add\|add-json\|get\|list\|remove\|login\|logout\|reset-project-choices\|serve\|add-from-claude-desktop`                                  |

Exit codes: `validate` exits 1 on errors, and on warnings with `--strict`. `--json` keeps the exit codes.
Plugin install scope default is `user`. `mcp add` scope default is `local`. `marketplace add` default is `user`.

After central preparation, all eight plugin manifests and their skills/agents/commands
pass `claude plugin validate --strict --json`. The central marketplace also passes.
Nested obsolete marketplaces were removed, YAML descriptions repaired and BXC
hook paths quoted. Validate component directories separately: manifest-only
validation does not establish that all skills and agents load.

## Manifest: `.claude-plugin/plugin.json`

Optional; only `name` is required (kebab-case, no `@`, `:`, spaces or separators). Anything other than `plugin.json`
goes at the plugin root, not in `.claude-plugin/`. Unknown top-level keys are stripped (warning). Unknown keys inside
`userConfig`, `channels`, `lspServers` or `monitors` entries are errors.

Fields: `$schema`, `name`, `displayName`, `version` (pins the version when set), `description`, `author{name,email?,url?}`,
`homepage` (must parse as URL), `repository`, `license`, `keywords`, `metadata`, `icon`, `documentationUrl`,
`supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`, `defaultEnabled` (default `true`), `dependencies`,
`settings` (only `agent`, `subagentStatusLine`), `userConfig`, `channels`, `skills`, `commands`, `agents`, `hooks`,
`mcpServers`, `lspServers`, `outputStyles`, `workflows`, `experimental{themes,monitors,evals}`.

Reserved plugin names (error in validate): prefixes `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-`, and the names
`claude`, `anthropic`, `anthropics`, `claude-code`, `claude-mods`.

Component path rules:

- Paths start with `./`, must resolve inside the plugin root and must exist (`skills` also accepts `"."`).
- Defaults: `skills/<name>/SKILL.md`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`,
  `output-styles/`, `workflows/`, `themes/`, `monitors/monitors.json`, `bin/`, `settings.json`.
- `skills` adds to the default scan. `commands`, `agents`, `outputStyles`, `workflows` replace it.
  `hooks`, `mcpServers`, `lspServers` merge with their default file (a later server name replaces an earlier one).
- `agents` entries are `.md` files, not directories.
- Hook files wrap the event map in a top-level `"hooks"` key. Inline hooks do not.
- `userConfig` option: `type` (`string|number|boolean|directory|file`), `title`, `description` required;
  `required`, `default`, `options`, `multiple`, `sensitive`, `min`, `max` optional. Sensitive values go to the OS
  credential store, others to `pluginConfigs` in settings.
- Variables: `${CLAUDE_PLUGIN_ROOT}` (changes on update, do not store state), `${CLAUDE_PLUGIN_DATA}`
  (`~/.claude/plugins/data/<id>/`, persistent), `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}`,
  `CLAUDE_PLUGIN_OPTION_<KEY>` in hook environments. `${user_config.*}` is rejected in shell-form hooks, monitors and
  `headersHelper`.
- `CLAUDE.md` at the plugin root is not loaded (validate warns).

Local example: `~/plugins/aphrody/.claude-plugin/plugin.json` declares `"mcpServers": "./.mcp.json"` and
`"skills": "./skills/"`. Its `.mcp.json` defines stdio server `aphrody` running `aphrody-mcp`.

## Manifest: `.claude-plugin/marketplace.json`

Required: `name` (letters, digits, `<repo>`, `_`, `-`), `owner{name}`, `plugins[]`. Optional: `$schema`, `description`,
`version`, `metadata{description,version,pluginRoot}`, `forceRemoveDeletedPlugins`,
`allowCrossMarketplaceDependenciesOn`, `renames`.

Plugin entry: required `name`, `source`. Optional: `description`, `version`, `category`, `tags`, `strict`
(default `true`), `defaultEnabled`, `displayName`, `dependencies`, `relevance`, `metadata`, `headers`, `headersHelper`,
plus any `plugin.json` field except directory-listing fields.

Plugin `source` types: relative path (`./...`, no `..`, no backslash), `github{repo,ref,sha}`, `url{url,ref,sha}`,
`git-subdir{url,path,ref,sha}`, `npm{package,version,registry}`, `archive{url,sha256}`, `command{command,timeout,mode}`.

Rules that matter for a manager:

- Entry `name` must equal the manifest `name`; otherwise `install <manifest-name>` fails.
- `strict:false` plus entry component fields on a plugin that has `plugin.json` fails with "conflicting manifests".
- Entry `hooks` must be an inline object; a path passes validate but never runs.
- Marketplace names are reserved for official Anthropic names and `inline`, `builtin`, `skills-dir`, `synced`, `npm`,
  `pip`, `uv`, `cargo`, `github`, `gh`, `claudeai-*`.
- Marketplace source forms for `marketplace add`: `owner/repo[#ref]`, git URL (`.git`, `/_git/`, `#ref`), local dir or
  `.json` file (start relative paths with `./`), hosted `https://…/marketplace.json` (relative plugin paths cannot
  resolve for a `url` marketplace).
- `claude plugin validate` does not catch a missing relative source dir or any remote fetch error. Those fail at
  install. Test with a real `marketplace add` plus `install`.
- Local example: `~/plugins/aphrody/.claude-plugin/marketplace.json`, marketplace `aphrody-local`, plugin
  `aphrody`, `source: ".//"`. Local directory marketplaces are read in place, so edits apply on the next session or
  `/reload-plugins` with no version bump.

## Local installation and discovery

Registered now: marketplaces `anthropic-plugin-directory` (built in), `claude-plugins-official`
(GitHub `anthropics/claude-plugins-official`). Plugins installed: only `modern-web-guidance@synced` (loaded) and
`cowork-plugin-management@synced` (disabled), both synced from claude.ai. No Aphrody plugin is installed in Claude Code.

Local install flow (not executed):

1. `claude plugin validate ~/plugins/<plugin> --strict`
2. `claude plugin marketplace add ~/plugins/<plugin> --scope user` (reads `.claude-plugin/marketplace.json`)
3. `claude plugin install <plugin>@<marketplace> --scope <scope>`
4. `claude plugin list --json`, `claude plugin details <plugin>`, then `/reload-plugins` in a live session.

Other discovery paths without a marketplace:

- `claude --plugin-dir <dir>` loads a plugin for one session (marketplace name `inline`).
- `~/.claude/skills/<name>/` plugins auto-load as `<name>@skills-dir` (`claude plugin init`).
- `claude.ai` account plugins appear as `<name>@synced`.

## Scope preservation

Plugin install scopes (`enabledPlugins`):

| Scope   | File                                 | Meaning                                                                 |
| ------- | ------------------------------------ | ----------------------------------------------------------------------- |
| user    | `~/.claude/settings.json`            | every project for this user (install default)                           |
| project | `<repo>/.claude/settings.json`       | committed. Collaborators must still run `install --scope project` once. |
| local   | `<repo>/.claude/settings.local.json` | this repo, this user only                                               |
| managed | managed settings                     | read-only for the user                                                  |

- Precedence for one plugin set at several scopes: local over project over user.
- `enable`/`disable` act on the most specific scope that already lists the plugin. `install`/`uninstall` default to user.
- Marketplace declarations follow `--scope` the same way (`extraKnownMarketplaces` in the matching settings file).
- Removing a marketplace uninstalls its plugins and removes their `enabledPlugins` entries. Do not call it from a sync.
- `iecode` is scoped to `../iecode` and `aphrody` to the monorepo and `aphrody-py` (repo `AGENTS.md`):
  install `iecode` with `--scope local` (or project) from that repo, never user. `yolo` may be user scope.
- Skills: personal `~/.claude/skills/<n>/SKILL.md`, project `.claude/skills/<n>/SKILL.md`, nested
  `<sub>/.claude/skills/…`, plugin `<plugin>/skills/<n>/SKILL.md` (namespaced `plugin:skill`, no conflict with
  bare names), enterprise via managed settings. Precedence: enterprise, personal, project. Symlinked skill dirs load
  once. Frontmatter: `name`, `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `context`,
  `agent`, `paths`, `arguments`. `synced` and `anthropic-skills` are reserved names.
  A manager that moves skills must keep the load path (symlink or marketplace entry) valid.

## MCP registration

| Scope           | Storage                                                                          | Shared          |
| --------------- | -------------------------------------------------------------------------------- | --------------- |
| local (default) | `~/.claude.json` under `projects.<abs path>.mcpServers`                          | no              |
| project         | `<repo>/.mcp.json` (needs per-user approval, `claude mcp reset-project-choices`) | yes             |
| user            | `~/.claude.json` top-level `mcpServers`                                          | no              |
| plugin          | plugin `.mcp.json` or `mcpServers` in `plugin.json`                              | with the plugin |

- Precedence for the same server name: local, project, user, plugin, claude.ai connectors. Whole entries win, with
  no field merge. Plugins and connectors are deduplicated by endpoint (URL or command). Managed `managedMcpServers`
  sit above all.
- Commands: `claude mcp add [-s scope] [-t stdio|sse|http] [-e K=V] [-H "K: V"] <name> <url-or-cmd> [-- args]`,
  `claude mcp add-json <name> '<json>'`, `get`, `list`, `remove [-s scope]`, `login`/`logout` for OAuth
  (`--client-id`, `--client-secret`, `--callback-port`).
- `.mcp.json` entry: `{"mcpServers":{"<name>":{"type":"stdio|http|sse|ws","command","args","env","url","headers"}}}`.
  Expansion `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`. Credential-like variables
  (`ANTHROPIC_API_KEY`, `NPM_TOKEN`, …) read as empty in remote `url`/`headers`; rename the variable to pass them.
- Plugin servers: tool name `mcp__plugin_<plugin>_<server>__<tool>`, scoped server name `plugin:<plugin>:<server>`.
  Plugin MCP changes need `/reload-plugins`.
- Current state: `claude mcp list` shows only the connector `claude.ai Claude Docs` (connected). No `aphrody` server is
  registered; `aphrody-mcp` is only declared inside the `aphrody` plugin.
- Manager rule: register Aphrody servers through the `aphrody` plugin `.mcp.json` rather than a `claude mcp add`
  duplicate (the same command would be deduplicated, but two names would double the tool inventory).

## Manager integration notes

1. Treat `claude plugin validate --json --strict` as the Claude provider's native validation gate.
2. Read state with `claude plugin list --json`, `claude plugin marketplace list --json`, `claude mcp list`; do not parse
   `~/.claude.json` or settings files directly except to confirm scope.
3. Write state only through `claude plugin …` and `claude mcp …`, always with an explicit `--scope`.
4. After moving plugin sources (as in the 2026-10-03 relocation), re-run `marketplace update` or re-add the marketplace,
   because installed copies are cached and local-directory marketplaces are read in place.
5. Remote marketplaces and command-source installation remain unverified. Local
   marketplace installation/removal was qualified in temporary homes.
6. Central preparation repaired the YOLO YAML and quoted BXC hook paths. Native
   install/removal of fixture plugins, skills and MCP is qualified in temporary
   homes, both user and project scopes; real owner plugins remain uninstalled.
