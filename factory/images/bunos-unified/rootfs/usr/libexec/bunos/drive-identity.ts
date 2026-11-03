// SPDX-License-Identifier: MIT
// The rclone config is read through a private child-process pipe, never
// command arguments or logs.
// Print only a fingerprint tying the cache to Google's verified Drive user and
// to the configured remote root. Failure must prevent a mount.
export async function driveFingerprint(
  config: Record<string, Record<string, unknown>>,
  request: typeof fetch = fetch,
): Promise<string> {
  const drive = config.gdrive;
  if (!drive || drive.type !== "drive" || typeof drive.token !== "string") throw new Error("invalid Drive config");
  let token: { access_token?: unknown };
  try {
    token = JSON.parse(drive.token) as { access_token?: unknown };
  } catch {
    throw new Error("invalid Drive token record");
  }
  if (typeof token.access_token !== "string" || !token.access_token) throw new Error("missing Drive token");
  const response = await request("https://www.googleapis.com/drive/v3/about?fields=user(permissionId)", {
    headers: { authorization: `Bearer ${token.access_token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Drive identity unavailable");
  const body = (await response.json()) as { user?: { permissionId?: unknown } };
  const permissionId = body.user?.permissionId;
  if (typeof permissionId !== "string" || !permissionId) throw new Error("missing Drive identity");
  const options = Object.entries(drive)
    .filter(([key]) => key !== "token" && key !== "client_secret")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(["bunos-drive-cache-v1", permissionId, options]))
    .digest("hex");
}

if (import.meta.main) {
  try {
    const path = Bun.argv[2];
    if (!path) throw new Error("missing config path");
    const child = Bun.spawn({
      cmd: ["timeout", "-k", "5s", "15s", "rclone", "--config", path, "config", "dump"],
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("rclone config unavailable");
    const config = JSON.parse(output) as Record<string, Record<string, unknown>>;
    console.log(await driveFingerprint(config));
  } catch {
    console.error("bunos-drive: cannot verify the Drive account and remote");
    process.exitCode = 1;
  }
}
