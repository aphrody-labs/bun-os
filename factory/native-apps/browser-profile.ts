#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Seeds a Chromium-family browser profile (Helium fork, Chromium fallback) in a session home from an exported Chrome
// profile: Bookmarks as-is, the portable part of Preferences (startup pages, search engine, home page, bookmark bar,
// new tab shortcuts, fonts, languages, spellcheck, content settings), and the extensions as an
// ExtensionInstallForcelist managed policy. Machine- and account-bound state (sign-in, sync, passwords, cookies,
// MAC-protected and enterprise keys) is dropped: cookies and passwords are encrypted with the Windows DPAPI key and do
// not carry over; Google sign-in with Sync inside the session restores them.
//
//   bun factory/native-apps/browser-profile.ts --import <dir> --home <home> [--policy-root /] [--uid 1000]
//
// <dir> holds Bookmarks, Preferences and extensions.jsonl ({id,name,version} per line). Only ever run for the owner's
// own home volume; shared and demo sessions never receive this profile.
import { chmod, chown, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    import: { type: "string" },
    home: { type: "string" },
    "policy-root": { type: "string", default: "/" },
    uid: { type: "string", default: "1000" },
  },
});
if (!values.import || !values.home) throw new Error("usage: --import <dir> --home <home> [--policy-root /] [--uid 1000]");

/** Profile directories read by the Helium fork and by plain Chromium. */
const PROFILE_DIRS = [".config/net.imput.helium/Default", ".config/chromium/Default"];
/** Managed policy directories (Helium on Linux reads the Chromium path as well). */
const POLICY_DIRS = ["etc/chromium/policies/managed", "etc/helium/policies/managed"];
/** Top-level Preferences keys that carry no machine or account binding. */
const PORTABLE = [
  "bookmark_bar",
  "browser",
  "custom_links",
  "default_search_provider",
  "default_search_provider_data",
  "homepage",
  "homepage_is_newtabpage",
  "intl",
  "NewTabPage",
  "session",
  "spellcheck",
  "translate",
  "webkit",
];
/** Keys inside "profile" that are portable (content settings, cookie and default content policies). */
const PORTABLE_PROFILE = ["content_settings", "default_content_setting_values", "block_third_party_cookies", "cookie_controls_mode"];
/** Content setting types that record the user's own allow/block decisions. */
const PERMISSION_TYPES = [
  "automatic_downloads",
  "clipboard",
  "cookies",
  "geolocation",
  "images",
  "javascript",
  "media_stream_camera",
  "media_stream_mic",
  "midi_sysex",
  "notifications",
  "popups",
  "protocol_handler",
  "sensors",
  "sound",
  "window_placement",
];
/** Extensions that are not installable from the Web Store (retired Google components). */
const UNINSTALLABLE = new Set(["nmmhkkegccagdldgiimedpiccmgmieda"]); // Chrome Web Store Payments
const UPDATE_URL = "https://clients2.google.com/service/update2/crx";

const dir = values.import;
const prefs = (await Bun.file(join(dir, "Preferences")).json()) as Record<string, unknown>;
const portable: Record<string, unknown> = {};
for (const key of PORTABLE) if (key in prefs) portable[key] = prefs[key];
const profile = prefs.profile as Record<string, unknown> | undefined;
if (profile) {
  const kept: Record<string, unknown> = {};
  for (const key of PORTABLE_PROFILE) if (key in profile) kept[key] = profile[key];
  // Only the user's permission decisions; engagement scores and other per-site telemetry stay behind.
  const settings = kept.content_settings as { exceptions?: Record<string, unknown> } | undefined;
  if (settings?.exceptions) {
    const exceptions: Record<string, unknown> = {};
    for (const type of PERMISSION_TYPES) if (type in settings.exceptions) exceptions[type] = settings.exceptions[type];
    kept.content_settings = { exceptions };
  }
  portable.profile = kept;
}
// Window placement and per-machine browser state are not portable.
if (portable.browser && typeof portable.browser === "object") {
  const { window_placement: _w, app_window_placement: _a, last_known_google_url: _g, ...rest } = portable.browser as Record<string, unknown>;
  portable.browser = rest;
}

const extensions = (await Bun.file(join(dir, "extensions.jsonl")).text())
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as { id: string; name: string });
const forced = extensions.filter((e) => /^[a-p]{32}$/.test(e.id) && !UNINSTALLABLE.has(e.id));
const skipped = extensions.filter((e) => !forced.includes(e));

const uid = Number(values.uid);
for (const rel of PROFILE_DIRS) {
  const target = join(values.home, rel);
  await mkdir(target, { recursive: true });
  await Bun.write(join(target, "Bookmarks"), Bun.file(join(dir, "Bookmarks")));
  await Bun.write(join(target, "Preferences"), JSON.stringify(portable));
  for (const file of ["Bookmarks", "Preferences"]) await chmod(join(target, file), 0o600);
  // Ownership of the whole chain inside the home (the session user owns its profile).
  let path = values.home;
  for (const part of rel.split("/")) {
    path = join(path, part);
    await chown(path, uid, uid).catch(() => {});
  }
  for (const file of ["Bookmarks", "Preferences"]) await chown(join(target, file), uid, uid).catch(() => {});
}

const policy = {
  ExtensionInstallForcelist: forced.map((e) => `${e.id};${UPDATE_URL}`),
  BrowserSignin: 1,
  SyncDisabled: false,
};
for (const rel of POLICY_DIRS) {
  const target = join(values["policy-root"], rel);
  await mkdir(target, { recursive: true });
  await Bun.write(join(target, "aphrody-owner-extensions.json"), `${JSON.stringify(policy, null, 2)}\n`);
}

console.log(
  JSON.stringify({
    profiles: PROFILE_DIRS.map((rel) => join(values.home!, rel)),
    preferences: Object.keys(portable),
    forced: forced.map((e) => e.id),
    skipped: skipped.map((e) => ({ id: e.id, reason: "not installable from the Chrome Web Store" })),
    policies: POLICY_DIRS.map((rel) => join(values["policy-root"]!, rel)),
  }),
);
