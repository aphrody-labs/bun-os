/**
 * @file index.ts
 * @description Master entry point for @rosegriffon/inagle/docs.
 * Exports OpenAPI 3.1 specifications, VFS architecture catalog, nie.exe reverse-engineering maps,
 * Answer.AI llms.txt models, and static documentation exporters.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

export * from "./types.js";
export * from "./vfs-catalog.js";
export * from "./nie-re-map.js";
export * from "./openapi.js";
export * from "./llm-docs.js";

import { generateOpenApiJson, generateOpenApiYaml } from "./openapi.js";
import { generateLlmsFullTxt, generateLlmsTxt } from "./llm-docs.js";
import { getVfsCatalog } from "./vfs-catalog.js";
import { getNieReMap } from "./nie-re-map.js";

/**
 * Generates the VFS-SPECIFICATION.md markdown content.
 */
export function generateVfsSpecificationMarkdown(): string {
  const catalog = getVfsCatalog();

  const formatsRows = catalog.supportedFormats
    .map(
      f =>
        `| \`${f.magicHex}\` | \`${f.magicAscii}\` | \`${f.extension}\` | **${f.category}** | ${f.isBigEndian ? "Big" : "Little"} | ${f.encryptionSupported ? "✅" : "❌"} | ${f.compressionSupported ? "✅" : "❌"} | ${f.description} |`,
    )
    .join("\n");

  const packRows = catalog.packRules
    .map(
      p =>
        `| \`${p.packName}\` | \`${p.filenameMask}\` | \`${p.keyDerivation}\` | ${p.mountPriority} | ${p.isCompressed ? "✅" : "❌"} | ${p.description} |`,
    )
    .join("\n");

  const dirRows = catalog.directories
    .map(
      d =>
        `| \`${d.path}\` | \`${d.primaryExtension}\` | ~${d.fileCountEstimate} | ${d.description} | \`${d.sampleFiles.slice(0, 2).join("`, `")}\` |`,
    )
    .join("\n");

  return `# Victory Road Virtual File System (VFS) Specification

> Comprehensive, authoritative technical specification for the Inazuma Eleven: Victory Road Virtual File System.
> Grounded in \`aphrody-nie-formats\`, \`IECODE.Core.CriFs\`, and reverse engineering of \`nie.exe\`.

---

## 1. Architectural Overview

The Victory Road VFS combines two distinct mounting tiers:
1. **Mounted CRI CPK Archives** (\`data/packs/*.cpk\`):
   - High-density packages indexed at game boot via \`cpk_list.cfg.bin\`.
   - Protected with CRI position-dependent XOR cipher and Viola key (\`0x1717E18E\`).
   - Compressed with reverse-bitstream CRILAYLA LZSS.
   - Cached in memory using an LRU cache budget (default 16 GiB on desktop).
2. **Loose File Dump Overlay**:
   - For fast modding, testing, and tool ingestion, the VFS inspects loose files on disk.
   - When a requested file path exists in the loose directory tree, it overrides the CPK archive entry.

---

## 2. Authoritative Binary Formats Catalog (${catalog.supportedFormats.length} Formats)

| Magic (Hex) | ASCII | Extension | Category | Endianness | Encrypted | Compressed | Description |
|---|---|---|---|---|---|---|---|
${formatsRows}

---

## 3. CPK Package Mapping & Priority Rules

| Archive Name | Wildcard Mask | Key Derivation | Priority | CRILAYLA | Role / Contents |
|---|---|---|---|---|---|
${packRows}

---

## 4. Top-Level Directory Topology

| Logical Directory | Dominant Format | Est. Files | Subsystem Role | Sample Entries |
|---|---|---|---|---|
${dirRows}

---

## 5. Decompression & Cryptography Reference

### 5.1 CRILAYLA LZSS Decompression
- **Header**: 16 bytes starting with ASCII \`CRILAYLA\`.
- **Offset +8**: 32-bit unsigned LE integer specifying uncompressed payload size.
- **Offset +12**: 32-bit unsigned LE integer specifying compressed bitstream size.
- **Direction**: Bitstream is processed **backwards** starting from the final byte of the compressed stream towards offset \`+16\`.
- **History Buffer**: 256 bytes (\`0x100\`) circular dictionary.

### 5.2 CRI Position-Aware XOR Cipher
- Plaintext blocks are transformed in 4-byte quadwords:
  \`\`\`c
  uint32_t quad_mask = key ^ ((offset * 0x41C64E6D + 0x3039) & 0xFFFFFFFF);
  plaintext[i] = ciphertext[i] ^ ((uint8_t*)&quad_mask)[i % 4];
  \`\`\`
- Key is generated via reflected CRC32 (\`0xEDB88320\`) of the archive filename string.
`;
}

/**
 * Generates the NIE-EXE-REVERSE-ENGINEERING.md markdown content.
 */
