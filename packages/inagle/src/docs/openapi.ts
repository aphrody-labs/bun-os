/**
 * @file openapi.ts
 * @description OpenAPI 3.1.0 specification generator and serializers for @aphrody/inagle.
 * Documents REST and RPC endpoints for game data, VFS virtual file system,
 * binary format inspection, and nie.exe reverse-engineering services.
 */

import type { OpenApiDocument, OpenApiSchema } from "./types.js";
import { VFS_FORMATS, VFS_PACK_RULES } from "./vfs-catalog.js";
import { NIE_CRITICAL_OFFSETS, NIE_CRYPTO_CONSTANTS, NIE_RTTI_CLASSES } from "./nie-re-map.js";

/**
 * Builds the canonical OpenAPI 3.1.0 document.
 */
export function generateOpenApiSpec(): OpenApiDocument {
  const schemaVfsFormat: OpenApiSchema = {
    type: "object",
    title: "VfsFormatDescriptor",
    description: "Binary file format descriptor recognized by IECODE and NIE.",
    properties: {
      id: { type: "integer", description: "Internal format identifier" },
      magicHex: {
        type: "string",
        description: "4-byte magic number in hexadecimal (e.g. '0x58543447')",
      },
      magicAscii: {
        type: "string",
        description: "ASCII representation of the magic header (e.g. 'G4TX')",
      },
      extension: { type: "string", description: "Canonical file extension (e.g. '.g4tx')" },
      description: { type: "string", description: "Human-readable format explanation" },
      isBigEndian: { type: "boolean", description: "True if byte order is big-endian" },
      category: {
        type: "string",
        enum: ["texture", "model", "config", "audio", "video", "container", "script", "system"],
      },
      encryptionSupported: { type: "boolean", description: "True if format supports encryption" },
      compressionSupported: {
        type: "boolean",
        description: "True if format supports CRILAYLA or LZSS compression",
      },
    },
    required: ["id", "magicHex", "magicAscii", "extension", "description", "category"],
  };

  const schemaVfsPack: OpenApiSchema = {
    type: "object",
    title: "VfsPackRule",
    description: "CRI CPK pack file mapping rule in the Victory Road VFS.",
    properties: {
      packName: { type: "string", description: "Target CPK archive filename" },
      filenameMask: { type: "string", description: "Wildcard mask matching input files" },
      keyDerivation: {
        type: "string",
        enum: ["filename-crc32", "viola-fixed", "none"],
      },
      mountPriority: {
        type: "integer",
        description: "Mount priority order (higher numbers resolve first)",
      },
      description: { type: "string", description: "Purpose and content of this pack" },
      isCompressed: {
        type: "boolean",
        description: "Whether contained streams use CRILAYLA compression",
      },
    },
    required: ["packName", "filenameMask", "keyDerivation", "mountPriority"],
  };

  const schemaCryptoConstant: OpenApiSchema = {
    type: "object",
    title: "NieCryptoConstant",
    description: "Cryptographic constant reverse-engineered from nie.exe.",
    properties: {
      name: { type: "string" },
      hexValue: { type: "string" },
      intValue: { type: "number" },
      usage: { type: "string" },
      verifiedInGameDump: { type: "boolean" },
    },
    required: ["name", "hexValue", "usage", "verifiedInGameDump"],
  };

  const schemaMemoryOffset: OpenApiSchema = {
    type: "object",
    title: "NieMemoryOffset",
    description: "Disassembled function entry point or memory address in nie.exe.",
    properties: {
      symbol: { type: "string" },
      addressHex: { type: "string" },
      subsystem: {
        type: "string",
        enum: ["game-loop", "controller", "render", "vfs", "audio", "crypto", "prng", "lua"],
      },
      description: { type: "string" },
      callingConvention: { type: "string" },
      signature: { type: "string" },
    },
    required: ["symbol", "addressHex", "subsystem", "description"],
  };

  const schemaRttiClass: OpenApiSchema = {
    type: "object",
    title: "NieRttiClass",
    description: "Reconstructed MSVC RTTI polymorphic class in nie.exe.",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      vtableOffsetHex: { type: "string" },
      baseClasses: { type: "array", items: { type: "string" } },
      description: { type: "string" },
    },
    required: ["name", "namespace", "vtableOffsetHex", "baseClasses", "description"],
  };

  const schemaCharacter: OpenApiSchema = {
    type: "object",
    title: "Character",
    description: "Canonical Inazuma Eleven: Victory Road character entity.",
    properties: {
      charaId: { type: "string", description: "Unique character ID (e.g. 'c01000010')" },
      name: { type: "string", description: "Localized display name" },
      element: { type: "integer", description: "Element ID (1=Wind, 2=Wood, 3=Fire, 4=Earth)" },
      position: { type: "integer", description: "Position ID (1=GK, 2=DF, 3=MF, 4=FW)" },
      rarity: { type: "integer", description: "Base rarity tier (1 to 5)" },
      kick: { type: "integer" },
      dribble: { type: "integer" },
      block: { type: "integer" },
      catch: { type: "integer" },
      speed: { type: "integer" },
      technique: { type: "integer" },
      stamina: { type: "integer" },
      lucky: { type: "integer" },
    },
    required: ["charaId", "name", "element", "position", "rarity"],
  };

  const schemaSkill: OpenApiSchema = {
    type: "object",
    title: "Skill",
    description: "Canonical special move (Hissatsu) or passive skill.",
    properties: {
      skillId: { type: "string", description: "Skill identifier" },
      name: { type: "string", description: "Localized skill name" },
      element: { type: "integer", description: "Element affinity" },
      tpCost: { type: "integer", description: "Tension point cost" },
      power: { type: "integer", description: "Base move power rating" },
      category: { type: "string", description: "Category (Shoot, Dribble, Block, Catch)" },
    },
    required: ["skillId", "name", "element", "tpCost", "power"],
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Inagle Universal Game Data & Reverse Engineering API",
      version: "2.0.5",
      description:
        "Authoritative OpenAPI 3.1 specification for Inazuma Eleven: Victory Road game data, VFS virtual file system, and nie.exe reverse-engineering services across Bun, Rust NIE crates, and C# IECODE.Core.",
      contact: {
        name: "Aphrody Code Team",
        url: "https://inagle.example.com",
        email: "contact@aphrody.com",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "https://inagle.example.com",
        description: "Production API",
      },
      {
        url: "http://localhost:3000",
        description: "Local Bun Development Server",
      },
    ],
    tags: [
      {
        name: "Characters",
        description: "Character catalog, base stats, growth curves, and variants",
      },
      { name: "Skills", description: "Special moves (Hissatsu), passives, and animations" },
      { name: "Teams", description: "Team formations, kits, tactics, and emblems" },
      { name: "Items", description: "Equipment, consumables, manuals, and spirits" },
      {
        name: "VFS",
        description: "Victory Road Virtual File System: CPK packs, @UTF schemas, and decompression",
      },
      {
        name: "Reverse Engineering",
        description: "Authoritative nie.exe offsets, RTTI classes, and cryptographic constants",
      },
      {
        name: "Saves",
        description: "Lives save container encryption, decryption, and payload parsing",
      },
      { name: "Wiki", description: "Structured SQL query endpoints and drop tables" },
    ],
    paths: {
      "/api/characters": {
        summary: "List characters",
        description: "Query characters with optional filtering by element, position, or name search.",
        get: {
          tags: ["Characters"],
          summary: "List characters",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 },
              description: "Max items to return",
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
              description: "Pagination offset",
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string" },
              description: "Name search filter",
            },
            {
              name: "element",
              in: "query",
              schema: { type: "integer" },
              description: "Element ID (1=Wind, 2=Wood, 3=Fire, 4=Earth)",
            },
            {
              name: "position",
              in: "query",
              schema: { type: "integer" },
              description: "Position ID (1=GK, 2=DF, 3=MF, 4=FW)",
            },
          ],
          responses: {
            "200": {
              description: "List of matching characters",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Character" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/characters/{id}": {
        summary: "Get character by ID",
        description: "Retrieves complete character profile including growth curve and skill tree.",
        get: {
          tags: ["Characters"],
          summary: "Get character by ID",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Character identifier (e.g. c01000010)",
            },
          ],
          responses: {
            "200": {
              description: "Character profile",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Character" },
                },
              },
            },
            "404": {
              description: "Character not found",
            },
          },
        },
      },
      "/api/skills": {
        summary: "List skills",
        get: {
          tags: ["Skills"],
          summary: "List skills",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "element", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "List of skills",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Skill" } },
                },
              },
            },
          },
        },
      },
      "/api/skills/{id}": {
        summary: "Get skill by ID",
        get: {
          tags: ["Skills"],
          summary: "Get skill by ID",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Skill details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Skill" } } },
            },
          },
        },
      },
      "/api/vfs/formats": {
        summary: "List recognized binary formats",
        description: "Returns all 28 binary formats recognized and parsed by IECODE and NIE.",
        get: {
          tags: ["VFS"],
          summary: "List supported binary formats",
          responses: {
            "200": {
              description: "List of format descriptors",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/VfsFormatDescriptor" },
                    example: VFS_FORMATS.slice(0, 3),
                  },
                },
              },
            },
          },
        },
      },
      "/api/vfs/probe": {
        summary: "Probe binary format by magic bytes",
        description: "Examines header bytes and returns the matching format descriptor if known.",
        post: {
          tags: ["VFS"],
          summary: "Probe binary format",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    magicHex: {
                      type: "string",
                      description: "Hexadecimal magic (e.g. '0x58543447')",
                    },
                    magicAscii: { type: "string", description: "ASCII magic header (e.g. 'G4TX')" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Identified format descriptor or null",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VfsFormatDescriptor" },
                },
              },
            },
          },
        },
      },
      "/api/vfs/packs": {
        summary: "List VFS pack rules",
        description: "Lists all CRI CPK pack routing rules, priority orders, and decryption mechanisms.",
        get: {
          tags: ["VFS"],
          summary: "List pack rules",
          responses: {
            "200": {
              description: "List of pack mapping rules",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/VfsPackRule" },
                    example: VFS_PACK_RULES,
                  },
                },
              },
            },
          },
        },
      },
      "/api/vfs/files/{path}": {
        summary: "Read file from VFS",
        description: "Fetches a file by logical path, resolving through mounted CPKs or loose dump overlays.",
        get: {
          tags: ["VFS"],
          summary: "Read VFS file",
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Logical file path (e.g. data/common/chara/chara_base.cfg.bin)",
            },
          ],
          responses: {
            "200": {
              description: "File payload stream",
              content: {
                "application/octet-stream": {},
              },
            },
            "404": { description: "File not found in any mounted VFS source" },
          },
        },
      },
      "/api/nie/re/constants": {
        summary: "Get nie.exe cryptographic constants",
        description: "Returns verified cryptographic keys and polynomials reverse-engineered from nie.exe.",
        get: {
          tags: ["Reverse Engineering"],
          summary: "Get crypto constants",
          responses: {
            "200": {
              description: "List of verified cryptographic constants",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/NieCryptoConstant" },
                    example: NIE_CRYPTO_CONSTANTS,
                  },
                },
              },
            },
          },
        },
      },
      "/api/nie/re/offsets": {
        summary: "Get critical function offsets in nie.exe",
        description: "Returns disassembler anchors, function boundary addresses, and signatures in nie.exe.",
        get: {
          tags: ["Reverse Engineering"],
          summary: "Get function offsets",
          responses: {
            "200": {
              description: "List of critical function offsets",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/NieMemoryOffset" },
                    example: NIE_CRITICAL_OFFSETS,
                  },
                },
              },
            },
          },
        },
      },
      "/api/nie/re/rtti": {
        summary: "Get reconstructed RTTI hierarchy",
        description: "Returns MSVC RTTI polymorphic classes and vtable offsets identified in nie.exe.",
        get: {
          tags: ["Reverse Engineering"],
          summary: "Get RTTI classes",
          responses: {
            "200": {
              description: "List of reconstructed RTTI classes",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/NieRttiClass" },
                    example: NIE_RTTI_CLASSES,
                  },
                },
              },
            },
          },
        },
      },
      "/api/saves/decrypt": {
        summary: "Decrypt Lives save file",
        description: "Decrypts a Level-5 Lives save container (002AB8F4-*) using CRC32 filename stream cipher.",
        post: {
          tags: ["Saves"],
          summary: "Decrypt save container",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    filename: {
                      type: "string",
                      description: "Save container filename (e.g. 002AB8F4-USERDATALIVE)",
                    },
                    payloadBase64: {
                      type: "string",
                      description: "Base64-encoded encrypted file content",
                    },
                  },
                  required: ["filename", "payloadBase64"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Decrypted payload and extracted EEFF blobs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      magic: { type: "string" },
                      blobCount: { type: "integer" },
                      unpackedBytesBase64: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Character: schemaCharacter,
        Skill: schemaSkill,
        VfsFormatDescriptor: schemaVfsFormat,
        VfsPackRule: schemaVfsPack,
        NieCryptoConstant: schemaCryptoConstant,
        NieMemoryOffset: schemaMemoryOffset,
        NieRttiClass: schemaRttiClass,
      },
    },
  };
}

