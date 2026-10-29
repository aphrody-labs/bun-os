// SPDX-License-Identifier: Apache-2.0
// Contract of the pure commands through WebAssembly. When APHRODY_NATIVE_BIN points at the native
// `aphrody` binary, every case is also run natively and the outputs must be identical.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadCliWasm, loadCliWasmSync, type Cli, type RunOptions } from "../src";

const wasmFile = join(import.meta.dir, "../wasm/aphrody_command_wasm_bg.wasm");
const built = existsSync(wasmFile);

test("the build is present (bun run build:wasm)", () => {
  expect(built).toBe(true);
});

const PAGE =
  "<html><head><title>T</title></head><body><article><h1>Guide</h1><p>A long enough paragraph with substantial content for extraction, long enough to be kept as the main content.</p></article></body></html>";
const RUST = 'fn greet() {\n    println!("hi");\n}\n';

const cases: [string, string[], RunOptions][] = [
  ["rag ops", ["rag", "ops"], {}],
  ["rag call", ["rag", "call", "rrf", '{"lists":[["a","b"],["b"]]}'], {}],
  ["rag chunk", ["rag", "chunk", "-", "--path", "a.rs"], { stdin: RUST }],
  ["rag chunk file", ["rag", "chunk", "src/a.rs", "--profile", "ts_parity"], { files: { "src/a.rs": RUST } }],
  ["toolcall repair", ["toolcall", "repair", "-"], { stdin: "```json\n{'a': 1,}\n```" }],
  [
    "toolcall extract",
    ["toolcall", "extract", "-"],
    {
      stdin: 'go <tool_call>{"name": "read", "arguments": {"path": "a"}}</tool_call>',
    },
  ],
  [
    "toolcall validate",
    ["toolcall", "validate", "--schema", "s.json", "-"],
    {
      stdin: '{"n": "x"}',
      files: {
        "s.json": '{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
      },
    },
  ],
  ["html markdown", ["html", "markdown", "-", "--base-url", "https://x.test/"], { stdin: PAGE }],
  ["html extract", ["html", "extract", "-"], { stdin: PAGE }],
  [
    "Dragon Ball reader",
    ["html", "dragon-ball", "-", "--kind", "reader", "--base-url", "https://example.test/"],
    {
      stdin: '<script>ts_reader.run({"sources":[{"images":["https://example.test/1.webp"]}]});</script>',
    },
  ],
  ["html simhash", ["html", "simhash", "-"], { stdin: "same text here" }],
  ["text comments", ["text", "comments", "-", "--path", "a.rs"], { stdin: "// hello world\nfn f() {}\n" }],
  ["text scrub", ["text", "scrub", "-"], { stdin: "note \u{1F916} here" }],
  ["text is-japanese", ["text", "is-japanese", "-"], { stdin: "こんにちは" }],
  ["usage error", ["nope"], {}],
  ["missing file", ["html", "markdown", "gone.html"], {}],
];

