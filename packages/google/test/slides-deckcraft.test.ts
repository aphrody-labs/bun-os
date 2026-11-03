// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createGoogleServices } from "../src/services.ts";
import {
  exportSlidesForDeckCraft,
  GOOGLE_SLIDES_PPTX,
  openGoogleSlidesInDeckCraft,
  openGoogleSlidesInDeckCraftFrame,
  waitForDeckCraftReady,
} from "../src/slides-deckcraft.ts";

describe("Google Slides export for DeckCraft", () => {
  test("uses Drive's PPTX export and prepares file.openBytes arguments", async () => {
    let requested: URL | undefined;
    const services = createGoogleServices({
      token: () => "test-token",
      fetch: async input => {
        requested = new URL(String(input));
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
      },
    });
    const args = await exportSlidesForDeckCraft(services.drive, "slide/id", { name: "Example.pptx" });
    expect(requested?.pathname).toBe("/drive/v3/files/slide%2Fid/export");
    expect(requested?.searchParams.get("mimeType")).toBe(GOOGLE_SLIDES_PPTX);
    expect(args).toEqual({ name: "Example.pptx", data: "UEsDBA==" });
  });

  test("rejects an empty or oversized export", async () => {
    const empty = { exportFile: async () => new Response(new Uint8Array()) };
    await expect(exportSlidesForDeckCraft(empty, "id")).rejects.toThrow("empty");
    const oversized = {
      exportFile: async () => new Response("x", { headers: { "content-length": String(10 * 1024 * 1024 + 1) } }),
    };
    await expect(exportSlidesForDeckCraft(oversized, "id")).rejects.toThrow("exceeds 10 MiB");
  });

  test("dispatches the exported copy to the local DeckCraft owner", async () => {
    const drive = { exportFile: async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])) };
    let received: unknown;
    const result = await openGoogleSlidesInDeckCraft(drive, "id", async (command, args) => {
      received = { command, args };
      return { document: 1 };
    });
    expect(received).toEqual({
      command: "file.openBytes",
      args: { name: "Presentation.pptx", data: "UEsDBA==" },
    });
    expect(result).toEqual({ document: 1 });
  });

  test("does not export when there is no same-origin browser host", async () => {
    let exported = false;
    const drive = { exportFile: async () => { exported = true; return new Response("x"); } };
    await expect(openGoogleSlidesInDeckCraftFrame(drive, "id", { postMessage() {} }))
      .rejects.toThrow("same-origin browser host");
    expect(exported).toBe(false);
  });

  test("sends bytes to the existing DeckCraft host at the page origin", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: { origin: "https://example.test" }, configurable: true });
    try {
      const drive = { exportFile: async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])) };
      let received: unknown;
      const frame = { postMessage(message: unknown, origin: string) { received = { message, origin }; } };
      await openGoogleSlidesInDeckCraftFrame(drive, "id", frame);
      expect(received).toEqual({
        origin: "https://example.test",
        message: { type: "deckcraft:open", name: "Presentation.pptx", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) },
      });
    } finally {
      if (previous) Object.defineProperty(globalThis, "location", previous);
      else Reflect.deleteProperty(globalThis, "location");
    }
  });

  test("only accepts readiness from the expected child and origin", async () => {
    const host = Object.assign(new EventTarget(), { location: { origin: "https://example.test" } });
    const frame = {} as Window;
    let ready = false;
    const waiting = waitForDeckCraftReady(frame, { host: host as unknown as Window, timeoutMs: 200 });
    void waiting.then(() => { ready = true; });
    const send = (origin: string, source: unknown) => {
      const event = Object.assign(new Event("message"), { origin, source, data: { type: "deckcraft:ready" } });
      host.dispatchEvent(event);
    };
    send("https://evil.test", frame);
    send("https://example.test", {});
    await Promise.resolve();
    expect(ready).toBe(false);
    send("https://example.test", frame);
    await waiting;
    expect(ready).toBe(true);
  });

  test("times out waiting for a silent editor", async () => {
    const host = Object.assign(new EventTarget(), { location: { origin: "https://example.test" } });
    await expect(waitForDeckCraftReady({} as Window, { host: host as unknown as Window, timeoutMs: 5 }))
      .rejects.toThrow("Timed out");
  });
});
