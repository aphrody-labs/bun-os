// SPDX-License-Identifier: Apache-2.0
// Explorer file operations (the real files-ops code: copy, move, trash, restore, usage) over an in-memory file system
// with the shape of `os.fs`. The Rust VFS itself is covered by aphrody-shell-vfs's conformance suite.
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("../src/os", () => ({ HOME: "/home/user", webos: async () => ({}), catalog: async () => ({}) }));
const ops = await import("../src/apps/files-ops");

class MemFs {
  nodes = new Map<string, Uint8Array | null>(); // null = directory
  constructor() {
    for (const d of ["/", "/home", "/home/user"]) this.nodes.set(d, null);
  }
  stat(path: string) {
    if (!this.nodes.has(path)) throw new Error(`ENOENT ${path}`);
    const n = this.nodes.get(path);
    return JSON.stringify({ kind: n === null ? "dir" : "file", size: n?.length ?? 0 });
  }
  list(dir: string) {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const rows = [...this.nodes.entries()]
      .filter(([p]) => p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map(([p, n]) => ({ name: p.slice(prefix.length), kind: n === null ? "dir" : "file", size: n?.length ?? 0 }));
    return JSON.stringify(rows);
  }
  read(path: string) {
    const n = this.nodes.get(path);
    if (!n) throw new Error(`ENOENT ${path}`);
    return n;
  }
  write(path: string, data: Uint8Array) {
    this.nodes.set(path, data);
  }
  mkdir(path: string) {
    this.nodes.set(path, null);
  }
  remove(path: string) {
    for (const p of this.nodes.keys()) if (p === path || p.startsWith(`${path}/`)) this.nodes.delete(p);
  }
  rename(from: string, to: string) {
    for (const [p, n] of this.nodes) {
      if (p === from || p.startsWith(`${from}/`)) {
        this.nodes.delete(p);
        this.nodes.set(to + p.slice(from.length), n);
      }
    }
  }
}

let fs: MemFs;
let os: any;
const put = (path: string, text: string) => fs.write(path, new TextEncoder().encode(text));
beforeEach(() => {
  fs = new MemFs();
  os = { fs };
});

describe("explorer operations", () => {
  test("copy keeps the source, numbers name collisions, and copies folders recursively", () => {
    put("/home/user/a.txt", "hello");
    fs.mkdir("/home/user/dir");
    put("/home/user/dir/b.txt", "bee");
    fs.mkdir("/home/user/dst");
    expect(ops.copyTo(os, "/home/user/a.txt", "/home/user/dst")).toBe("/home/user/dst/a.txt");
    expect(ops.copyTo(os, "/home/user/a.txt", "/home/user/dst")).toBe("/home/user/dst/a (2).txt");
    ops.copyTo(os, "/home/user/dir", "/home/user/dst");
    expect(new TextDecoder().decode(fs.read("/home/user/dst/dir/b.txt"))).toBe("bee");
    expect(fs.nodes.has("/home/user/a.txt")).toBe(true);
  });

  test("a folder cannot be copied into itself", () => {
    fs.mkdir("/home/user/dir");
    expect(() => ops.copyTo(os, "/home/user/dir", "/home/user/dir")).toThrow();
  });

  test("trash moves files out of sight, restore puts them back where they were", () => {
    put("/home/user/a.txt", "hello");
    ops.trash(os, ["/home/user/a.txt"]);
    expect(fs.nodes.has("/home/user/a.txt")).toBe(false);
    const trashed = ops.listDir(os, ops.TRASH).filter(e => e.name !== ".origins.json");
    expect(trashed).toHaveLength(1);
    ops.restore(os, [trashed[0]!.path]);
    expect(new TextDecoder().decode(fs.read("/home/user/a.txt"))).toBe("hello");
  });

  test("emptying the trash deletes for good", () => {
    put("/home/user/a.txt", "x");
    ops.trash(os, ["/home/user/a.txt"]);
    ops.emptyTrash(os);
    expect(ops.listDir(os, ops.TRASH).filter(e => e.name !== ".origins.json")).toHaveLength(0);
  });

  test("usage counts bytes, files and folders below a directory", () => {
    put("/home/user/a.txt", "12345");
    fs.mkdir("/home/user/d");
    put("/home/user/d/b.txt", "123");
    const u = ops.usage(os, "/home/user");
    expect(u.bytes).toBe(8);
    expect(u.files).toBe(2);
    expect(u.dirs).toBeGreaterThanOrEqual(1);
  });

  test("protected paths and path helpers", () => {
    expect(ops.protectedPath("/")).toBe(true);
    expect(ops.protectedPath("/home/user")).toBe(true);
    expect(ops.protectedPath("/home/user/a.txt")).toBe(false);
    expect(ops.isInside("/home/user/a", "/home/user")).toBe(true);
    expect(ops.isInside("/home/username", "/home/user")).toBe(false);
    expect(ops.fmtSize(1536)).toBe("1.5 KB");
  });
});
