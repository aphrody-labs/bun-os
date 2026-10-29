> **Legacy fork notice (2026-10-29).** This document describes a matrix whose `bun:windows` references target the abandoned fork's API. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# rea capability matrix

Every reverse-engineering need of Bun OS mapped to one `re` (rea) command, its MCP tool, its canonical owner and a real run on this workstation. Machine-readable copy: [`rea-matrix.json`](rea-matrix.json). Proof outputs live under `var/rea-matrix/proof/` (local, not versioned).

Status: `covered` (command, MCP tool and owner exist and ran), `partial` (runs with a documented gap), `not-run` (wired, no lawful target on this machine), `pending-build` (code complete, native rebuild and run pending on the VPS). The `before` column is the state before this pass.

## Command surface

| `re` command | Owner |
| --- | --- |
| `steam` | @aphrody/bun-steam CLI (in process) |
| `steam-rea` | packages/re/src/steamRea.ts |
| `pipeline` | packages/re/src/pipeline/cli.ts -> bunre pipeline |
| `recompile` | packages/re/src/pipeline/recompile.ts -> bunre recompile |
| `engine` | packages/re/src/engine/machine.ts -> bun-engine |
| `formats` | packages/re/src/engine/formats.ts -> @aphrody/bun-engine/formats (in process) |
| `bin` | packages/re/src/binary/inspect.ts -> bunre pipeline triage + bun:windows |
| `replica` | packages/re/src/replica/cli.ts |
| `ghidra-win` | packages/re/src/ghidra/windows.ts |
| `magika` | packages/re/src/ml/magika.ts -> bun:python |
| `dbxv2` | packages/re/src/bunre.ts -> bunre dbxv2 |
| `game` | packages/re/src/game/cli.ts (other owner) |
| `install` | packages/re/scripts/install.ts |

Every command accepts `--json`. The MCP server (`re mcp`) lists 228 tools; 21 are the Bun OS tools: `re_recompile`, `engine_run`, `engine_info`, `steam_scan`, `steam_stats`, `steam_sql`, `steam_api_sync`, `steam_classify`, `steam_rea`, `re_pipeline_run`, `re_pipeline_adapters`, `formats_inspect`, `formats_disasm`, `binary_inspect`, `ghidra_probe`, `magika_identify`, `replica_record`, `replica_replay`, `replica_nds`, `steam_appinfo`, `steam_manifest`.

## Needs

