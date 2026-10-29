// SPDX-License-Identifier: Apache-2.0
// Cross-origin isolation of the shell (SharedArrayBuffer for the threaded emulators and the interactive Alpine guest).
// `credentialless` keeps third-party images and styles working; documents embedded in the shell (the Browser app's
// /api/browse frames) must carry the same pair of headers or Chromium refuses to render them.
export const ISOLATION = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
} as const;

export function isolated(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(ISOLATION)) out.headers.set(key, value);
  return out;
}
