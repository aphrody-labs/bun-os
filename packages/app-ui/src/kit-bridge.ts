// SPDX-License-Identifier: Apache-2.0
// Kit bridge (protocol `aphrody.kit/1`): types the events of one run of the `admin` and `creator`
// surfaces. Its native host (apps/aphrody-app, src/kits.rs) and the kit side (product `desktop`
// subcommands) were retired on 2026-10-31; without a host `isTauri()` is false and the surfaces stay hidden.
import { Channel, invoke } from "./web-runtime";
import { isTauri } from "./tauri-bridge";

export const KIT_PROTOCOL = "aphrody.kit/1";

export type KitName = "omar" | "creator";

export type KitFieldKind = "text" | "path" | "url" | "number" | "select" | "boolean";

export interface KitField {
  name: string;
  label: string;
  kind: KitFieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  flag?: string;
  repeat?: boolean;
  default?: string | boolean;
}

export interface KitAction {
  id: string;
  group: string;
  title: string;
  description?: string;
  icon?: string;
  fields?: KitField[];
  confirm?: { message: string; typed?: string };
  longRunning?: boolean;
  windowsOnly?: boolean;
}

export interface KitGroup {
  id: string;
  title: string;
  icon: string;
}

export interface KitCatalog {
  protocol: string;
  kit: string;
  title: string;
  version: string;
  platform: string;
  groups: KitGroup[];
  actions: KitAction[];
  admin?: boolean;
}

export type KitAskKind = "text" | "confirm" | "typed";

export type KitEvent =
  | { type: "catalog"; catalog: KitCatalog }
  | { type: "say"; text: string; stream?: "out" | "err" }
  | {
      type: "ask";
      id: number;
      kind: KitAskKind;
      question: string;
      expect?: string;
      fallback?: boolean;
    }
  | { type: "done"; code: number }
  | { type: "error"; message: string }
  /** Sent by the desktop when the kit process ended (code null: stopped). */
  | { type: "exit"; session: number; code: number | null };

export type KitInput = Record<string, string | boolean | undefined>;

export interface KitRun {
  session: number;
  answer(answer: string | null): Promise<void>;
  cancel(): Promise<void>;
}

const NOT_DESKTOP = "Cette vue nécessite l’application Aphrody.";

/** Start `<kit> desktop <args>`; every event goes to `onEvent` in order. */
export async function startKit(kit: KitName, args: string[], onEvent: (event: KitEvent) => void): Promise<KitRun> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  const channel = new Channel<KitEvent>();
  // Channel exposes only the `onmessage` setter.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  channel.onmessage = onEvent;
  const session = await invoke<number>("aphrody_kit_start", {
    kit,
    args,
    channel,
  });
  return {
    session,
    answer: answer => invoke<void>("aphrody_kit_answer", { session, answer }),
    cancel: () => invoke<void>("aphrody_kit_cancel", { session }),
  };
}

const catalogs = new Map<KitName, Promise<KitCatalog>>();

/** The kit's catalog; cached per kit until `refresh`. Rejects when the kit is not installed. */
export function kitCatalog(kit: KitName, refresh = false): Promise<KitCatalog> {
  const cached = catalogs.get(kit);
  if (cached && !refresh) return cached;
  const pending = new Promise<KitCatalog>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    startKit(kit, ["catalog"], event => {
      if (event.type === "catalog" && !settled) {
        if (event.catalog.protocol !== KIT_PROTOCOL)
          return fail(`Protocole du kit non pris en charge : ${event.catalog.protocol}`);
        settled = true;
        resolve(event.catalog);
      } else if (event.type === "error") fail(event.message);
      else if (event.type === "exit") fail("Le kit s’est arrêté sans catalogue.");
    }).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  });
  catalogs.set(kit, pending);
  pending.catch(() => catalogs.delete(kit));
  return pending;
}

/** @internal Reset the in-memory catalog cache between tests. */
export function clearKitCatalogsForTesting(): void {
  catalogs.clear();
}

export interface RunLine {
  /** Position in the run, a stable key for the log. */
  id: number;
  text: string;
  stream: "out" | "err";
}

export interface RunState {
  status: "idle" | "running" | "asking" | "done" | "failed" | "stopped";
  lines: RunLine[];
  question: Extract<KitEvent, { type: "ask" }> | null;
  code: number | null;
}

export const idleRun: RunState = {
  status: "idle",
  lines: [],
  question: null,
  code: null,
};

/** Longest log kept on screen. */
export const MAX_LINES = 2000;

/** Pure state of one run, folded over its events. */
export function reduceRun(state: RunState, event: KitEvent): RunState {
  const push = (line: Omit<RunLine, "id">): RunLine[] =>
    [...state.lines, { ...line, id: (state.lines.at(-1)?.id ?? 0) + 1 }].slice(-MAX_LINES);
  switch (event.type) {
    case "say":
      return {
        ...state,
        lines: push({ text: event.text, stream: event.stream ?? "out" }),
      };
    case "ask":
      return { ...state, status: "asking", question: event };
    case "error":
      return { ...state, lines: push({ text: event.message, stream: "err" }) };
    case "done":
      return {
        ...state,
        status: event.code === 0 ? "done" : "failed",
        question: null,
        code: event.code,
      };
    case "exit":
      if (state.status === "done" || state.status === "failed") return state;
      return {
        ...state,
        status: event.code === null ? "stopped" : "failed",
        question: null,
        code: event.code,
      };
    case "catalog":
      return state;
  }
}

/** The dialog answered: back to running. */
export const answered = (state: RunState): RunState => ({
  ...state,
  status: "running",
  question: null,
});

/** A typed confirmation is valid only when the expected word is typed exactly. */
export const typedOk = (expect: string | undefined, value: string): boolean =>
  expect === undefined || value.trim() === expect;

/** Actions shown on this platform (Windows-only actions are hidden elsewhere). */
export function visibleActions(catalog: KitCatalog, group: string): KitAction[] {
  return catalog.actions.filter(
    action => action.group === group && (!action.windowsOnly || catalog.platform === "win32"),
  );
}
