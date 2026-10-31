#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import chromium from "./modules/chromium.ts";

export async function runChromiumCommand(args: string[]): Promise<unknown> {
  const [command, value, ...extra] = args;
  if (extra.length) throw new TypeError("Unexpected Chromium command arguments");
  switch (command) {
    case "status":
      if (value !== undefined) throw new TypeError("status accepts no arguments");
      return { executable: chromium.findExecutable(), transport: "CDP", owner: "@aphrody/chromium" };
    case "validate-url":
      if (!value) throw new TypeError("validate-url requires a URL");
      return { url: chromium.protocol.validateURL(value) };
    case "validate-extension":
      if (!value) throw new TypeError("validate-extension requires manifest JSON");
      return chromium.manifests.validateExtension(JSON.parse(value));
    case "bookmarks":
      if (!value) throw new TypeError("bookmarks requires an explicit Bookmarks file");
      return chromium.profiles.readBookmarks(value);
    default:
      throw new TypeError("Commands: status, validate-url <url>, validate-extension <json>, bookmarks <file>");
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runChromiumCommand(Bun.argv.slice(2))));
  } catch {
    console.error("Chromium command failed; check the command and explicit input");
    process.exitCode = 1;
  }
}
