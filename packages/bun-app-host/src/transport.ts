// SPDX-License-Identifier: MIT
import { timingSafeEqual } from "node:crypto";
import { hashContent } from "@aphrody/bun-workspace";
import { problem } from "../../bun-os-platform/src/api/index.ts";

export const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function jsonReply(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders });
}

/** One authentication and origin policy for product and native app transports. */
export function validatePublicOrigin(value?: string): string | undefined {
  if (value === undefined) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password)
      throw new Error("Invalid origin.");
    return url.origin;
  } catch {
    throw new Error("Product public origin must be an HTTPS origin without a path or credentials.");
  }
}

export function authenticateRequest(
  request: Request,
  token: string,
  options: { publicOrigin?: string } = {},
): Response | undefined {
  if (token.length < 32) throw new Error("Inject the application token from its protected store.");
  const authorization = request.headers.get("Authorization");
  if (
    !authorization?.startsWith("Bearer ") ||
    !timingSafeEqual(
      new TextEncoder().encode(hashContent(authorization.slice(7))),
      new TextEncoder().encode(hashContent(token)),
    )
  )
    return problem(401, undefined, "Authentication required.", { headers: { "WWW-Authenticate": "Bearer" } });
  const url = new URL(request.url);
  const origin = validatePublicOrigin(options.publicOrigin) ?? url.origin;
  if (
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (request.headers.get("Origin") && request.headers.get("Origin") !== origin)
  )
    return problem(403, undefined, "Origin denied.");
}
