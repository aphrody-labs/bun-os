// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkCatalog,
  composeNginx,
  composeUnit,
  hostRoot,
  loadCatalog,
  sourceCheckout,
  yoloRoot,
} from "../src/host/index.ts";

const directives = (t: string) =>
  t
    .split("\n")
    .filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("["))
    .toSorted();

test("catalog and tree agree", () => {
  expect(checkCatalog()).toEqual([]);
});

test("YOLO_ROOT overrides the default monorepo checkout", () => {
  expect(yoloRoot({ YOLO_ROOT: "/x" })).toBe("/x");
  expect(yoloRoot({ HOME: "/h" })).toBe(sourceCheckout()!);
  expect(yoloRoot({ HOME: "/h" }, null)).toBe(join("/h", "src", "aphrody"));
});

test("composed units carry every dropped-in directive", () => {
  const text = composeUnit("aphrody-mcp-http-dbfr.service");
  for (const d of ["User=ubuntu", "NoNewPrivileges=true", "SystemCallFilter=@system-service"])
    expect(text).toContain(d);
  expect(text.indexOf("[Service]")).toBeLessThan(text.indexOf("User=ubuntu"));
});

test("every composed unit has no duplicate scalar directives from drop-ins", () => {
  for (const u of loadCatalog().units) {
    const own = readFileSync(join(hostRoot(), u.path), "utf8");
    const merged = directives(composeUnit(u.unit));
    expect(merged.length).toBeGreaterThanOrEqual(directives(own).length);
    for (const l of directives(own)) expect(merged).toContain(l);
  }
});

test("nginx includes inline to the snippet body", () => {
  const out = composeNginx("  location / {\n    include snippets/proxy-upstream.inc;\n  }\n");
  expect(out).toContain("    proxy_http_version 1.1;");
  expect(out).not.toContain("include snippets");
});

test("inventory records and the toolchain manifest are part of the host catalog", () => {
  const inv = loadCatalog().inventory;
  expect(inv?.files).toContain("targets.json");
  expect(inv?.toolchain).toBe("toolchain.json");
  const targets = JSON.parse(readFileSync(join(hostRoot(), inv!.dir, "targets.json"), "utf8"));
  expect(Array.isArray(targets.targets)).toBe(true);
  expect(JSON.parse(readFileSync(join(hostRoot(), inv!.toolchain), "utf8"))).toBeObject();
});
