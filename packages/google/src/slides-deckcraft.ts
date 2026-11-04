// SPDX-License-Identifier: Apache-2.0
/** Import Google Slides into DeckCraft through the existing Drive export and
 * DeckCraft `file.openBytes` contracts. Export requires Google connectivity;
 * subsequent editing is local and does not update the Google presentation. */
import type { createGoogleServices } from "./services.ts";

export const GOOGLE_SLIDES_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

export interface DeckCraftOpenBytes {
  name: string;
  data: string;
}

/** DeckCraft's in-process or WASM command dispatcher. Loopback control clients
 * have a 64 KiB request limit, so they cannot carry most exported decks. */
export type DeckCraftDispatch = (command: "file.openBytes", args: DeckCraftOpenBytes) => Promise<unknown>;

/** Subscribe before navigating the iframe. The host authenticates both the
 * origin and the specific child window, and stops waiting after a bounded time. */
export function waitForDeckCraftReady(
  frame: Window,
  options: { timeoutMs?: number; signal?: AbortSignal; host?: Window } = {},
): Promise<void> {
  const host = options.host ?? globalThis.window;
  const origin = host?.location?.origin;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!origin || origin === "null") return Promise.reject(new Error("DeckCraft requires a same-origin browser host"));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    return Promise.reject(new RangeError("DeckCraft ready timeout must be between 1 and 120000 milliseconds"));
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      host.removeEventListener("message", onMessage);
      options.signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame) return;
      if (event.data?.type === "deckcraft:ready") {
        cleanup();
        resolve();
      } else if (event.data?.type === "deckcraft:failed") {
        cleanup();
        reject(new Error("DeckCraft failed to start"));
      }
    };
    const onAbort = () => {
      cleanup();
      reject(options.signal?.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for DeckCraft"));
    }, timeoutMs);
    host.addEventListener("message", onMessage);
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Export once and open the resulting copy in the supplied local editor. */
export async function openGoogleSlidesInDeckCraft(
  drive: Pick<ReturnType<typeof createGoogleServices>["drive"], "exportFile">,
  fileId: string,
  dispatch: DeckCraftDispatch,
  options: { name?: string; signal?: AbortSignal } = {},
): Promise<unknown> {
  const args = await exportSlidesForDeckCraft(drive, fileId, options);
  return dispatch("file.openBytes", args);
}

/** Build the arguments to DeckCraft's `file.openBytes` from an explicit Drive
 * export. The caller chooses the local editor transport; this does not upload,
 * overwrite a file, or promise lossless Google Slides round trips. */
export async function exportSlidesForDeckCraft(
  drive: Pick<ReturnType<typeof createGoogleServices>["drive"], "exportFile">,
  fileId: string,
  options: { name?: string; signal?: AbortSignal } = {},
): Promise<DeckCraftOpenBytes> {
  const bytes = await exportSlidesBytes(drive, fileId, options.signal);
  // Keep each chunk a multiple of three so concatenated base64 has no interior padding.
  // btoa is available in both Bun and browsers; the small chunks avoid argument limits.
  let data = "";
  for (let start = 0; start < bytes.length; start += 12_288) {
    const chunk = bytes.subarray(start, start + 12_288);
    data += btoa(String.fromCharCode(...chunk));
  }
  return { name: options.name ?? "Presentation.pptx", data };
}

/** Send a copy to the same-origin DeckCraft browser host after its
 * `deckcraft:ready` message. Sending does not prove the editor opened it. */
export async function openGoogleSlidesInDeckCraftFrame(
  drive: Pick<ReturnType<typeof createGoogleServices>["drive"], "exportFile">,
  fileId: string,
  frame: { postMessage(message: unknown, targetOrigin: string): void },
  options: { name?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const origin = globalThis.location?.origin;
  if (!origin || origin === "null") throw new Error("DeckCraft requires a same-origin browser host");
  const bytes = await exportSlidesBytes(drive, fileId, options.signal);
  frame.postMessage({ type: "deckcraft:open", name: options.name ?? "Presentation.pptx", bytes }, origin);
}

async function exportSlidesBytes(
  drive: Pick<ReturnType<typeof createGoogleServices>["drive"], "exportFile">,
  fileId: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await drive.exportFile(fileId, GOOGLE_SLIDES_PPTX, signal);
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_EXPORT_BYTES) {
    await response.body?.cancel();
    throw new RangeError("Google Slides export exceeds 10 MiB");
  }
  if (!response.body) throw new Error("Google Slides export has no body");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EXPORT_BYTES) {
        await reader.cancel();
        throw new RangeError("Google Slides export exceeds 10 MiB");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Google Slides export is empty");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
