// @ts-nocheck: verbatim fork source (aphrody-labs/bun src/js, 62fcdb38ec9), written for the engine's loose builtin typing.
// SPDX-License-Identifier: BSD-2-Clause
// Fallback "dotenv" module (the fork's hardcoded builtin, src/js/internal/dotenv.ts), shared with "dotenv/config".
// API-compatible with https://github.com/motdotla/dotenv 17.x (parse, populate, config, configDotenv).
// Bun already loads .env files natively; this keeps explicit `dotenv` callers working without the package.
// Differences: no "injected env" banner (as with `quiet: true`), and .env.vault decryption through
// DOTENV_KEY is not supported (falls back to plain .env files, as dotenv does when no vault exists).
// BSD-2-Clause License, Copyright (c) 2015, Scott Motte

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

type Env = Record<string, string | undefined>;

interface DotenvOptions {
  path?: string | URL | Array<string | URL>;
  encoding?: BufferEncoding;
  debug?: boolean | string;
  quiet?: boolean | string;
  override?: boolean | string;
  processEnv?: Env;
  DOTENV_KEY?: string;
}

const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

function parseBoolean(value: unknown): boolean {
  if (typeof value === "string") return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
  return Boolean(value);
}

function debugLog(message: string) {
  console.log(`┆ ${message}`);
}

function parse(src: string | Buffer): Record<string, string> {
  const obj: Record<string, string> = {};
  const lines = src.toString().replace(/\r\n?/gm, "\n");
  LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE.exec(lines)) != null) {
    const key = match[1];
    let value = (match[2] || "").trim();
    const maybeQuote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    obj[key] = value;
  }
  return obj;
}

function populate(processEnv: Env, parsed: Record<string, string>, options: DotenvOptions = {}) {
  const debug = Boolean(options && options.debug);
  const override = Boolean(options && options.override);
  const populated: Record<string, string> = {};
  if (typeof parsed !== "object") {
    const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
    (err as any).code = "OBJECT_REQUIRED";
    throw err;
  }
  for (const key of Object.keys(parsed)) {
    if (Object.hasOwn(processEnv, key)) {
      if (override === true) {
        processEnv[key] = parsed[key];
        populated[key] = parsed[key];
      }
      if (debug) {
        debugLog(`"${key}" is already defined and ${override === true ? "WAS" : "was NOT"} overwritten`);
      }
    } else {
      processEnv[key] = parsed[key];
      populated[key] = parsed[key];
    }
  }
  return populated;
}

function resolveHome(envPath: string | URL): string | URL {
  return typeof envPath === "string" && envPath[0] === "~" ? path.join(os.homedir(), envPath.slice(1)) : envPath;
}

function configDotenv(options?: DotenvOptions) {
  let processEnv: Env = process.env;
  const optionsProcessEnv = options?.processEnv;
  if (optionsProcessEnv != null) processEnv = optionsProcessEnv;
  const debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || (options && options.debug));
  const encoding = (options && options.encoding) || "utf8";

  let optionPaths: Array<string | URL> = [path.resolve(process.cwd(), ".env")];
  const optionsPath = options?.path;
  if (optionsPath) {
    optionPaths = Array.isArray(optionsPath) ? optionsPath.map(resolveHome) : [resolveHome(optionsPath)];
  }

  let lastError: Error | undefined;
  const parsedAll: Record<string, string> = {};
  for (const filePath of optionPaths) {
    try {
      populate(parsedAll, parse(fs.readFileSync(filePath, { encoding })), options);
    } catch (e) {
      if (debug) debugLog(`failed to load ${filePath} ${(e as Error).message}`);
      lastError = e as Error;
    }
  }
  populate(processEnv, parsedAll, options);
  return lastError ? { parsed: parsedAll, error: lastError } : { parsed: parsedAll };
}

function config(options?: DotenvOptions) {
  return configDotenv(options);
}

function decrypt(_encrypted: string, _keyStr: string): string {
  const err = new Error("DECRYPTION_FAILED: .env.vault decryption is not supported by Bun's built-in dotenv");
  (err as any).code = "DECRYPTION_FAILED";
  throw err;
}

export default {
  configDotenv,
  config,
  decrypt,
  parse,
  populate,
};

export { configDotenv, config, decrypt, parse, populate };
