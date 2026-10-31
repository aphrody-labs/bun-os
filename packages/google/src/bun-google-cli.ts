#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { googleRuntime } from "./client.ts";
import { createAntigravityServices, type AntigravityServicesOptions } from "./antigravity.ts";
import { createAntigravityCredentialProvider } from "./credentials.ts";

export async function runGoogleCommand(
  args: string[],
  options?: AntigravityServicesOptions & { signal?: AbortSignal },
): Promise<unknown> {
  const [command, ...rest] = args;
  if (command === "config") {
    if (rest.length) throw new TypeError("config accepts no arguments");
    return options?.runtime ?? googleRuntime(Bun.env);
  }
  if (!["authstatus", "models", "generate", "stream"].includes(command))
    throw new TypeError("Commands: config, authstatus, models, generate, stream");
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!["--target", "--model", "--prompt"].includes(key) || value === undefined || flags.has(key))
      throw new TypeError("Expected unique --target, --model or --prompt arguments");
    flags.set(key, value);
  }
  const generating = command === "generate" || command === "stream";
  if (!generating && (flags.has("--model") || flags.has("--prompt")))
    throw new TypeError("Model and prompt apply only to generation commands");
  if (generating && !flags.has("--prompt")) throw new TypeError("Generation requires --prompt");
  if (options?.credentialProvider && flags.has("--target"))
    throw new TypeError("Use a provider or an explicit target, not both");
  const credentialProvider =
    options?.credentialProvider ??
    createAntigravityCredentialProvider({
      target: flags.get("--target")!,
    });
  if (command === "authstatus") {
    options?.signal?.throwIfAborted();
    const token = await credentialProvider(options?.signal);
    if (typeof token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token))
      throw new Error("Google credential unavailable");
    options?.signal?.throwIfAborted();
    return { authenticated: true };
  }
  const services = createAntigravityServices({ ...options, credentialProvider });
  if (command === "models") return services.models(options?.signal);
  const model = flags.get("--model") ?? "gemini-2.5-flash";
  const prompt = flags.get("--prompt")!;
  return command === "stream"
    ? services.stream(prompt, model, options?.signal)
    : services.generate(prompt, model, options?.signal);
}

if (import.meta.main) {
  try {
    const result = await runGoogleCommand(Bun.argv.slice(2));
    if (result instanceof ReadableStream) {
      for await (const chunk of result) process.stdout.write(chunk);
    } else console.log(JSON.stringify(result));
  } catch {
    console.error("Google command failed; verify explicit credentials, input and cancellation");
    process.exitCode = 1;
  }
}
