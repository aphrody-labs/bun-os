import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

test("wasm-package.ts writes the browser glue beside the package consumer", async () => {
  const root = resolve(import.meta.dir, "..");
  const repository = resolve(root, "../..");
  const manifest = await Bun.file(join(root, "package.json")).json();
  const [build, notices] = manifest.scripts["build:wasm"].split(" && ");
  const args = build.split(/\s+/);
  expect(args.slice(0, 2)).toEqual(["bun", "../../scripts/aphrody/build/rust/wasm-package.ts"]);
  expect(await Bun.file(resolve(root, args[1])).exists()).toBe(true);
  const crate = args[args.indexOf("--crate") + 1];
  expect(crate).toBe("aphrody-webos-wasm");
  expect(await Bun.file(join(repository, "crates", crate, "Cargo.toml")).exists()).toBe(true);
  // wasm-package.ts resolves --out against the repository root.
  const output = resolve(repository, args[args.indexOf("--out") + 1]);
  expect(output).toBe(join(root, "wasm"));
  expect(resolve(root, manifest.imports["#webos-wasm-glue"])).toBe(join(output, "aphrody_webos_wasm.js"));
  expect(notices).toBe("bun stage-notices.ts");
});