describe.skipIf(!built)("wasm", () => {
  let cli: Cli;
  test("loads synchronously and asynchronously", async () => {
    cli = loadCliWasmSync(readFileSync(wasmFile));
    expect(cli.version).toMatch(/^\d/);
    const again = await loadCliWasm(readFileSync(wasmFile));
    expect(again.run(["rag", "ops"]).code).toBe(0);
  });

  test("rag", () => {
    expect(cli.json<{ abi: number }>(["rag", "ops"]).abi).toBe(1);
    const chunks = cli.json<{ symbol: string; hash: string }[]>(["rag", "chunk", "-", "--path", "a.rs"], {
      stdin: RUST,
    });
    expect(chunks[0]?.symbol).toBe("greet");
    expect(chunks[0]?.hash).toHaveLength(64);
    const js = cli.json<unknown[]>(["rag", "chunk", "-", "--path", "a.ts"], {
      stdin: "export function add(a: number, b: number) {\n  return a + b;\n}\n",
    });
    expect(js.length).toBeGreaterThan(0);
    const fused = cli.json<{ id: string }[]>(["rag", "call", "rrf", '{"lists":[["a","b"],["b"]]}']);
    expect(fused[0]?.id).toBe("b");
    expect(cli.run(["rag", "call", "nope"]).stderr).toContain("unknown json operation");
  });

  test("toolcall", () => {
    const repaired = cli.json<{ value: unknown; repairs: string[] }>(["toolcall", "repair", "-"], {
      stdin: "```json\n{'a': 1,}\n```",
    });
    expect(repaired.value).toEqual({ a: 1 });
    expect(repaired.repairs.length).toBeGreaterThan(0);
    const calls = cli.json<{ name: string }[]>(["toolcall", "extract", "-"], {
      stdin: 'go <tool_call>{"name": "read", "arguments": {"path": "a"}}</tool_call>',
    });
    expect(calls[0]?.name).toBe("read");
    const v = cli.json<{ violations: unknown[] }>(["toolcall", "validate", "--schema", "s.json", "-"], {
      stdin: '{"n": "x"}',
      files: {
        "s.json": '{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}',
      },
    });
    expect(v.violations).toHaveLength(1);
  });

  test("html and text", () => {
    expect(cli.text(["html", "markdown", "-"], { stdin: PAGE })).toContain("# Guide");
    expect(cli.json<{ title: string }>(["html", "extract", "-"], { stdin: PAGE }).title).toBe("T");
    expect(cli.text(["html", "simhash", "-"], { stdin: "x y z" }).trim()).toHaveLength(16);
    const comments = cli.json<{ body: string }[]>(["text", "comments", "-", "--path", "a.rs"], {
      stdin: "// hello world\nfn f() {}\n",
    });
    expect(comments[0]?.body).toBe("hello world");
    expect(cli.text(["text", "scrub", "-"], { stdin: "note \u{1F916} here" }).trim()).toBe("note here");
    expect(cli.text(["text", "is-japanese", "-"], { stdin: "こんにちは" }).trim()).toBe("true");
  });

  test("exit codes, help and missing inputs", () => {
    expect(cli.run(["nope"]).code).toBe(2);
    expect(cli.run(["--help"]).stdout).toContain("toolcall");
    const missing = cli.run(["html", "markdown", "gone.html"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("no such file");
    expect(() => cli.text(["toolcall", "repair", "-"], { stdin: "  " })).toThrow();
  });

  test("Dragon Ball portable projection retains source identity and refuses credential URLs", () => {
    expect(
      cli.dragonBall<string[]>(
        '<script>ts_reader.run({"sources":[{"images":["https://example.test/1.webp"]}]});</script>',
        { kind: "reader", baseUrl: "https://example.test/" },
      ),
    ).toEqual(["https://example.test/1.webp"]);
    expect(() =>
      cli.dragonBall("", {
        kind: "reader",
        baseUrl: "https://user:secret@example.test/",
      }),
    ).toThrow("credential-free");
  });

  const native = process.env.APHRODY_NATIVE_BIN;
  test.skipIf(!native || !existsSync(native))(
    "outputs are identical to the native `aphrody pure`",
    async () => {
      await Promise.all(
        cases.map(async ([name, args, options]) => {
          const dir = mkdtempSync(join(tmpdir(), "aphrody-cli-wasm-parity-"));
          try {
            await Promise.all(
              Object.entries(options.files ?? {}).map(async ([file, text]) => {
                const path = join(dir, file);
                mkdirSync(dirname(path), { recursive: true });
                await Bun.write(path, text);
              }),
            );
            const proc = Bun.spawnSync([native!, "pure", ...args], {
              windowsHide: true,
              cwd: dir,
              stdin: new TextEncoder().encode(options.stdin ?? ""),
            });
            const wasm = cli.run(args, options);
            expect(`${name}: ${proc.stdout.toString()}`).toBe(`${name}: ${wasm.stdout}`);
            expect(proc.exitCode, name).toBe(wasm.code);
          } finally {
            // Only the absolute directory returned by mkdtempSync is removed.
            rmSync(dir, { recursive: true, force: true });
          }
        }),
      );
    },
    // Sixteen real native process startups can exceed the unit-test default on a busy host.
    60_000,
  );
});
