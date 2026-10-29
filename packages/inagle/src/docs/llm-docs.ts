/**
 * @file llm-docs.ts
 * @description Generators for Answer.AI llms.txt and llms-full.txt standards.
 * Provides high-density, factual, token-efficient technical documentation
 * for autonomous LLMs and coding agents working on Inazuma Eleven: Victory Road.
 */

import type { LlmIndexDocument } from "./types.js";
import { VFS_DIRECTORIES, VFS_FORMATS, VFS_PACK_RULES } from "./vfs-catalog.js";
import { NIE_CRITICAL_OFFSETS, NIE_CRYPTO_CONSTANTS, NIE_RTTI_CLASSES } from "./nie-re-map.js";

/**
 * Builds the structured LlmIndexDocument model.
 */
export function getLlmIndexDocument(): LlmIndexDocument {
  return {
    projectName: "@aphrody/inagle",
    version: "2.0.4",
    description:
      "Universal Game Data API, CRI VFS stream engine, and nie.exe reverse-engineering specification for Inazuma Eleven: Victory Road.",
    updatedAt: "2026-10-01",
    quickstartPrompt:
      "You are working on Inazuma Eleven: Victory Road reverse engineering and data extraction. Use @aphrody/inagle/docs for authoritative format signatures, CPK decryption rules, nie.exe memory offsets, and cross-language FFI bindings across Bun, Rust, and .NET.",
    sections: {
      Architecture: [
        {
          title: "Cross-Language Architecture",
          url: "docs/CROSS-LANGUAGE-ARCHITECTURE.md",
          summary:
            "Tri-language runtime linking Bun TypeScript, Rust libiecode.so C-ABI, and .NET 10 IECODE.Ffi NativeAOT.",
          tokensEstimate: 1200,
          keyConcepts: ["bun:ffi", "NativeAOT", "C-ABI", "libiecode.so", "IECODE.Ffi.so"],
        },
      ],
      Vfs: [
        {
          title: "Victory Road VFS Specification",
          url: "docs/VFS-SPECIFICATION.md",
          summary:
            "Complete specification of CriFs CPK containers, @UTF metadata, CRILAYLA decompression, and directory maps.",
          tokensEstimate: 2400,
          keyConcepts: ["CPK", "@UTF", "CRILAYLA", "Viola 0x1717E18E", "CRC32 ISO-3309", "data/packs/"],
        },
      ],
      ReverseEngineering: [
        {
          title: "nie.exe Reverse Engineering Reference",
          url: "docs/NIE-EXE-REVERSE-ENGINEERING.md",
          summary:
            "Authoritative PE32+ disassembly reference: 117,068 functions, 8 critical offsets, RTTI tree, and memory structs.",
          tokensEstimate: 2200,
          keyConcepts: ["0x140000000", "GameTickLoop", "CharaControllerUpdate", "BonePalette", "RTTI", "0xEEFF blobs"],
        },
      ],
      Api: [
        {
          title: "OpenAPI 3.1.0 Specification (JSON)",
          url: "docs/OPENAPI.json",
          summary: "REST & VFS API endpoints covering characters, skills, teams, format probe, and save decryption.",
          tokensEstimate: 3100,
          keyConcepts: ["OpenAPI 3.1", "/api/vfs/probe", "/api/characters", "/api/saves/decrypt"],
        },
        {
          title: "OpenAPI 3.1.0 Specification (YAML)",
          url: "docs/OPENAPI.yaml",
          summary: "YAML equivalent of the canonical OpenAPI 3.1.0 specification.",
          tokensEstimate: 2900,
          keyConcepts: ["OpenAPI 3.1", "YAML"],
        },
      ],
    },
  };
}

/**
 * Generates standard Answer.AI `llms.txt`.
 */
