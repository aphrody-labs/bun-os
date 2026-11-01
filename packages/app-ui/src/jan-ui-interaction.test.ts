// SPDX-License-Identifier: Apache-2.0
// Real React DOM interactions with synthetic owner responses; no live data or service claims.
import { afterEach, expect, test } from "bun:test";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
// Base UI captures browser availability during module initialization. Load the
// components after the DOM owner has registered its globals, including standalone runs.
const { HistoryPanel } = await import("./history-panel");
const { ModelsHub } = await import("./models-hub");
const { GeneralSettings } = await import("./Settings/pages/GeneralSettings");
const { AgentToolsSettings } = await import("./Settings/pages/AgentToolsSettings");

test("configured MCP servers show unknown connection honestly and propagate registry errors", async () => {
  let fail = false;
  window.__TAURI__ = {
    core: {
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        expect(command).toBe("aphrody_rpc");
        const method = (args?.request as { method: string } | undefined)?.method;
        if (fail) return { error: { message: "synthetic unavailable" } } as T;
        if (method === "initialize") return { result: { serverInfo: { name: "aphrody" } } } as T;
        if (method === "initialized") return {} as T;
        if (method === "tools/list") return { result: { data: [] } } as T;
        expect(method).toBe("mcpServerStatus/list");
        return {
          result: {
            servers: [{ name: "synthetic", status: "unknown", toolCount: 0 }],
          },
        } as T;
      },
    },
  };
  await mount(createElement(AgentToolsSettings));
  await click("Actualiser");
  expect(host.textContent).toContain("Connexion non vérifiée");
  expect(host.textContent).not.toContain("Aucun serveur configuré");
  fail = true;
  await click("Actualiser");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Impossible de lire les outils");
});

let root: Root | undefined;
const originalTauri = window.__TAURI__;
const testWindow = window as unknown as {
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: unknown) => Promise<unknown>;
    transformCallback?: (callback: unknown, once?: boolean) => number;
  };
};
const originalInternals = testWindow.__TAURI_INTERNALS__;
const host = document.createElement("div");
document.body.append(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.__TAURI__ = originalTauri;
  testWindow.__TAURI_INTERNALS__ = originalInternals;
  host.replaceChildren();
});

test("update installation uses the signed updater hook and restarts only after successful installation", async () => {
  testWindow.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: async command =>
      command === "plugin:store|load" ? 1 : command === "plugin:store|get" ? [null, false] : undefined,
  };
  const calls: string[] = [];
  window.__TAURI__ = {
    core: {
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push(command);
        if (command === "plugin:updater|check") return { rid: 42, currentVersion: "1.0.0", version: "1.0.1" } as T;
        if (command === "plugin:updater|download_and_install") {
          expect(args?.rid).toBe(42);
          const channel = args?.onEvent as {
            onmessage: (message: unknown) => void;
          };
          channel.onmessage({ event: "Started", data: { contentLength: 100 } });
          channel.onmessage({ event: "Progress", data: { chunkLength: 100 } });
        }
        return undefined as T;
      },
    },
  };
  await mount(createElement(GeneralSettings));
  await click("Vérifier les mises à jour");
  expect(host.textContent).toContain("Version 1.0.1 disponible");
  await click("Installer et redémarrer");
  expect(calls).not.toContain("plugin:updater|download_and_install");
  const dialog = document.querySelector('[role="alertdialog"]');
  const confirmation = [...dialog!.querySelectorAll("button")].find(
    button => button.textContent === "Installer et redémarrer",
  );
  await act(async () => confirmation!.click());
  expect(calls.slice(-2)).toEqual(["plugin:updater|download_and_install", "plugin:process|restart"]);
});

async function mount(node: React.ReactNode) {
  root = createRoot(host);
  await act(async () => root!.render(node));
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent?.includes(label));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