| Need | Command | MCP | Owner | Before | Status | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| Identify ROMs and parse their headers (NES, GBA, NDS/DSi, ...) | `re formats identify\|header\|sections\|files <file> [--json]` | `formats_inspect` | packages/bun-engine/src/formats (called in process) | partial | **covered** | ok `formats-nes` 0.1s<br>ok `formats-gba` 0.102s<br>ok `formats-nds` 0.172s<br>ok `formats-nds-files` 0.213s |
| Identify BIOS/firmware dumps and match free replacements | `re formats header <bios>` | `formats_inspect` | packages/bun-engine/src/formats + plugins/consoles/{firmware,free-firmware}.json | missing | **covered** | ok `formats-openbios` 0.108s<br>ok `formats-normmatt` 0.1s |
| Disassemble console code (6502, ARM/Thumb, R3000, PPC, AArch64, ...) | `re formats disasm <file> [--arch] [--at] [--count] [--json]` | `formats_disasm` | packages/bun-engine/src/formats/disasm | missing | **covered** | ok `formats-disasm-nes` 0.133s |
| Run a machine headless and capture screens and console output | `re engine run <system> <image> [--frames] [--bios] [--out] [--input] [--trace] [--json]` | `engine_run` | crates/bun-engine-core (bun-engine binary) | partial | **covered** | ok `engine-run-nes` 13.774s<br>ok `engine-run-gba` 10.308s<br>ok `engine-run-psx-openbios` 14.133s |
| Validate a DS/DSi cartridge header natively (CRCs, regions) | `re engine info <rom.nds> [--json]` | `engine_info` | crates/bun-engine-core (bun-engine info) | missing | **covered** | ok `engine-info-nds` 0.701s |
| Statically recompile a ROM to WebAssembly and run it | `re recompile <rom> --target wasm --out DIR [--json]` | `re_recompile` | crates/re pipeline::recomp + crates/bun-engine-core/src/recomp | partial | **pending-build** | FAIL `recompile-nes-wasm` 267.51s |
| Statically recompile a ROM to a native executable and run it | `re recompile <rom> --target exe --out DIR [--json]` | `re_recompile` | crates/re pipeline::recomp + crates/bun-engine-core/src/recomp | covered | **pending-build** | FAIL `recompile-nes-exe` |
| Record and replay a deterministic input session on a Bun Engine machine | `re replica record <system> <image> --input SCRIPT --frames N \| re replica replay <file>` | `replica_record` `replica_replay` | crates/bun-engine-core (bun-engine run --input --trace) + packages/re/src/replica/replay.ts | missing | **covered** | ok `replica-record-nes` 27.53s<br>ok `replica-replay-nes` 5.501s<br>ok `replica-replay-divergence` 6.116s<br>ok `replica-record-gba` 3.087s<br>ok `replica-replay-gba` 26.282s |
| Read-only DS intake and provenance for a Replica project | `re replica nds <rom> \| re replica init <rom> [out]` | `replica_nds` | packages/re/src/replica | partial | **covered** | ok `replica-nds` 0.078s<br>ok `replica-init-homebrew` |
| Ordered Replica skill pack and pipeline stages | `re replica skills \| skill <name> \| pipeline` | - | packages/re/plugin/skills/replica-* | covered | **covered** | ok `replica-pipeline` 0.102s |
| PE/ELF imports, version resource, signature and provenance of release emulators | `re bin <exe> [--strings N] [--imports N] [--json]` | `binary_inspect` | crates/re triage (bunre pipeline triage) + bun:windows PE + packages/bun-engine/src/usr.ts (bep db) | missing | **covered** | ok `bin-mgba` 0.329s |
| Header, imports and strings of a Steam executable on this PC (read-only) | `re bin <steam exe> --json` | `binary_inspect` | crates/re triage + bun:windows PE + @aphrody/bun-steam (installedGames) | missing | **covered** | ok `bin-steam-client` 0.172s |
| Local Steam index, Web API catalogue, libraries, VDF | `re steam <command> [--json]` | `steam_scan` `steam_stats` `steam_sql` `steam_api_sync` `steam_classify` | packages/bun-steam (consumed) | covered | **covered** | ok `steam-libraries` 0.145s<br>ok `steam-stats` 0.144s<br>ok `steam-appinfo-vdf` 0.123s |
| appinfo.vdf entries and depot manifests for agents | `re steam vdf <appinfo.vdf> --appinfo \| re steam depot ...` | `steam_appinfo` `steam_manifest` | packages/bun-steam (parseAppInfo, parseDepotManifest) | partial | **covered** | ok `steam-appinfo-vdf` 0.123s<br>ok `mcp:steam_appinfo` 0.02s<br>ok `mcp:steam_manifest` 0.004s |
| RE pipeline on an installed Steam app executable | `re steam-rea <appid>` | `steam_rea` | packages/re/src/steamRea.ts over bun-steam index + crates/re pipeline | covered | **not-run** | - |
| Static view of Proton/Wine binaries on the VPS, read-only | `re bin <path> --host vps --json` | `binary_inspect` | crates/re triage (local copy via ssh cat, deleted after) | missing | **covered** | ok `bin-proton-vps` 3.06s |
| Ghidra on Windows: install, JDK, PE metadata, source build | `re ghidra-win probe\|inspect <pe>\|build` | `ghidra_probe` | packages/re/src/ghidra/windows.ts (bun:windows) | partial | **covered** | ok `ghidra-probe` 0.158s<br>ok `ghidra-inspect` 0.181s |
| Ghidra headless import, analysis and decompilation of a small binary | `re pipeline <bin> --target os --out DIR --external` | `re_pipeline_run` | crates/re pipeline/ghidra.rs (GHIDRA_INSTALL_DIR) | covered | **covered** | ok `pipeline-ghidra-headless` 110.9s |
| Acquire to verify on OS binaries, BIOS and firmware; adapter status | `re pipeline <input> --target os\|bios\|firmware \| re pipeline adapters` | `re_pipeline_run` `re_pipeline_adapters` | crates/re pipeline | covered | **partial** | ok `pipeline-adapters` 0.194s<br>ok `pipeline-bios` 0.963s |
| Magika content typing of a file and of a mixed folder | `re magika identify <file\|dir> [--limit N] \| re magika setup` | `magika_identify` | vendor/magika via bun:python (packages/re/src/ml/magika.ts) | partial | **covered** | ok `magika-file` 0.461s<br>ok `magika-folder` 2.339s |
| Game-agnostic detect/mount/index/export/serve (generalized NIE pipeline) | `re game <appid\|path> <command>` | - | crates/re/src/game + packages/re/src/game (other agent, consumed only) | partial | **not-run** | - |
| Dragon Ball Xenoverse 2 inventory and archives | `re dbxv2 <command>` | - | crates/re bin/bunre/dbxv2.rs | covered | **not-run** | ok `dbxv2-usage` 0.102s |
| One MCP server exposing every Bun OS command | `re mcp` | - | packages/re/src/server/registerBunOsTools.ts | partial | **covered** | ok `mcp:list` 27.014s |
| Skills routing agents to the right rea command | `re install` | - | packages/re/plugin/skills | partial | **covered** | - |

