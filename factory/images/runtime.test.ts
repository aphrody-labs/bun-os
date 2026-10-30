import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashContent } from "@aphrody/bun-workspace";
import { inspectLinuxABI } from "../../src/elf.ts";
import { stageAlpineRuntime } from "./runtime.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function elf(loader: string, machine = 62) {
  const bytes = new Uint8Array(256);
  bytes.set([127, 69, 76, 70, 2, 1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(18, machine, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint32(64, 3, true);
  view.setBigUint64(72, 128n, true);
  const name = new TextEncoder().encode(loader + "\0");
  view.setBigUint64(96, BigInt(name.length), true);
  bytes.set(name, 128);
  return bytes;
}

async function fixture(loader = "/lib/ld-musl-x86_64.so.1") {
  const root = await mkdtemp(join(tmpdir(), "bunos-musl-stage-"));
  roots.push(root);
  const binary = join(root, "bun");
  const bytes = elf(loader);
  await Bun.write(binary, bytes);
  const expected = { repository: "oven-sh/bun", version: "1.4.6", revision: "a".repeat(40) };
  const receipt = {
    target: "bun-linux-x64-musl",
    sha256: hashContent(bytes),
    facts: {
      ...expected,
      sourceUrl: "https://github.com/oven-sh/bun/releases/download/bun-v1.4.6/bun-linux-x64-musl.zip",
      executable: binary,
    },
    qualification: { host: "fixture", mode: "docker", observedAt: "2026-10-19T00:00:00Z" },
  };
  const receiptPath = join(root, "receipt.json");
  await Bun.write(receiptPath, JSON.stringify(receipt));
  return { root, binary, expected, receipt, receiptPath };
}

test("ELF ABI owner distinguishes GNU and Alpine loaders and architecture", async () => {
  const value = await fixture();
  expect((await inspectLinuxABI(value.binary, "x64", "musl")).libc).toBe("musl");
  await expect(inspectLinuxABI(value.binary, "x64")).rejects.toThrow("gnu target");
  await expect(inspectLinuxABI(value.binary, "arm64", "musl")).rejects.toThrow("machine");
  const gnu = await fixture("/lib64/ld-linux-x86-64.so.2");
  expect((await inspectLinuxABI(gnu.binary, "x64")).libc).toBe("glibc");
  await expect(inspectLinuxABI(gnu.binary, "x64", "musl")).rejects.toThrow("musl target");
});

test("Alpine staging retains exact qualified bytes and receipt without executing synthetic ELF", async () => {
  const value = await fixture();
  const context = join(value.root, "context");
  await stageAlpineRuntime(context, "amd64", value.binary, value.receiptPath, value.expected);
  expect(await Bun.file(join(context, "runtime/amd64/bun")).bytes()).toEqual(await Bun.file(value.binary).bytes());
  expect(await Bun.file(join(context, "runtime/amd64/receipt.json")).json()).toEqual(value.receipt);
});

test("Alpine staging rejects the abandoned fork provenance, altered bytes and GNU artifacts", async () => {
  const value = await fixture();
  value.receipt.facts.sourceUrl =
    "https://github.com/aphrody-labs/bun/releases/download/bun-v1.4.6/bun-linux-x64-musl.zip";
  await Bun.write(value.receiptPath, JSON.stringify(value.receipt));
  await expect(
    stageAlpineRuntime(join(value.root, "bad"), "amd64", value.binary, value.receiptPath, value.expected),
  ).rejects.toThrow("provenance invalid");
  const altered = await fixture();
  await Bun.write(altered.binary, elf("/lib/ld-musl-x86_64.so.2"));
  await expect(
    stageAlpineRuntime(join(altered.root, "bad"), "amd64", altered.binary, altered.receiptPath, altered.expected),
  ).rejects.toThrow("digest");
  const gnu = await fixture("/lib64/ld-linux-x86-64.so.2");
  await expect(
    stageAlpineRuntime(join(gnu.root, "bad"), "amd64", gnu.binary, gnu.receiptPath, gnu.expected),
  ).rejects.toThrow("musl target");
});
