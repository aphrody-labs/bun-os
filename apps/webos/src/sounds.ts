// SPDX-License-Identifier: Apache-2.0
// UI sounds (Spacedrive set, Apache-2.0, see /sounds/LICENSE.apache). On/off, volume and each cue follow the
// "sound.*" preferences. Call initSounds() once; it watches the desktop for windows opening and closing.
// Dispatch `new CustomEvent("aph:notify", { detail: { title, body } })` for notifications.
import { prefs } from "./prefs";

/** Sound file and its level relative to the master volume. */
const FILES = {
  open: ["pairing", 0.4],
  close: ["copy", 0.33],
  notify: ["job-done", 0.6],
} as const;
export type SoundName = keyof typeof FILES;

export const soundsEnabled = () => prefs.get("sound.enabled");
export const setSoundsEnabled = (on: boolean) => prefs.set("sound.enabled", on);

let ext: string | undefined;
/** Play a cue; `force` previews it in Settings even while that cue is switched off. */
export function playSound(name: SoundName, force = false) {
  if (!force && (!soundsEnabled() || !prefs.get("sound.events")[name])) return;
  const [file, level] = FILES[name];
  const a = new Audio();
  ext ??= a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  a.src = `/sounds/${file}.${ext}`;
  a.volume = Math.min(1, level * prefs.get("sound.volume"));
  a.play().catch(() => {});
}

export function initSounds() {
  const isWin = (n: Node): n is HTMLElement =>
    n instanceof HTMLElement && n.matches("section.win");
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (isWin(n)) playSound("open");
      for (const n of r.removedNodes) if (isWin(n)) playSound("close");
    }
  }).observe(document.body, { childList: true, subtree: true });
}
