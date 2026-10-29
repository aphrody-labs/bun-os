// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { keyToBytes, type KeyLike } from "./terminal-keys";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("terminal keys", () => {
  test("printable characters pass through", () => {
    expect(keyToBytes(key("a"))).toBe("a");
    expect(keyToBytes(key("é"))).toBe("é");
  });
  test("Enter, Backspace, Tab", () => {
    expect(keyToBytes(key("Enter"))).toBe("\r");
    expect(keyToBytes(key("Backspace"))).toBe("\x7f");
    expect(keyToBytes(key("Tab"))).toBe("\t");
    expect(keyToBytes(key("Tab", { shiftKey: true }))).toBe("\x1b[Z");
  });
  test("arrows and navigation use CSI sequences", () => {
    expect(keyToBytes(key("ArrowUp"))).toBe("\x1b[A");
    expect(keyToBytes(key("ArrowLeft"))).toBe("\x1b[D");
    expect(keyToBytes(key("Home"))).toBe("\x1b[H");
    expect(keyToBytes(key("Delete"))).toBe("\x1b[3~");
  });
  test("Ctrl+letter sends the control character", () => {
    expect(keyToBytes(key("c", { ctrlKey: true }))).toBe("\x03");
    expect(keyToBytes(key("D", { ctrlKey: true }))).toBe("\x04");
    expect(keyToBytes(key("l", { ctrlKey: true }))).toBe("\x0c");
  });
  test("Alt prefixes escape; Meta and bare modifiers are not for the guest", () => {
    expect(keyToBytes(key("b", { altKey: true }))).toBe("\x1bb");
    expect(keyToBytes(key("c", { metaKey: true }))).toBeUndefined();
    expect(keyToBytes(key("Shift"))).toBeUndefined();
    expect(keyToBytes(key("Control", { ctrlKey: true }))).toBeUndefined();
  });
});
