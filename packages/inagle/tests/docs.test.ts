/**
 * @file docs.test.ts
 * @description Unit tests for @aphrody/inagle/docs: OpenAPI 3.1 generator,
 * VFS catalog, nie.exe reverse-engineering specification, Answer.AI llms.txt models,
 * and static documentation file exporter.
 */

import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportDocsToDirectory,
  generateDocsReadmeMarkdown,
  generateLlmsFullTxt,
  generateLlmsTxt,
  generateNieReMarkdown,
  generateOpenApiJson,
  generateOpenApiSpec,
  generateOpenApiYaml,
  generateVfsSpecificationMarkdown,
  getLlmIndexDocument,
  getNieReMap,
  getVfsCatalog,
  NIE_CRITICAL_OFFSETS,
  NIE_CRYPTO_CONSTANTS,
  NIE_MEMORY_STRUCTURES,
  NIE_RTTI_CLASSES,
  resolveFormat,
  VFS_DIRECTORIES,
  VFS_FORMATS,
  VFS_PACK_RULES,
} from "../src/docs/index.js";

describe("@aphrody/inagle/docs", () => {
  describe("VFS Catalog Specification", () => {
    it("should catalog all 28 authoritative binary formats", () => {
      expect(VFS_FORMATS.length).toBe(28);

      const catalog = getVfsCatalog();
      expect(catalog.version).toBe("2.0.5");
      expect(catalog.authoritativeEngine).toBe("aphrody-nie-formats");
      expect(catalog.supportedFormats.length).toBe(28);
      expect(catalog.defaultSectorSize).toBe(0x800);
      expect(catalog.utfTableOffset).toBe(0x10);
    });

    it("should resolve formats by magic ASCII and extension", () => {
      const g4tx = resolveFormat("G4TX");
      expect(g4tx).toBeDefined();
      expect(g4tx?.category).toBe("texture");
      expect(g4tx?.extension).toBe(".g4tx");

      const cpk = resolveFormat(".cpk");
      expect(cpk).toBeDefined();
      expect(cpk?.magicAscii.trim()).toBe("CPK");
      expect(cpk?.isBigEndian).toBe(true);

      const rdbn = resolveFormat(".cfg.bin");
      expect(rdbn).toBeDefined();
      expect(rdbn?.magicAscii).toBe("RDBN");

      const live = resolveFormat("LIVE");
      expect(live).toBeDefined();
      expect(live?.category).toBe("system");
      expect(live?.encryptionSupported).toBe(true);
    });

    it("should contain all essential CRI CPK pack rules", () => {
      expect(VFS_PACK_RULES.length).toBeGreaterThanOrEqual(8);

      const commonPack = VFS_PACK_RULES.find(p => p.packName === "common.cpk");
      expect(commonPack).toBeDefined();
      expect(commonPack?.keyDerivation).toBe("filename-crc32");
      expect(commonPack?.mountPriority).toBe(100);

      const cpkList = VFS_PACK_RULES.find(p => p.packName === "cpk_list.cfg.bin");
      expect(cpkList).toBeDefined();
      expect(cpkList?.keyDerivation).toBe("viola-fixed");
    });

    it("should define top-level directory topologies", () => {
      expect(VFS_DIRECTORIES.length).toBeGreaterThanOrEqual(6);
      const commonDir = VFS_DIRECTORIES.find(d => d.path === "data/common/");
      expect(commonDir).toBeDefined();
      expect(commonDir?.primaryExtension).toBe(".cfg.bin");
    });
  });

  describe("nie.exe Reverse Engineering Map", () => {
    it("should provide authoritative binary base information", () => {
      const map = getNieReMap();
      expect(map.targetBinary).toBe("nie.exe");
      expect(map.internalName).toBe("nie1v2.exe");
      expect(map.architecture).toBe("x86_64");
      expect(map.format).toBe("PE32+");
      expect(map.baseAddressHex).toBe("0x140000000");
      expect(map.totalFunctionsCount).toBe(117068);
    });

    it("should include verified cryptographic constants", () => {
      const viola = NIE_CRYPTO_CONSTANTS.find(c => c.name === "VIOLA_FIXED_KEY");
      expect(viola).toBeDefined();
      expect(viola?.hexValue).toBe("0x1717E18E");
      expect(viola?.intValue).toBe(0x1717e18e);
      expect(viola?.verifiedInGameDump).toBe(true);

      const crc = NIE_CRYPTO_CONSTANTS.find(c => c.name === "LEVEL5_CRC32_POLYNOMIAL");
      expect(crc).toBeDefined();
      expect(crc?.hexValue).toBe("0xEDB88320");
      expect(crc?.intValue).toBe(0xedb88320);

      const steam = NIE_CRYPTO_CONSTANTS.find(c => c.name === "STEAM_APP_ID");
      expect(steam?.intValue).toBe(2799860);
    });

    it("should include all 8 critical function offsets", () => {
      expect(NIE_CRITICAL_OFFSETS.length).toBe(8);

      const tickLoop = NIE_CRITICAL_OFFSETS.find(o => o.symbol === "GameTickLoop");
      expect(tickLoop).toBeDefined();
      expect(tickLoop?.addressHex).toBe("0x1406d5840");
      expect(tickLoop?.subsystem).toBe("game-loop");

      const charaCtrl = NIE_CRITICAL_OFFSETS.find(o => o.symbol === "CharaControllerUpdate");
      expect(charaCtrl).toBeDefined();
      expect(charaCtrl?.addressHex).toBe("0x1404ecd60");

      const cpkDecrypt = NIE_CRITICAL_OFFSETS.find(o => o.symbol === "CriFsStreamDecryptBlock");
      expect(cpkDecrypt?.addressHex).toBe("0x1405a1120");

      const crilayla = NIE_CRITICAL_OFFSETS.find(o => o.symbol === "CriLaylaDecompressStream");
      expect(crilayla?.addressHex).toBe("0x1405b3890");
    });

    it("should document runtime memory structures", () => {
      expect(NIE_RTTI_CLASSES.length).toBeGreaterThanOrEqual(8);
      expect(NIE_MEMORY_STRUCTURES.BonePalette).toBeDefined();
      expect(NIE_MEMORY_STRUCTURES.BonePalette.sizeHex).toBe("0x600");
      expect(NIE_MEMORY_STRUCTURES.FontGlyph).toBeDefined();
      expect(NIE_MEMORY_STRUCTURES.FontGlyph.sizeHex).toBe("0x0C");
      expect(NIE_MEMORY_STRUCTURES.RdbnHeader).toBeDefined();
    });
  });

  describe("OpenAPI 3.1.0 Generator", () => {
    it("should generate a valid OpenAPI 3.1.0 document", () => {
      const doc = generateOpenApiSpec();
      expect(doc.openapi).toBe("3.1.0");
      expect(doc.info.title).toContain("Inagle Universal Game Data");
      expect(doc.info.version).toBe("2.0.5");
      expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(8);
      expect(doc.paths["/api/characters"]).toBeDefined();
      expect(doc.paths["/api/vfs/formats"]).toBeDefined();
      expect(doc.paths["/api/vfs/probe"]).toBeDefined();
      expect(doc.paths["/api/nie/re/constants"]).toBeDefined();
      expect(doc.paths["/api/saves/decrypt"]).toBeDefined();
    });

    it("should serialize to valid JSON", () => {
      const jsonStr = generateOpenApiJson(true);
      expect(typeof jsonStr).toBe("string");
      const parsed = JSON.parse(jsonStr);
      expect(parsed.openapi).toBe("3.1.0");
      expect(parsed.info.version).toBe("2.0.5");
    });

    it("should serialize to valid YAML text", () => {
      const yamlStr = generateOpenApiYaml();
      expect(typeof yamlStr).toBe("string");
      expect(yamlStr).toContain("openapi: 3.1.0");
      expect(yamlStr).toContain("/api/characters:");
      expect(yamlStr).toContain("/api/vfs/formats:");
    });
  });

  describe("Answer.AI llms.txt Standard", () => {
    it("should produce a structured LlmIndexDocument model", () => {
      const index = getLlmIndexDocument();
      expect(index.projectName).toBe("@aphrody/inagle");
      expect(index.sections.Architecture).toBeDefined();
      expect(index.sections.Vfs).toBeDefined();
      expect(index.sections.ReverseEngineering).toBeDefined();
    });

    it("should generate compliant llms.txt content", () => {
      const txt = generateLlmsTxt();
      expect(txt.startsWith("# @aphrody/inagle")).toBe(true);
      expect(txt).toContain("> Universal Game Data API");
      expect(txt).toContain("## Documentation");
      expect(txt).toContain("[Cross-Language Architecture](docs/CROSS-LANGUAGE-ARCHITECTURE.md)");
      expect(txt).toContain("[VFS Specification](docs/VFS-SPECIFICATION.md)");
      expect(txt).toContain("0x1717E18E");
      expect(txt).toContain("0xEDB88320");
    });

    it("should generate comprehensive llms-full.txt content", () => {
      const full = generateLlmsFullTxt();
      expect(full).toContain("SYSTEM ARCHITECTURE & CROSS-LANGUAGE RUNTIME");
      expect(full).toContain("Rust C-ABI Export Symbols (libiecode.so):");
      expect(full).toContain(".NET 10 NativeAOT C-ABI Export Symbols (IECODE.Ffi.so):");
      expect(full).toContain("VICTORY ROAD VIRTUAL FILE SYSTEM (VFS) SPECIFICATION");
      expect(full).toContain("All 28 Recognized Authoritative Binary Formats:");
      expect(full).toContain("CRILAYLA Reverse Bitstream LZSS");
      expect(full).toContain("NIE.EXE REVERSE ENGINEERING DISASSEMBLY REFERENCE");
      expect(full).toContain("117,068");
      expect(full).toContain("GameTickLoop");
      expect(full).toContain("BonePalette (0x600 / 1536 bytes)");
    });
  });

  describe("Markdown Generators & File Exporter", () => {
    it("should generate markdown documents without errors", () => {
      const vfsMd = generateVfsSpecificationMarkdown();
      expect(vfsMd).toContain("# Victory Road Virtual File System (VFS) Specification");
      expect(vfsMd).toContain("G4TX");

      const nieMd = generateNieReMarkdown();
      expect(nieMd).toContain("# nie.exe Reverse Engineering Specification");
      expect(nieMd).toContain("0x1406d5840");

      const readmeMd = generateDocsReadmeMarkdown();
      expect(readmeMd).toContain("# @aphrody/inagle/docs");
    });

    it("should export all documentation files to target directory", async () => {
      const testDir = join(tmpdir(), `inagle-docs-test-${Date.now()}`);
      const files = await exportDocsToDirectory(testDir);

      expect(files.length).toBe(8);
      const expectedFiles = [
        "README.md",
        "OPENAPI.json",
        "OPENAPI.yaml",
        "VFS-SPECIFICATION.md",
        "NIE-EXE-REVERSE-ENGINEERING.md",
        "CROSS-LANGUAGE-ARCHITECTURE.md",
        "llms.txt",
        "llms-full.txt",
      ];

      for (const expected of expectedFiles) {
        const filePath = join(testDir, expected);
        const stat = await fs.stat(filePath);
        expect(stat.size).toBeGreaterThan(50);
      }

      // Cleanup
      await fs.rm(testDir, { recursive: true, force: true });
    });
  });
});
