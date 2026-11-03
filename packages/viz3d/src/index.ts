// SPDX-License-Identifier: MIT
// @aphrody/viz3d: 3Dviz Pro Max on Bun OS. Library surface of the CLI (src/cli.ts) and the MCP tools (m3-mcp).
export { type Catalog, type CatalogRecord, catalogHashes, fieldText, fingerprint, loadCatalog } from "./catalog.ts";
export { COLLECTIONS, KNOWLEDGE_KINDS, validateManifest } from "./manifest-contract.ts";
export { search, type SearchHit, type SearchResult } from "./search.ts";
export { blueprintUsage, resolveRecords } from "./resolve.ts";
export { blueprintsFor, gather, LOOK_KINDS } from "./design-context.ts";
export { buildBrief, DELIVERY, loadHost, recommend, tierView, TIER_ORDER } from "./quality-brief.ts";
export { findBlender as locateBlender } from "./blender.ts";
export { probe as probeHost } from "./host-probe.ts";
export { heroTier } from "./hero-tier.ts";
export { capture, type CaptureArgs, parseCaptureArgs } from "./capture.ts";
export { kitPage, kitUrl, serve, THREE_VERSION } from "./server.ts";
export { validateDataset } from "./validate.ts";
export { classify, THRESHOLDS } from "./view-quality.ts";
export { skillRoot, studiesDir } from "./paths.ts";
export { run } from "./cli.ts";
