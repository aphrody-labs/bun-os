// SPDX-License-Identifier: MIT
// bun:fetch of the aphrody-labs/bun fork.
// Port of cloudscraper's request path: HTTP fetch with browser-like headers and
// Cloudflare challenge detection. Challenge solving is not ported; a detected
// challenge is reported to the caller instead of being bypassed.

export type ChallengeKind = "none" | "js" | "managed" | "turnstile" | "captcha";

export interface FetchResult {
  status: number;
  url: string;
  headers: Headers;
  body: string;
  challenge: ChallengeKind;
}

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export function detectChallenge(status: number, headers: Headers, body: string): ChallengeKind {
  const server = headers.get("server") ?? "";
  if (!/cloudflare/i.test(server) && !headers.has("cf-mitigated")) return "none";
  if (headers.get("cf-mitigated") === "challenge" || /cf-chl|Just a moment/i.test(body)) {
    if (/challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(body)) return "turnstile";
    if (/managed_challenge|cType: 'managed'/i.test(body)) return "managed";
    if (/g-recaptcha|hcaptcha/i.test(body)) return "captcha";
    return "js";
  }
  return status === 403 || status === 503 ? "js" : "none";
}

export async function get(
  url: string,
  init: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...init.headers },
    signal: AbortSignal.timeout(init.timeout ?? 30_000),
    redirect: "follow",
  });
  const body = await res.text();
  return {
    status: res.status,
    url: res.url,
    headers: res.headers,
    body,
    challenge: detectChallenge(res.status, res.headers, body),
  };
}

export default { detectChallenge, get };
