import { join, resolve } from "node:path";

export interface QualificationFixture {
  path: string;
  sha256: string;
  license: string;
  source: string;
}
export interface QualificationResult {
  ok: boolean;
  frames: number;
  lit: boolean;
  hash: string;
  errors: string[];
  renderer: string;
  gpu2d_submitted_frames: number;
  gpu3d_submitted_frames: number;
}
export interface WasmQualificationReceipt {
  schemaVersion: 2;
  kind: "bun-engine-wasm-qualification";
  core: string;
  variant: "single" | "threads";
  /** Revision of the qualification harness; this does not establish the artifact's build revision. */
  sourceRevision: string;
  testedAt: string;
  lockSHA256: string;
  files: Record<string, string>;
  fixtures: QualificationFixture[];
  result: QualificationResult;
}
const defaultRoot = resolve(import.meta.dir, "../../..");
const digestPattern = /^[a-f0-9]{64}$/;
const harnessPaths = [
  "packages/bun-engine/web-emulation/smoke.ts",
  "packages/bun-engine/web-emulation/smoke.html",
  "packages/bun-engine/web-emulation/serve.ts",
  "packages/bun-engine/web-emulation/png.ts",
  "packages/bun-engine/web-emulation/qualification.ts",
  "packages/bun-engine/web-emulation/web-emulation.lock.json",
  "packages/bun-engine/plugins/consoles/roms.json",
  "packages/bun-engine/plugins/consoles/free-firmware.json",
];

