import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertList, prependToPath, splitList, translateEnv } from "./env.ts";
import { convertPath, detectStyle, looksLikePath, parsePath, toCygwin, toMsys, toWindows, toWsl } from "./path.ts";
import { posixShell, posixSpawn, preparePosixSpawn } from "./spawn.ts";

describe("path translation", () => {
  test("drive paths across all styles", () => {
    expect(toMsys("C:\\Users\\me\\x")).toBe("/c/Users/me/x");
    expect(toCygwin("C:\\Users\\me\\x")).toBe("/cygdrive/c/Users/me/x");
    expect(toWsl("C:\\Users\\me\\x")).toBe("/mnt/c/Users/me/x");
    expect(toWsl("c:/Users/me", { wslMount: "/" })).toBe("/c/Users/me");
    expect(toWindows("/c/Users/me/x")).toBe("C:\\Users\\me\\x");
    expect(toWindows("/mnt/d/a/b")).toBe("D:\\a\\b");
    expect(toWindows("/cygdrive/e/")).toBe("E:\\");
    expect(toWindows("/c")).toBe("C:\\");
    expect(toMsys("C:\\")).toBe("/c");
  });
  test("mixed slashes, extended-length and UNC", () => {
    expect(toMsys("C:/a\\b//c")).toBe("/c/a/b/c");
    expect(toMsys("\\\\?\\C:\\long\\path")).toBe("/c/long/path");
    expect(toMsys("\\\\server\\share\\dir")).toBe("//server/share/dir");
    expect(toWindows("//server/share/dir")).toBe("\\\\server\\share\\dir");
    expect(toWindows("\\\\?\\UNC\\srv\\sh\\f")).toBe("\\\\srv\\sh\\f");
  });
  test("WSL network paths map to Linux paths", () => {
    expect(toWsl("\\\\wsl$\\Ubuntu\\home\\me")).toBe("/home/me");
    expect(parsePath("\\\\wsl.localhost\\Arch\\etc").wslDistro).toBe("Arch");
  });
  test("relative and plain POSIX paths only change separators", () => {
    expect(toWindows("src/lib/x.ts")).toBe("src\\lib\\x.ts");
    expect(toMsys("src\\lib\\x.ts")).toBe("src/lib/x.ts");
    expect(convertPath("/usr/bin/ls", "posix")).toBe("/usr/bin/ls");
    expect(toWindows("C:\\a", { sep: "/" })).toBe("C:/a");
  });
  test("style detection", () => {
    expect(detectStyle("C:\\x")).toBe("windows");
    expect(detectStyle("/c/x")).toBe("msys");
    expect(detectStyle("/cygdrive/c/x")).toBe("cygwin");
    expect(detectStyle("/mnt/c/x")).toBe("wsl");
    expect(detectStyle("/usr/bin")).toBe("posix");
    expect(detectStyle("/mnt/data/x")).toBe("posix");
    expect(looksLikePath("C:foo")).toBe(false);
    expect(looksLikePath("--flag")).toBe(false);
  });
  test("round trip", () => {
    for (const p of ["C:\\Users\\a b\\c.txt", "D:\\", "Z:\\x\\y\\z"]) expect(toWindows(toMsys(p))).toBe(p);
  });
});

describe("env translation", () => {
  test("PATH list both ways, case-insensitive key kept", () => {
    const posix = translateEnv(
      { Path: "C:\\Windows;C:\\Program Files\\Git\\cmd", FOO: "bar", TEMP: "C:\\Temp" },
      "msys",
      "windows",
    );
    expect(posix.Path).toBe("/c/Windows:/c/Program Files/Git/cmd");
    expect(posix.TEMP).toBe("/c/Temp");
    expect(posix.FOO).toBe("bar");
    const back = translateEnv(posix, "windows", "msys");
    expect(back.Path).toBe("C:\\Windows;C:\\Program Files\\Git\\cmd");
  });
  test("a POSIX list that holds a drive-letter path stays together", () => {
    expect(splitList("/usr/bin:C:\\x\\y:/c/z", "msys")).toEqual(["/usr/bin", "C:\\x\\y", "/c/z"]);
    expect(convertList("/usr/bin:C:\\x", "windows", "msys")).toBe("\\usr\\bin;C:\\x");
  });
  test("prependToPath adds once", () => {
    const env = prependToPath({ Path: "C:\\Windows" }, ["C:\\buncc\\bin", "C:\\Windows"]);
    expect(env.Path).toBe("C:\\buncc\\bin;C:\\Windows");
    expect(prependToPath(env, ["C:\\buncc\\bin"]).Path).toBe(env.Path);
  });
});

describe("spawn", () => {
  test("prepare: native child keeps windows paths, pathPrepend goes first, args translate on request", () => {
    const a = preparePosixSpawn(["ls", "/c/x"], {
      env: { PATH: "C:\\a" },
      pathPrepend: ["C:\\shims"],
      childStyle: "windows",
      translateArgs: true,
    });
    expect(a.env.PATH).toBe("C:\\shims;C:\\a");
    expect(a.argv).toEqual(["ls", "C:\\x"]);
    const b = preparePosixSpawn(["x", "C:\\y"], { env: { PATH: "C:\\a" }, childStyle: "msys", translateArgs: true });
    expect(b.argv).toEqual(["x", "/c/y"]);
    expect(b.env.PATH).toBe("/c/a");
  });
  test("posixShell and posixSpawn run a real process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "px-"));
    writeFileSync(join(dir, "f.txt"), "data\n");
    expect(existsSync(join(dir, "f.txt"))).toBe(true);
    const r = await posixShell("cat f.txt", { cwd: dir });
    expect(r).toMatchObject({ code: 0, stdout: "data\n" });
    const s = await posixSpawn(
      [process.execPath, "-e", "console.log(process.env.PATH.split(require('path').delimiter)[0])"],
      { pathPrepend: [dir] },
    );
    expect(s.stdout.trim().toLowerCase()).toBe(dir.toLowerCase());
  });
});
