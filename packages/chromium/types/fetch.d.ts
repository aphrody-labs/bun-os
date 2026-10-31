/** Browser-header fetch with Cloudflare challenge detection (the fork's bun:fetch). Challenges are reported, never solved. */
declare module "bun:fetch" {
  export type ChallengeKind = "none" | "js" | "managed" | "turnstile" | "captcha";
  export interface FetchResult {
    status: number;
    url: string;
    headers: Headers;
    body: string;
    challenge: ChallengeKind;
  }
  export function detectChallenge(status: number, headers: Headers, body: string): ChallengeKind;
  export function get(url: string, init?: { headers?: Record<string, string>; timeout?: number }): Promise<FetchResult>;
  const fetch: { detectChallenge: typeof detectChallenge; get: typeof get };
  export default fetch;
}
