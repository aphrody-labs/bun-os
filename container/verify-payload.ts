import { sourceIntegrity } from "./source-integrity.ts";
import { verifyQualifiedProduct } from "./verify-product.ts";

type RuntimeReceipt = {
  repository: string;
  target: string;
  abi: "gnu";
  revision: string;
  version: string;
  sha256: string;
  bytes: number;
  qualification: { passed: boolean; gates: string[] };
};

export async function verifyPayload(root = Bun.env.BUN_OS_ROOT ?? "/opt/bun-os", requireImageQualification = true) {
  const receipt = (await Bun.file(`${root}/distribution.json`).json()) as {
    name: string;
    runtime: RuntimeReceipt;
    product?: {
      sourceRevision: string;
      installedTreeSHA256: string;
      installedModesSHA256: string;
      receiptSHA256: string;
      qualificationSHA256: string;
    };
    imageQualification?: {
      schemaVersion: number;
      kind: string;
      passed: boolean;
      target: string;
      sourceRevision: string;
      installedTreeSHA256: string;
      installedModesSHA256: string;
      runtimeRevision: string;
      runtimeSHA256: string;
      productQualificationSHA256: string;
      gates: string[];
    };
  };
  const runtime = receipt.runtime;
  if (Bun.env.BUN_OS_PACKAGE_MANAGER === "pacman") {
    const arch = await Bun.file(`${root}/arch/rootfs.receipt.json`).json();
    if (
      arch.kind !== "bun-os-arch-rootfs" ||
      arch.schemaVersion !== 1 ||
      arch.target !== runtime.target ||
      arch.architecture !== "x86_64" ||
      !["server", "desktop", "gaming"].includes(arch.composition) ||
      (Bun.env.BUN_OS_COMPOSITION && arch.composition !== Bun.env.BUN_OS_COMPOSITION) ||
      !/^[a-f0-9]{64}$/.test(arch.lockSha256) ||
      !Array.isArray(arch.packages) ||
      !arch.packages.length ||
      arch.packageHashesVerified !== true ||
      arch.packageSignaturesVerified !== true ||
      arch.exactInventoryVerified !== true
    )
      throw new Error("The primary image requires a verified pacman rootfs receipt");
    const inventory = Bun.spawn(["pacman", "-Q"], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
    const [actual, errors] = await Promise.all([
      new Response(inventory.stdout).text(),
      new Response(inventory.stderr).text(),
    ]);
    const expected = arch.packages
      .map((pkg: { name: string; version: string }) => `${pkg.name} ${pkg.version}`)
      .sort()
      .join("\n");
    if ((await inventory.exited) !== 0 || actual.trim().split("\n").sort().join("\n") !== expected)
      throw new Error(`Installed pacman inventory differs from the locked rootfs: ${errors.slice(-1000)}`);
  }
  if (
    runtime?.repository !== "oven-sh/bun" ||
    runtime.abi !== "gnu" ||
    !/^[0-9a-f]{40}$/.test(runtime.revision) ||
    !/^[0-9a-f]{64}$/.test(runtime.sha256) ||
    !runtime.qualification?.passed ||
    !runtime.qualification.gates.includes("native-runtime")
  ) {
    throw new Error("The payload requires a qualified Aphrody Bun runtime receipt");
  }
  const target = process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : "";
  if (process.platform !== "linux" || runtime.target !== target) {
    throw new Error(`Runtime target ${runtime.target} does not match ${process.platform}/${process.arch}`);
  }
  const child = Bun.spawn(["getconf", "GNU_LIBC_VERSION"], { stdout: "pipe", stderr: "pipe" });
  const libc = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) !== 0 || !/^glibc \d+\.\d+$/.test(libc))
    throw new Error("The image does not provide GNU glibc");
  const binary = Bun.file(`${root}/runtime/bun`);
  const header = new Uint8Array(await binary.slice(0, 4).arrayBuffer());
  if (header.join(",") !== "127,69,76,70" || binary.size !== runtime.bytes) {
    throw new Error("Runtime ELF header or byte count differs from the receipt");
  }
  const actualHash = new Bun.CryptoHasher("sha256").update(await binary.arrayBuffer()).digest("hex");
  if (actualHash !== runtime.sha256 || Bun.revision !== runtime.revision || Bun.version !== runtime.version) {
    throw new Error("Executing Bun does not match the exact staged runtime");
  }
  for (const path of [
    "sources/bun/package.json",
    "sources/material/package.json",
    "sources/cosmic-epoch/README.md",
    "sources/libcosmic/Cargo.toml",
  ]) {
    if (!(await Bun.file(`${root}/${path}`).exists())) throw new Error(`Missing distribution source ${path}`);
  }
  const sourceReceipt = await Bun.file(`${root}/sources.receipt.json`).json();
  if (sourceReceipt.complete !== true || sourceReceipt.kind !== "bun-os-sources")
    throw new Error("Incomplete source receipt");
  if (
    !sourceReceipt.repositories.some(
      (source: { id: string; revision: string }) => source.id === "bun" && source.revision === runtime.revision,
    )
  )
    throw new Error("Source receipt and runtime revision differ");
  const contents = await sourceIntegrity(`${root}/sources`);
  if (contents.treeSHA256 !== sourceReceipt.treeSHA256)
    throw new Error("Image sources differ from their exported content checksum");
  if (!receipt.product) throw new Error("The image requires the qualified distribution CLI workspace");
  const product = await verifyQualifiedProduct(
    `${root}/product`,
    `${root}/product.receipt.json`,
    `${root}/product.qualification.json`,
    { target: runtime.target, runtime },
  );
  const digest = async (path: string) =>
    new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
  if (
    product.receipt.sourceRevision !== receipt.product.sourceRevision ||
    product.receipt.installedTreeSHA256 !== receipt.product.installedTreeSHA256 ||
    product.receipt.installedModesSHA256 !== receipt.product.installedModesSHA256 ||
    (await digest(`${root}/product.receipt.json`)) !== receipt.product.receiptSHA256 ||
    (await digest(`${root}/product.qualification.json`)) !== receipt.product.qualificationSHA256
  )
    throw new Error("Product payload receipts differ from the staged distribution identity");
  if (requireImageQualification) {
    const proof = (await Bun.file(`${root}/image.qualification.json`).json()) as NonNullable<
      typeof receipt.imageQualification
    >;
    const requiredGates = ["product-cli", "cli-wasm", "ffi", "agent-plugin", "mcp"];
    if (
      proof.schemaVersion !== 1 ||
      proof.kind !== "bun-os-image-surface-qualification" ||
      proof.passed !== true ||
      proof.target !== receipt.runtime.target ||
      proof.sourceRevision !== receipt.product.sourceRevision ||
      proof.installedTreeSHA256 !== receipt.product.installedTreeSHA256 ||
      proof.installedModesSHA256 !== receipt.product.installedModesSHA256 ||
      proof.runtimeRevision !== receipt.runtime.revision ||
      proof.runtimeSHA256 !== receipt.runtime.sha256 ||
      proof.productQualificationSHA256 !== (await digest(`${root}/product.qualification.json`)) ||
      !Array.isArray(proof.gates) ||
      !requiredGates.every(gate => proof.gates.includes(gate))
    )
      throw new Error("Container surface qualification does not match the staged runtime and product receipts");
    receipt.imageQualification = proof;
  }
  return receipt;
}

if (import.meta.main) {
  const receipt = await verifyPayload();
  console.log(
    JSON.stringify({
      name: receipt.name,
      revision: receipt.runtime.revision,
      runtime: "verified",
      imageQualification: receipt.imageQualification,
    }),
  );
}
