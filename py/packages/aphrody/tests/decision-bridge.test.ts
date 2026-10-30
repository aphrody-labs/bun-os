// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Python } from "@aphrody/runtime-sdk/python";
import { decideJson } from "../src/aphrody/decision/bridge";

test("the decision bridge is built on the runtime SDK Python host", () => {
  expect(typeof Python.open).toBe("function");
  expect(typeof decideJson).toBe("function");
});

test.skipIf(!process.env.BUN_PYTHON_HOST_LIBRARY || !process.env.BUN_PYTHON_LIBPYTHON)(
  "Bun calls the Python graph through the real native host and private HTTP contract",
  async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        expect(url.pathname).toBe("/v1/systemone");
        expect(url.searchParams.get("minimum_confidence")).toBe("0.8");
        const body = await request.json();
        expect(body.model).toBe("synthetic-fixture");
        expect(request.headers.get("Authorization")).toBe("Bearer synthetic-auth-fixture");
        calls++;
        return Response.json({
          model: "synthetic-fixture",
          usage: { input_tokens: 12, output_tokens: 3 },
          answers: {
            action: {
              type: "choice",
              choice: "read",
              confidence: 0.9,
              probabilities: { read: 0.9, search: 0.1 },
            },
          },
          selections: { action: "read" },
        });
      },
    });
    try {
      await using python = await Python.async();
      expect(await python.eval("__import__('os').getpid()")).toBe(String(process.pid));
      await python.run(
        "from aphrody.decision import DecisionInput\nfrom pydantic_core import SchemaValidator\n",
      );
      expect(await python.eval("SchemaValidator({'type': 'int'}).validate_python(42)")).toBe("42");
      const schema = await python.evalJSON<{ title: string }>("DecisionInput.model_json_schema()");
      expect(schema.title).toBe("DecisionInput");
      await python.run(
        `import os\nos.environ['APHRODY_YOLO_DECISION_ENDPOINT'] = ${JSON.stringify(`http://127.0.0.1:${server.port}/v1/systemone`)}\nos.environ['APHRODY_YOLO_DECISION_TOKEN'] = 'synthetic-auth-fixture'\n`,
      );
      const output = JSON.parse(
        await decideJson(
          python,
          JSON.stringify({
            goal: "Read the configured owner",
            model: "synthetic-fixture",
            actions: [
              { id: "read", description: "Read owner docs" },
              { id: "search", description: "Search graph" },
            ],
          }),
        ),
      );
      expect(output.action_id).toBe("read");
      expect(output.executed).toBe(false);
      expect(output.inference_owner).toBe("aphrody-jev");
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  },
  15000,
);
