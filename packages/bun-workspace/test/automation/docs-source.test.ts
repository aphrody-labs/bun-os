// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSourceReference } from "../../src/automation/docs-source.ts";

test.skipIf(!Bun.which("uv"))("source references extract three languages deterministically without executing modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-source-"));
  try {
    await writeFile(
      join(root, "api.ts"),
      [
        "/** Greets a caller. @param name caller */",
        "export function greet(name: string): string { throw new Error('never'); }",
        "function hidden() {}",
        "export interface Options { name: string; }",
        "export class Client { /** Sends data. */ send(value: string): void { throw 1; } }",
        "export { greet as hello };",
      ].join("\n"),
    );
    await writeFile(join(root, "api.rs"), "//! Crate overview.\n/// Sends a value.\npub fn send() {}\n");
    await writeFile(
      join(root, "api.py"),
      [
        '"""Module facts."""',
        "raise RuntimeError('must never execute')",
        "def greet(name: str, *, count: int = 1) -> str:",
        '    """Greets a caller."""',
        "    return name",
        "class Client:",
        "    def send(self, value: str) -> None:",
        '        """Send docs."""',
        "        pass",
      ].join("\n"),
    );
    const targets = [
      { id: "ts-api", language: "typescript" as const, paths: ["api.ts"] },
      { id: "rust-api", language: "rust" as const, paths: ["api.rs"] },
      { id: "python-api", language: "python" as const, paths: ["api.py"] },
    ];
    const outputs = await generateSourceReference(root, targets);
    expect(outputs).toEqual(await generateSourceReference(root, targets));
    const ts = outputs.get("docs/apis/generated/ts-api.md")!;
    expect(ts).toContain("Greets a caller");
    expect(ts).toContain("greet(name: string): string;");
    expect(ts).toContain("send(value: string): void;");
    expect(ts).toContain("greet as hello");
    expect(ts).not.toContain("throw");
    expect(ts).not.toContain("hidden");
    expect(ts).toMatch(/SHA-256: `[a-f0-9]{64}`/);
    expect(outputs.get("docs/apis/generated/rust-api.md")).toContain("not an exhaustive API");
    expect(outputs.get("docs/apis/generated/rust-api.md")).toContain("//! Crate overview.");
    const py = outputs.get("docs/apis/generated/python-api.md")!;
    expect(py).toContain("def greet(name: str, *, count: int=1) -> str");
    expect(py).toContain("Client.send");
    expect(py).toContain("Greets a caller.");
    expect(py).not.toContain("RuntimeError");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source references reject malformed ids, unsafe paths and escaping symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-source-path-"));
  const outside = await mkdtemp(join(tmpdir(), "docs-source-outside-"));
  try {
    await writeFile(join(root, "api.ts"), "export const value: number = 1;");
    const target = {
      id: "safe",
      language: "typescript" as const,
      paths: ["api.ts"],
    };
    await Promise.all(
      ["../api.ts", "/tmp/api.ts", "a/../api.ts", "./api.ts", "a\\api.ts", ".env", ".npmrc", "a//api.ts"].map(path =>
        expect(generateSourceReference(root, [{ ...target, paths: [path] }])).rejects.toThrow("Unsafe"),
      ),
    );
    await expect(generateSourceReference(root, [{ ...target, id: "../escape" }])).rejects.toThrow("Invalid");
    await expect(generateSourceReference(root, [target, target])).rejects.toThrow("duplicate");
    await mkdir(join(outside, "source"));
    await writeFile(join(outside, "source", "api.ts"), "export const secret = 1;");
    await symlink(join(outside, "source"), join(root, "linked"));
    await expect(generateSourceReference(root, [{ ...target, paths: ["linked/api.ts"] }])).rejects.toThrow("escapes");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
