// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test";
import { driveFingerprint } from "../rootfs/usr/libexec/bunos/drive-identity.ts";

function config(token: string, root = "root-a") {
  return { gdrive: { type: "drive", token: JSON.stringify({ access_token: token }), root_folder_id: root } };
}

function account(id: string) {
  return (async () => Response.json({ user: { permissionId: id } })) as typeof fetch;
}

test("cache identity follows the account and root, not rotating access tokens", async () => {
  const initial = await driveFingerprint(config("first"), account("account-a"));
  expect(await driveFingerprint(config("rotated"), account("account-a"))).toBe(initial);
  expect(await driveFingerprint(config("first"), account("account-b"))).not.toBe(initial);
  expect(await driveFingerprint(config("first", "root-b"), account("account-a"))).not.toBe(initial);
});

test("unverified identities and other providers are refused", async () => {
  await expect(driveFingerprint(config("token"), (async () => new Response("", { status: 403 })) as typeof fetch))
    .rejects.toThrow();
  await expect(driveFingerprint({ gdrive: { type: "alias", token: "{}" } }, account("account-a")))
    .rejects.toThrow();
  await expect(driveFingerprint(config("token"), (async () => Response.json({ user: {} })) as typeof fetch))
    .rejects.toThrow();
  await expect(driveFingerprint({ gdrive: { type: "drive", token: "fake-secret-not-json" } }, account("account-a")))
    .rejects.toThrow("invalid Drive token record");
});
