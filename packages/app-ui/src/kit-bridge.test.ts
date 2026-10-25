// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { KIT_PROTOCOL as KIT_SOURCE_PROTOCOL } from "../../product/src/shared/desktop";
import {
  clearKitCatalogsForTesting,
  idleRun,
  KIT_PROTOCOL,
  kitCatalog,
  reduceRun,
  answered,
  typedOk,
  visibleActions,
  type KitCatalog,
  type KitEvent,
} from "./kit-bridge";
import { kitVisible } from "./routes/kit/use-kit-visible";
import { destinationRoutes, routeOf } from "./use-open-requests";
import { LINK_DESTINATIONS, parseLink } from "./open-requests";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  clearKitCatalogsForTesting();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const catalog: KitCatalog = {
  protocol: KIT_PROTOCOL,
  kit: "omar",
  title: "Kit",
  version: "1",
  platform: "linux",
  groups: [{ id: "pc", title: "PC", icon: "computer" }],
  actions: [
    { id: "pc.1", group: "pc", title: "État", windowsOnly: true },
    { id: "pc.2", group: "pc", title: "Serveurs" },
  ],
  admin: true,
};

describe("kit bridge (aphrody.kit/1)", () => {
  test("the UI speaks the protocol of the kits", () => {
    expect(KIT_PROTOCOL).toBe(KIT_SOURCE_PROTOCOL);
  });

  test("a run folds its events: lines, a question, the answer, the end", () => {
    const events: KitEvent[] = [
      { type: "say", text: "début" },
      {
        type: "ask",
        id: 1,
        kind: "typed",
        question: "Tape OUI",
        expect: "OUI",
      },
    ];
    let state = events.reduce(reduceRun, {
      ...idleRun,
      status: "running" as const,
    });
    expect(state.status).toBe("asking");
    expect(state.question?.expect).toBe("OUI");
    state = answered(state);
    state = reduceRun(state, { type: "say", text: "erreur", stream: "err" });
    state = reduceRun(state, { type: "done", code: 0 });
    state = reduceRun(state, { type: "exit", session: 1, code: 0 });
    expect(state.status).toBe("done");
    expect(state.lines).toEqual([
      { id: 1, text: "début", stream: "out" },
      { id: 2, text: "erreur", stream: "err" },
    ]);
    expect(reduceRun({ ...idleRun, status: "running" }, { type: "exit", session: 1, code: null }).status).toBe(
      "stopped",
    );
  });

  test("typed confirmations need the exact word", () => {
    expect(typedOk("OUI", "OUI")).toBe(true);
    expect(typedOk("OUI", " OUI ")).toBe(true);
    expect(typedOk("OUI", "oui")).toBe(false);
    expect(typedOk(undefined, "")).toBe(true);
  });

  test("Windows-only actions are hidden elsewhere; admin needs the access pack", () => {
    expect(visibleActions(catalog, "pc").map(action => action.id)).toEqual(["pc.2"]);
    expect(visibleActions({ ...catalog, platform: "win32" }, "pc")).toHaveLength(2);
    expect(kitVisible(catalog, true)).toBe(true);
    expect(kitVisible({ ...catalog, admin: false }, true)).toBe(false);
    expect(kitVisible({ admin: false }, false)).toBe(true);
    expect(kitVisible(null, false)).toBe(false);
  });

  test("the catalog comes from the native kit command over a channel", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __TAURI_INTERNALS__: {
          transformCallback: (callback: (message: unknown) => void) => {
            (globalThis as { kitCallback?: unknown }).kitCallback = callback;
            return 1;
          },
          invoke: async (command: string, args: Record<string, unknown>) => {
            calls.push({ command, args });
            const channel = args.channel as {
              onmessage: (event: KitEvent) => void;
            };
            queueMicrotask(() => channel.onmessage({ type: "catalog", catalog }));
            return 7;
          },
        },
      },
    });
    expect(await kitCatalog("omar", true)).toEqual(catalog);
    expect(calls[0]?.command).toBe("aphrody_kit_start");
    expect(calls[0]?.args).toMatchObject({ kit: "omar", args: ["catalog"] });
  });
});

describe("open requests reach the kit surfaces", () => {
  test("aphrody://admin and aphrody://creator open their routes", () => {
    for (const destination of LINK_DESTINATIONS) expect(destinationRoutes[destination]).toBeString();
    expect(routeOf(parseLink("aphrody://admin")!)).toEqual({ to: "/admin" });
    expect(routeOf(parseLink("aphrody://creator")!)).toEqual({
      to: "/creator",
    });
    expect(routeOf(parseLink("aphrody://ask?q=bonjour")!)).toEqual({
      to: "/chat",
      state: { initialPrompt: "bonjour" },
    });
  });
});
