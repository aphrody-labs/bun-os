import { expect, setDefaultTimeout, test } from "bun:test";

// every COM or PowerShell test starts pwsh, which can take several seconds on a loaded machine
setDefaultTimeout(60_000);
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

import { classify, parseManifest, parseWingetList, readMsixManifest } from "../src/msix.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";

test("AppxManifest: packaged Win32 app versus Windows App SDK app", () => {
  const win32 =
    parseManifest(`<Package xmlns:rescap="r"><Identity Name="A.B" Publisher="CN=X" Version="1.0.0.0" ProcessorArchitecture="x64"/>
    <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0"/></Dependencies>
    <Applications><Application Id="App" Executable="a.exe" EntryPoint="Windows.FullTrustApplication"/></Applications>
    <Capabilities><rescap:Capability Name="runFullTrust"/><Capability Name="internetClient"/></Capabilities></Package>`);
  expect(win32).toMatchObject({
    name: "A.B",
    architecture: "x64",
    minVersion: "10.0.19041.0",
    restrictedCapabilities: ["runFullTrust"],
    capabilities: ["internetClient"],
  });
  expect(classify(win32).kind).toBe("win32-packaged");
  const sdk = { ...win32, dependencies: ["Microsoft.WindowsAppRuntime.1.8"] };
  expect(classify(sdk)).toMatchObject({ kind: "winui-or-appsdk-dependent", wineCoverageApplies: false });
});

test("winget list table is parsed by header column offsets", () => {
  const rows = parseWingetList(`Name                    Id                       Version
-------------------------------------------------------
Windows Terminal        Microsoft.WindowsTerminal 1.24.12741.0
Git                     Git.Git                  2.51.0`);
  expect(rows.map(r => r.id)).toEqual(["Microsoft.WindowsTerminal", "Git.Git"]);
  expect(rows[0]!.name).toBe("Windows Terminal");
});

const msixDir = join(import.meta.dir, "..", "..", "fluent", "out", "msix");
const builtMsix = (() => {
  try {
    return readdirSync(msixDir).find(f => f.endsWith(".msix"));
  } catch {
    return undefined;
  }
})();
test.skipIf(!win || !builtMsix)(
  "the MSIX built by buncc package msix is a packaged Win32 WinUI app (read back from the zip)",
  async () => {
    const m = await readMsixManifest(join(msixDir, builtMsix!));
    expect(m).toMatchObject({ name: "BunOs.Fluent", architecture: "x64", publisher: "CN=BunOsLocalTest" });
    expect(m.apps[0]).toMatchObject({ executable: "FluentApp.exe", entryPoint: "Windows.FullTrustApplication" });
    expect(classify(m).kind).toBe("win32-packaged");
  },
);

import { dump, toDts, WINMD } from "../src/winmd.ts";

test("winmd projection: enum values and kinds map to TypeScript", () => {
  const dts = toDts([
    {
      ns: "Windows.Foo",
      name: "Reason",
      kind: "enum",
      base: "System.Enum",
      methods: [],
      fields: [
        { name: "A", type: "Int32", value: 0 },
        { name: "B", type: "Int32", value: 1 },
      ],
    },
    {
      ns: "Windows.Foo",
      name: "IThing",
      kind: "interface",
      base: "",
      methods: [
        {
          name: "GetAsync",
          returns: "Windows.Foundation.IAsyncOperation`1<System.String>",
          parameters: [{ name: "id", type: "System.Int32" }],
        },
      ],
      fields: [],
    },
  ]);
  expect(dts).toContain("enum Reason {\n    A = 0,\n    B = 1,");
  expect(dts).toContain("GetAsync(id: number): Promise<string>;");
});

test.skipIf(!win || !existsSync(WINMD) || !Bun.which("dotnet"))(
  "winmd projection: real Windows.winmd, Windows.UI.Notifications",
  async () => {
    const types = await dump(["Windows.UI.Notifications"]);
    const names = types.map(t => t.name);
    expect(names).toContain("ToastNotificationManager");
    expect(names).toContain("ToastNotification");
    const reason = types.find(t => t.name === "ToastDismissalReason")!;
    expect(reason.kind).toBe("enum");
    expect(reason.fields.map(f => [f.name, f.value])).toEqual([
      ["UserCanceled", 0],
      ["ApplicationHidden", 1],
      ["TimedOut", 2],
    ]);
    const statics = types.find(t => t.name === "IToastNotificationManagerStatics")!;
    expect(statics.methods.map(m => m.name)).toContain("CreateToastNotifier");
  },
  240_000,
);

test("Office add-in manifest has a task pane runtime and the pages it points to exist", async () => {
  const dir = new URL("../officejs/", import.meta.url);
  const m = await Bun.file(new URL("manifest.json", dir)).json();
  const rt = m.extensions[0].runtimes[0];
  expect(rt.actions[0].type).toBe("openPage");
  expect(await Bun.file(new URL("taskpane.html", dir)).text()).toContain("office.js");
  expect(rt.code.page).toContain("taskpane.html");
});