export function qualificationHarnessRevision(root: string, baseline = "HEAD"): string {
  if (baseline !== "HEAD" && !/^[a-f0-9]{40}$/.test(baseline))
    throw new Error("Invalid qualification harness baseline");
  const revision = Bun.spawnSync(["git", "-C", root, "rev-parse", "--verify", baseline]);
  const value = revision.stdout.toString().trim();
  if (revision.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(value))
    throw new Error("Cannot resolve qualification harness revision");
  const type = Bun.spawnSync(["git", "-C", root, "cat-file", "-t", value]);
  if (type.exitCode !== 0 || type.stdout.toString().trim() !== "commit")
    throw new Error("Qualification harness baseline is not a commit");
  const tracked = Bun.spawnSync(["git", "-C", root, "ls-files", "--error-unmatch", "--", ...harnessPaths]);
  if (tracked.exitCode !== 0) throw new Error("Qualification harness files are not all tracked");
  const diff = Bun.spawnSync(["git", "-C", root, "diff", "--quiet", value, "--", ...harnessPaths]);
  if (diff.exitCode !== 0) throw new Error("Qualification harness has uncommitted changes or cannot be checked");
  return value;
}
function safePath(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.includes(":") ||
    path.startsWith("/") ||
    path.split("/").some(p => !p || p === "." || p === "..")
  )
    throw new Error(`Unsafe qualification path: ${path}`);
  return path;
}
function safeCore(core: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(core)) throw new Error(`Invalid core: ${core}`);
}
function selectedVariant(manifest: any, variant: "single" | "threads") {
  if (variant !== "single" && variant !== "threads") throw new Error("Invalid qualification variant");
  const selected = variant === "threads" ? manifest.variants?.threads : manifest;
  if (!selected || (variant === "threads" && selected.threads !== true))
    throw new Error("Requested threaded WASM variant is not built");
  for (const path of [selected.module, selected.wasm]) {
    if (typeof path !== "string" || /[%?#]/.test(path)) throw new Error("Invalid qualified module path");
    safePath(path);
  }
  return selected;
}
export async function qualificationSHA256(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}
async function snapshotFiles(dist: string, core: string, fixtures: QualificationFixture[]) {
  safeCore(core);
  const paths = new Set<string>();
  for (const directory of [core, "runtime"]) {
    for await (const path of new Bun.Glob("**/*").scan({
      cwd: join(dist, directory),
      onlyFiles: true,
      followSymlinks: false,
    })) {
      const relative = `${directory}/${path.replaceAll("\\", "/")}`;
      if (relative !== `${core}/qualification.json`) paths.add(safePath(relative));
    }
  }
  if (!paths.has(`${core}/manifest.json`) || ![...paths].some(p => p.startsWith(`${core}/`) && p.endsWith(".wasm")))
    throw new Error(`${core}: missing core manifest or WASM artifact`);
  if (![...paths].some(p => p.startsWith("runtime/"))) throw new Error("Missing shared WASM runtime files");
  for (const fixture of fixtures) paths.add(safePath(fixture.path));
  const files: Record<string, string> = {};
  for (const path of [...paths].sort()) files[path] = await qualificationSHA256(join(dist, path));
  return files;
}
async function checkFixtures(dist: string, fixtures: QualificationFixture[], root: string, systems: string[]) {
  if (!Array.isArray(fixtures) || !fixtures.length)
    throw new Error("Qualification requires a pinned open-source fixture");
  const lock = await Bun.file(join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json")).json();
  const registry = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/free-firmware.json")).json();
  const roms = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/roms.json")).json();
  let hasROM = false;
  for (const fixture of fixtures) {
    safePath(fixture.path);
    if (!digestPattern.test(fixture.sha256) || !fixture.source || !fixture.license)
      throw new Error("Invalid fixture provenance");
    const rom = Object.entries<any>(lock.testContent).find(([id, pin]) => {
      const pack = roms.packs.find((p: any) => p.id === id);
      return (
        systems.includes(pin.system) &&
        pin.sha256 === fixture.sha256 &&
        pack?.sha256 === pin.sha256 &&
        pack.url === fixture.source &&
        pack.license === fixture.license
      );
    });
    const firmware = Object.entries<any>(registry.firmware).find(
      ([id, pin]) =>
        lock.firmware?.[id]?.sha256 === pin.sha256 &&
        pin.sha256 === fixture.sha256 &&
        pin.source === fixture.source &&
        pin.license === fixture.license,
    );
    if (!rom && !firmware) throw new Error(`Fixture is not pinned by the open-source registries: ${fixture.path}`);
    if (rom) hasROM = true;
    if ((await qualificationSHA256(join(dist, fixture.path))) !== fixture.sha256)
      throw new Error(`Fixture digest mismatch: ${fixture.path}`);
  }
  if (!hasROM) throw new Error("Qualification requires a pinned open-source ROM, not firmware alone");
}
function checkResult(result: QualificationResult) {
  if (
    result?.ok !== true ||
    !Number.isFinite(result.frames) ||
    result.frames < 120 ||
    result.lit !== true ||
    !/^[a-f0-9]+$/i.test(result.hash) ||
    !Array.isArray(result.errors) ||
    result.errors.length
  )
    throw new Error("WASM qualification requires 120 lit frames, a frame hash and no errors");
  if (
    typeof result.renderer !== "string" ||
    !result.renderer ||
    ![result.gpu2d_submitted_frames, result.gpu3d_submitted_frames].every(n => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error("Qualification is missing actual renderer/submission evidence");
  if (result.renderer === "wgpu30-dust" && result.gpu2d_submitted_frames < 1)
    throw new Error("Dust GPU qualification requires actual 2D GPU submissions");
}
export async function createQualificationSnapshot(
  dist: string,
  core: string,
  fixtures: QualificationFixture[],
  options: { root?: string; variant?: "single" | "threads" } = {},
): Promise<Omit<WasmQualificationReceipt, "testedAt" | "result">> {
  const root = options.root ?? defaultRoot;
  const manifest = await Bun.file(join(dist, core, "manifest.json")).json();
  const variant = options.variant ?? "single";
  const selected = selectedVariant(manifest, variant);
  await checkFixtures(dist, fixtures, root, manifest.systems ?? []);
  const registry = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/free-firmware.json")).json();
  for (const id of manifest.firmware ?? []) {
    const pin = registry.firmware[id];
    if (!pin || !fixtures.some(f => f.path === `firmware/${pin.file}` && f.sha256 === pin.sha256))
      throw new Error(`${core}: qualification is missing required firmware ${id}`);
  }
  const sourceRevision = qualificationHarnessRevision(root);
  const files = await snapshotFiles(dist, core, fixtures);
  for (const path of [selected.module, selected.wasm])
    if (!files[`${core}/${path}`]) throw new Error(`${core}: selected variant input is not in qualification files`);
  if (manifest.firmware?.length)
    files["firmware/firmware.json"] = await qualificationSHA256(join(dist, "firmware/firmware.json"));
  qualificationHarnessRevision(root, sourceRevision);
  return {
    schemaVersion: 2,
    kind: "bun-engine-wasm-qualification",
    core,
    variant,
    sourceRevision,
    lockSHA256: await qualificationSHA256(join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json")),
    files,
    fixtures,
  };
}
export async function writeQualification(
  dist: string,
  snapshot: Omit<WasmQualificationReceipt, "testedAt" | "result">,
  result: QualificationResult,
  options: { root?: string } = {},
): Promise<WasmQualificationReceipt> {
  const root = options.root ?? defaultRoot;
  checkResult(result);
  if (snapshot.core === "dust-nds" && result.renderer !== "wgpu30-dust")
    throw new Error("Dust distribution qualification must exercise its GPU renderer");
  qualificationHarnessRevision(root, snapshot.sourceRevision);
  const current = await snapshotFiles(dist, snapshot.core, snapshot.fixtures);
  if (snapshot.files["firmware/firmware.json"])
    current["firmware/firmware.json"] = await qualificationSHA256(join(dist, "firmware/firmware.json"));
  if (JSON.stringify(current) !== JSON.stringify(snapshot.files))
    throw new Error("WASM qualification inputs changed during browser run");
  qualificationHarnessRevision(root, snapshot.sourceRevision);
  const receipt: WasmQualificationReceipt = { ...snapshot, testedAt: new Date().toISOString(), result };
  await Bun.write(join(dist, snapshot.core, "qualification.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
export async function verifyQualification(
  dist: string,
  core: string,
  options: { root?: string } = {},
): Promise<WasmQualificationReceipt> {
  safeCore(core);
  const root = options.root ?? defaultRoot;
  const receipt = (await Bun.file(join(dist, core, "qualification.json")).json()) as WasmQualificationReceipt;
  if (
    receipt.schemaVersion !== 2 ||
    receipt.kind !== "bun-engine-wasm-qualification" ||
    receipt.core !== core ||
    !/^[a-f0-9]{40}$/.test(receipt.sourceRevision) ||
    !Number.isFinite(Date.parse(receipt.testedAt))
  )
    throw new Error(`${core}: invalid qualification receipt`);
  checkResult(receipt.result);
  if (core === "dust-nds" && receipt.result.renderer !== "wgpu30-dust")
    throw new Error("Dust distribution qualification must exercise its GPU renderer");
  if (
    receipt.lockSHA256 !==
    (await qualificationSHA256(join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json")))
  )
    throw new Error(`${core}: stale qualification lock`);
  const manifest = await Bun.file(join(dist, core, "manifest.json")).json();
  const selected = selectedVariant(manifest, receipt.variant);
  await checkFixtures(dist, receipt.fixtures, root, manifest.systems ?? []);
  const registry = await Bun.file(join(root, "packages/bun-engine/plugins/consoles/free-firmware.json")).json();
  for (const id of manifest.firmware ?? []) {
    const pin = registry.firmware[id];
    if (!pin || !receipt.fixtures.some(f => f.path === `firmware/${pin.file}` && f.sha256 === pin.sha256))
      throw new Error(`${core}: qualification is missing required firmware ${id}`);
  }
  for (const [path, hash] of Object.entries(receipt.files))
    if (!safePath(path) || !digestPattern.test(hash)) throw new Error("Invalid qualification file digest");
  const current = await snapshotFiles(dist, core, receipt.fixtures);
  for (const path of [selected.module, selected.wasm])
    if (!current[`${core}/${path}`] || !receipt.files[`${core}/${path}`])
      throw new Error(`${core}: selected variant input is not in qualification files`);
  if (manifest.firmware?.length)
    current["firmware/firmware.json"] = await qualificationSHA256(join(dist, "firmware/firmware.json"));
  for (const [path, digest] of Object.entries(receipt.files))
    if (current[path] !== digest) throw new Error(`${core}: qualification artifact set or digests changed`);
  const selectedDirectories = new Set([selected.module, selected.wasm].map((path: string) => path.split("/")[0]));
  for (const path of Object.keys(current)) {
    if (receipt.files[path]) continue;
    const match = new RegExp(`^${core}/([a-f0-9]{12})/`).exec(path);
    if (!match || selectedDirectories.has(match[1]))
      throw new Error(`${core}: qualification artifact set or digests changed`);
  }
  return receipt;
}
