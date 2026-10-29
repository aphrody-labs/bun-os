/**
 * @file types.ts
 * @description Types and schemas for @aphrody/inagle/docs.
 * Covers OpenAPI 3.1.0 specifications, VFS architecture catalog,
 * nie.exe reverse engineering mappings, and Answer.AI llms.txt models.
 */

// ============================================================================
// 1. OpenAPI 3.1.0 Models
// ============================================================================

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
  contact?: {
    name?: string;
    url?: string;
    email?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenApiServer {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; description?: string; enum?: string[] }>;
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: OpenApiSchema;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, { summary?: string; value: unknown }>;
}

export interface OpenApiRequestBody {
  description?: string;
  content: Record<string, OpenApiMediaType>;
  required?: boolean;
}

export interface OpenApiResponse {
  description: string;
  headers?: Record<string, { description?: string; schema: OpenApiSchema }>;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  deprecated?: boolean;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  delete?: OpenApiOperation;
  options?: OpenApiOperation;
  head?: OpenApiOperation;
  patch?: OpenApiOperation;
  trace?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

export interface OpenApiSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  $ref?: string;
  example?: unknown;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    responses?: Record<string, OpenApiResponse>;
    parameters?: Record<string, OpenApiParameter>;
    securitySchemes?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

// ============================================================================
// 2. VFS (Virtual File System) Architecture Models
// ============================================================================

export type VfsStorageMode = "cpk-pack" | "loose-file" | "remote-stream" | "sqlite-mirror";

export interface VfsFormatDescriptor {
  id: number;
  magicHex: string;
  magicAscii: string;
  extension: string;
  description: string;
  isBigEndian: boolean;
  category: "texture" | "model" | "config" | "audio" | "video" | "container" | "script" | "system";
  encryptionSupported: boolean;
  compressionSupported: boolean;
}

export interface VfsPackRule {
  packName: string;
  filenameMask: string;
  keyDerivation: "filename-crc32" | "viola-fixed" | "none";
  mountPriority: number;
  description: string;
  isCompressed: boolean;
}

export interface VfsDirectoryCategory {
  path: string;
  primaryExtension: string;
  fileCountEstimate: number;
  sampleFiles: string[];
  description: string;
}

export interface VfsCatalog {
  version: string;
  authoritativeEngine: "aphrody-nie-formats" | "IECODE.Core.CriFs";
  totalKnownPacks: number;
  defaultSectorSize: number;
  utfTableOffset: number;
  supportedFormats: VfsFormatDescriptor[];
  packRules: VfsPackRule[];
  directories: VfsDirectoryCategory[];
}

// ============================================================================
// 3. nie.exe Reverse Engineering Models
// ============================================================================

export interface NieMemoryOffset {
  symbol: string;
  addressHex: string;
  runtimePc: bigint;
  subsystem: "game-loop" | "controller" | "render" | "vfs" | "audio" | "crypto" | "prng" | "lua";
  description: string;
  callingConvention?: string;
  signature?: string;
}

export interface NieRttiClass {
  name: string;
  namespace: string;
  vtableOffsetHex: string;
  baseClasses: string[];
  description: string;
}

export interface NieCryptoConstant {
  name: string;
  hexValue: string;
  intValue: number | bigint;
  usage: string;
  verifiedInGameDump: boolean;
}

export interface NieReMap {
  targetBinary: "nie.exe";
  internalName: "nie1v2.exe";
  architecture: "x86_64";
  format: "PE32+";
  baseAddressHex: string;
  totalFunctionsCount: number;
  cryptoConstants: NieCryptoConstant[];
  criticalOffsets: NieMemoryOffset[];
  rttiClasses: NieRttiClass[];
  memoryStructures: Record<string, { sizeHex: string; description: string; fields: Record<string, string> }>;
}

// ============================================================================
// 4. LLM / AI-Optimized Documentation Models
// ============================================================================

export interface LlmDocSection {
  title: string;
  url: string;
  summary: string;
  tokensEstimate: number;
  keyConcepts: string[];
}

export interface LlmIndexDocument {
  projectName: string;
  description: string;
  version: string;
  updatedAt: string;
  sections: Record<string, LlmDocSection[]>;
  quickstartPrompt: string;
}
