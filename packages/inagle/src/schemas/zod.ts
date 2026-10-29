/**
 * Zod Schemas for @aphrody/inagle
 *
 * Schema definitions for runtime validation and TypeScript inference.
 */

import { z } from "zod";

// ============================================================================
// Base Types
// ============================================================================

/** Hex ID pattern (e.g., "0x63BDA8A4") */
export const HexId = z
  .string()
  .regex(/^0x[0-9A-Fa-f]+$/)
  .describe('Hexadecimal identifier (e.g., "0x63BDA8A4")');

/** String ID pattern (e.g., "whs00010", "c01000010") */
export const StringId = z
  .string()
  .regex(/^[a-z]{1,3}\d+$/)
  .describe('String identifier (e.g., "whs00010", "c01000010")');

// ============================================================================
// Skill Schemas
// ============================================================================

/** Skill element types (Zod schema) */
export const SkillElementSchema = z.number().int().min(1).max(4).describe("1=Wind, 2=Wood, 3=Fire, 4=Mountain");

/** Skill category types (Zod schema) */
export const SkillCategorySchema = z.number().int().min(1).max(4).describe("1=Shot, 2=Dribble, 3=Block, 4=Catch");

/** Skill info schema */
export const SkillInfoSchema = z
  .object({
    skillID: HexId,
    skillIDStr: z.string(),
    eventID: HexId,
    eventIDName: z.string(),
    failEventID: HexId,
    failEventIDName: z.string(),
    skillNameId: HexId,
    skillDescId: HexId,
    cmdOptIdx: z.number().int().min(0).max(3),
    skillEffectBitFlag: z.number().int(),
    power_min: z.number().int(),
    power_max: z.number().int(),
    element: SkillElementSchema,
    colorIdx: z.number().int().min(1).max(4),
    category: SkillCategorySchema,
    growthType: z.number().int().min(1).max(6),
    foulRate: z.number(),
    consumeTp: z.number().int(),
    focusBattleEffectId: z.string(),
    recastTime: z.number(),
    partnerType: z.number().int(),
    partner1: HexId,
    partner2: HexId,
    partner3: HexId,
    telopInfoId: HexId,
    eldorado: z.boolean(),
  })
  .describe("Complete skill definition from skill_config");

export type ZodSkillInfo = z.infer<typeof SkillInfoSchema>;

/** Enriched skill with localized names */
export const EnrichedSkillSchema = z
  .object({
    skillID: z.string(),
    skillIDStr: z.string(),
    displayName: z.string(),
    name_FR: z.string().optional(),
    name_EN: z.string().optional(),
    name_JA: z.string().optional(),
    description_FR: z.string().optional(),
    description_EN: z.string().optional(),
    element: z.number().int().optional(),
    elementName: z.string().optional(),
    category: z.number().int().optional(),
    categoryName: z.string().optional(),
    power_min: z.number().int().optional(),
    power_max: z.number().int().optional(),
    consumeTp: z.number().int().optional(),
    isCombo: z.boolean().optional(),
  })
  .describe("Skill with localized names and computed properties");

export type ZodEnrichedSkill = z.infer<typeof EnrichedSkillSchema>;

// ============================================================================
// Character Schemas
// ============================================================================

/** Character rarity levels */
export const CharacterRarity = z
  .number()
  .int()
  .describe("0=Normal, 1=En progression, 2=Expérimenté, 3=Émérite, 4-7=Légendaire, 10=Héros, 20=BASARA");

/** Personality types (Zod schema) */
export const PersonalityTypeSchema = z
  .number()
  .int()
  .min(0)
  .max(11)
  .describe(
    "0=Unknown, 1=Gentle, 2=Cool, 3=Hot, 4=Shy, 5=Mature, 6=Cheerful, 7=Serious, 8=Wild, 9=Mysterious, 10=Elegant, 11=Mischievous",
  );

/** Enriched character schema */
export const EnrichedCharacterSchema = z
  .object({
    charaId: z.string(),
    charaIdStr: z.string().optional(),
    charaParamId: z.string().optional(),
    nameHash: z.string().optional(),
    displayName: z.string(),
    name_FR: z.string().optional(),
    name_EN: z.string().optional(),
    name_JA: z.string().optional(),
    rubyName_FR: z.string().optional(),
    rarity: z.number().int().optional(),
    rarityName: z.string().optional(),
    isRemarkable: z.boolean().optional(),
    personalityType: z.number().int().optional(),
    personalityName: z
      .object({
        en: z.string(),
        ja: z.string(),
        fr: z.string(),
      })
      .optional(),
    _sources: z.array(z.string()).optional(),
  })
  .describe("Character with all available data merged from multiple sources");

export type EnrichedCharacter = z.infer<typeof EnrichedCharacterSchema>;

// ============================================================================
// BASARA Schemas
// ============================================================================

/** BASARA (Fabled) character schema */
export const BasaraSchema = z
  .object({
    charaParamId: z.string(),
    charaIdStr: z.string(),
    displayName: z.string(),
    names: z.object({
      fr: z.string().optional(),
      en: z.string().optional(),
      ja: z.string().optional(),
    }),
    rarity: z.number().int(),
    rarityName: z.string(),
    isRemarkable: z.boolean(),
    baseStats: z
      .object({
        kick: z.number().int(),
        body: z.number().int(),
        control: z.number().int(),
        guard: z.number().int(),
        speed: z.number().int(),
        stamina: z.number().int(),
        guts: z.number().int(),
        total: z.number().int(),
      })
      .optional(),
  })
  .describe("BASARA Character");

export type Basara = z.infer<typeof BasaraSchema>;

// ============================================================================
// API Request/Response Schemas
// ============================================================================

/** Pagination query params */
export const PaginationQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .describe("Standard pagination parameters");

export type PaginationQueryType = z.infer<typeof PaginationQuery>;

/** Search query params */
export const SearchQuery = z
  .object({
    q: z.string().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    lang: z.enum(["fr", "en", "ja"]).optional(),
  })
  .describe("Search query parameters");

export type SearchQueryType = z.infer<typeof SearchQuery>;

/** Character ID param */
export const CharacterIdParam = z
  .object({
    id: z.string().min(1),
  })
  .describe("Character ID path parameter");

/** Skill ID param */
export const SkillIdParam = z
  .object({
    id: z.string().min(1),
  })
  .describe("Skill ID path parameter");

/** Paginated list response */
export const PaginatedResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    data: z.array(itemSchema),
  });

/** Search result response */
export const SearchResultSchema = z.object({
  score: z.number(),
});

export const SearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int(),
  data: z.array(
    z
      .object({
        score: z.number(),
      })
      .passthrough(),
  ),
});

/** Error response */
export const ErrorResponse = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  })
  .describe("Standard error response");

export type ErrorResponseType = z.infer<typeof ErrorResponse>;

// ============================================================================
// OpenAPI Generation
// ============================================================================

/** Global schema registry for OpenAPI generation - Stub for now */
export const schemaRegistry = {};

/**
 * Generate JSON Schema from Zod schema
 */
export function toJSONSchema<T extends z.ZodType>(schema: T) {
  return (z as any).toJSONSchema?.(schema, { target: "draft-7" }) ?? {};
}

/**
 * Pretty print Zod errors for API responses
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
}
