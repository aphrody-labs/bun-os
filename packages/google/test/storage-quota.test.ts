// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createGoogleServices } from "../src/services.ts";

test("reads Drive quota without losing int64 precision or inventing a limit", async () => {
  let requested = "";
  const services = createGoogleServices({
    token: () => "test-token",
    fetch: async input => {
      requested = String(input);
      return Response.json({ storageQuota: { usage: "9007199254740993", usageInDrive: "42" } });
    },
  });
  expect(await services.drive.storageQuota()).toEqual({ usage: "9007199254740993", usageInDrive: "42" });
  expect(new URL(requested).searchParams.get("fields")).toBe("storageQuota");
});

test("rejects malformed quota values", async () => {
  const services = createGoogleServices({
    token: () => "test-token",
    fetch: async () => Response.json({ storageQuota: { usage: -1 } }),
  });
  await expect(services.drive.storageQuota()).rejects.toThrow("storage quota response is invalid");
});
