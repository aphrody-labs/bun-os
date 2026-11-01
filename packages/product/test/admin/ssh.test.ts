// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { realSystem } from "../../src/admin/lib/system.ts";
import {
  classifySshFailure,
  ensureSshKey,
  hostAlias,
  machineLabel,
  removeIncludeBlock,
  renderSshConfig,
  shellQuote,
  sshArgv,
  withIncludeBlock,
  writeSshFiles,
} from "../../src/admin/lib/ssh.ts";
import { samplePack, testContext } from "./helpers.ts";

test("shellQuote encodes every shell metacharacter as a POSIX single-quoted literal", () => {
  for (const value of ["plain", "with space", "it's", "$(id)", "`id`", "a;b", 'a"b', "a\\b", "*", "-n", ""]) {
    expect(shellQuote(value)).toBe(`'${value.replaceAll("'", `'\\''`)}'`);
  }
});

test("ssh_config has one alias per host and pins nothing it does not know", () => {
  const { ctx } = testContext();
  const text = renderSshConfig(samplePack(), ctx.paths);
  expect(text).toContain(`Host ${hostAlias("vps")}`);
  expect(text).toContain("HostName 198.51.100.2");
  expect(text).toContain("StrictHostKeyChecking accept-new");
  expect(text).toContain("IdentitiesOnly yes");
  expect(text).not.toContain("\\");
  const pinned = renderSshConfig(samplePack({ hostKeys: ["198.51.100.1 ssh-ed25519 AAAAFake"] }), ctx.paths);
  expect(pinned).toContain("StrictHostKeyChecking yes");
});

test("the Include block is added once, refreshed in place, and removable without touching the rest", () => {
  const original = "Host github.com\n  User git\n";
  const once = withIncludeBlock(original, "C:\\Users\\Omar\\.aphrody\\omar\\ssh_config");
  expect(
    once.startsWith(
      '# >>> aphrody-omar >>>\nInclude "C:/Users/Omar/.aphrody/omar/ssh_config"\n# <<< aphrody-omar <<<\n',
    ),
  ).toBe(true);
  expect(once.endsWith(original)).toBe(true);
  expect(withIncludeBlock(once, "C:\\Users\\Omar\\.aphrody\\omar\\ssh_config")).toBe(once);
  expect(removeIncludeBlock(once)).toBe(original);
  expect(removeIncludeBlock(withIncludeBlock("", "/x"))).toBe("");
  const crlf = withIncludeBlock("Host a\r\n  User b\r\n", "/x");
  expect(crlf).toContain("\r\n");
  expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
});

test("writeSshFiles saves the user's ssh config before changing it and is idempotent", async () => {
  const { ctx } = testContext();
  mkdirSync(dirname(ctx.paths.userSshConfig), { recursive: true });
  writeFileSync(ctx.paths.userSshConfig, "Host old\n  User me\n");
  const pack = samplePack({ hostKeys: ["198.51.100.1 ssh-ed25519 AAAAFake"] });
  const first = await writeSshFiles(pack, ctx.paths, new Date("2026-10-06T12:00:00Z"));
  expect(first.changedUserConfig).toBe(true);
  expect(readFileSync(first.backup!, "utf8")).toBe("Host old\n  User me\n");
  expect(readFileSync(ctx.paths.userSshConfig, "utf8")).toContain("Host old");
  expect(readFileSync(ctx.paths.knownHostsFile, "utf8")).toBe("198.51.100.1 ssh-ed25519 AAAAFake\n");
  const second = await writeSshFiles(pack, ctx.paths, new Date("2026-10-06T12:05:00Z"));
  expect(second.changedUserConfig).toBe(false);
  expect(readdirSync(dirname(ctx.paths.userSshConfig)).filter(name => name.includes("avant-aphrody"))).toHaveLength(1);
});

test("sshArgv sends the script on stdin and quotes every argument", () => {
  const { ctx } = testContext();
  const argv = sshArgv(ctx.paths, "gpu", {
    args: ["a b", "it's"],
    connectTimeoutSecs: 5,
  });
  expect(argv.slice(0, 3)).toEqual(["ssh", "-F", ctx.paths.sshConfigFile]);
  expect(argv).toContain("BatchMode=yes");
  expect(argv).toContain("ConnectTimeout=5");
  expect(argv.at(-2)).toBe("aphrody-gpu");
  expect(argv.at(-1)).toBe(`sh -s -- 'a b' 'it'\\''s'`);
  expect(sshArgv(ctx.paths, "gpu").at(-1)).toBe("sh -s --");
});

const fail = (stderr: string, code = 255, timedOut = false) =>
  classifySshFailure({ code, stdout: "", stderr, timedOut });

test("ssh failures are told apart in plain words", () => {
  expect(fail("omar@x: Permission denied (publickey).")).toBe("cle-refusee");
  expect(fail("Host key verification failed.")).toBe("hote-inconnu");
  expect(fail("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@")).toBe("hote-inconnu");
  expect(fail("ssh: connect to host x port 22: Connection timed out")).toBe("injoignable");
  expect(fail("ssh: connect to host x port 22: Connection refused")).toBe("injoignable");
  expect(fail("", 124, true)).toBe("delai");
  expect(fail("something odd")).toBe("autre");
  expect(fail("remote script failed", 3)).toBeUndefined();
});

test("ensureSshKey creates an ed25519 key once and never overwrites it (real ssh-keygen)", async () => {
  const { ctx } = testContext({ platform: "linux" });
  const sys = realSystem(ctx.sys.env);
  const made = await ensureSshKey(sys, ctx.paths, "omar@PC");
  expect(made.created).toBe(true);
  expect(made.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
  expect(made.publicKey.endsWith("omar@PC")).toBe(true);
  const before = readFileSync(ctx.paths.sshKey, "utf8");
  const again = await ensureSshKey(sys, ctx.paths, "omar@OTHER");
  expect(again.created).toBe(false);
  expect(again.publicKey).toBe(made.publicKey);
  expect(readFileSync(ctx.paths.sshKey, "utf8")).toBe(before);
  // private key without its public half: the public half is derived, the private key untouched
  Bun.spawnSync(["rm", `${ctx.paths.sshKey}.pub`], { windowsHide: true });
  const derived = await ensureSshKey(sys, ctx.paths, "omar@PC");
  expect(derived.created).toBe(false);
  expect(existsSync(`${ctx.paths.sshKey}.pub`)).toBe(true);
  expect(readFileSync(ctx.paths.sshKey, "utf8")).toBe(before);
});

test("machineLabel keeps only safe characters", () => {
  expect(machineLabel({ COMPUTERNAME: "PC d'Omar (salon)" })).toBe("PC-d-Omar--salon-");
  expect(machineLabel({})).toBe("pc");
});
