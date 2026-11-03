# Ghidra and AI plugin suite

The agent-facing owner is the private
[`aphrody-code/ghidra-suite-plugin`](https://github.com/aphrody-code/ghidra-suite-plugin)
repository. It is the Codex-native AI plugin for Ghidra 12.x, not a fork of the
Ghidra runtime. It provides three execution surfaces:

- visible Windows GUI control through `ghidra-gui-computer-use`;
- structured access to an open CodeBrowser through `ghidra-mcp-live` and
  GhidrAssistMCP on `localhost:8080`;
- reproducible batch analysis through `ghidra-headless`.

Its skills route binary triage, decompilation cleanup, firmware, Nintendo DS/3DS,
malware, vulnerability and CTF analysis. Provider authentication, MCP state and
raw agent sessions remain in their protected stores. The private plugin is not
vendored into this public repository and must not be exposed through a public
submodule URL.

## Analysis engines

Bun Engine and REA use the following reverse-engineering sources. A pinned source
does not establish that its binary or extension is installed or qualified:

| Owner                                                                                 | Pinned revision                            | Role                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| [`aphrody-labs/ghidra`](https://github.com/aphrody-labs/ghidra)                       | `918acd744d17e3b95fbde44ec6ab3e59b6dbd45f` | Full interactive and headless Ghidra analysis platform.   |
| `ghidra-decompiler` Cargo dependency                                                   | `2.1.0`                                    | Rust decompiler dependency; see the workspace lockfile.  |
| [`aphrody-labs/NTRGhidra`](https://github.com/aphrody-labs/NTRGhidra)                 | `9e0674c0b36ef9b816dbe7833a68b17327edc1b9` | Nintendo DS/DSi loader and overlay plugin.                |

The AI plugin orchestrates these engines; it does not duplicate them. The submodules
are shallow transport boundaries. REA's Ghidra integration lives in
`vendor/rea/src/ghidra`; the RE pipeline facade lives in `packages/re/src/pipeline`.
These sources provide distinct capabilities, not a guarantee that every host has
every engine or that a game can be ported automatically.

1. inspect PE32/PE32+ metadata with `bun:windows.pe` (fork-only API, not available on upstream Bun);
2. decompile PE, ELF or Mach-O through the Rust owner;
3. route full multi-architecture analysis to Ghidra;
4. activate NTRGhidra for Nintendo DS/DSi images.

## Windows 11 integration

`vendor/rea/src/ghidra/windows.ts` contains Windows integration. The fork-only
`bun:windows` API is not available in upstream Bun. The historical integration discovers the
Windows version, MSVC and Windows SDK without `vswhere`, parses PE metadata without
loading the image, and contains Gradle/Java descendants in a Windows Job Object.
Closing the owner terminates its entire process tree.

```powershell
re ghidra-win probe
re ghidra-win inspect C:\path\program.exe
re pipeline adapters
re ghidra-win build
```

Historical workstation checks are not proof of current host readiness. The REA
bridge currently marks Ghidra 12.1.4 as verified and accepts other 12.1.x builds
as compatible but unverified; it rejects 12.2 and 12.3 until qualified and updated.
The pinned Ghidra source tree declares JDK 25 as its minimum. Check the installation,
JDK, native decompiler, extension compatibility and actual analysis on each host.

## Source policy

Upstream history remains authoritative in the NSA, koute and pedro-javierf projects.
The Aphrody forks carry Bun Engine integration work, retain their Apache-2.0 notices,
and are pinned by the root repository. Update a fork first, qualify it independently,
then advance its gitlink and this revision table in one commit.

The private AI plugin remains independently versioned under `aphrody-code`. Changes
to its MCP, Codex manifests, skills or protected configuration are delivered in that
repository; Bun Engine documents only the stable orchestration boundary.