## Notes per need

- **engine.rom-identify**: Before: only `re replica nds` (DS) and the coarse crates/re sniff (`raw`/`rom`).
- **engine.bios-identify**: Owner fixed: OpenBIOS was `unknown` (no Sony string); PlayStation reset-vector heuristic and free-firmware.json SHA-256 matching added.
- **engine.run**: Before: MCP only, no CLI verb. The CLI and the MCP tool now share runMachine().
- **engine.recompile-wasm**: The NES wasm build failed for real here (getrandom 0.4 from rand 0.10 in TetaNES has no wasm32-unknown-unknown backend). Fixed in code: `cargo-recompile` builds wasm with the getrandom `unsupported` backend and the NES machine powers on with zeroed RAM. The verify stage runs the wasm under Bun against the interpreter and `bun-engine run`. Rebuild and rerun on the VPS.
- **engine.recompile-exe**: Not run: interrupted by a full C: drive, then by the no-build-on-PC rule. The verify stage runs the executable translated and `--interp` and compares with `bun-engine run`.
- **replica.record-replay**: New: scripted input and per-frame FNV-1a screen digests in the native headless loop; replay pins image/BIOS SHA-256 and reports the first diverging frame.
- **replica.intake**: Before: no MCP tool, and `init` rejected homebrew (`####` game code, devkitPro default); now accepted.
- **replica.skills**: Served to agents as plugin skills, not MCP tools.
- **emulators.binaries**: Before: core rea `inspect-artifact` gave identity only; imports needed a deep provider.
- **steam.binary**: No game with an executable is installed on this PC (only app 228980, redistributables); the Steam client executable was used.
- **steam.appinfo-depots**: Before: CLI only; MCP tools added over the owner's parsers.
- **steam.rea**: No installed app with a scanned executable on this PC.
- **proton.vps**: One bounded `ssh vps head -c` read; nothing written on the VPS.
- **ghidra.windows**: Probe now reports the installed Ghidra and the stale JAVA_HOME with its remediation.
- **ghidra.headless**: Requires a valid JAVA_HOME (user value is stale; run with the JDK 25 path).
- **pipeline.cross-os**: Console BIOS images identify as `raw` in crates/re sniff (use `re formats`/`re recompile`); the binwalk adapter fails on Windows (binwalk v2 imports `pwd`).
- **magika**: Fixed: setup needs the MSVC env (maturin/Cargo), stale BUN_PYTHON_HOST_LIBRARY now falls back to the checkout build, one session per folder.
- **game.assets**: Being moved by the NIE agent; `bunre game` needs the `assets` feature; MCP tools left to that owner.
- **dbxv2**: No Xenoverse 2 install on this PC; wiring verified (usage, exit 2).
- **plugin.skills**: bun-engine, binary-triage, firmware-analyst, ghidra-headless, static-recompile and steam skills updated; `re install` not run (it rewrites ~/.claude skills and the user MCP registration).

