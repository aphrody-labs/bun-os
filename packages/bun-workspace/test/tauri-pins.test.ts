import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** `name = { version = "=x" ...}` / `name = "x"` entries of the Tauri family in a manifest. */
function pins(manifest: string, section: RegExp): Map<string, string> {
  const start = manifest.search(section);
  const body = manifest.slice(start).split(/\n\[/)[0] ?? "";
  const out = new Map<string, string>();
  for (const line of body.split("\n")) {
    const match = /^(tauri(?:-[a-z-]+)?|wry|tao|muda|tray-icon|webview2-com)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/.exec(line);
    if (match) out.set(match[1]!, (match[2] ?? match[3])!);
  }
  return out;
}

const workspace = pins(read("Cargo.toml"), /^\[workspace\.dependencies\]/m);

test("the root pins one upstream Tauri 3 line", () => {
  expect(workspace.get("tauri")).toMatch(/^=3\.0\.0-alpha\./);
  expect(workspace.get("tauri-build")).toMatch(/^=3\./);
  expect(workspace.get("tauri-runtime-wry")).toMatch(/^=3\./);
  expect(workspace.get("wry")).toBeDefined();
  expect(workspace.get("muda")).toBeDefined();
});

test("the standalone artcraft app repeats the workspace pins exactly", () => {
  const artcraft = pins(read("apps/artcraft/Cargo.toml"), /^\[dependencies\]/m);
  const build = pins(read("apps/artcraft/Cargo.toml"), /^\[build-dependencies\]/m);
  for (const [name, version] of [...artcraft, ...build]) {
    if (!workspace.has(name)) continue;
    expect({ name, version }).toEqual({ name, version: workspace.get(name)! });
  }
});

test("no workspace member carries its own Tauri-family version", () => {
  const offenders: string[] = [];
  const dirs = ["apps", "crates"];
  for (const dir of dirs) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "artcraft") continue;
      for (const candidate of [`${dir}/${entry.name}/Cargo.toml`, `${dir}/${entry.name}/src-tauri/Cargo.toml`]) {
        let manifest: string;
        try {
          manifest = read(candidate);
        } catch {
          continue;
        }
        if (/^\[workspace\]/m.test(manifest)) continue;
        for (const section of [/^\[dependencies\]/m, /^\[build-dependencies\]/m, /^\[dev-dependencies\]/m]) {
          for (const [name, version] of pins(manifest, section)) {
            if (name === "tauri-plugin-aphrody") continue;
            offenders.push(`${candidate}: ${name} = ${version}`);
          }
        }
      }
    }
  }
  expect(offenders.filter(line => !/workspace\s*=\s*true/.test(line))).toEqual([]);
}, 60_000);
