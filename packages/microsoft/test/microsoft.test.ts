import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { isPackagedAumid, listStartApps } from "../src/apps.ts";
import { isRegistered, officeProgIds, withCom } from "../src/com.ts";
import { analyze } from "../src/matrix.ts";
import { parsePe } from "../src/pe.ts";
import { coverage, parseSpec } from "../src/wine.ts";

const win = process.platform === "win32";

test("Wine spec lines: implemented, stub, flags with = and !, comments", () => {
  const s = parseSpec(`
# comment
@ stdcall CreateFileW(wstr long ptr long long long) # trailing comment
@ stdcall -syscall=0x000f NtClose(long)
@ stdcall -arch=!i386 RtlLookupFunctionEntry(long ptr ptr)
@ stub BadFunction
@ cdecl -arch=win64 memcpy(ptr ptr long)
42 stdcall -ordinal OrdinalOnly()
@ stdcall -forward Fwd ntdll.Fwd
`);
  expect([...s.implemented].sort()).toEqual([
    "CreateFileW",
    "Fwd",
    "NtClose",
    "OrdinalOnly",
    "RtlLookupFunctionEntry",
    "memcpy",
  ]);
  expect([...s.stubs]).toEqual(["BadFunction"]);
});

test("coverage counts implemented, stub and missing, and reports DLLs without a spec", () => {
  const specs = new Map([["kernel32", parseSpec("@ stdcall A()\n@ stub B")]]);
  const c = coverage(
    new Map([
      ["kernel32.dll", ["A", "B", "C", "#12"]],
      ["api-ms-win-core-foo-l1-1-0.dll", ["X"]],
    ]),
    specs,
  );
  expect(c).toMatchObject({
    total: 3,
    implemented: 1,
    stub: 1,
    missing: 1,
    unknownDlls: ["api-ms-win-core-foo-l1-1-0.dll"],
  });
  expect(c.missingNames).toEqual(["kernel32!B (stub)", "kernel32!C"]);
});

test("AUMID of a packaged app has a package family name", () => {
  expect(isPackagedAumid("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App")).toBe(true);
  expect(isPackagedAumid("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\notepad.exe")).toBe(false);
});

test.skipIf(!win)("PE import table of a real Windows executable (notepad.exe)", async () => {
  const path = `${process.env.SystemRoot}\\System32\\notepad.exe`;
  const pe = parsePe(new Uint8Array(await Bun.file(path).arrayBuffer()));
  expect(pe.machine === 0x8664 || pe.machine === 0xaa64).toBe(true);
  const all = [...pe.imports.keys(), ...pe.delayImports.keys()];
  expect(all.some(d => d.startsWith("api-ms-win-") || d === "kernel32.dll")).toBe(true);
  expect(all).toContain("user32.dll");
  expect(pe.imports.get("user32.dll")!.length).toBeGreaterThan(5);
  expect(pe.isDotnet).toBe(false);
  expect(() => parsePe(new Uint8Array(64))).toThrow(/not a PE/);
});

test.skipIf(!win)("a NativeAOT executable built by buncc has no CLR header; the matrix reads it", async () => {
  const exe = process.env.BUNOS_AOT_EXE;
  if (!exe || !existsSync(exe)) return;
  const row = await analyze(exe, new Map());
  expect(row.dotnet).toBe(false);
  expect(row.dlls).toBeGreaterThan(3);
});

test.skipIf(!win)("COM / IDispatch from Bun: Scripting.FileSystemObject", async () => {
  expect(await isRegistered("Scripting.FileSystemObject")).toBe(true);
  const r = await withCom<{ name: string; ext: string }>(
    "Scripting.FileSystemObject",
    "[pscustomobject]@{ name = $obj.GetFileName('C:\\a\\b.txt'); ext = $obj.GetExtensionName('x.docx') }",
  );
  expect(r).toEqual({ name: "b.txt", ext: "docx" });
});

test.skipIf(!win)("COM / IDispatch from Bun: Shell.Application resolves a namespace", async () => {
  const r = await withCom<{ title: string }>(
    "Shell.Application",
    "[pscustomobject]@{ title = $obj.NameSpace('C:\\Windows').Title }",
  );
  expect(r.title.toLowerCase()).toBe("windows");
});

test.skipIf(!win)(
  "Office: each Office ProgID is either automated or reported as not installed",
  async () => {
    for (const id of officeProgIds) {
      if (!(await isRegistered(id))) {
        console.log(`${id}: not registered on this machine (Office not installed), automation not tested`);
        continue;
      }
      const r = await withCom<{ version: string }>(id, "[pscustomobject]@{ version = $obj.Version }", 180_000);
      expect(r.version).toMatch(/^\d+\.\d+/);
    }
  },
  600_000,
);

test.skipIf(!win)("Start menu apps are listed with AUMIDs", async () => {
  const apps = await listStartApps();
  expect(apps.length).toBeGreaterThan(5);
  expect(apps.some(a => a.packaged)).toBe(true);
});
