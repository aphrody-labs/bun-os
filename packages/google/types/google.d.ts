declare module "bun:google" {
  export interface GoogleRuntime {
    project: "aphrody" | "rgfr";
    location: string;
    home: string;
    auth: string;
  }
  /** Public configuration only. This function never discovers credentials. */
  export function googleRuntime(env?: Record<string, string | undefined>): GoogleRuntime;
  export interface GoogleClientOptions {
    /** Called for each request. Keep token storage and refresh in its existing owner. */
    credentialProvider: (signal?: AbortSignal) => string | Promise<string>;
    /** Google HTTPS endpoint, or loopback HTTP(S) for local testing. */
    baseURL?: string | URL;
    /** Optional trusted transport for local testing. Must honor redirect: "error" and AbortSignal. */
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }
  export interface GoogleClient {
    /**
     * Authenticated in-process fetch. Accepts a relative path and encoded query;
     * use ./ for a first path segment containing a colon, such as Cloud Code RPCs.
     * rejects raw whitespace, path traversal, caller auth headers and redirects.
     * Non-success HTTP errors report only the status, never response bodies.
     */
    request(relativePath: string, init?: RequestInit): Promise<Response>;
  }
  export function createClient(options: GoogleClientOptions): GoogleClient;
  /** Existing browser bridges; these aliases add no engine or engine parity. */
  export const chromium: typeof import("bun:chromium").default;
  export const obscura: typeof import("bun:obscura").default;
  export const dns: typeof Bun.dns;
  const google: {
    googleRuntime: typeof googleRuntime;
    createClient: typeof createClient;
    chromium: typeof chromium;
    obscura: typeof obscura;
    dns: typeof dns;
  };
  export default google;
}