export function generateLlmsTxt(): string {
  const model = getLlmIndexDocument();

  return `# ${model.projectName}

> ${model.description}

## Documentation
- [Cross-Language Architecture](${model.sections.Architecture[0].url}): ${model.sections.Architecture[0].summary}
- [VFS Specification](${model.sections.Vfs[0].url}): ${model.sections.Vfs[0].summary}
- [nie.exe Reverse Engineering](${model.sections.ReverseEngineering[0].url}): ${model.sections.ReverseEngineering[0].summary}
- [OpenAPI 3.1 Specification (JSON)](${model.sections.Api[0].url}): ${model.sections.Api[0].summary}
- [OpenAPI 3.1 Specification (YAML)](${model.sections.Api[1].url}): ${model.sections.Api[1].summary}
- [Complete Full Knowledge Base (llms-full.txt)](docs/llms-full.txt): Single-pass token-efficient ingestion context containing all schemas, offsets, format tables, and C-ABI symbols.

## Core Repositories & Crates
- Bun OS libraries: \`packages/inagle\` (Universal API), \`packages/inagle-cross\` (cross-language data); web apps built on them live in their own repositories
- Rust NIE Workspace (\`crates/nie/*\`): \`aphrody-nie-core\`, \`aphrody-nie-formats\`, \`aphrody-nie-save\`, \`aphrody-nie-ffi\`
- C# .NET 10 Solution (\`src/IECODE\`): \`IECODE.Core\` (CriFs archive manager), \`IECODE.Ffi\` (NativeAOT C-ABI export)

## Verified Constants Quick Reference
- Viola CPK Manifest Key: \`0x1717E18E\`
- CRC32 ISO-3309 Reflected Polynomial: \`0xEDB88320\`
- Encrypted CRI Table Magic: \`0xF5F39E1F\`
- Lives Save Container Magic: \`0x9DCE66C3\` (Const2: \`0x2EC3031F\`, Blobs: \`0xEEFF\`)
- Steam App ID: \`2799860\` (\`0x2AB8F4\`)
- Game Base Address: \`0x140000000\` (PE32+ x86_64, 117,068 functions)
`;
}

/**
 * Generates the exhaustive, token-efficient `llms-full.txt` knowledge base.
 */
