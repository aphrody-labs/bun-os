// SPDX-License-Identifier: MIT
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPayload } from "./verify-payload.ts";

const root = Bun.env.BUN_OS_ROOT ?? "/opt/bun-os";
const receipt = await verifyPayload(root, false);
if (!receipt.product) throw new Error("Image surface qualification requires a staged product payload");
const workspace = join(root, "product/sources/bun-os");
const qualificationPath = join("/tmp", `bun-os-image-product-qualification-${crypto.randomUUID()}.json`);
const factory = await import(pathToFileURL(join(workspace, "factory/product-qualification.ts")).href);
const result = await factory.qualifyProductPayload(
  workspace,
  join(root, "product.receipt.json"),
  join(root, "runtime/bun"),
  qualificationPath,
);
const qualification = (await Bun.file(qualificationPath).json()) as {
  schemaVersion: number;
  passed: boolean;
  target: string;
  sourceRevision: string;
  installedTreeSHA256: string;
  installedModesSHA256: string;
  runtimeSHA256: string;
  gates: string[];
};
const requiredGates = ["product-cli", "cli-wasm", "ffi"];
if (
  result.passed !== true ||
  qualification.passed !== true ||
  !requiredGates.every(gate => qualification.gates.includes(gate)) ||
  qualification.target !== receipt.runtime.target ||
  qualification.sourceRevision !== receipt.product.sourceRevision ||
  qualification.installedTreeSHA256 !== receipt.product.installedTreeSHA256 ||
  qualification.installedModesSHA256 !== receipt.product.installedModesSHA256 ||
  qualification.runtimeSHA256 !== receipt.runtime.sha256
)
  throw new Error("Image product surfaces did not qualify against the staged runtime and product receipts");

const proof = {
  schemaVersion: 1,
  kind: "bun-os-image-surface-qualification",
  passed: true,
  target: qualification.target,
  sourceRevision: qualification.sourceRevision,
  installedTreeSHA256: qualification.installedTreeSHA256,
  installedModesSHA256: qualification.installedModesSHA256,
  runtimeRevision: receipt.runtime.revision,
  runtimeSHA256: qualification.runtimeSHA256,
  productQualificationSHA256: new Bun.CryptoHasher("sha256")
    .update(await Bun.file(join(root, "product.qualification.json")).arrayBuffer())
    .digest("hex"),
  gates: qualification.gates,
};
await Bun.file(qualificationPath).delete();
await Bun.write(join(root, "image.qualification.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ imageQualification: proof }));