## Proof runs

| Proof | Command | Exit | Seconds | Output |
| --- | --- | --- | --- | --- |
| `formats-nes` | `re formats header ./vendor/tetanes/tetanes/assets/roms/alter_ego.nes` | 0 | 0.1 | `var/rea-matrix/proof/formats-nes.out` |
| `formats-gba` | `re formats header ./vendor/rustboyadvance-ng/external/gba-tests/arm/arm.gba` | 0 | 0.102 | `var/rea-matrix/proof/formats-gba.out` |
| `formats-nds` | `re formats header ./usr/var/cache/bep/roms/godmode9i/GodMode9i.nds` | 0 | 0.172 | `var/rea-matrix/proof/formats-nds.out` |
| `formats-nds-files` | `re formats files ./usr/var/cache/bep/roms/godmode9i/GodMode9i.nds --json` | 0 | 0.213 | `var/rea-matrix/proof/formats-nds-files.out` |
| `formats-openbios` | `re formats header ./usr/share/bun-engine/firmware/sony-playstation/da0bf3d3e0bf75d4bea49c037f9d0639d75c3ff4a569659965e04b9809b707c5.bin` | 0 | 0.108 | `var/rea-matrix/proof/formats-openbios.out` |
| `formats-normmatt` | `re formats header ./vendor/rustboyadvance-ng/core/benches/roms/normatt_gba_bios.bin` | 0 | 0.1 | `var/rea-matrix/proof/formats-normmatt.out` |
| `formats-disasm-nes` | `re formats disasm ./vendor/tetanes/tetanes/assets/roms/alter_ego.nes --count 8 --json` | 0 | 0.133 | `var/rea-matrix/proof/formats-disasm-nes.out` |
| `engine-run-nes` | `re engine run nes ./vendor/tetanes/tetanes/assets/roms/alter_ego.nes --frames 120 --out ./var/rea-matrix/proof/engine-nes --json` | 0 | 13.774 | `var/rea-matrix/proof/engine-run-nes.out` |
| `engine-run-gba` | `re engine run gba ./vendor/rustboyadvance-ng/external/gba-tests/arm/arm.gba --frames 300 --out ./var/rea-matrix/proof/engine-gba --json` | 0 | 10.308 | `var/rea-matrix/proof/engine-run-gba.out` |
| `engine-run-psx-openbios` | `re engine run psx ./usr/share/bun-engine/firmware/sony-playstation/da0bf3d3e0bf75d4bea49c037f9d0639d75c3ff4a569659965e04b9809b707c5.bin --bios ./usr/share/bun-engine/firmware/sony-playstation/da0bf3d3e0bf75d4bea49c037f9d0639d75c3ff4a569659965e04b9809b707c5.bin --frames 120 --out ./var/rea-matrix/proof/engine-psx --json` | 0 | 14.133 | `var/rea-matrix/proof/engine-run-psx-openbios.out` |
| `engine-info-nds` | `re engine info ./usr/var/cache/bep/roms/godmode9i/GodMode9i.nds --json` | 0 | 0.701 | `var/rea-matrix/proof/engine-info-nds.out` |
| `replica-nds` | `re replica nds ./usr/var/cache/bep/roms/godmode9i/GodMode9i.nds --json` | 0 | 0.078 | `var/rea-matrix/proof/replica-nds.out` |
| `replica-pipeline` | `re replica pipeline --json` | 0 | 0.102 | `var/rea-matrix/proof/replica-pipeline.out` |
| `bin-mgba` | `re bin ./usr/lib/mgba/mGBA-0.10.5-win64/mGBA.exe --strings 16 --json` | 0 | 0.329 | `var/rea-matrix/proof/bin-mgba.out` |
| `bin-steam-client` | `re bin C:/Program Files (x86)/Steam/steam.exe --strings 16 --json` | 0 | 0.172 | `var/rea-matrix/proof/bin-steam-client.out` |
| `bin-proton-vps` | `re bin /home/ubuntu/.steam/steam/steamapps/common/Proton - Experimental/files/bin/wineserver --host vps --strings 16 --json` | 0 | 3.06 | `var/rea-matrix/proof/bin-proton-vps.out` |
| `magika-folder` | `re magika identify ./usr/lib/mgba/mGBA-0.10.5-win64 --limit 500 --json` | 0 | 2.339 | `var/rea-matrix/proof/magika-folder.out` |
| `magika-file` | `re magika identify ./vendor/tetanes/tetanes/assets/roms/alter_ego.nes --json` | 0 | 0.461 | `var/rea-matrix/proof/magika-file.out` |
| `ghidra-probe` | `re ghidra-win probe --json` | 0 | 0.158 | `var/rea-matrix/proof/ghidra-probe.out` |
| `ghidra-inspect` | `re ghidra-win inspect ./usr/lib/mgba/mGBA-0.10.5-win64/mGBA.exe --json` | 0 | 0.181 | `var/rea-matrix/proof/ghidra-inspect.out` |
| `pipeline-adapters` | `re pipeline adapters --json` | 0 | 0.194 | `var/rea-matrix/proof/pipeline-adapters.out` |
| `pipeline-bios` | `re pipeline ./vendor/rustboyadvance-ng/core/benches/roms/normatt_gba_bios.bin --target bios --out ./var/rea-matrix/proof/pipeline-normmatt --json` | 0 | 0.963 | `var/rea-matrix/proof/pipeline-bios.out` |
| `steam-libraries` | `re steam libraries games --json` | 0 | 0.145 | `var/rea-matrix/proof/steam-libraries.out` |
| `steam-stats` | `re steam stats --json` | 0 | 0.144 | `var/rea-matrix/proof/steam-stats.out` |
| `steam-appinfo-vdf` | `re steam vdf C:/Program Files (x86)/Steam/appcache/appinfo.vdf --appinfo --json` | 0 | 0.123 | `var/rea-matrix/proof/steam-appinfo-vdf.out` |
| `dbxv2-usage` | `re dbxv2` | 2 | 0.102 | `var/rea-matrix/proof/dbxv2-usage.out` |
| `replica-record-nes` | `re replica record nes ./vendor/tetanes/tetanes/assets/roms/alter_ego.nes --frames 300 --input start@120-125,right@180-240 --out ./var/rea-matrix/proof/replay-nes.json --json` | 0 | 27.53 | `var/rea-matrix/proof/replica-record-nes.out` |
| `replica-replay-nes` | `re replica replay ./var/rea-matrix/proof/replay-nes.json --json` | 0 | 5.501 | `var/rea-matrix/proof/replica-replay-nes.out` |
| `replica-record-gba` | `re replica record gba ./vendor/rustboyadvance-ng/external/gba-tests/arm/arm.gba --frames 240 --out ./var/rea-matrix/proof/replay-gba.json --json` | 0 | 3.087 | `var/rea-matrix/proof/replica-record-gba.out` |
| `replica-replay-gba` | `re replica replay ./var/rea-matrix/proof/replay-gba.json --json` | 0 | 26.282 | `var/rea-matrix/proof/replica-replay-gba.out` |
| `replica-replay-divergence` | `re replica replay replay-nes-altered.json (same recording, input without start@120-125; expected exit 1)` | 1 | 6.116 | `var/rea-matrix/proof/replica-replay-nes-altered.out` |
| `replica-init-homebrew` | `re replica init GodMode9i.nds var/rea-matrix/proof/replica-godmode9i` | 0 | - | `var/rea-matrix/proof/replica-init.out` |
| `pipeline-ghidra-headless` | `JAVA_HOME=<JDK 25> re pipeline target/slot-1/release/bun_python_host.dll --target os --out var/rea-matrix/proof/ghidra-pyhost --external --max-functions 64` | 0 | 110.9 | `(console report kept in the session log; output tree removed during disk cleanup)` |
| `recompile-nes-wasm` | `re recompile alter_ego.nes --target wasm --out var/rea-matrix/proof/recompile-nes-wasm --frames 300 --json` | 1 | 267.51 | `var/rea-matrix/proof/recompile-nes-wasm/report.json` |
| `recompile-nes-exe` | `re recompile alter_ego.nes --target exe --out var/rea-matrix/proof/recompile-nes-exe --frames 300 --json` | - | - | `-` |
| `mcp` | stdio client: list tools, call `formats_inspect`, `binary_inspect`, `steam_appinfo`, `steam_manifest`, `engine_info`, `ghidra_probe`, `formats_disasm` | 0 | 27.014 | `var/rea-matrix/proof/mcp.json` |

