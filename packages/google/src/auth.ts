import type { GoogleClientOptions } from "./client.ts";
import { createAntigravityServices, type AntigravityServicesOptions } from "./antigravity.ts";
import { createAntigravityCredentialProvider } from "./credentials.ts";

export interface GoogleNativeAuthOptions {
  credentialProvider?: GoogleClientOptions["credentialProvider"];
  baseURL?: GoogleClientOptions["baseURL"];
  fetch?: GoogleClientOptions["fetch"];
  signal?: AbortSignal;
  runtime?: AntigravityServicesOptions["runtime"];
  authMethod?: string;
  wait?: AntigravityServicesOptions["wait"];
}

function nativeProvider(options: GoogleNativeAuthOptions) {
  return options.credentialProvider ?? createAntigravityCredentialProvider({ target: "gemini:antigravity" });
}

export interface GoogleProfile {
  name?: string;
  email?: string;
  picture?: string;
}

export interface GoogleModel {
  name?: string;
  displayName?: string;
  description?: string;
  capabilities?: unknown;
}

export function resolveGoogleCommand(which: typeof Bun.which = Bun.which): string[] {
  const configured = Bun.env.APHRODY_GOOGLE_BIN;
  if (configured) return [configured];
  const owner = which("aphrody");
  if (owner) return [owner, "google"];
  const binary = which("aphrody-google") ?? which("google");
  if (!binary) throw new Error("Google CLI not found; install aphrody or set APHRODY_GOOGLE_BIN");
  return [binary];
}

export function resolveGoogleBinary(): string {
  return resolveGoogleCommand()[0]!;
}

async function invoke<T>(...args: string[]): Promise<T> {
  const child = Bun.spawn([...resolveGoogleCommand(), ...args], {
    windowsHide: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`aphrody-google ${args[0]} failed (${exitCode})`);
  }
  if (args[0] === "login") return undefined as T;
  const output = stdout.trim();
  return (output ? JSON.parse(output) : undefined) as T;
}

/** Interactive PKCE and protected-store persistence remain owned by the explicitly invoked native CLI. */
export function googleLogin(): Promise<void> {
  return invoke<void>("login");
}

/** Check credential availability without returning credential material. */
export async function googleAuthStatus(options: GoogleNativeAuthOptions = {}): Promise<string> {
  await nativeProvider(options)(options.signal);
  return "available";
}

/** Return the signed-in account's non-secret OpenID profile. */
export async function googleWhoami(options: GoogleNativeAuthOptions = {}): Promise<GoogleProfile> {
  return createAntigravityServices({
    ...options,
    credentialProvider: nativeProvider(options),
  }).whoami(options.signal);
}

/** List Gemini models exposed to the signed-in account. */
export function googleModels(options: GoogleNativeAuthOptions = {}): Promise<GoogleModel[]> {
  return createAntigravityServices({
    ...options,
    credentialProvider: nativeProvider(options),
  }).models(options.signal);
}

/** Generate one Gemini response using the signed-in account. */
export function googleGenerate(
  prompt: string,
  model?: string,
  options: GoogleNativeAuthOptions = {},
): Promise<unknown> {
  return createAntigravityServices({
    ...options,
    credentialProvider: nativeProvider(options),
  }).generate(prompt, model, options.signal);
}

/** Run Gemini generateContent through the OAuth-backed native SDK. */
export function googleGenerateStream(
  prompt: string,
  model = "gemini-2.5-flash",
  signal?: AbortSignal,
  options: GoogleNativeAuthOptions = {},
): ReadableStream<string> {
  return createAntigravityServices({
    ...options,
    credentialProvider: nativeProvider(options),
  }).stream(prompt, model, signal ?? options.signal);
}
