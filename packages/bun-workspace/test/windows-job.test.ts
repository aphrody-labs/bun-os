import { expect, test } from "bun:test";
import { WindowsJob } from "../src/windows-job";

test.skipIf(process.platform !== "win32")("closing a kill-on-close job terminates its processes", async () => {
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const job = new WindowsJob({ killOnClose: true });
  job.assign(child);
  job.close();
  const code = await Promise.race([child.exited, Bun.sleep(10_000).then(() => "alive")]);
  if (code === "alive") child.kill();
  expect(code).not.toBe("alive");
});

test.skipIf(process.platform !== "win32")("terminate ends the assigned process with the given code", async () => {
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const job = new WindowsJob({ killOnClose: true });
  try {
    job.assign(child);
    job.terminate(7);
    expect(await child.exited).toBe(7);
  } finally {
    job.close();
  }
});
