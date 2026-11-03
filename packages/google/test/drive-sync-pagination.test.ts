// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import type { drive_v3 } from "@googleapis/drive";
import { remoteDocs } from "../src/drive-sync.ts";

test("Drive sync rejects repeated pagination tokens", async () => {
  let calls = 0;
  const drive = {
    files: {
      list: async () => {
        calls++;
        return { data: { files: [], nextPageToken: "repeated" } };
      },
    },
  } as unknown as drive_v3.Drive;
  await expect(remoteDocs(drive, "root")).rejects.toThrow("repeated page token");
  expect(calls).toBe(2);
});
