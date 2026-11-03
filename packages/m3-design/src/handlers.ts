// SPDX-License-Identifier: Apache-2.0
//! Side-effect-free request handlers and CLI runner for the design compiler.
//! Importing this module never starts a server or exits the process; the
//! application entrypoint lives in `server.ts`.

import { DesignCompiler } from "./generator.ts";

type JsonObject = Record<string, unknown>;
type Protocol = "anthropic" | "openai" | "google";

class InvalidRequest extends Error {}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBody(req: Request): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InvalidRequest("Request body must be valid JSON");
  }
  if (!isObject(body)) throw new InvalidRequest("Request body must be a JSON object");
  return body;
}

function optionalString(body: JsonObject, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InvalidRequest(`${field} must be a string`);
  return value;
}

function requiredString(body: JsonObject, field: string): string {
  const value = optionalString(body, field);
  if (!value?.trim()) throw new InvalidRequest(`${field} must be a non-empty string`);
  return value;
}

function nullableString(body: JsonObject, field: string): string | null | undefined {
  return body[field] === null ? null : optionalString(body, field);
}

function readArtifact(body: JsonObject): { name: string; body: string } | null | undefined {
  const value = body.artifact;
  if (value === undefined || value === null) return value;
  if (!isObject(value)) throw new InvalidRequest("artifact must be an object with name and body");
  const name = requiredString(value, "name");
  const content = optionalString(value, "body");
  if (content === undefined) throw new InvalidRequest("artifact.body must be a string");
  return { name, body: content };
}

function readBaseUrl(body: JsonObject): string | undefined {
  const value = optionalString(body, "baseUrl");
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidRequest("baseUrl must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new InvalidRequest("baseUrl must be an HTTP(S) URL without credentials, query or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: error instanceof InvalidRequest ? 400 : 500 });
}