test("rendered archived history restores through the canonical RPC and removes the archived row", async () => {
  const calls: string[] = [];
  await mount(
    createElement(HistoryPanel, {
      rpc: async (method, params) => {
        calls.push(method);
        if (method === "thread/list")
          return {
            threads: params?.archived
              ? [
                  {
                    id: "synthetic",
                    name: "Archived synthetic thread",
                    updatedAt: 2,
                  },
                ]
              : [],
          };
        expect(params?.threadId).toBe("synthetic");
        return { archived: false };
      },
      onOpen: () => {
        throw new Error("archived thread must be restored before opening");
      },
      onNewThread: () => {},
      onClose: () => {},
    }),
  );
  await click("Show archived history");
  expect(host.textContent).toContain("Archived synthetic thread");
  expect(host.querySelector("button[disabled]")).not.toBeNull();
  await click("Restore");
  expect(calls).toContain("thread/unarchive");
  expect(host.textContent).not.toContain("Archived synthetic thread");
});

test("rendered hub reports transport failure instead of a successful empty store", async () => {
  testWindow.__TAURI_INTERNALS__ = {
    invoke: async command =>
      command === "plugin:store|load" ? 1 : command === "plugin:store|get" ? [null, false] : undefined,
  };
  window.__TAURI__ = {
    core: {
      invoke: async () => {
        throw new Error("synthetic unavailable");
      },
    },
  };
  await mount(createElement(MemoryRouter, {}, createElement(ModelsHub)));
  expect(host.textContent).toContain("Catalogue : synthetic unavailable");
  expect(host.textContent).toContain("Stockage : synthetic unavailable");
  expect(host.querySelector('button[aria-label="Réessayer"]')).not.toBeNull();
});

test("rendered update check does not report up-to-date when the release feed fails", async () => {
  testWindow.__TAURI_INTERNALS__ = {
    invoke: async command =>
      command === "plugin:store|load" ? 1 : command === "plugin:store|get" ? [null, false] : undefined,
  };
  window.__TAURI__ = {
    core: {
      invoke: async <T>(command: string): Promise<T> => {
        if (command === "plugin:updater|check") throw new Error("synthetic feed failure");
        if (command === "plugin:store|load") return 1 as T;
        if (command === "plugin:store|get") return [null, false] as T;
        return undefined as T;
      },
    },
  };
  await mount(createElement(GeneralSettings));
  await click("Vérifier les mises à jour");
  expect(host.textContent).toContain("Vérification impossible");
  expect(host.textContent).not.toContain("Votre application est à jour");
  expect(host.textContent).not.toContain("Aphrody 2.0");
});

test("rendered model favorites persist and deletion waits for the M3 confirmation", async () => {
  const settings = new Map<string, unknown>();
  testWindow.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      const input = args as { key: string; value?: unknown };
      if (command === "plugin:store|load") return 1;
      if (command === "plugin:store|get") return [settings.get(input.key), settings.has(input.key)];
      if (command === "plugin:store|set") settings.set(input.key, input.value);
      return undefined;
    },
  };
  const removed: unknown[] = [];
  const entry = {
    id: "synthetic-embedding",
    title: "Synthetic embedding",
    task: "text-embedding",
    backend: "synthetic",
    summary: "Test data",
    files: [],
    accel: [],
    vram_min_bytes: 0,
    speed: "",
    license: { spdx: "Apache-2.0" },
  };
  window.__TAURI__ = {
    core: {
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (command === "aphrody_model_catalog") return { entries: [entry], count: 1 } as T;
        if (command === "aphrody_model_list")
          return {
            root: "/synthetic",
            count: 1,
            total_bytes: 10,
            models: [
              {
                ref: "synthetic-ref",
                catalog_id: entry.id,
                path: "/synthetic/file",
                bytes: 10,
                format: "gguf",
              },
            ],
          } as T;
        if (command === "aphrody_model_remove") removed.push(args);
        return {} as T;
      },
    },
  };
  await mount(
    createElement(
      MemoryRouter,
      { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      createElement(ModelsHub),
    ),
  );
  const chatButton = [...host.querySelectorAll("button")].find(button =>
    button.textContent?.includes("Utiliser dans le chat"),
  );
  expect(chatButton?.disabled).toBe(true);
  await click("Ajouter aux favoris");
  expect(settings.get("favoriteModels")).toEqual([entry.id]);
  await click("Supprimer");
  expect(removed).toEqual([]);
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  const confirmation = [...dialog!.querySelectorAll("button")].find(button => button.textContent === "Supprimer");
  await act(async () => confirmation!.click());
  expect(removed).toEqual([{ id: entry.id }]);
});
