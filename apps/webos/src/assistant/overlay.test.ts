// SPDX-License-Identifier: Apache-2.0
// End to end in a DOM: pointer events -> shake -> overlay -> question -> streamed answer from an HTTP model server,
// with excerpts from the content index placed in the prompt.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { openAiCompatible } from "./backend";
import { installAssistant, openOnShake, type AssistantHandle } from "./overlay";

let server: ReturnType<typeof Bun.serve>;
let base: string;
const prompts: any[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: any = await request.json();
      prompts.push(body);
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(c) {
            for (const piece of ["Ship ", "on ", "Friday."])
              c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));

let handle: AssistantHandle | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
  document.body.replaceChildren();
});

function move(x: number, y: number, t: number) {
  const event = new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: t });
  document.dispatchEvent(event);
}
const wiggle = (from = 0) => {
  for (let ms = 0; ms <= 700; ms += 16) move(500 + 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), 300, from + ms);
};
const until = async (ok: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!ok() && Date.now() < deadline) await Bun.sleep(5);
  expect(ok()).toBe(true);
};

const make = (enabled = true) =>
  (handle = installAssistant({
    enabled: () => enabled,
    backend: () => openAiCompatible({ kind: "llama", baseUrl: base, model: "local" }),
    search: query => [{ path: "/home/user/notes/plan.md", line: 3, text: `release plan for ${query}: ship on friday` }],
  }));

describe("assistant overlay", () => {
  test("a pointer shake opens the prompt next to the pointer and focuses it", () => {
    make();
    wiggle();
    const panel = document.querySelector<HTMLElement>(".assist");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-label")).toBe("Assistant");
    expect(document.activeElement).toBe(panel!.querySelector("input"));
  });

  test("ordinary movement does not open it", () => {
    make();
    for (let ms = 0; ms <= 700; ms += 16) move(100 + ms, 100 + ms / 3, ms);
    expect(document.querySelector(".assist")).toBeNull();
  });

  test("disabled in Settings, the gesture does nothing", () => {
    make(false);
    wiggle();
    expect(document.querySelector(".assist")).toBeNull();
  });

  test("asking streams the model's answer and lists the files used as context", async () => {
    make();
    wiggle();
    const input = document.querySelector<HTMLInputElement>(".assist input")!;
    input.value = "when do we release?";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const answer = document.querySelector<HTMLElement>(".assist-out")!;
    await until(() => answer.dataset.state === "done");
    expect(answer.textContent).toBe("Ship on Friday.");
    expect(document.querySelector(".assist-src")!.textContent).toBe("/home/user/notes/plan.md:3");
    const system = prompts.at(-1).messages[0].content as string;
    expect(system).toContain("/home/user/notes/plan.md:3");
    expect(system).toContain("release plan for when do we release?");
  });

  test("Escape closes the overlay", () => {
    make();
    wiggle();
    const input = document.querySelector<HTMLInputElement>(".assist input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".assist")).toBeNull();
    expect(handle!.isOpen).toBe(false);
  });

  test("an unreachable backend shows its error instead of an empty panel", async () => {
    handle = installAssistant({
      enabled: () => true,
      backend: () => openAiCompatible({ kind: "hosted", baseUrl: base, model: "m" }), // no key
      search: () => [],
    });
    wiggle();
    const input = document.querySelector<HTMLInputElement>(".assist input")!;
    input.value = "hi";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const answer = document.querySelector<HTMLElement>(".assist-out")!;
    await until(() => answer.dataset.state === "error");
    expect(answer.textContent).toContain("API key");
  });
});

describe("compositor shake source", () => {
  test("a shake recognised by the wasmos compositor opens the assistant at the pointer", async () => {
    const { Compositor } = await import("../../../../packages/wasmos/src/compositor.ts");
    const { ShakeDetector } = await import("./shake");
    const compositor = new Compositor({ init() {} } as never, 1280, 720);
    compositor.useShakeGesture(new ShakeDetector());
    make();
    const off = openOnShake(handle!, compositor);
    for (let ms = 0; ms <= 700; ms += 16)
      compositor.pointerMove(400 + 70 * Math.sin((2 * Math.PI * 7 * ms) / 1000), 300, 1000 + ms);
    expect(handle!.isOpen).toBe(true);
    expect(document.querySelector(".assist")).not.toBeNull();
    off();
  });
});
