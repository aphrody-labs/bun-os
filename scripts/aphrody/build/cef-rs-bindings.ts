// Generates and qualifies the cef-rs bindings of the vendor/cef-rs fork from owner-built CEF headers.
// The Chromium pins below are the revisions the owner-built CEF headers were produced from.
import { isAbsolute, join, resolve } from "node:path";

export const CHROMIUM_REVISION = "95ff46fdacff0d4973f17710418f12e1ceedeed9";
export const CHROMIUM_BASE_REVISION = "ce0615a76d6347f1914d673f1da66285b328d494";

const root = resolve(import.meta.dir, "../../..");
const source = join(root, "vendor/cef-rs");
const lock: { repositories: { id: string; revision: string }[] } = await Bun.file(
  join(root, "sources.lock.json"),
).json();
export const CEF_RS_REVISION = lock.repositories.find(entry => entry.id === "vendor/cef-rs")!.revision;
const cefRevision = "7e28cb05af72af8c0cdfafe7facfca97eed139c8";
const chromiumRevision = CHROMIUM_REVISION;
const chromiumVersion = "157.0.8099.0";
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function cefTargetEnvironment(target: string, headers: string): Record<string, string> {
  const targets: Record<string, string> = {
    "x86_64-pc-windows-msvc": "CEF_PATH_windows_x86_64",
    "aarch64-pc-windows-msvc": "CEF_PATH_windows_aarch64",
    "x86_64-unknown-linux-gnu": "CEF_PATH_linux_x86_64",
    "aarch64-unknown-linux-gnu": "CEF_PATH_linux_aarch64",
    "x86_64-apple-darwin": "CEF_PATH_macos_x86_64",
    "aarch64-apple-darwin": "CEF_PATH_macos_aarch64",
  };
  const key = targets[target];
  if (!key) throw new Error(`Unsupported owner CEF target: ${target}`);
  if (!isAbsolute(headers)) throw new Error("CEF header directory must be absolute");
  return { [key]: headers };
}

export function generatedBindingPaths(target: string) {
  cefTargetEnvironment(target, source);
  const filename = target.replaceAll("-", "_") + ".rs";
  return [`sys/src/bindings/${filename}`, `cef/src/bindings/${filename}`, `cef/src/resources/${filename}`];
}

export function bindingPlan(target: string, headers: string, platform = process.platform, bun = process.execPath) {
  return {
    cefRsRevision: CEF_RS_REVISION,
    cefRevision,
    chromiumRevision,
    chromiumBaseRevision: CHROMIUM_BASE_REVISION,
    chromiumVersion,
    target,
    headers,
    cwd: source,
    env: cefTargetEnvironment(target, headers),
    argv: [
      bun,
      join(root, "scripts/aphrody/build/rust/cargo-serial.ts"),
      ...(platform === "win32" ? ["--msvc"] : []),
      "run",
      "--manifest-path",
      join(source, "Cargo.toml"),
      "-p",
      "update-bindings",
      "--",
      "--bindgen",
      "--target",
      target,
    ],
    outputs: generatedBindingPaths(target),
  };
}