## Limits

- Offline analysis only, for interoperability, preservation, modding and our own software. No anti-cheat or DRM circumvention, no live memory tampering of online games, no non-public keys. `crates/aphrody-nie-trace/scripts/patch-eac.sh` is outside `re` and untouched.
- No Steam game with an executable is installed on this PC (only app 228980, redistributables): `re steam-rea` was not run and the Steam binary proof uses the Steam client executable.
- `re game` belongs to the NIE generalization in progress (`crates/re/src/game`, `packages/re/src/game`); it was consumed, not modified, and needs a `bunre` built with the `assets` feature. Its MCP tools are left to that owner.
- `re dbxv2` needs a Dragon Ball Xenoverse 2 install; only its wiring was checked.
- `re install` was not run: it rewrites `~/.claude/skills` and the user-scope MCP registration.
- The user `JAVA_HOME` (`C:\android\tools\jdk`) does not exist; Ghidra headless runs used the installed JDK 25 for the process only. `re ghidra-win probe` reports the remediation.
- `BUN_PYTHON_HOST_LIBRARY` points to a missing file; `re magika` falls back to the checkout's `bun-python-host` build.
- crates/re `sniff-identify` reports console BIOS images as `raw`; the pipeline's `binwalk-extract` adapter fails on Windows (binwalk v2 imports `pwd`).
- Replays compare FNV-1a 64 digests of the screens (not cryptographic) and the console output; audio is not part of the digest. The engine and replay proofs ran on the `bun-engine` build that preceded the zeroed NES power-on RAM change.

## Pending native build (VPS)

Native builds are not run on the workstation. Pending commands:

```sh
bun scripts/cargo.ts exec -- build -p bun-re --bin bunre
bun scripts/cargo.ts exec -- build -p bun-engine --bin bun-engine
re recompile vendor/tetanes/tetanes/assets/roms/alter_ego.nes --target wasm --out var/rea-matrix/proof/recompile-nes-wasm --frames 300 --json
re recompile vendor/tetanes/tetanes/assets/roms/alter_ego.nes --target exe --out var/rea-matrix/proof/recompile-nes-exe --frames 300 --json
var/rea-matrix/proof/recompile-nes-exe/bin/recomp-nes-alter-ego --frames 300 --json
re replica record nes vendor/tetanes/tetanes/assets/roms/alter_ego.nes --frames 300 --input start@120-125,right@180-240 --out replay-nes.json && re replica replay replay-nes.json
```
