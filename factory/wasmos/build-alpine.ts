#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Builds the Alpine x86_64 wasm (Bochs + Linux 6.1 + Alpine rootfs in one WASI module) with container2wasm.
// Linux only (needs docker buildx). Every input is pinned in pins.json and verified.
//   bun factory/wasmos/build-alpine.ts [--out dir] [--loglevel 0..7]
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const pins = await Bun.file(join(import.meta.dir, "pins.json")).json();
const { values } = parseArgs({ options: { out: { type: "string" }, loglevel: { type: "string" } } });
const out = resolve(values.out ?? join(import.meta.dir, "../../build/wasmos"));
mkdirSync(out, { recursive: true });

const sh = async (cmd: string[], cwd = out) => {
  const p = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
};

const tgz = join(out, "c2w.tgz");
if (!existsSync(tgz)) await Bun.write(tgz, await (await fetch(pins.container2wasm.release)).arrayBuffer());
const sha = new Bun.CryptoHasher("sha256").update(await Bun.file(tgz).bytes()).digest("hex");
if (sha !== pins.container2wasm.sha256) throw new Error(`c2w tarball sha256 mismatch: ${sha}`);
await sh(["tar", "xzf", tgz, "c2w"]);

const proc = Bun.spawn([join(out, "c2w"), "--show-dockerfile"], { stdout: "pipe" });
let dockerfile = await new Response(proc.stdout).text();
await proc.exited;
for (const p of pins.dockerfilePatches) {
  if (!dockerfile.includes(p.from)) throw new Error(`patch no longer applies: ${p.from}`);
  dockerfile = dockerfile.replaceAll(p.from, p.to);
}
await Bun.write(join(out, "Dockerfile.patched"), dockerfile);

const args = [join(out, "c2w"), "--dockerfile", join(out, "Dockerfile.patched")];
if (values.loglevel) args.push("--build-arg", `LINUX_LOGLEVEL=${values.loglevel}`);
args.push(pins.image, join(out, pins.artifact));
const t0 = performance.now();
await sh(args);
const bytes = Bun.file(join(out, pins.artifact)).size;
const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(join(out, pins.artifact)).bytes()).digest("hex");
console.log(
  JSON.stringify({
    artifact: pins.artifact,
    bytes,
    sha256: digest,
    buildSeconds: Math.round((performance.now() - t0) / 1000),
  }),
);