export function generateNieReMarkdown(): string {
  const reMap = getNieReMap();

  const cryptoRows = reMap.cryptoConstants
    .map(
      c =>
        `| \`${c.name}\` | \`${c.hexValue}\` | \`${c.intValue}\` | ${c.verifiedInGameDump ? "✅ Verified" : "⚠️ Candidate"} | ${c.usage} |`,
    )
    .join("\n");

  const offsetRows = reMap.criticalOffsets
    .map(
      o =>
        `| **${o.symbol}** | \`${o.addressHex}\` | \`${o.subsystem}\` | \`${o.callingConvention ?? "default"}\` | \`${o.signature}\` | ${o.description} |`,
    )
    .join("\n");

  const rttiRows = reMap.rttiClasses
    .map(
      r =>
        `| \`${r.namespace}::${r.name}\` | \`${r.vtableOffsetHex}\` | \`${r.baseClasses.join(", ") || "None"}\` | ${r.description} |`,
    )
    .join("\n");

  const structBlocks = Object.entries(reMap.memoryStructures)
    .map(([name, s]) => {
      const fieldLines = Object.entries(s.fields)
        .map(([offset, desc]) => `  - \`${offset}\`: ${desc}`)
        .join("\n");
      return `### \`${name}\` (Size: \`${s.sizeHex}\`)\n*${s.description}*\n${fieldLines}`;
    })
    .join("\n\n");

  return `# nie.exe Reverse Engineering Specification

> Comprehensive, authoritative disassembly reference for \`nie.exe\` (Inazuma Eleven: Victory Road).
> Based on static PE32+ analysis, .pdata exception directory boundary mapping, and runtime memory inspection.

---

## 1. Binary Characteristics

- **Target Executable**: \`nie.exe\` (Internal file name: \`nie1v2.exe\`)
- **Format**: PE32+ (64-bit Windows Executable)
- **Architecture**: x86_64
- **Image Base**: \`${reMap.baseAddressHex}\`
- **Total Function Entries**: **${reMap.totalFunctionsCount.toLocaleString()}** (extracted from \`.pdata\` function entry table)

---

## 2. Cryptographic Constants & Polynomials

| Constant Name | Hexadecimal | Integer | Status | Algorithmic Usage |
|---|---|---|---|---|
${cryptoRows}

---

## 3. Critical Function Offsets & Entry Points

| Symbol Name | Disassembly Address | Subsystem | Calling Conv | Signature | Functional Description |
|---|---|---|---|---|---|
${offsetRows}

---

## 4. Polymorphic RTTI Class Hierarchy

| Class (Fully Qualified) | VTable Offset | Inheritance Base | Subsystem Description |
|---|---|---|---|
${rttiRows}

---

## 5. Critical Memory Structures

${structBlocks}
`;
}

/**
 * Generates the CROSS-LANGUAGE-ARCHITECTURE.md markdown content.
 */
export function generateCrossLanguageArchitectureMarkdown(): string {
  return `# Cross-Language Architecture: Bun, Rust NIE & C# IECODE.Core

> Technical design and implementation of the unified tri-runtime architecture powering IECODE.
> Bridges TypeScript / Bun, Rust C-ABI (\`libiecode.so\`), and .NET 10 NativeAOT (\`IECODE.Ffi.so\`).

---

## 1. Architecture Overview

\`\`\`
+---------------------------------------------------------------------------------+
|                       USER INTERFACES & WORKSPACE CONSUMERS                     |
|  - CLI: \`inagle <command>\`                                                      |
|  - Web Application: \`apps/azalee-web\` in aphrody-labs/rosegriffon                 |
|  - Shared Components: \`packages/ieverse\`                                       |
+---------------------------------------+-----------------------------------------+
                                        |
                   +--------------------+--------------------+
                   |                                         |
+------------------v------------------+   +------------------v------------------+
|           BUN FFI CLIENT            |   |         .NET NATIVEAOT / C-ABI      |
|    \`packages/inagle/src/ffi/nie.ts\`  |   |   \`src/IECODE/Ffi/IECODE.Ffi.so\`    |
|   - Zero-copy buffer exchange       |   |   - CriFs CPK Container Engine      |
|   - Safe memory pointer unwrapping  |   |   - UnmanagedCallersOnly exports    |
|   - Multi-platform library loader   |   |   - Node-API JSExport layer         |
+------------------+------------------+   +------------------+------------------+
                   |                                         |
+------------------v-----------------------------------------v------------------+
|                      RUST NIE ENGINE (crates/nie/*)                           |
|               Shared Library: \`target/release/libiecode.so\`                    |
|   - \`aphrody-nie-core\`: CRC32 (reflected), Viola cipher, PRNG, endian IO       |
|   - \`aphrody-nie-formats\`: CRILAYLA SIMD decompressor, G4TX, G4MD, RDBN        |
|   - \`aphrody-nie-save\`: Lives save decryption (002AB8F4-* containers)        |
|   - \`aphrody-nie-data\`: In-game gamedata schemas, players, growth curves       |
|   - \`aphrody-nie-wiki\`: Relational SQLite database queries and drop tables   |
+-------------------------------------------------------------------------------+
\`\`\`

---

## 2. ABI Contracts & Memory Management

### 2.1 Rust C-ABI (\`libiecode.so\`)
- **Symbol Prefix**: \`nie_*\`
- **Calling Convention**: System V AMD64 ABI (Linux) / Microsoft x64 ABI (Windows)
- **String Management**: Output strings allocated by Rust are freed via \`nie_free_string(char* ptr)\`.
- **Status Codes**: Functions return \`0\` on success, negative integers on error (\`-1\` Invalid Argument, \`-2\` Buffer Too Small, \`-3\` Corrupt Data).

### 2.2 .NET 10 NativeAOT (\`IECODE.Ffi.so\`)
- **Symbol Prefix**: \`iecode_*\`
- **Compiler**: \`dotnet publish /p:PublishAot=true\` producing self-contained native \`.so\` without external runtime dependency.
- **Node-API**: Compliant with Node.js N-API v8 and Bun native addon loader.

---

## 3. High-Performance TypeScript Usage

\`\`\`typescript
import { Inagle } from "@rosegriffon/inagle";
import { nieCrc32, nieDecompressCrilayla, nieProbeHeader } from "@rosegriffon/inagle/ffi";
import { IecodeDotnet } from "@rosegriffon/inagle/dotnet";

// 1. Instant header probe
const probe = nieProbeHeader(rawBuffer);
console.log("Detected format:", probe.format);

// 2. High-speed SIMD CRILAYLA decompression
const decompressed = nieDecompressCrilayla(compressedBytes);

// 3. .NET CriFs CPK Extraction
await IecodeDotnet.extractCpk("data/packs/common.cpk", "dist/common");
\`\`\`
`;
}

