/**
 * Schema exports for @aphrody/inagle
 *
 * All schemas are based on actual CFG.BIN JSON structures from IEVR dump:
 * - dump/data/common/gamedata/ (13924 JSON files)
 * - dump/data/common/text/ (6090 JSON files)
 *
 * Total: 20040 JSON files analyzed
 */

// Core CFG.BIN formats
export * from "./cfgbin.js";
// Domain-specific schemas
export * from "./character.js";
export * from "./skill.js";
export * from "./soccer.js";
// Localized text structures
export * from "./text.js";

// Zod 4 schemas (runtime validation + TypeScript inference)
export * from "./zod.js";
