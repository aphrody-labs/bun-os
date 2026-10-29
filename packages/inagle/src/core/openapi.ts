/**
 * OpenAPI 3.1.0 Specification Generator
 *
 * Generates OpenAPI spec from Zod 4 schemas automatically.
 * This provides accurate, always-in-sync API documentation.
 *
 * @example
 * ```typescript
 * import { generateOpenAPI } from '@aphrody/inagle/openapi'
 *
 * const spec = generateOpenAPI({ characters, skills })
 * // Serve at /openapi.json
 * ```
 */

import type { z } from "zod";
import {
  BasaraSchema,
  EnrichedCharacterSchema,
  EnrichedSkillSchema,
  ErrorResponse,
  PaginationQuery,
  SearchQuery,
  toJSONSchema,
} from "../schemas/zod.js";

// ============================================================================
// Types
// ============================================================================

interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; url?: string };
}

interface OpenAPIServer {
  url: string;
  description?: string;
}

interface OpenAPIConfig {
  info?: Partial<OpenAPIInfo>;
  servers?: OpenAPIServer[];
  stats?: {
    characters?: number;
    skills?: number;
    basara?: number;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_INFO: OpenAPIInfo = {
  title: "IEVR Game Data API",
  version: "0.3.0",
  description: `
Universal REST API for Inazuma Eleven: Victory Road game data.

## Features
- 🔍 Fuzzy search with typo tolerance
- 📖 Paginated listings
- 🌐 Multilingual (FR/EN/JA)
- ⚡ Zod 4 validated requests
- 🎮 11,587 characters, 2,458 skills

## Authentication
No authentication required for read operations.
`.trim(),
  contact: { name: "Azalee" },
  license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
};

const DEFAULT_SERVERS: OpenAPIServer[] = [{ url: "http://localhost:3000", description: "Local development" }];

// ============================================================================
// Schema Converters
// ============================================================================

/**
 * Convert Zod schema to OpenAPI parameter
 */
function zodToParameter(
  name: string,
  schema: z.ZodType,
  location: "query" | "path" | "header",
  required = false,
): object {
  const jsonSchema = toJSONSchema(schema);
  return {
    name,
    in: location,
    required,
    schema: jsonSchema,
  };
}

/**
 * Generate parameters from Zod object schema
 */
function objectToParameters(schema: z.ZodObject<z.ZodRawShape>, location: "query" | "path"): object[] {
  const shape = schema.shape;
  const params: object[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodSchema = value as z.ZodType;
    const isOptional = zodSchema.isOptional();
    params.push(zodToParameter(key, zodSchema, location, !isOptional));
  }

  return params;
}

// ============================================================================
// OpenAPI Spec Generator
// ============================================================================

/**
 * Generate complete OpenAPI 3.1.0 specification
 */
export function generateOpenAPI(config: OpenAPIConfig = {}): object {
  const info = { ...DEFAULT_INFO, ...config.info };
  const servers = config.servers ?? DEFAULT_SERVERS;
  const stats = config.stats ?? {};

  return {
    openapi: "3.1.0",
    info,
    servers,
    tags: [
      {
        name: "Meta",
        description: "API metadata and health endpoints",
      },
      {
        name: "Characters",
        description: `Game characters (${stats.characters ?? "11,587"} total)`,
      },
      {
        name: "Skills",
        description: `Special moves and techniques (${stats.skills ?? "2,458"} total)`,
      },
      {
        name: "BASARA",
        description: `Fabled rarity characters (${stats.basara ?? "~50"} total)`,
      },
    ],
    paths: {
      "/": {
        get: {
          operationId: "getApiInfo",
          summary: "API information and statistics",
          tags: ["Meta"],
          responses: {
            "200": {
              description: "API info with current data stats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string", example: "@aphrody/inagle" },
                      version: { type: "string", example: "0.3.0" },
                      stats: {
                        type: "object",
                        properties: {
                          characters: { type: "integer" },
                          skills: { type: "integer" },
                          basara: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/characters": {
        get: {
          operationId: "listCharacters",
          summary: "List all characters with pagination",
          tags: ["Characters"],
          parameters: objectToParameters(PaginationQuery, "query"),
          responses: {
            "200": {
              description: "Paginated list of characters",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: {
                        type: "integer",
                        description: "Total character count",
                      },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      data: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/EnrichedCharacter",
                        },
                      },
                    },
                  },
                },
              },
            },
            "503": {
              description: "Characters not loaded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },

      "/characters/search": {
        get: {
          operationId: "searchCharacters",
          summary: "Search characters by name",
          description: "Fuzzy search across FR/EN/JA character names with typo tolerance",
          tags: ["Characters"],
          parameters: objectToParameters(SearchQuery, "query"),
          responses: {
            "200": {
              description: "Search results with relevance scores",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      count: { type: "integer" },
                      lang: { type: "string", enum: ["fr", "en", "ja", "all"] },
                      data: {
                        type: "array",
                        items: {
                          allOf: [
                            { $ref: "#/components/schemas/EnrichedCharacter" },
                            {
                              type: "object",
                              properties: { score: { type: "number" } },
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/characters/{id}": {
        get: {
          operationId: "getCharacter",
          summary: "Get character by ID",
          tags: ["Characters"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Character ID (hex or string)",
              schema: { type: "string" },
              examples: {
                hex: { value: "0x63BDA8A4", summary: "Hex ID" },
                string: { value: "c01000010", summary: "String ID" },
              },
            },
          ],
          responses: {
            "200": {
              description: "Character details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/EnrichedCharacter" },
                    },
                  },
                },
              },
            },
            "404": {
              description: "Character not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },

      "/skills": {
        get: {
          operationId: "listSkills",
          summary: "List all skills with pagination",
          tags: ["Skills"],
          parameters: objectToParameters(PaginationQuery, "query"),
          responses: {
            "200": {
              description: "Paginated list of skills",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/EnrichedSkill" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/skills/search": {
        get: {
          operationId: "searchSkills",
          summary: "Search skills by name",
          tags: ["Skills"],
          parameters: objectToParameters(SearchQuery, "query"),
          responses: {
            "200": {
              description: "Search results with scores",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      count: { type: "integer" },
                      data: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/skills/{id}": {
        get: {
          operationId: "getSkill",
          summary: "Get skill by ID",
          tags: ["Skills"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Skill details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/EnrichedSkill" },
                    },
                  },
                },
              },
            },
            "404": { description: "Skill not found" },
          },
        },
      },

      "/basara": {
        get: {
          operationId: "listBasara",
          summary: "List BASARA (Fabled) characters",
          tags: ["BASARA"],
          parameters: objectToParameters(PaginationQuery, "query"),
          responses: {
            "200": {
              description: "Paginated BASARA list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Basara" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/basara/search": {
        get: {
          operationId: "searchBasara",
          summary: "Search BASARA characters",
          tags: ["BASARA"],
          parameters: objectToParameters(SearchQuery, "query"),
          responses: {
            "200": { description: "Search results" },
          },
        },
      },
    },

    components: {
      schemas: {
        EnrichedCharacter: toJSONSchema(EnrichedCharacterSchema),
        EnrichedSkill: toJSONSchema(EnrichedSkillSchema),
        Basara: toJSONSchema(BasaraSchema),
        Error: toJSONSchema(ErrorResponse),
      },
    },
  };
}

/**
 * Generate OpenAPI YAML string (requires js-yaml)
 */
export function generateOpenAPIYAML(config: OpenAPIConfig = {}): string {
  const spec = generateOpenAPI(config);
  // Simple YAML serialization for basic cases
  return JSON.stringify(spec, null, 2).replace(/^/gm, "");
}

export type { OpenAPIConfig, OpenAPIInfo, OpenAPIServer };
