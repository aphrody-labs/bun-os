// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { callM3Tool, listM3Tools } from "../src/tools.ts";

test("the viz3d tools are listed with JSON schemas", () => {
  const names = listM3Tools().map(tool => tool.name);
  for (const name of ["viz3d_search", "viz3d_resolve", "viz3d_design_context", "viz3d_blueprints", "viz3d_host_probe", "viz3d_validate", "viz3d_capture"])
    expect(names).toContain(name);
});

test("viz3d tools return structured results", async () => {
  const search = await callM3Tool("viz3d_search", { query: "timber cottage at dusk", limit: 3 });
  expect(search.isError).not.toBe(true);
  const hits = (search.structuredContent as { results: { id: string }[] }).results;
  expect(hits[0]?.id).toBe("knowledge.blueprint-timber-cottage");
  expect(JSON.parse(search.content[0]!.text).results.length).toBe(3);
  const resolved = await callM3Tool("viz3d_resolve", { ids: ["knowledge.blueprint-timber-cottage"] });
  expect(Object.keys((resolved.structuredContent as { blueprints: object }).blueprints)).toEqual(["knowledge.blueprint-timber-cottage"]);
  const blueprints = await callM3Tool("viz3d_blueprints", {});
  expect((blueprints.structuredContent as { blueprints: unknown[] }).blueprints.length).toBe(22);
  expect((await callM3Tool("viz3d_search", { query: "x", limit: 21 })).isError).toBe(true);
  expect((await callM3Tool("viz3d_resolve", { ids: ["knowledge.nope"] })).isError).toBe(true);
});

test("the executable host serves a viz3d call", () => {
  const host = Bun.fileURLToPath(new URL("../src/tool-host.ts", import.meta.url));
  const call = Bun.spawnSync([process.execPath, host, "call", "viz3d_validate", "{}"], { windowsHide: true });
  const result = JSON.parse(call.stdout.toString());
  expect(result.structuredContent.ok).toBe(true);
  expect(result.structuredContent.counts).toEqual({ recipes: 223, knowledge: 440, blueprints: 22, sources: 451, directions: 24 });
});
