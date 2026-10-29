// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bunfigHasPlugin, parseArgs, runCli } from "../src/cli.ts";
import { cleanup, FIXTURE, fixtureCopy, tmp } from "./helpers.ts";

afterAll(cleanup);

async function capture(fn: () => Promise<number>): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { code: await fn(), text: lines.join("\n") };
  } finally {
    console.log = log;
  }
}

describe("parseArgs", () => {
  test("command, positionals and flags with values or booleans", () => {
    const parsed = parseArgs(["deploy", "docker", "nginx", "--out", "dist-deploy", "--domain=a.example.com", "--json"]);
    expect(parsed.command).toBe("deploy");
    expect(parsed.positionals).toEqual(["docker", "nginx"]);
    expect(parsed.flags.get("out")).toBe("dist-deploy");
    expect(parsed.flags.get("domain")).toBe("a.example.com");
    expect(parsed.flags.get("json")).toBe(true);
  });
  test("help and version win, a flag without a value is an error, -- passes the rest through", () => {
    expect(parseArgs([]).command).toBe("help");
    expect(parseArgs(["build", "--help"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(() => parseArgs(["build", "--minify"])).toThrow(/--minify needs a value/);
    expect(parseArgs(["smoke", "--", "--weird"]).positionals).toEqual(["--weird"]);
  });
});

describe("bunfigHasPlugin", () => {
  test("accepts a relative path or package specifier that resolves to the m3 plugin", () => {
    expect(bunfigHasPlugin(FIXTURE)).toBe(true);
    expect(bunfigHasPlugin(tmp())).toBe(false);
  });
  test("rejects a bunfig without the plugin", async () => {
    const dir = tmp();
    await Bun.write(join(dir, "bunfig.toml"), '[serve.static]\nplugins = ["some-other-plugin"]\n');
    expect(bunfigHasPlugin(dir)).toBe(false);
    await Bun.write(join(dir, "bunfig.toml"), '[test]\npreload = ["x"]\n');
    expect(bunfigHasPlugin(dir)).toBe(false);
  });
});

describe("runCli", () => {
  test("help, version and targets", async () => {
    expect((await capture(() => runCli(["help"]))).text).toContain("Compile targets: linux-x64");
    expect((await capture(() => runCli(["version"]))).text).toMatch(/^\d+\.\d+\.\d+/);
    const targets = await capture(() => runCli(["targets"]));
    for (const id of [
      "docker",
      "systemd",
      "nginx",
      "vercel",
      "fly",
      "cloudflare",
      "coolify",
      "vscode",
      "windows",
    ])
      expect(targets.text).toContain(id);
  });

  test("build prints the files and a summary; --json is the manifest", async () => {
    const dir = fixtureCopy();
    const human = await capture(() => runCli(["build"], dir));
    expect(human.code).toBe(0);
    expect(human.text).toContain("m3-bun build hello-m3@1.2.3: 3 files");
    expect(existsSync(join(dir, "dist", "index.html"))).toBe(true);
    const machine = await capture(() => runCli(["build", "--json", "--minify", "none"], dir));
    expect(JSON.parse(machine.text).manifest.minify).toBe("none");
  });

  test("deploy generates the requested targets into --out and says nothing was applied", async () => {
    const dir = fixtureCopy();
    const out = tmp();
    const { code, text } = await capture(() =>
      runCli(
        [
          "deploy",
          "docker",
          "systemd",
          "--out",
          out,
          "--domain",
          "x.example.org",
          "--namespace",
          "demo",
          "--user",
          "svc",
        ],
        dir,
      ),
    );
    expect(code).toBe(0);
    expect(text).toContain("generated only: nothing was applied, pushed or reloaded");
    expect(readFileSync(join(out, "systemd", "hello-m3.service"), "utf8")).toContain(
      "WorkingDirectory=/home/svc/apps/demo/current",
    );
    expect(readFileSync(join(out, "systemd", "hello-m3.service"), "utf8")).toContain("User=svc");
    expect(existsSync(join(out, "nginx"))).toBe(false);
    const all = tmp();
    await capture(() =>
      runCli(["deploy", "all", "--out", all, "--http2", "listen", "--tls-cert", "/c.pem", "--tls-key", "/k.pem"], dir),
    );
    const tls = JSON.parse(readFileSync(join(all, "nginx", "hello-m3.nginx.json"), "utf8")).servers[1];
    expect([tls.ssl_certificate, tls.listen_ports]).toEqual(["/c.pem", ["443 ssl http2"]]);
  });

  test("bad flag values are errors, not silent defaults", async () => {
    const dir = fixtureCopy();
    await expect(runCli(["build", "--minify", "extreme"], dir)).rejects.toThrow(/--minify must be none, basic or full/);
    await expect(runCli(["compile", "--target", "plan9-x64"], dir)).rejects.toThrow(/--target must be one of/);
    await expect(runCli(["deploy", "docker", "--tls-cert", "/c.pem"], dir)).rejects.toThrow(/go together/);
    await expect(runCli(["deploy", "heroku"], dir)).rejects.toThrow(/unknown deploy target heroku/);
    await expect(runCli(["serve", "--port", "-1"], dir)).rejects.toThrow(/non-negative integer/);
    await expect(runCli(["package", "--format", "rar"], dir)).rejects.toThrow(/--format must be tar.gz or zip/);
  });

  test("smoke needs a compiled executable and says which command makes one", async () => {
    await expect(runCli(["smoke"], fixtureCopy())).rejects.toThrow(/m3-bun compile first/);
  });
});
