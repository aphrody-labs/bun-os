// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { A2A_ERROR_CODES, A2A_METHODS, A2A_STREAMING_METHODS, TASK_STATE_VALUES } from "../src/index.ts";
import { renderGenerated } from "../scripts/generate-types.ts";
import { generateTypes, jsonName, parseProto } from "../scripts/proto-to-ts.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const protoPath = join(repoRoot, "crates", "aphrody-a2a-pb", "proto", "a2a.proto");
const rustErrors = join(repoRoot, "crates", "aphrody-a2a", "src", "errors.rs");
const rustJsonRpc = join(repoRoot, "crates", "aphrody-a2a", "src", "jsonrpc.rs");

describe("generated types", () => {
  test("src/generated/a2a.ts is the projection of the current proto", async () => {
    const committed = await Bun.file(join(import.meta.dir, "..", "src", "generated", "a2a.ts")).text();
    // The committed file is run through the repo formatter (wrapping, leading `|`, trailing commas).
    const squash = (s: string) =>
      s
        .replace(/\s+/g, "")
        .replace(/=\|/g, "=")
        .replace(/,([)\]}])/g, "$1");
    expect(squash(await renderGenerated())).toBe(squash(committed));
  });
});

describe("proto reader", () => {
  const proto = parseProto(`
    syntax = "proto3";
    package demo.v1;
    // A thing.
    message Thing {
      // Identifier.
      string thing_id = 1 [(google.api.field_behavior) = REQUIRED];
      optional int32 page_size = 2;
      repeated string tags = 3;
      map<string, Other> by_name = 4;
      google.protobuf.Struct metadata = 5;
      oneof payload {
        string text = 6;
        bytes raw = 7;
      }
    }
    message Other { bool ok = 1 [deprecated = true]; }
    enum Color { COLOR_UNSPECIFIED = 0; COLOR_RED = 1; }
    service Svc {
      rpc Do(Thing) returns (stream Other) {
        option (google.api.http) = { post: "/do" body: "*" additional_bindings: { post: "/{t}/do" } };
      }
      rpc Quiet(Thing) returns (google.protobuf.Empty);
    }
  `);

  test("reads messages, fields, oneofs, enums and rpcs", () => {
    expect(proto.package).toBe("demo.v1");
    const thing = proto.messages.find(m => m.name === "Thing");
    expect(thing?.doc).toBe("A thing.");
    expect(thing?.fields.map(f => [f.jsonName, f.required, f.optional, f.repeated])).toEqual([
      ["thingId", true, false, false],
      ["pageSize", false, true, false],
      ["tags", false, false, true],
      ["byName", false, false, false],
      ["metadata", false, false, false],
    ]);
    expect(thing?.fields[3]?.mapKey).toBe("string");
    expect(thing?.oneofs[0]?.fields.map(f => f.name)).toEqual(["text", "raw"]);
    expect(proto.messages[1]?.fields[0]?.deprecated).toBe(true);
    expect(proto.enums[0]?.values.map(v => v.name)).toEqual(["COLOR_UNSPECIFIED", "COLOR_RED"]);
    expect(proto.rpcs).toEqual([
      {
        name: "Do",
        doc: "",
        request: "Thing",
        response: "Other",
        requestStream: false,
        responseStream: true,
      },
      {
        name: "Quiet",
        doc: "",
        request: "Thing",
        response: "google.protobuf.Empty",
        requestStream: false,
        responseStream: false,
      },
    ]);
  });

  test("projects to ProtoJSON TypeScript", () => {
    const ts = generateTypes(proto, {
      protoPath: "demo.proto",
      command: "regen",
    });
    expect(ts).toContain("thingId: string;");
    expect(ts).toContain("pageSize?: number;");
    expect(ts).toContain("tags?: string[];");
    expect(ts).toContain("byName?: { [key: string]: Other };");
    expect(ts).toContain("metadata?: JsonObject;");
    expect(ts).toContain("export type ThingPayload =");
    expect(ts).toContain("export type Thing = ThingCommon & ThingPayload;");
    expect(ts).toContain('export const COLOR_VALUES = ["COLOR_UNSPECIFIED", "COLOR_RED"] as const;');
  });

  test("jsonName follows the protobuf JSON mapping", () => {
    expect(jsonName("context_id")).toBe("contextId");
    expect(jsonName("oauth2_metadata_url")).toBe("oauth2MetadataUrl");
    expect(jsonName("api_key_security_scheme")).toBe("apiKeySecurityScheme");
    expect(jsonName("id")).toBe("id");
  });

  test("an unsupported construct fails loudly", () => {
    expect(() => parseProto("message A { message B {} }")).toThrow(/nested message/);
    expect(() =>
      generateTypes(parseProto("message A { Missing m = 1; }"), {
        protoPath: "x",
        command: "y",
      }),
    ).toThrow(/unresolved type Missing/);
  });
});

describe("parity with the Rust owner", () => {
  test("JSON-RPC and gRPC method names are the rpcs of a2a.proto", async () => {
    const proto = parseProto(await Bun.file(protoPath).text());
    expect([...A2A_METHODS] as string[]).toEqual(proto.rpcs.map(r => r.name));
    expect([...A2A_STREAMING_METHODS] as string[]).toEqual(proto.rpcs.filter(r => r.responseStream).map(r => r.name));
  });

  test("method names equal the `methods` module of aphrody-a2a", async () => {
    const source = await Bun.file(rustJsonRpc).text();
    const block = source.slice(source.indexOf("pub mod methods"));
    const names = [...block.matchAll(/pub const [A-Z_]+: &str = "(\w+)";/g)].map(m => m[1]);
    expect(new Set(names)).toEqual(new Set(A2A_METHODS));
  });

  test("error codes equal the `error_code` module of aphrody-a2a", async () => {
    const source = await Bun.file(rustErrors).text();
    const block = source.slice(source.indexOf("pub mod error_code"), source.indexOf("/// Returns the reason string"));
    const rust = new Map([...block.matchAll(/pub const ([A-Z_]+): i32 = (-?\d+);/g)].map(m => [m[1], Number(m[2])]));
    const aliases: Record<string, string> = {
      EXTENDED_AGENT_CARD_NOT_CONFIGURED: "EXTENDED_CARD_NOT_CONFIGURED",
    };
    for (const [reason, code] of Object.entries(A2A_ERROR_CODES)) {
      expect(rust.get(aliases[reason] ?? reason)).toBe(code);
    }
    expect(rust.size).toBe(Object.keys(A2A_ERROR_CODES).length);
  });

  test("task states are the enum of a2a.proto", async () => {
    const proto = parseProto(await Bun.file(protoPath).text());
    expect([...TASK_STATE_VALUES] as string[]).toEqual(
      proto.enums.find(e => e.name === "TaskState")?.values.map(v => v.name) as string[],
    );
  });
});
