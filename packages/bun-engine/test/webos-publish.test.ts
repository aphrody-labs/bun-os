import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { qualificationSHA256, verifyQualification } from "../web-emulation/qualification";
import { publishQualifiedCores } from "../web-emulation/webos-publish";

test("WebOS publication requires a receipt and preserves existing assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunos-webos-publish-"));
  const dist = join(root, "dist");
  const objects = join(root, "objects");
  const write = async (path: string, value: string) => {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, value);
  };
  try {
    const core = "dust-nds";
    const wasm = "0123456789ab/bun_engine_bg.wasm";
    const module = "0123456789ab/bun_engine.js";
    const fixturePath = "fixtures/test/game.nds";
    await write(join(dist, core, wasm), "wasm fixture");
    await write(join(dist, core, module), "module fixture");
    await write(join(dist, "runtime/touch.js"), "runtime fixture");
    await write(join(dist, fixturePath), "rom fixture");
    await write(join(dist, core, "manifest.json"), JSON.stringify({ systems: ["nds"], module, wasm, firmware: [] }));
    const fixtureSHA = await qualificationSHA256(join(dist, fixturePath));
    const fixture = { path: fixturePath, sha256: fixtureSHA, source: "fixture-source", license: "fixture-license" };
    const lockPath = join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json");
    await write(lockPath, JSON.stringify({ testContent: { test: { system: "nds", sha256: fixtureSHA } } }));
    await write(
      join(root, "packages/bun-engine/plugins/consoles/roms.json"),
      JSON.stringify({ packs: [{ id: "test", sha256: fixtureSHA, url: fixture.source, license: fixture.license }] }),
    );
    await write(
      join(root, "packages/bun-engine/plugins/consoles/free-firmware.json"),
      JSON.stringify({ firmware: {} }),
    );
    await expect(publishQualifiedCores(dist, objects, [core], root)).rejects.toThrow();
    expect(await Bun.file(join(objects, "emulation", core, "manifest.json")).exists()).toBe(false);
    const paths = [`${core}/${module}`, `${core}/${wasm}`, `${core}/manifest.json`, fixturePath, "runtime/touch.js"];
    const files: Record<string, string> = {};
    for (const path of paths.sort()) files[path] = await qualificationSHA256(join(dist, path));
    await write(
      join(dist, core, "qualification.json"),
      JSON.stringify({
        schemaVersion: 2,
        kind: "bun-engine-wasm-qualification",
        core,
        variant: "single",
        sourceRevision: "a".repeat(40),
        testedAt: new Date().toISOString(),
        lockSHA256: await qualificationSHA256(lockPath),
        files,
        fixtures: [fixture],
        result: {
          ok: true,
          frames: 120,
          lit: true,
          hash: "1234",
          errors: [],
          renderer: "wgpu30-dust",
          gpu2d_submitted_frames: 120,
          gpu3d_submitted_frames: 0,
        },
      }),
    );
    const old = join(objects, "emulation", core, "aaaaaaaaaaaa/old.wasm");
    await write(old, "keep old version");
    expect(await publishQualifiedCores(dist, objects, [core], root)).toEqual([core]);
    expect(await readFile(old, "utf8")).toBe("keep old version");
    expect(await readFile(join(objects, "emulation", core, wasm), "utf8")).toBe("wasm fixture");
    await write(join(objects, "emulation", fixturePath), "rom fixture");
    expect((await verifyQualification(join(objects, "emulation"), core, { root })).core).toBe(core);
    const unexpected = join(objects, "emulation", core, "0123456789ab/unexpected.js");
    await write(unexpected, "unexpected");
    await expect(verifyQualification(join(objects, "emulation"), core, { root })).rejects.toThrow(
      "qualification artifact set or digests changed",
    );
    await unlink(unexpected);
    const manifest = await readFile(join(objects, "emulation", core, "manifest.json"), "utf8");
    await write(join(objects, "emulation/runtime/touch.js"), "different shared runtime");
    await expect(publishQualifiedCores(dist, objects, [core], root)).rejects.toThrow("overwrite an existing asset");
    expect(await readFile(old, "utf8")).toBe("keep old version");
    expect(await readFile(join(objects, "emulation/runtime/touch.js"), "utf8")).toBe("different shared runtime");
    expect(await readFile(join(objects, "emulation", core, "manifest.json"), "utf8")).toBe(manifest);
    await write(join(objects, "emulation/runtime/touch.js"), "runtime fixture");
    await write(join(objects, "emulation", core, wasm), "different immutable asset");
    await expect(publishQualifiedCores(dist, objects, [core], root)).rejects.toThrow("overwrite an existing asset");
    expect(await readFile(join(objects, "emulation", core, wasm), "utf8")).toBe("different immutable asset");
    expect(await readFile(join(objects, "emulation", core, "manifest.json"), "utf8")).toBe(manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
