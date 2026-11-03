import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { qualificationHarnessRevision } from "../web-emulation/qualification";

test("qualification identifies a clean harness and rejects modified or missing inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "bun-emulation-harness-"));
  const paths = [
    "packages/bun-engine/web-emulation/smoke.ts",
    "packages/bun-engine/web-emulation/smoke.html",
    "packages/bun-engine/web-emulation/serve.ts",
    "packages/bun-engine/web-emulation/png.ts",
    "packages/bun-engine/web-emulation/qualification.ts",
    "packages/bun-engine/web-emulation/web-emulation.lock.json",
    "packages/bun-engine/plugins/consoles/roms.json",
    "packages/bun-engine/plugins/consoles/free-firmware.json",
  ];
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  try {
    git("init", "--quiet");
    for (const path of paths) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "fixture\n");
    }
    git("add", "--", ...paths);
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture");
    const baseline = qualificationHarnessRevision(root);
    expect(baseline).toMatch(/^[a-f0-9]{40}$/);
    writeFileSync(join(root, "unrelated.txt"), "unrelated\n");
    git("add", "unrelated.txt");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "unrelated");
    expect(qualificationHarnessRevision(root, baseline)).toBe(baseline);
    writeFileSync(join(root, paths[0]!), "changed\n");
    expect(() => qualificationHarnessRevision(root, baseline)).toThrow("uncommitted changes");
    git("checkout", "--", paths[0]!);
    git("rm", "--quiet", paths[1]!);
    expect(() => qualificationHarnessRevision(root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
