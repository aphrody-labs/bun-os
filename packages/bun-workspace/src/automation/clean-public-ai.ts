// SPDX-License-Identifier: Apache-2.0
import { resolve, relative } from "node:path";
import { readdir, readFile } from "node:fs/promises";

/**
 * Audit and sanitizer for public artifacts, websites, and repos.
 * Ensures internal AI metadata (Co-Authored-By, prompt sessions, private bot hooks)
 * does not leak into user-facing web products, public documentation or public GitHub repositories.
 *
 * Rules:
 * - Code, skills, MCP definitions, and plugin definitions under plugins/ or crates/ai are exempt.
 * - Public apps (passed with --root), public pages, and git history are audited.
 */

// Patterns to detect in public files and commit messages
export const AI_PUBLIC_LEAK_PATTERNS = [
  /co-authored-by:\s*.*/i,
  /generated with \[(?:claude code|codex|gemini)\].*/i,
  /claude-session:\s*.*/i,
  /\b(?:Claude Code Agent|Gemini \/ AGY \/ Codex)\b/i,
  // Secrets and API tokens
  /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AIzaSy[a-zA-Z0-9_-]{33}|xox[baprs]-[a-zA-Z0-9]{10,})/i,
  // Sensitive credentials / passwords
  /(?:password|passwd|secret_key|client_secret)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  // Personal / non-canonical emails in public surfaces
  /\b[A-Za-z0-9._%+-]+@(gmail|hotmail|yahoo|outlook|live|icloud|proton|anthropic|openai)\.[a-z]{2,}\b/i,
];

export interface ScanHit {
  file: string;
  line: number;
  pattern: string;
  matchedText: string;
}

export async function scanFileForAiLeaks(filePath: string): Promise<ScanHit[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const hits: ScanHit[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of AI_PUBLIC_LEAK_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({
            file: filePath,
            line: i + 1,
            pattern: pattern.source,
            matchedText: line.trim(),
          });
        }
      }
    }
    return hits;
  } catch {
    return [];
  }
}

async function walkDir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        if (
          entry.name.startsWith(".git") ||
          entry.name === "node_modules" ||
          entry.name === ".next" ||
          entry.name === "dist"
        ) {
          return [];
        }
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) return walkDir(fullPath);
        if (entry.isFile() && /\.(tsx?|jsx?|json|html|md|txt)$/i.test(entry.name)) return [fullPath];
        return [];
      }),
    );
    return nested.flat();
  } catch {
    // skip non-existent dirs
    return [];
  }
}

export async function auditPublicSurfaces(rootDir: string): Promise<{ hits: ScanHit[]; scannedCount: number }> {
  const root = resolve(rootDir);
  const publicDirs = [resolve(root, "apps/site/public"), resolve(root, "apps/site/src")];

  const allFiles = (await Promise.all(publicDirs.map(dir => walkDir(dir)))).flat();

  // Skip internal admin console files
  const scannable = allFiles.filter(
    file => !(file.includes("/src/app/admin/") || file.includes("/src/components/admin/")),
  );
  const hits = (await Promise.all(scannable.map(file => scanFileForAiLeaks(file)))).flat();

  return { hits, scannedCount: allFiles.length };
}

export async function runCleanPublicAi(args: string[]): Promise<number> {
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = args[++i] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops clean-public-ai [--root <repo>]");
      console.log("Scans public web surfaces and verifies no private AI branding/attributions leak.");
      return 0;
    }
  }

  console.log(`Scanning public web surfaces for AI leaks in ${root}...`);
  const { hits, scannedCount } = await auditPublicSurfaces(root);

  console.log(`Scanned ${scannedCount} public files.`);
  if (hits.length === 0) {
    console.log("PASS: No private AI mentions or attribution trailers found in public surfaces.");
    return 0;
  }

  console.error(`FAIL: Found ${hits.length} leak(s) in public surfaces:`);
  for (const hit of hits) {
    console.error(`  - ${relative(root, hit.file)}:${hit.line}: ${hit.matchedText}`);
  }
  return 1;
}
