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

Bun Engine ships one reverse-engineering pipeline backed by three pinned Aphrody forks:

| Owner                                                                                 | Pinned revision                            | Role                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| [`aphrody-labs/ghidra`](https://github.com/aphrody-labs/ghidra)                       | `918acd744d17e3b95fbde44ec6ab3e59b6dbd45f` | Full interactive and headless Ghidra analysis platform.   |
| [`aphrody-labs/ghidra-decompiler`](https://github.com/aphrody-labs/ghidra-decompiler) | `268c3a406d8d964bc00ae2ead4d3e1e1373aaa27` | Native Rust decompiler integrated into `bun-engine-core`. |
| [`aphrody-labs/NTRGhidra`](https://github.com/aphrody-labs/NTRGhidra)                 | `9e0674c0b36ef9b816dbe7833a68b17327edc1b9` | Nintendo DS/DSi loader and overlay plugin.                |

The AI plugin orchestrates these engines; it does not duplicate them. The submodules
are shallow transport boundaries. Product ownership stays in the root Cargo/Bun
workspaces and `src/pipeline/reverse.ts` defines the canonical engine sequence:

1. inspect PE32/PE32+ metadata with `bun:windows.pe` (fork-only API, not available on upstream Bun);
2. decompile PE, ELF or Mach-O through the Rust owner;
3. route full multi-architecture analysis to Ghidra;
4. activate NTRGhidra for Nintendo DS/DSi images.

## Windows 11 integration

`packages/re/src/ghidra/windows.ts` uses the abandoned fork's `bun:windows` API directly (not available on upstream Bun). It discovers the
Windows version, MSVC and Windows SDK without `vswhere`, parses PE metadata without
loading the image, and contains Gradle/Java descendants in a Windows Job Object.
Closing the owner terminates its entire process tree.

```powershell
re ghidra-win probe
re ghidra-win inspect C:\path\program.exe
re pipeline adapters
re ghidra-win build
```

The current workstation qualification covers Windows 11 x64, MSVC 14.44, Windows
SDK 10.0.26100.0, source discovery, NTRGhidra discovery, native PE inspection and
the Rust workspace. A complete Ghidra Java build additionally requires JDK 25 on
`PATH`; the command fails explicitly when it is absent.

## Source policy

Upstream history remains authoritative in the NSA, koute and pedro-javierf projects.
The Aphrody forks carry Bun Engine integration work, retain their Apache-2.0 notices,
and are pinned by the root repository. Update a fork first, qualify it independently,
then advance its gitlink and this revision table in one commit.

The private AI plugin remains independently versioned under `aphrody-code`. Changes
to its MCP, Codex manifests, skills or protected configuration are delivered in that
repository; Bun Engine documents only the stable orchestration boundary.