/**
 * Serializes the OpenAPI specification to a formatted JSON string.
 */
export function generateOpenApiJson(pretty = true): string {
  const spec = generateOpenApiSpec();
  return JSON.stringify(spec, (_key, value) => (typeof value === "bigint" ? value.toString() : value), pretty ? 2 : 0);
}

/**
 * Serializes an arbitrary JavaScript object or primitive into clean YAML 1.2.
 */
export function toYaml(value: unknown, indentLevel = 0): string {
  const indent = "  ".repeat(indentLevel);

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    if (value.includes("\n")) {
      const lines = value
        .split("\n")
        .map(l => `${indent}  ${l}`)
        .join("\n");
      return `|\n${lines}`;
    }
    // Quote strings containing YAML special characters, or numeric strings
    if (
      /[:#[\]{},&*?|<>=!%@`-]/.test(value) ||
      value === "" ||
      !isNaN(Number(value)) ||
      value === "true" ||
      value === "false" ||
      value === "null"
    ) {
      return JSON.stringify(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map(item => {
        if (typeof item === "object" && item !== null) {
          const itemYaml = toYaml(item, indentLevel + 1);
          const lines = itemYaml.split("\n");
          return `${indent}- ${lines[0].trimStart()}\n${lines.slice(1).join("\n")}`;
        }
        return `${indent}- ${toYaml(item, indentLevel + 1)}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, val]) => {
        if (typeof val === "object" && val !== null) {
          if (Array.isArray(val) && val.length === 0) {
            return `${indent}${key}: []`;
          }
          if (!Array.isArray(val) && Object.keys(val).length === 0) {
            return `${indent}${key}: {}`;
          }
          return `${indent}${key}:\n${toYaml(val, indentLevel + 1)}`;
        }
        return `${indent}${key}: ${toYaml(val, indentLevel)}`;
      })
      .join("\n");
  }

  return String(value);
}

/**
 * Serializes the OpenAPI specification to a formatted YAML string.
 */
export function generateOpenApiYaml(): string {
  const spec = generateOpenApiSpec();
  return toYaml(spec);
}
