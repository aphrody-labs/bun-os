#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Regenerate the root dotenv key catalogue without emitting private values. */
import { Glob } from "bun";
import { join, relative } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

const root = findWorkspaceRoot();
const keys = new Set<string>();
const sourceGlob = new Glob("**/*.{rs,ts,tsx,js,jsx,sh,nu,ps1,py}");
const dotenvGlob = new Glob("**/*.env.example");
const ignored = new Set([
  "node_modules",
  "target",
  ".next",
  "dist",
  "upstream",
  "third_party",
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "generated",
  "data",
  "public",
  "docs",
  ".venv",
  "var",
  "vendor",
  "forks",
]);
const envAccess = /(?:process\.env|Bun\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g;
const rustEnvAccess = /(?:std::env|env)::(?:var|var_os|remove_var)\s*\(\s*"([A-Z][A-Z0-9_]*)"/g;
const compileEnvAccess = /\benv!\s*\(\s*"([A-Z][A-Z0-9_]*)"/g;
const mapEnvAccess = /\benv\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;
const rustEnvConstant = /\b(?:const|static)\s+[A-Z][A-Z0-9_]*(?:ENV|_ENV)[A-Z0-9_]*\s*:[^=;]+?=\s*"([A-Z][A-Z0-9_]*)"/g;
const clapEnvAttribute = /\benv\s*=\s*"([A-Z][A-Z0-9_]*)"/g;
const pythonEnvAccess = /\b(?:os\.environ(?:\.get)?|os\.getenv|environ\.get)\s*[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g;
const dotenvKey = /^\s*#?\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm;

function ignoredPath(path: string): boolean {
  return path.split(/[\\/]/).some(part => ignored.has(part));
}

function addMatches(text: string, pattern: RegExp): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) keys.add(match[1]!);
}

for (const sourceRoot of ["apps", "crates", "packages", "scripts", "config", "m3", "py"]) {
  for await (const path of sourceGlob.scan({
    cwd: join(root, sourceRoot),
    onlyFiles: true,
    dot: true,
  })) {
    if (ignoredPath(path) || path.includes(".test.") || path.endsWith("_test.rs")) continue;
    const rel = relative(root, join(root, sourceRoot, path)).replaceAll("\\", "/");
    if (rel.startsWith("scripts/aphrody/build/")) continue;
    const text = await Bun.file(join(root, sourceRoot, path)).text();
    for (const pattern of [
      envAccess,
      rustEnvAccess,
      compileEnvAccess,
      mapEnvAccess,
      rustEnvConstant,
      clapEnvAttribute,
      pythonEnvAccess,
    ]) {
      addMatches(text, pattern);
    }
  }
}

// Maintained app examples only; ignored trees hold private host state. The root .env.example (this
// script's output) is read below, keeping only names a tracked first-party file still mentions.
for (const exampleRoot of ["apps", "crates", "packages", "scripts", "config", "m3", "py"]) {
  for await (const path of dotenvGlob.scan({
    cwd: join(root, exampleRoot),
    onlyFiles: true,
    dot: true,
  })) {
    if (ignoredPath(path)) continue;
    addMatches(await Bun.file(join(root, exampleRoot, path)).text(), dotenvKey);
  }
}

// Names read through computed lookups or declared by host contracts (systemd units, secrets and
// service catalogues) are not statically discoverable above. A name already catalogued survives while
// a tracked first-party file outside the docs still mentions it, so retired products drop out.
const mentioned = new Set<string>();
const tracked = (await Bun.$`git ls-files -z -- apps crates packages scripts config m3 py`.cwd(root).quiet().text())
  .split("\0")
  .filter(
    path =>
      path &&
      !/\.(md|mdx|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|wasm|gz|zip|lock)$/i.test(path) &&
      !/(^|\/)docs\//.test(path),
  );
for (const path of tracked) {
  const file = Bun.file(join(root, path));
  if (file.size > 4_000_000) continue;
  for (const match of (await file.text()).matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) mentioned.add(match[0]);
}
const previous = Bun.file(join(root, ".env.example"));
if (await previous.exists()) {
  for (const match of (await previous.text()).matchAll(dotenvKey)) if (mentioned.has(match[1]!)) keys.add(match[1]!);
}

const notUserConfiguration = new Set([
  "FOO",
  "X",
  "Y",
  "QUOTED",
  "APHRODY_A2A_TEST_ENV_VAR",
  "CARGO_MANIFEST_DIR",
  "CARGO_PKG_VERSION",
  "CARGO_PKG_VERSION_MAJOR",
  "CARGO_PKG_VERSION_MINOR",
  "CARGO_CFG_TARGET_ARCH",
  "CARGO_CFG_TARGET_ENV",
  "CARGO_CFG_TARGET_OS",
  "OUT_DIR",
  "TARGET",
  "TARGET_TRIPLE",
  "DOCS_RS",
  "NOTIFY_SOCKET",
  "WATCHDOG_USEC",
]);
for (const key of keys) {
  if (notUserConfiguration.has(key) || key.startsWith("CARGO_FEATURE_") || key.startsWith("NEXT_PRIVATE_")) {
    keys.delete(key);
  }
}

const sections: [string, (key: string) => boolean][] = [
  [
    "Aphrody paths and agent profile",
    key =>
      /^(APHRODY_HOME|APHRODY_ROOT|APHRODY_AGENT_|APHRODY_WORKSPACE|APHRODY_PROFILE|APHRODY_SOURCE_ROOT|APHRODY_PY_ROOT|APHRODY_IECODE_ROOT|IECODE_|NIE_)/.test(
        key,
      ),
  ],
  ["Rust and Bun toolchain", key => /^(CARGO_|RUST|BUN_|N2B_|NAPI_|TURBO_|NODE_|NPM_)/.test(key)],
  [
    "Google Cloud and AI providers",
    key => /^(GOOGLE_|GEMINI_|ANTHROPIC_|OPENAI_|XAI_|OLLAMA_|HF_|AWS_|CLOUDFLARE_|ELEVENLABS_|MEM0_)/.test(key),
  ],
  [
    "Databases, storage and services",
    key => /DATABASE|POSTGRES|SUPABASE|REDIS|SQLITE|STORAGE|CDN|RAG_DB|KNOWLEDGE_DB/.test(key),
  ],
  [
    "Game data",
    key => /^(ACHILLEA_|AZALEE_|INAGLE_|GAME_|DATA_|JA_DATA_|FR_TITLES|CROSS_CATALOG|CFGBIN_|IEVR_|STEAM_)/.test(key),
  ],
  [
    "Discord and notifications",
    key => /^(DISCORD_|GUILD_|OWNER_|BOT_|CRON_|MAIL_|SMTP_|RESEND_|TELEGRAM_|MATRIX_|SLACK_)/.test(key),
  ],
  [
    "Web, identity and payments",
    key =>
      /^(NEXT_|VITE_|AUTH_|BETTER_AUTH_|STRIPE_|PATREON_|TWITCH_|VAPID_|GOOGLE_CLIENT|GOOGLE_OAUTH|GOOGLE_PRIVATE|GOOGLE_SERVICE|GOOGLE_CALENDAR|GOOGLE_EVENTS|GOOGLE_RGTV|GITHUB_|GH_|VERCEL_|CLOUDFLARE_)/.test(
        key,
      ),
  ],
  [
    "Browser, system and rendering",
    key =>
      /^(OBSCURA_|APHRODY_WEB_|APHRODY_BROWSER_|CHROME_|AGENT_BROWSER_|FFMPEG_|CUDA_|HIP_|VULKAN_|AMD|BLAS_|OPENBLAS_|WINE|WINCLEAN_|SD_|SPACEDRIVE_)/.test(
        key,
      ),
  ],
];

const output = [
  "# Aphrody monorepo environment reference. Generated from statically discoverable first-party reads",
  "# and maintained .env.example files. Dynamic lookups and build tools may need manual additions.",
  "# All entries are commented: uncomment only the keys required by the app you run.",
  "# Bun/Next load app .env files; Rust reads the process environment and does not parse dotenv.",
  "# Keep credentials in ignored local files or a secret manager. Never paste secrets here.",
  "",
  "# Master variable catalogue; app-specific examples remain the source of their service defaults.",
];
const remaining = new Set(keys);
for (const [title, matches] of sections) {
  const group = [...remaining].filter(matches).toSorted();
  if (!group.length) continue;
  output.push("", `## ${title}`, ...group.map(key => `# ${key}=`));
  for (const key of group) remaining.delete(key);
}
if (remaining.size)
  output.push("", "## Other first-party variables", ...[...remaining].toSorted().map(key => `# ${key}=`));

const target = join(root, ".env.example");
await Bun.write(target, `${output.join("\n")}\n`);
console.log(`Wrote ${target} with ${keys.size} variable names; private values were not emitted.`);
