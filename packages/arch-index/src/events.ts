// SPDX-License-Identifier: MIT
// In-process event bus plus webhook delivery (HMAC-SHA256 signed, bounded retries).
import type { IndexEvent } from "./store.ts";

export type EventListener = (event: IndexEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: IndexEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A faulty subscriber never blocks the others or the sync loop.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

export interface Webhook {
  url: string;
  /** Event types to deliver; empty = all. */
  types?: string[];
  /** Shared secret for the X-Archindex-Signature header (sha256=<hex> over the body). Never logged. */
  secret?: string;
}

export interface WebhookOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
  userAgent?: string;
}

export function signBody(secret: string, body: string): string {
  return `sha256=${new Bun.CryptoHasher("sha256", secret).update(body).digest("hex")}`;
}

/** Deliver one event; resolves true on a 2xx answer, false after the retries are exhausted. */
export async function deliverWebhook(hook: Webhook, event: IndexEvent, options: WebhookOptions = {}): Promise<boolean> {
  if (hook.types?.length && !hook.types.includes(event.type)) return true;
  const doFetch = options.fetch ?? ((i, init) => fetch(i, init));
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": options.userAgent ?? "bunos-archindex/1.0 (+https://github.com/aphrody-labs/bun-os)",
    "x-archindex-event": event.type,
    "x-archindex-delivery": String(event.id),
  };
  if (hook.secret) headers["x-archindex-signature"] = signBody(hook.secret, body);
  const retries = options.retries ?? 3;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      await res.body?.cancel().catch(() => {});
      if (res.ok) return true;
      // 4xx other than 408/429 will not heal by retrying.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return false;
    } catch {
      // network error: retry
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  return false;
}