/** Build the HTTP handler served by the design engine. */
export function createFetchHandler(compiler: DesignCompiler): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const allowed =
      url.pathname === "/"
        ? "GET"
        : ["/api/generate", "/api/generate/finalize"].includes(url.pathname)
          ? "POST"
          : undefined;
    if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
    if (req.method !== allowed) {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: allowed } });
    }

    if (url.pathname === "/api/generate") {
      try {
        const body = await readBody(req);
        const prompt = requiredString(body, "prompt");
        const seedColor = optionalString(body, "seedColor");
        const designSystemId = optionalString(body, "designSystemId");
        if (seedColor !== undefined && !/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(seedColor.trim())) {
          throw new InvalidRequest("seedColor must be a three- or six-digit HEX color");
        }
        const result = compiler.compile(prompt, seedColor, designSystemId);
        return Response.json(result);
      } catch (error: unknown) {
        return failure(error);
      }
    }

    if (url.pathname === "/api/generate/finalize") {
      try {
        const body = await readBody(req);
        const projectId = requiredString(body, "projectId");
        const apiKey = requiredString(body, "apiKey");
        const model = requiredString(body, "model");
        const suppliedProtocol = optionalString(body, "protocol") ?? "anthropic";
        if (!["anthropic", "openai", "google"].includes(suppliedProtocol)) {
          throw new InvalidRequest("protocol must be anthropic, openai or google");
        }
        const protocol = suppliedProtocol as Protocol;
        const baseUrl = readBaseUrl(body);
        const transcriptJsonl = optionalString(body, "transcriptJsonl") ?? "";
        const transcriptMessageCount = body.transcriptMessageCount ?? 0;
        if (
          body.transcriptMessageCount === null ||
          !Number.isSafeInteger(transcriptMessageCount) ||
          (transcriptMessageCount as number) < 0
        ) {
          throw new InvalidRequest("transcriptMessageCount must be a non-negative safe integer");
        }
        const designSystemId = nullableString(body, "designSystemId");
        const designSystemBody = nullableString(body, "designSystemBody");
        const artifact = readArtifact(body);

        const defaultBaseUrl =
          protocol === "openai"
            ? "https://api.openai.com"
            : protocol === "google"
              ? "https://generativelanguage.googleapis.com"
              : "https://api.anthropic.com";
        const resolvedBaseUrl = baseUrl ?? defaultBaseUrl;
        const prompts = buildSynthesisPrompt({
          projectId,
          transcriptJsonl,
          transcriptMessageCount: transcriptMessageCount as number,
          designSystemId,
          designSystemBody,
          artifact,
          now: new Date(),
        });

        try {
          let response: Response;
          if (protocol === "anthropic") {
            const endpoint = resolvedBaseUrl.includes("/v1")
              ? `${resolvedBaseUrl}/messages`
              : `${resolvedBaseUrl}/v1/messages`;
            response = await fetch(endpoint, {
              method: "POST",
              signal: req.signal,
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model,
                max_tokens: 4000,
                system: prompts.systemPrompt,
                messages: [{ role: "user", content: prompts.userPrompt }],
              }),
            });
          } else if (protocol === "openai") {
            const endpoint = resolvedBaseUrl.includes("/v1")
              ? `${resolvedBaseUrl}/chat/completions`
              : `${resolvedBaseUrl}/v1/chat/completions`;
            response = await fetch(endpoint, {
              method: "POST",
              signal: req.signal,
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: "system", content: prompts.systemPrompt },
                  { role: "user", content: prompts.userPrompt },
                ],
                max_tokens: 4000,
              }),
            });
          } else {
            const endpoint = `${resolvedBaseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
            response = await fetch(endpoint, {
              method: "POST",
              signal: req.signal,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompts.userPrompt }] }],
                systemInstruction: { parts: [{ text: prompts.systemPrompt }] },
                generationConfig: { maxOutputTokens: 4000 },
              }),
            });
          }

          if (!response.ok) {
            const details = await response.text().catch(() => "");
            return Response.json(
              {
                error: `Upstream ${protocol} call failed with status ${response.status}`,
                details,
              },
              { status: 502 },
            );
          }

          const designMd = extractDesignMd(await response.json(), protocol);
          return Response.json({
            success: true,
            designMd,
            projectId,
            designSystemId: designSystemId || null,
          });
        } catch {
          return Response.json({ error: `Upstream ${protocol} request or response failed` }, { status: 502 });
        }
      } catch (error: unknown) {
        return failure(error);
      }
    }

    // Root details
    return Response.json({
      engine: "design",
      status: "active",
      endpoints: {
        "POST /api/generate": {
          body: {
            prompt: "string (required)",
            seedColor: "string (optional HEX seed)",
            designSystemId: "string (optional design system id recorded on the brief)",
          },
        },
        "POST /api/generate/finalize": {
          body: {
            projectId: "string (required)",
            apiKey: "string (required)",
            model: "string (required)",
            protocol: "string (optional: anthropic | openai | google)",
            baseUrl: "string (optional API base url)",
            transcriptJsonl: "string (optional)",
            transcriptMessageCount: "number (optional)",
            designSystemId: "string (optional)",
            designSystemBody: "string (optional)",
            artifact: "object with name and body (optional)",
          },
        },
      },
    });
  };
}

/** Parsed `--prompt` CLI invocation. */
export interface CliOptions {
  prompt?: string;
  color?: string;
  designSystem?: string;
}

/** Extract CLI options from an argv array. Returns `null` when `--prompt` is absent. */
export function parseCliArgs(args: readonly string[]): CliOptions | null {
  const promptIndex = args.indexOf("--prompt");
  if (promptIndex === -1) return null;
  const colorIndex = args.indexOf("--color");
  const designSystemIndex = args.indexOf("--design-system");
  return {
    prompt: args[promptIndex + 1],
    color: colorIndex !== -1 ? args[colorIndex + 1] : undefined,
    designSystem: designSystemIndex !== -1 ? args[designSystemIndex + 1] : undefined,
  };
}

/** Run the compiler as a CLI tool and return the process exit code. */
export function runCli(options: CliOptions, compiler: DesignCompiler): number {
  const { prompt, color, designSystem } = options;

  if (!prompt) {
    console.error("Error: Please provide a prompt value using --prompt <text>");
    return 1;
  }

  console.log(`[CLI Compiler] Compiling prompt: "${prompt}"...`);
  if (designSystem) {
    console.log(`[CLI Compiler] Using custom design system: "${designSystem}"`);
  }
  const result = compiler.compile(prompt, color, designSystem);

  console.log("\n--- DESIGN BRIEF EXTRACTED ---");
  console.log(JSON.stringify(result.brief, null, 2));

  const { themeExport } = result.theme;
  console.log("\n--- THEME EXPORT ---");
  console.log(`Seed Color: ${result.theme.seed} (${themeExport.variant})`);
  console.log(`Primary: ${themeExport.light.primary} light, ${themeExport.dark.primary} dark`);
  console.log(`Surface: ${themeExport.light.surface} light, ${themeExport.dark.surface} dark`);

  console.log("\n--- GENERATED FILES ---");
  for (const file of result.files) {
    console.log(`- ${file.path} (${file.content.length} characters)`);
  }

  console.log("\n--- SELF-CRITIQUE ---");
  console.log(`Scores: ${JSON.stringify(result.critique.scores)}`);
  console.log(`Rationale: ${result.critique.rationale}`);

  return 0;
}

// Synthesis Prompts compiler helper
export function buildSynthesisPrompt(input: {
  projectId: string;
  transcriptJsonl: string;
  transcriptMessageCount: number;
  designSystemId?: string | null;
  designSystemBody?: string | null;
  artifact?: { name: string; body: string } | null;
  now: Date;
}) {
  const SYSTEM_PROMPT = `You are a senior product designer synthesizing a finalized design package
from a multi-turn design session. Your output is a single Markdown document
named DESIGN.md that captures the durable design intent of the work so a
fresh contributor (human or LLM) can reconstruct context without replaying
the full chat.

Output structure (Markdown headings exactly as below):
# DESIGN.md
## Summary
## Brand & Voice
## Information Architecture
## Components & Patterns
## Visual System
## Open Questions
## Provenance

The Provenance section MUST list:
- Project ID
- Design system (or "none" if not selected)
- Current artifact (file name, or "none" if not in scope)
- Transcript message count
- Generated UTC timestamp

Render Provenance fields as plain Markdown bullets with no emphasis on the field labels, exactly: "- Field name: value". Do not bold, italicize, or otherwise decorate the labels or the colon. Field values may use inline code formatting (backticks) where appropriate.

Output the Markdown body only. No preamble, no chat-style framing, no
"Here's your DESIGN.md" prefix. Do not invent facts not supported by the
inputs; if an input is missing or empty, the corresponding section should
say so explicitly rather than fabricating content.`;

  const designSystemHeader = input.designSystemId ?? "none";
  const designSystemBody =
    input.designSystemBody && input.designSystemBody.trim().length > 0
      ? input.designSystemBody
      : "(no design system selected for this project)";

  const artifactHeader = input.artifact ? input.artifact.name : "none";
  const artifactBody = input.artifact ? input.artifact.body : "(no artifact in scope for this finalize)";

  const userPrompt =
    `The following inputs describe the design session for project ${input.projectId}.\n\n` +
    `## Transcript (JSONL)\n${input.transcriptJsonl}\n\n` +
    `## Active design system: ${designSystemHeader}\n${designSystemBody}\n\n` +
    `## Current artifact: ${artifactHeader}\n${artifactBody}\n\n` +
    `## Generation context\n` +
    `- Generated at: ${input.now.toISOString()}\n` +
    `- Project ID: ${input.projectId}\n` +
    `- Transcript message count: ${input.transcriptMessageCount}\n\n` +
    `Synthesize DESIGN.md per the system instructions.`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

// Extractor helper for provider payloads
export function extractDesignMd(payload: unknown, protocol: string): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("response payload was not an object");
  }

  const p = payload as Record<string, unknown>;
  let out = "";

  if (protocol === "anthropic") {
    const content = p.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object") {
          const blockObj = block as Record<string, unknown>;
          if (blockObj.type === "text" && typeof blockObj.text === "string") {
            out += blockObj.text;
          }
        }
      }
    }
  } else if (protocol === "openai") {
    const choices = p.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (choice && typeof choice === "object") {
          const choiceObj = choice as Record<string, unknown>;
          const message = choiceObj.message;
          if (message && typeof message === "object") {
            const msgObj = message as Record<string, unknown>;
            if (typeof msgObj.content === "string") {
              out += msgObj.content;
            }
          }
        }
      }
    }
  } else if (protocol === "google") {
    const candidates = p.candidates;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
          const candObj = candidate as Record<string, unknown>;
          const content = candObj.content;
          if (content && typeof content === "object") {
            const contentObj = content as Record<string, unknown>;
            const parts = contentObj.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part && typeof part === "object") {
                  const partObj = part as Record<string, unknown>;
                  if (typeof partObj.text === "string") {
                    out += partObj.text;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (out.trim().length === 0) {
    throw new Error(`upstream ${protocol} response contained no text content`);
  }
  return out;
}
