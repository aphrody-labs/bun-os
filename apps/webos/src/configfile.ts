// SPDX-License-Identifier: Apache-2.0
// Settings as a file, Hyprland-style: `~/.config/bunos/settings.json` holds every non-default preference, including the
// keybinds (`keys.bindings`: action id -> chords). The file is read at start and re-read when it changes (edit it with the
// Editor); changes made in Settings are written back. `prefs` stays the single owner of the values and their validation.
import type { prefs as Prefs } from "./prefs";

export const CONFIG_PATH = "/home/user/.config/bunos/settings.json";

export interface ConfigFs {
  read(path: string): Uint8Array;
  write(path: string, data: Uint8Array): void;
  flush(): Promise<void>;
}

export interface ConfigReport {
  applied: number;
  skipped: string[];
  error?: string;
}

type Store = Pick<typeof Prefs, "export" | "applyPartial" | "subscribe">;

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Apply the file once; a missing file is not an error, a malformed one is reported and changes nothing. */
export function loadConfig(fs: ConfigFs, store: Store, path = CONFIG_PATH): ConfigReport {
  let text: string;
  try {
    text = decode(fs.read(path));
  } catch {
    return { applied: 0, skipped: [] };
  }
  try {
    return store.applyPartial(JSON.parse(text));
  } catch (error) {
    return { applied: 0, skipped: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Keep file and store in step: the file wins when it changes on disk, the store wins when Settings changes. Returns a
 * function that stops both directions. `poll` is the interval in ms for noticing edits of the file.
 */
export function syncConfigFile(fs: ConfigFs, store: Store, options: { path?: string; poll?: number } = {}) {
  const path = options.path ?? CONFIG_PATH;
  let last = "";
  let writing = false;
  const render = () => `${JSON.stringify(store.export().prefs, null, 2)}\n`;
  const write = async () => {
    const text = render();
    if (text === last) return;
    writing = true;
    try {
      last = text;
      fs.write(path, new TextEncoder().encode(text));
      await fs.flush();
    } finally {
      writing = false;
    }
  };
  const check = () => {
    if (writing) return;
    let text: string;
    try {
      text = decode(fs.read(path));
    } catch {
      return void write();
    }
    if (text === last) return;
    last = text;
    loadConfig(fs, store, path);
  };
  check();
  void write();
  const stop = store.subscribe("*", () => void write());
  const timer = options.poll ? setInterval(check, options.poll) : undefined;
  return () => {
    stop();
    if (timer) clearInterval(timer);
  };
}
