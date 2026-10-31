import { expect, test } from "bun:test";
import chromium, { chrome, connect, manifests, profiles, protocol } from "../src/index.ts";
import owner from "../src/modules/chromium.ts";
import { runChromiumCommand } from "../src/cli.ts";

test("Chromium SDK preserves the exact capability owner", () => {
  expect(chromium).toBe(owner);
  expect(chrome).toBe(owner);
  expect(connect).toBe(owner.connect);
  expect(manifests).toBe(owner.manifests);
  expect(profiles).toBe(owner.profiles);
  expect(protocol).toBe(owner.protocol);
});

test("Chromium commands validate explicit inputs through the owner", async () => {
  expect(await runChromiumCommand(["validate-url", "https://example.test/path"])).toEqual({
    url: "https://example.test/path",
  });
  await expect(runChromiumCommand(["validate-url", "file:///secret"])).rejects.toThrow();
  await expect(runChromiumCommand(["bookmarks"])).rejects.toThrow();
  await expect(runChromiumCommand(["status", "unexpected"])).rejects.toThrow();
  await expect(runChromiumCommand(["unknown"])).rejects.toThrow();
});
