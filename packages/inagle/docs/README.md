# @aphrody/inagle/docs

Universal technical documentation, OpenAPI 3.1 specifications, VFS architecture catalog,
and `nie.exe` reverse-engineering reference for **Inazuma Eleven: Victory Road**.

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

```typescript
import {
  generateOpenApiSpec,
  generateOpenApiJson,
  generateOpenApiYaml,
  generateLlmsTxt,
  generateLlmsFullTxt,
  getVfsCatalog,
  getNieReMap,
  VFS_FORMATS,
  NIE_CRITICAL_OFFSETS,
} from "@aphrody/inagle/docs";

// Query VFS formats
const formats = VFS_FORMATS;
console.log("Total formats:", formats.length); // 28

// Generate OpenAPI 3.1 spec
const spec = generateOpenApiSpec();
```
