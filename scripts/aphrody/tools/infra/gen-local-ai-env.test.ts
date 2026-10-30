// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { examplePath, loadContract, render } from "./gen-local-ai-env.ts";

const contract = await loadContract();
const rendered = render(contract);

describe("local-ai env example", () => {
  test("the committed example matches tools/aphrody/config/local-ai.json", async () => {
    const committed = (await Bun.file(examplePath).text()).replaceAll("\r\n", "\n");
    expect(committed).toBe(rendered);
  });

  test("every canonical name appears exactly once and without a value", () => {
    const canonical = [
      ...Object.values(contract.binaries ?? {}).flatMap(binary => binary.env),
      ...Object.values(contract.gateways ?? {}).flatMap(gateway => gateway.env ?? []),
      ...Object.values(contract.capabilities).flatMap(capability => capability.env ?? []),
    ].map(env => env.canonical);
    const assignments = rendered.split("\n").filter(line => line !== "" && !line.startsWith("#"));
    expect(assignments).toEqual(canonical.map(name => `${name}=`));
    expect(new Set(canonical).size).toBe(canonical.length);
  });
});
