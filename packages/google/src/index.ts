/** Canonical Google/Gemini facade backed by this workspace's own modules. */
export * from "./runtime.ts";
export * from "./vertex.ts";
export * from "./api.ts";
export * from "./drive-sync.ts";
export * from "./drive-model-sync.ts";

/** Google account authentication and data operations backed by the native
 * credential-store SDK. Explicit target reads return tokens to the Bun process;
 * no implicit credential-store writes or migrations occur. */
export {
  googleAuthStatus,
  googleLogin,
  googleWhoami,
  googleModels,
  googleGenerate,
  googleGenerateStream,
  type GoogleModel,
  type GoogleProfile,
} from "./auth.ts";

/** The fork's `bun:google` surface (also served as the `bun:google` specifier by ./bun-plugin). */
export { createClient, adcCredentialProvider, chromium, obscura, dns } from "./bun-google.ts";
export type { GoogleClient, GoogleClientOptions } from "./client.ts";
export * from "./services.ts";
export { createGooglePublicSearch } from "./search.ts";
export { createPublicIndexSearch } from "./public-index.ts";
export type {
  PublicIndexInput,
  PublicIndexBody,
  PublicIndexCollection,
  PublicIndexSdkOptions,
  PublicIndexResult,
  PublicIndexSearch,
} from "./public-index.ts";
export {
  createAntigravityCredentialProvider,
  type AntigravityCredentialOptions,
  type AntigravityCredentialProvider,
} from "./credentials.ts";
export { createAntigravityServices, type AntigravityServicesOptions, type AntigravityModel } from "./antigravity.ts";
