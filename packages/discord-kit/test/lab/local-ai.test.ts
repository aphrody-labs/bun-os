// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { NativeLocalAI, type LocalAISelection, type LocalAIResult } from "../../src/lab/local-ai.ts";

const gemma = { model: "gemma-4-e2b-it-q4km", profile: "aphrody" };
const dbfrProfile = { model: "qwen3-4b-instruct-2507-q4km", profile: "dbfr" };
const input = { messages: [{ role: "user" as const, content: "Bonjour" }] };
const result = (selection: LocalAISelection): LocalAIResult => ({
  text: "Bonjour",
  model: selection.model,
  profile: selection.profile,
  usage: { input: 8, output: 2, total: 10 },
  finishReason: "stop",
});

test("the next model cannot open until native destruction completes", async () => {
  const release = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const order: string[] = [];
  let resident = 0;
  const ai = new NativeLocalAI(async selection => {
    expect(++resident).toBe(1);
    order.push(`open:${selection.profile}`);
    return {
      async chat() {
        return result(selection);
      },
      async close() {
        if (selection.profile === "aphrody") {
          closing.resolve();
          await release.promise;
        }
        resident--;
        order.push(`close:${selection.profile}`);
      },
    };
  });
  const first = ai.chat(gemma, input);
  const second = ai.chat(dbfrProfile, input);
  await closing.promise;
  expect(order).toEqual(["open:aphrody"]);
  release.resolve();
  const answers = await Promise.all([first, second]);
  expect(answers.map(answer => answer.profile)).toEqual(["aphrody", "dbfr"]);
  expect(order).toEqual(["open:aphrody", "close:aphrody", "open:dbfr", "close:dbfr"]);
  expect(resident).toBe(0);
  await ai.close();
  await expect(ai.chat(gemma, input)).rejects.toThrow("closing");
});

test("failed generation is closed and does not poison subsequent turns", async () => {
  let closed = 0;
  const ai = new NativeLocalAI(async selection => ({
    async chat() {
      if (selection.profile === "aphrody") throw new Error("Generation failed");
      return result(selection);
    },
    async close() {
      closed++;
    },
  }));
  await expect(ai.chat(gemma, input)).rejects.toThrow("Generation failed");
  expect((await ai.chat(dbfrProfile, input)).profile).toBe("dbfr");
  expect(closed).toBe(2);
});

test("an aborted queued turn does not load its model", async () => {
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let opens = 0;
  const ai = new NativeLocalAI(async selection => {
    opens++;
    return {
      async chat() {
        started.resolve();
        await release.promise;
        return result(selection);
      },
      async close() {},
    };
  });
  const first = ai.chat(gemma, input);
  await started.promise;
  const abort = new AbortController();
  const second = ai.chat(dbfrProfile, { ...input, signal: abort.signal });
  abort.abort();
  release.resolve();
  await first;
  await expect(second).rejects.toThrow();
  expect(opens).toBe(1);
});

test("queue wait counts against the request deadline", async () => {
  const release = Promise.withResolvers<void>();
  let opens = 0;
  const ai = new NativeLocalAI(async selection => ({
    async chat() {
      opens++;
      await release.promise;
      return result(selection);
    },
    async close() {},
  }));
  const first = ai.chat(gemma, input);
  const expired = ai.chat(dbfrProfile, { ...input, timeoutMs: 1 });
  await Bun.sleep(10);
  release.resolve();
  await first;
  await expect(expired).rejects.toThrow("deadline");
  expect(opens).toBe(1);
});

test("invalid profile or output identity fails closed and native session is freed", async () => {
  let opens = 0;
  let closed = 0;
  const ai = new NativeLocalAI(async () => {
    opens++;
    return {
      async chat() {
        return result(dbfrProfile);
      },
      async close() {
        closed++;
      },
    };
  });
  await expect(ai.chat({ ...gemma, profile: "../dbfr" }, input)).rejects.toThrow("required");
  await expect(ai.chat({ ...gemma, context: 256 }, input)).rejects.toThrow("context");
  await expect(ai.chat({ ...gemma, context: 1000000 }, input)).rejects.toThrow("context");
  expect(opens).toBe(0);
  await expect(ai.chat(gemma, input)).rejects.toThrow("identity");
  expect(closed).toBe(1);
});
