import { expect, test } from "bun:test";
import { mergeIni, parseIni, sizing, wslPath } from "./install";

test("mergeIni overrides template keys, keeps the user's other keys and sections", () => {
  const current = "# mine\r\n[wsl2]\r\nmemory=8GB\r\nKernel=C:\\\\old\\\\bzImage\r\n\r\n[user]\r\nfoo=bar\r\n";
  const merged = mergeIni(current, "[wsl2]\nkernel=C:\\\\new\nguiApplications=true\n[experimental]\nsparseVhd=true\n");
  const ini = parseIni(merged);
  expect(ini.get("wsl2")).toEqual(
    new Map([
      ["memory", "8GB"],
      ["kernel", "C:\\\\new"],
      ["guiApplications", "true"],
    ]),
  );
  expect(ini.get("user")?.get("foo")).toBe("bar");
  expect(ini.get("experimental")?.get("sparseVhd")).toBe("true");
  expect(merged.startsWith("# mine\r\n")).toBe(true);
  expect(merged.match(/kernel=/gi)?.length).toBe(1);
});

test("mergeIni on an empty file writes the template sections", () => {
  expect(parseIni(mergeIni("", "[wsl2]\na=1\n")).get("wsl2")?.get("a")).toBe("1");
});

test("wslPath escapes backslashes", () => {
  expect(wslPath("C:\\Users\\x\\bzImage")).toBe("C:\\\\Users\\\\x\\\\bzImage");
  expect(wslPath("C:/a/b")).toBe("C:\\\\a\\\\b");
});

test("sizing: all CPUs, half the RAM, a quarter as swap", () => {
  expect(sizing(24, 31.8 * 2 ** 30)).toEqual({ processors: "24", memory: "16GB", swap: "8GB" });
  expect(sizing(2, 1 * 2 ** 30)).toEqual({ processors: "2", memory: "2GB", swap: "1GB" });
});
