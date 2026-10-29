// SPDX-License-Identifier: MIT
import { verifyProductPayload } from "./product-payload.ts";

export interface ProductQualification {
  schemaVersion: 1;
  kind: "bun-os-product-qualification";
  passed: true;
  target: string;
  sourceRevision: string;
  installedTreeSHA256: string;
  installedModesSHA256: string;
  runtimeSHA256: string;
  gates: string[];
}

/** Preparation is not runtime-surface qualification. Bind all independent gates to these exact bytes. */
export async function verifyQualifiedProduct(
  workspace: string,
  receiptPath: string,
  qualificationPath: string,
  expected: { target: string; runtime: { sha256: string; revision: string; abi: "gnu" } },
) {
  const receipt = await verifyProductPayload(workspace, receiptPath, expected);
  const qualification = (await Bun.file(qualificationPath).json()) as ProductQualification;
  if (
    qualification.schemaVersion !== 1 ||
    qualification.kind !== "bun-os-product-qualification" ||
    qualification.passed !== true ||
    qualification.target !== receipt.target ||
    qualification.sourceRevision !== receipt.sourceRevision ||
    qualification.installedTreeSHA256 !== receipt.installedTreeSHA256 ||
    qualification.installedModesSHA256 !== receipt.installedModesSHA256 ||
    qualification.runtimeSHA256 !== receipt.runtime.sha256 ||
    !Array.isArray(qualification.gates) ||
    !qualification.gates.includes("product-cli") ||
    !qualification.gates.includes("cli-wasm") ||
    !qualification.gates.includes("ffi")
  )
    throw new Error(
      "Product payload requires passed CLI, CLI-WASM and FFI gates bound to its source, runtime and installed tree",
    );
  return { receipt, qualification };
}