export async function generateBindings(target: string, headers: string) {
  const plan = bindingPlan(target, headers);
  const headerReceipt = await Bun.file(join(headers, ".bun-cef-headers.json")).json();
  if (
    headerReceipt.schema !== 1 ||
    headerReceipt.target !== target ||
    headerReceipt.cefRevision !== cefRevision ||
    headerReceipt.chromiumRevision !== chromiumRevision ||
    headerReceipt.chromiumVersion !== chromiumVersion ||
    !Number.isInteger(headerReceipt.apiVersion)
  ) {
    throw new Error("CEF binding generation requires the matching owner source header receipt");
  }
  const headerInputs: { path: string; sha256: string }[] = [];
  for (const path of new Bun.Glob("include/**/*.h").scanSync({
    cwd: headers,
  })) {
    headerInputs.push({
      path: path.replaceAll("\\", "/"),
      sha256: hash(await Bun.file(join(headers, path)).bytes()),
    });
  }
  if (!headerInputs.length) throw new Error("Owner CEF header inputs missing");
  headerInputs.sort((a, b) => a.path.localeCompare(b.path));
  const process = Bun.spawn(plan.argv, {
    cwd: plan.cwd,
    env: { ...Bun.env, ...plan.env },
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  const code = await process.exited;
  if (code !== 0) throw new Error(`Owner CEF binding generation failed (${code})`);
  const files: { path: string; sha256: string }[] = [];
  for (const path of plan.outputs)
    files.push({
      path,
      sha256: hash(await Bun.file(join(source, path)).bytes()),
    });
  const raw = await Bun.file(join(source, plan.outputs[0]!)).text();
  const constant = (name: string) => Number(new RegExp(`^pub const ${name}: i32 = (\\d+);$`, "m").exec(raw)?.[1]);
  const version = ["MAJOR", "MINOR", "BUILD", "PATCH"].map(part => constant(`CHROME_VERSION_${part}`)).join(".");
  if (version !== chromiumVersion || constant("CEF_API_VERSION_LAST") !== headerReceipt.apiVersion)
    throw new Error("Generated CEF bindings do not match owner Chromium and header API version");
  for (const header of headerInputs) {
    if (hash(await Bun.file(join(headers, header.path)).bytes()) !== header.sha256)
      throw new Error(`CEF header changed during generation: ${header.path}`);
  }
  const receipt = {
    schema: 1,
    target,
    cefRsRevision: CEF_RS_REVISION,
    cefRevision,
    chromiumRevision,
    chromiumVersion,
    apiVersion: headerReceipt.apiVersion,
    qualification: "source-generated",
    headers: headerInputs,
    files,
  };
  await Bun.write(
    join(source, plan.outputs[0]!.replace(/\.rs$/, ".bun-cef.json")),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}

export async function qualifyBindings(target: string, distribution: string, generatedSource = source) {
  const generated = generatedBindingPaths(target);
  const receiptPath = join(generatedSource, generated[0]!.replace(/\.rs$/, ".bun-cef.json"));
  const receipt = await Bun.file(receiptPath).json();
  const native = await Bun.file(join(distribution, ".bun-cef-build.json")).json();
  for (const key of ["schema", "target", "cefRevision", "chromiumRevision", "chromiumVersion", "apiVersion"]) {
    if (receipt[key] !== native[key]) throw new Error(`Native CEF and generated bindings do not match (${key})`);
  }
  if (
    native.cefRevision !== cefRevision ||
    native.chromiumRevision !== chromiumRevision ||
    native.chromiumVersion !== chromiumVersion ||
    native.target !== target ||
    typeof native.apiHash !== "string" ||
    !native.apiHash
  )
    throw new Error("Native CEF API hash receipt is not qualified");
  const binary = native.binary;
  if (
    !binary ||
    typeof binary.path !== "string" ||
    isAbsolute(binary.path) ||
    binary.path.includes("\\") ||
    binary.path.split("/").some((part: string) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid CEF binary receipt path");
  if (hash(await Bun.file(join(distribution, binary.path)).bytes()) !== binary.sha256)
    throw new Error("Owner CEF binary hash mismatch");
  if (
    !Array.isArray(receipt.files) ||
    receipt.files.length !== generated.length ||
    !generated.every(path => receipt.files.some((file: { path: string }) => file.path === path))
  ) {
    throw new Error("CEF generation must cover raw, safe and resource bindings");
  }
  if (!Array.isArray(receipt.headers) || !receipt.headers.length)
    throw new Error("Generated CEF header inputs are missing");
  for (const file of receipt.files) {
    if (
      !generated.includes(file.path) ||
      hash(await Bun.file(join(generatedSource, file.path)).bytes()) !== file.sha256
    )
      throw new Error("Generated CEF binding hash mismatch");
  }
  for (const header of receipt.headers) {
    if (
      !header.path.startsWith("include/") ||
      header.path.includes("..") ||
      header.path.includes("\\") ||
      hash(await Bun.file(join(distribution, header.path)).bytes()) !== header.sha256
    )
      throw new Error("Generated CEF header inputs do not match the native distribution");
  }
  receipt.apiHash = native.apiHash;
  receipt.qualification = "native-api-qualified";
  await Bun.write(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (import.meta.main) {
  const [command, target, headers] = Bun.argv.slice(2);
  if (!target || !headers || !["plan", "generate", "qualify"].includes(command!))
    throw new Error(
      "Usage: bun scripts/aphrody/build/cef-rs-bindings.ts <plan|generate|qualify> <rust-target> <absolute-owner-headers-or-distribution>",
    );
  console.log(
    JSON.stringify(
      command === "plan"
        ? bindingPlan(target, headers)
        : command === "generate"
          ? await generateBindings(target, headers)
          : await qualifyBindings(target, headers),
      null,
      2,
    ),
  );
}