export function generateLlmsFullTxt(): string {
  const formatsTable = VFS_FORMATS.map(
    f =>
      `| ${f.id} | ${f.magicHex} | ${f.magicAscii.padEnd(4, " ")} | ${f.extension.padEnd(8, " ")} | ${f.category.padEnd(9, " ")} | ${f.isBigEndian ? "BE" : "LE"} | ${f.encryptionSupported ? "Yes" : "No"} | ${f.compressionSupported ? "Yes" : "No"} | ${f.description} |`,
  ).join("\n");

  const packRulesTable = VFS_PACK_RULES.map(
    r =>
      `| ${r.packName.padEnd(16, " ")} | ${r.filenameMask.padEnd(16, " ")} | ${r.keyDerivation.padEnd(15, " ")} | ${String(r.mountPriority).padStart(4, " ")} | ${r.isCompressed ? "Yes" : "No"} | ${r.description} |`,
  ).join("\n");

  const directoriesTable = VFS_DIRECTORIES.map(
    d =>
      `| ${d.path.padEnd(16, " ")} | ${d.primaryExtension.padEnd(8, " ")} | ${String(d.fileCountEstimate).padStart(5, " ")} | ${d.description} |`,
  ).join("\n");

  const cryptoTable = NIE_CRYPTO_CONSTANTS.map(
    c =>
      `| ${c.name.padEnd(24, " ")} | ${c.hexValue.padEnd(12, " ")} | ${String(c.intValue).padEnd(10, " ")} | ${c.verifiedInGameDump ? "Yes" : "No"} | ${c.usage} |`,
  ).join("\n");

  const offsetsTable = NIE_CRITICAL_OFFSETS.map(
    o =>
      `| ${o.symbol.padEnd(24, " ")} | ${o.addressHex.padEnd(13, " ")} | ${o.subsystem.padEnd(11, " ")} | \`${o.signature}\` |`,
  ).join("\n");

  const rttiTable = NIE_RTTI_CLASSES.map(
    r =>
      `| ${r.namespace}::${r.name} | ${r.vtableOffsetHex} | ${r.baseClasses.join(", ") || "(none)"} | ${r.description} |`,
  ).join("\n");

  return `# INAZUMA ELEVEN: VICTORY ROAD — EXHAUSTIVE TECHNICAL SPECIFICATION & KNOWLEDGE BASE
Version: 2.0.4 | Date: 2026-10-01 | Architecture: Bun 1.4+ / Rust 1.85+ / .NET 10 NativeAOT

================================================================================
1. SYSTEM ARCHITECTURE & CROSS-LANGUAGE RUNTIME
================================================================================
The IECODE ecosystem unifies three high-performance runtimes into a single coherent pipeline:
1. TypeScript / Bun (packages/inagle):
   - Fast user-facing CLI (inagle vfs, inagle format, inagle zukan, inagle wiki).
   - High-throughput web API and wiki query engine.
   - Dynamic FFI bindings via \`bun:ffi\` communicating with both Rust and .NET.
2. Rust NIE C-ABI (crates/nie/aphrody-nie-ffi -> target/release/libiecode.so):
   - High-efficiency SIMD-accelerated CRILAYLA decompression and compression.
   - CRI position-aware XOR stream cipher and Viola fixed-key decrypter.
   - Relational database binary (RDBN / T2B cfg.bin) parsing into zero-copy JSON strings.
   - G4TX Level-5 texture decoding into raw RGBA8 pixel buffers and PNG streams.
   - Level-5 Lives save container (002AB8F4-*) decrypt/encrypt with CRC32 block checksums.
3. C# .NET 10 NativeAOT (src/IECODE/Ffi -> IECODE.Ffi.so):
   - CriFs CPK container builder and unpacker with comprehensive TOC/@UTF rebuilding.
   - NativeAOT unmanaged exports via [UnmanagedCallersOnly] attribute.
   - Full Node-API [JSExport] support for native Node.js / Bun addon loading.

--------------------------------------------------------------------------------
Rust C-ABI Export Symbols (libiecode.so):
--------------------------------------------------------------------------------
- const char* nie_version(void)
- uint32_t nie_crc32(const uint8_t* data, size_t length)
- uint32_t nie_crc32_iso(const uint8_t* data, size_t length)
- int32_t nie_cpk_probe_header(const uint8_t* data, size_t length)
- int32_t nie_cpk_decrypt_block(uint8_t* data, size_t length, uint64_t offset, uint32_t key)
- int32_t nie_crilayla_decompress(const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_len, size_t* out_decompressed)
- int32_t nie_rdbn_probe_header(const uint8_t* data, size_t length)
- int32_t nie_rdbn_decode_json(const uint8_t* data, size_t length, char* out_json, size_t json_capacity, size_t* out_len)
- int32_t nie_g4tx_probe_header(const uint8_t* data, size_t length)
- int32_t nie_g4tx_to_png(const uint8_t* data, size_t length, uint8_t* out_png, size_t png_capacity, size_t* out_len)
- int32_t nie_lives_decrypt(const char* filename, const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_cap, size_t* out_len)
- int32_t nie_lives_encrypt(const char* filename, const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_cap, size_t* out_len)
- void nie_free_string(char* ptr)

--------------------------------------------------------------------------------
.NET 10 NativeAOT C-ABI Export Symbols (IECODE.Ffi.so):
--------------------------------------------------------------------------------
- const char* iecode_core_version(void)
- int32_t iecode_crifs_probe_cpk(const uint8_t* data, size_t length)
- int32_t iecode_crifs_extract_cpk(const char* cpk_path, const char* out_dir)
- int32_t iecode_crifs_create_cpk(const char* input_dir, const char* cpk_out_path, int32_t compress)
- int32_t iecode_rdbn_to_json(const uint8_t* data, size_t length, char* out_json, size_t cap)
- void iecode_free_string(char* ptr)

================================================================================
2. VICTORY ROAD VIRTUAL FILE SYSTEM (VFS) SPECIFICATION
================================================================================
The game accesses all assets through a hybrid VFS composed of two layers:
1. Mounted CRI CPK Packages (located in \`data/packs/\`):
   - Mapped at startup by reading \`cpk_list.cfg.bin\`.
   - \`cpk_list.cfg.bin\` is encrypted with the Viola fixed XOR key: 0x1717E18E.
   - Individual CPK archives are encrypted with a position-aware XOR stream cipher
     where key = CRC32_ISO3309(filename).
   - High-throughput read requests are decoded into an in-memory LRU block cache.
2. Loose File Dump Overlay:
   - When running development builds or unpacked assets, the engine probes disk
     paths directly before falling back to mounted CPK containers.

--------------------------------------------------------------------------------
All 28 Recognized Authoritative Binary Formats:
--------------------------------------------------------------------------------
| ID | Magic Hex | ASCII | Extension | Category | Endian | Encrypted | Compressed | Description |
|---|---|---|---|---|---|---|---|---|
${formatsTable}

--------------------------------------------------------------------------------
CRI CPK Pack Mounting Rules:
--------------------------------------------------------------------------------
| Pack Name | Filename Mask | Key Derivation | Priority | Compressed | Description |
|---|---|---|---|---|---|
${packRulesTable}

--------------------------------------------------------------------------------
Top-Level Directory Topology:
--------------------------------------------------------------------------------
| Path | Primary Ext | Est. Files | Description |
|---|---|---|---|
${directoriesTable}

--------------------------------------------------------------------------------
Cryptographic & Compression Algorithms:
--------------------------------------------------------------------------------
1. CRILAYLA Reverse Bitstream LZSS:
   - Header is 16 bytes:
     + 0x00..0x08: ASCII "CRILAYLA"
     + 0x08..0x0C: uint32 LE uncompressed size
     + 0x0C..0x10: uint32 LE compressed payload size
   - The bitstream is read strictly backwards from the last compressed byte towards
     offset 0x10.
   - Ring buffer history size is 0x100 (256) bytes.
   - Control bits: 0 = literal byte (8 bits); 1 = dictionary match (offset + length).
2. CRI Position-Aware XOR Stream Cipher:
   - Applied in 4-byte quads.
   - Given file offset and 32-bit key, quad_mask = key ^ ((offset * 0x41C64E6D + 0x3039) & 0xFFFFFFFF).
   - Plaintext[i] = Ciphertext[i] ^ quad_mask[i % 4].
3. Level-5 Lives Save Cryptography:
   - Filenames are formatted as \`002AB8F4-<CATEGORY>LIVE\` (Steam App ID 2799860 = 0x2AB8F4).
   - Key derivation: seed = CRC32_Reflected(filename_ascii).
   - Decrypted file starts with sentinel uint32 LE \`0x9DCE66C3\` at offset 0x00 and \`0x2EC3031F\` at 0x08.
   - Subsequent payload chunks are prefixed with big-endian uint16 \`0xEEFF\` followed by 32-bit chunk length.

================================================================================
3. NIE.EXE REVERSE ENGINEERING DISASSEMBLY REFERENCE
================================================================================
Target Binary: nie.exe (Internal name: nie1v2.exe)
Binary Architecture: x86_64 PE32+
Image Base: 0x140000000
Total Cataloged Functions: 117,068 (from .pdata exception directory)

--------------------------------------------------------------------------------
Verified Cryptographic Constants:
--------------------------------------------------------------------------------
| Name | Hex Value | Decimal | Verified | Usage |
|---|---|---|---|---|
${cryptoTable}

--------------------------------------------------------------------------------
Critical Function Offsets & Signatures:
--------------------------------------------------------------------------------
| Symbol | Address | Subsystem | Signature |
|---|---|---|---|
${offsetsTable}

--------------------------------------------------------------------------------
Reconstructed RTTI Class Hierarchy:
--------------------------------------------------------------------------------
| Qualified Name | VTable Offset | Base Classes | Description |
|---|---|---|---|
${rttiTable}

--------------------------------------------------------------------------------
Runtime Memory Structures & Layouts:
--------------------------------------------------------------------------------
1. BonePalette (0x600 / 1536 bytes):
   - Stored at \`renderObj + 0x1D98\`.
   - Layout: 32 bone transforms, each taking 3 vec4 registers (mat3x4 affine matrix).
   - Total: 32 * 3 = 96 vec4 = 1536 bytes.
2. FontGlyph (0x0C / 12 bytes):
   - +0x00: uint16 u (X coordinate in font texture atlas)
   - +0x02: uint16 v (Y coordinate in font texture atlas)
   - +0x04: uint8 width
   - +0x05: uint8 height
   - +0x06: int8 offsetX
   - +0x07: int8 offsetY
   - +0x08: int8 advanceX
   - +0x09: uint8 pageIndex (0 to 3)
   - +0x0A: uint16 padding
3. RdbnHeader (0x50 / 80 bytes):
   - +0x00: uint32 magic = 0x4E424452 ("RDBN")
   - +0x04: uint16 headerSize = 0x50
   - +0x06: uint16 version = 0x01
   - +0x08: uint32 tableCount
   - +0x0C: uint32 stringPoolOffset
   - +0x10: uint32 stringPoolSize
   - +0x14: uint32 dataSectionOffset
   - +0x18: uint32 dataSectionSize
   - +0x1C..0x50: CRC32 checksums, schema validation flags, and column index descriptors.

================================================================================
4. CONSUMPTION GUIDE FOR AUTONOMOUS AGENTS & DEVELOPERS
================================================================================
Using Inagle in Bun TypeScript:
--------------------------------------------------------------------------------
\`\`\`typescript
import { Inagle } from "@aphrody/inagle";
import { nieCrc32, nieDecompressCrilayla } from "@aphrody/inagle/ffi";
import { IecodeDotnet } from "@aphrody/inagle/dotnet";
import { getVfsCatalog, resolveFormat } from "@aphrody/inagle/docs";

// 1. Inspect format magic
const fmt = resolveFormat("G4TX");
console.log(fmt?.description); // Level-5 Texture Container

// 2. High-speed CRILAYLA decompression via Rust FFI
const decompressed = nieDecompressCrilayla(compressedCpkBuffer);

// 3. Extract CRI CPK via .NET NativeAOT
await IecodeDotnet.extractCpk("data/packs/common.cpk", "output/common");
\`\`\`

CLI Commands:
- \`bun run cli vfs inspect <path>\`: Probes header magic and dumps metadata.
- \`bun run cli vfs unpack <cpk> <out>\`: Extracts CPK using Rust/C# acceleration.
- \`bun run cli zukan chara <id>\`: Prints full character profile and growth curve.
- \`bun run cli wiki query "<sql>"\`: Runs read-only queries against mirror database.
`;
}
