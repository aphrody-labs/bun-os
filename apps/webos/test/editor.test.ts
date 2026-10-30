// SPDX-License-Identifier: Apache-2.0
// Integration: the editor's engine is CodeMirror 6; language packages resolve per extension and parse real source.
import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { languageFor } from "../src/apps/editor-lang";

const parse = (path: string, doc: string) => {
  const state = EditorState.create({ doc, extensions: [languageFor(path)] });
  const names: string[] = [];
  ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({ enter: n => void names.push(n.name) });
  return names;
};

describe("editor languages", () => {
  test("TypeScript parses a function with a type annotation", () => {
    const names = parse("a.ts", "function f(x: number): string { return String(x); }");
    expect(names).toContain("FunctionDeclaration");
    expect(names).toContain("TypeAnnotation");
  });
  test("Rust parses a function item", () => {
    expect(parse("lib.rs", "fn main() { let x = 1; }")).toContain("FunctionItem");
  });
  test("JSON parses an object", () => {
    expect(parse("a.json", '{"a": [1, 2]}')).toContain("Object");
  });
  test("unknown extensions fall back to plain text (no tree)", () => {
    expect(parse("notes.txt", "hello")).not.toContain("FunctionDeclaration");
  });
});
