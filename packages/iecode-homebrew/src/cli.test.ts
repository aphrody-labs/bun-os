import { expect, test } from "bun:test";

test("help works without Cargo or the native binary", async () => {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/cli.ts`, "--help"], {
    env: { ...process.env, PATH: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toContain("targets|doctor|build");
  expect(await child.exited).toBe(0);
});

test.skipIf(process.platform === "win32")(
  "configured native binary receives arguments without invoking Cargo",
  async () => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/cli.ts`, "targets"], {
      env: { ...process.env, IECODE_HOMEBREW_BINARY: "/bin/echo", PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect((await new Response(child.stdout).text()).trim()).toBe("targets");
    expect(await child.exited).toBe(0);
  },
);
