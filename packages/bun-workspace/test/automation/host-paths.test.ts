// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectHostPaths,
  hostPathArea,
  rewriteHostPaths,
  runHostPaths,
  scanHostPaths,
} from "../../src/automation/host-paths.ts";

// Machine paths are composed so this file does not report itself.
const HOME = ["", "home", "someone"].join("/");
const VPS = ["", "home", "ubuntu"].join("/");

test("rules classify each span once, in priority order", () => {
  const line = `cd ${HOME}/aphrody/scripts && ls ${HOME}/yolo ${HOME}/source/x ${HOME}/.cache ${VPS}/bin /mnt/c/x aphrody-src`;
  expect(scanHostPaths(line, "code").map(item => [item.rule, item.match])).toEqual([
    ["repo-absolute", `${HOME}/aphrody/`],
    ["sibling-absolute", `${HOME}/yolo`],
    ["source-checkouts", `${HOME}/source`],
    ["user-home", HOME],
    ["vps-home", VPS],
    ["wsl-mount", "/mnt/c"],
    ["legacy-layout", "aphrody-src"],
  ]);
  expect(scanHostPaths("see ../source and ../source-map.json", "docs")).toHaveLength(1);
  expect(scanHostPaths(`${HOME}/aphrody`, "code")[0]?.rewrite).toBeUndefined();
});

test("rewrites make prose, records and data location-independent, never code", () => {
  const text = [
    `Run from \`${HOME}/aphrody\` then open ${HOME}/aphrody/docs/x.md.`,
    `{"imagePath":"${VPS}/app/site/public/a.jpg","bot":"${VPS}/app/bot/x"}`,
    `Sibling ${HOME}/yolo/PLAN.md, cache ${HOME}/.cache/x, windows C:\\Users\\someone\\x`,
  ].join("\n");
  expect(rewriteHostPaths(text, "docs")).toBe(
    [
      "Run from `<repo>` then open docs/x.md.",
      '{"imagePath":"~/app/site/public/a.jpg","bot":"~/app/bot/x"}',
      "Sibling ../yolo/PLAN.md, cache ~/.cache/x, windows %USERPROFILE%\\x",
    ].join("\n"),
  );
  expect(rewriteHostPaths(text, "code")).toBe(text);
});

test("areas separate runtime sources from prose, records and data", () => {
  expect(hostPathArea("infra/config/host/vps-cargo.json")).toBe("host");
  expect(hostPathArea("infra/config/host/systemd/aphrody/x.service")).toBe("host");
  expect(hostPathArea("infra/config/production-topology.json")).toBe("config");
  expect(hostPathArea("scripts/a.sh")).toBe("code");
  expect(hostPathArea("config/infra/hosts.json")).toBe("host");
  expect(hostPathArea("crates/os/x/src/tests.rs")).toBe("test");
  expect(hostPathArea("config/rg/package.json")).toBe("config");
  expect(hostPathArea("systemd/x.service")).toBe("host");
  expect(hostPathArea("docs/guides/a.md")).toBe("docs");
  expect(hostPathArea("docs/migration/a.json")).toBe("record");
  expect(hostPathArea("data/lots/a.jsonl")).toBe("data");
});

test("apply skips dirty files and the ratchet reports regressions", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-paths-"));
  const git = (...args: string[]) =>
    expect(Bun.spawnSync(["git", "-C", root, ...args], { windowsHide: true }).exitCode).toBe(0);
  try {
    await mkdir(join(root, "docs/migration"), { recursive: true });
    await writeFile(join(root, "docs/clean.md"), `Open ${HOME}/aphrody/README.md\n`);
    await writeFile(join(root, "docs/dirty.md"), `Open ${HOME}/aphrody/README.md\n`);
    await writeFile(join(root, "docs/migration/map.json"), `{"from":"aphrody-ai/scripts/x.sh"}\n`);
    git("init", "-q");
    git("add", ".");
    const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
    git(...identity, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", "fixture");
    await writeFile(join(root, "docs/dirty.md"), `Open ${HOME}/aphrody/README.md\nlocal edit\n`);
    // Provenance records keep original repository names.
    expect((await collectHostPaths(root)).map(file => file.path)).toEqual(["docs/clean.md", "docs/dirty.md"]);
    const log: string[] = [];
    const original = console.log;
    console.log = (value: string) => log.push(value);
    try {
      expect(await runHostPaths(["--root", root, "--apply", "--write-baseline"])).toBe(0);
    } finally {
      console.log = original;
    }
    expect(JSON.parse(log[0]!).skippedDirty).toEqual(["docs/dirty.md"]);
    expect(await readFile(join(root, "docs/clean.md"), "utf8")).toBe("Open README.md\n");
    expect(await readFile(join(root, "docs/dirty.md"), "utf8")).toContain(`${HOME}/aphrody`);
    await writeFile(join(root, "docs/clean.md"), `Open ${HOME}/x\n`);
    console.log = () => {};
    try {
      expect(await runHostPaths(["--root", root, "--check"])).toBe(1);
    } finally {
      console.log = original;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the declared VPS catalog and fixtures keep their host names", () => {
  expect(scanHostPaths(`${VPS}/x /mnt/c/x`, "host").map(item => item.rule)).toEqual(["wsl-mount"]);
  expect(scanHostPaths(`${HOME}/x`, "test")).toEqual([]);
});