/**
 * Generates the README.md content for packages/inagle/docs.
 */
export function generateDocsReadmeMarkdown(): string {
  return `# @rosegriffon/inagle/docs

Universal technical documentation, OpenAPI 3.1 specifications, VFS architecture catalog,
and \`nie.exe\` reverse-engineering reference for **Inazuma Eleven: Victory Road**.

---

## Contents

1. [VFS Specification](VFS-SPECIFICATION.md): CRI CPK packaging, @UTF metadata, CRILAYLA decompression, and directory topologies.
2. [nie.exe Reverse Engineering](NIE-EXE-REVERSE-ENGINEERING.md): PE32+ 0x140000000 image base, 117,068 functions, RTTI classes, Viola keys, and memory structs.
3. [Cross-Language Architecture](CROSS-LANGUAGE-ARCHITECTURE.md): Tri-runtime design linking Bun TypeScript, Rust NIE C-ABI, and .NET 10 NativeAOT.
4. [OpenAPI 3.1.0 Specification (JSON)](OPENAPI.json): Full OpenAPI 3.1 schema in JSON format.
5. [OpenAPI 3.1.0 Specification (YAML)](OPENAPI.yaml): Full OpenAPI 3.1 schema in YAML format.
6. [Answer.AI llms.txt](llms.txt): Machine-readable index complying with the Answer.AI standard.
7. [Answer.AI llms-full.txt](llms-full.txt): Complete, consolidated single-pass knowledge base for autonomous agents.

---

## Programmatic Access

All catalogs, specs, and generators are exported directly:

\`\`\`typescript
import {
  generateOpenApiSpec,
  generateOpenApiJson,
  generateOpenApiYaml,
  generateLlmsTxt,
  generateLlmsFullTxt,
  getVfsCatalog,
  getNieReMap,
  VFS_FORMATS,
  NIE_CRITICAL_OFFSETS
} from "@rosegriffon/inagle/docs";

// Query VFS formats
const formats = VFS_FORMATS;
console.log("Total formats:", formats.length); // 28

// Generate OpenAPI 3.1 spec
const spec = generateOpenApiSpec();
\`\`\`
`;
}

/**
 * Writes all static documentation artifacts to a target directory.
 */
export async function exportDocsToDirectory(outDir: string): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });

  const files: Record<string, string> = {
    "README.md": generateDocsReadmeMarkdown(),
    "OPENAPI.json": generateOpenApiJson(true),
    "OPENAPI.yaml": generateOpenApiYaml(),
    "VFS-SPECIFICATION.md": generateVfsSpecificationMarkdown(),
    "NIE-EXE-REVERSE-ENGINEERING.md": generateNieReMarkdown(),
    "CROSS-LANGUAGE-ARCHITECTURE.md": generateCrossLanguageArchitectureMarkdown(),
    "llms.txt": generateLlmsTxt(),
    "llms-full.txt": generateLlmsFullTxt(),
  };

  const writtenFiles: string[] = [];

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(outDir, filename);
    await fs.writeFile(filePath, content, "utf-8");
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}
