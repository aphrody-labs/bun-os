import type { Subprocess } from "bun";

export async function stopTestBrowser(
  child: Pick<Subprocess, "pid" | "exitCode" | "kill" | "exited">,
  profile: string,
) {
  if (process.platform === "win32" && child.exitCode === null) {
    Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else child.kill();
  await child.exited;
  const separator = process.platform === "win32" ? "\\" : "/";
  const canonical = profile.replace(/[\\/]+/g, separator).replace(/[\\/]+$/, "");
  const parent = (Bun.env.TMPDIR ?? Bun.env.TEMP ?? Bun.env.TMP ?? ".")
    .replace(/[\\/]+/g, separator)
    .replace(/[\\/]+$/, "");
  const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const normalizedParent = process.platform === "win32" ? parent.toLowerCase() : parent;
  const relative = normalized.slice(normalizedParent.length);
  if (
    !normalized.startsWith(normalizedParent + separator) ||
    !relative.slice(1).startsWith("iecode-chromium-smoke-") ||
    relative.includes("..")
  )
    throw new Error("Unexpected browser test profile cleanup target");
  await Bun.$`rm -rf -- ${canonical}`.quiet();
}
