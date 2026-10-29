import { describe, expect, test } from "bun:test";
import {
  detectLegacy,
  executePlan,
  planUninstall,
  protectedRoots,
  renderPlan,
  touchesProtected,
  type LegacyHost,
  type UninstallEntry,
} from "../src/legacy.ts";

/** A fake machine: a set of directories/files, a simulated registry, recorded commands and deletions. */
function fakeHost(opts: {
  files: string[];
  uninstall?: UninstallEntry[];
  reg?: Record<string, Record<string, string>>;
  userPath?: string;
  machinePath?: string;
  configs?: Record<string, string>;
  execCode?: (argv: string[]) => number;
}) {
  const files = new Set(opts.files.map(f => f.toLowerCase()));
  const dirs = new Set<string>();
  for (const f of opts.files) {
    const parts = f.split("\\");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("\\").toLowerCase());
  }
  const log = { exec: [] as string[][], removed: [] as string[], written: {} as Record<string, string> };
  const host: LegacyHost = {
    env: { ProgramFiles: "C:\\Program Files", USERPROFILE: "C:\\Users\\me", PATH: "C:\\msys64\\usr\\bin;C:\\Windows" },
    exists: p => {
      const k = p.toLowerCase().replace(/\\+$/, "");
      return files.has(k) || dirs.has(k);
    },
    isDir: p => dirs.has(p.toLowerCase()),
    list: p => {
      const prefix = p.toLowerCase() + "\\";
      const names = new Set<string>();
      for (const f of opts.files) if (f.toLowerCase().startsWith(prefix)) names.add(f.slice(prefix.length).split("\\")[0]!);
      return [...names];
    },
    readText: p => opts.configs?.[p],
    uninstallEntries: async () => opts.uninstall ?? [],
    regValues: async k => opts.reg?.[k],
    persistentPath: async () => ({ user: opts.userPath ?? "", machine: opts.machinePath ?? "" }),
    exec: async argv => {
      log.exec.push(argv);
      return { code: opts.execCode?.(argv) ?? 0, stdout: "pkg-a\npkg-b\n", stderr: "" };
    },
    removeDir: p => void log.removed.push(p),
    writeFile: (p, t) => void (log.written[p] = t),
    configFiles: () => Object.keys(opts.configs ?? {}),
  };
  return { host, log };
}

const MSYS = ["C:\\msys64\\usr\\bin\\msys-2.0.dll", "C:\\msys64\\usr\\bin\\pacman.exe", "C:\\msys64\\home\\me\\.bashrc", "C:\\msys64\\uninstall.exe"];
const GIT = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"];

describe("detection (read-only)", () => {
  test("msys2: mode installer, PATH entry, registry key, dependents", async () => {
    const { host } = fakeHost({
      files: [...MSYS, ...GIT],
      uninstall: [{ key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MSYS2 64bit", DisplayName: "MSYS2 64bit", DisplayVersion: "20260927", InstallLocation: "C:\\msys64", UninstallString: "C:\\msys64\\uninstall.exe" }],
      userPath: "C:\\msys64\\ucrt64\\bin;C:\\Tools",
      configs: { "C:\\Users\\me\\AppData\\Roaming\\Code\\User\\settings.json": '{"terminal":"C:\\\\msys64\\\\usr\\\\bin\\\\bash.exe"}' },
    });
    const [m] = await detectLegacy("msys2", host);
    expect(m!.mode).toBe("installer");
    expect(m!.root).toBe("C:\\msys64");
    expect(m!.pathEntries.map(e => e.scope + ":" + e.value)).toContain("user:C:\\msys64\\ucrt64\\bin");
    expect(m!.pathEntries.some(e => e.scope === "process")).toBe(true);
    expect(m!.dependents.some(d => d.includes("settings.json"))).toBe(true);
    expect(m!.notes.some(n => n.includes("user data"))).toBe(true);
  });

  test("portable and scoop modes", async () => {
    const portable = fakeHost({ files: ["C:\\w64devkit\\bin\\gcc.exe"] });
    expect((await detectLegacy("mingw", portable.host))[0]!.mode).toBe("portable");
    const scoop = fakeHost({ files: ["C:\\Users\\me\\scoop\\apps\\msys2\\current\\usr\\bin\\msys-2.0.dll"] });
    expect((await detectLegacy("msys2", scoop.host))[0]!.mode).toBe("scoop");
  });

  test("Git for Windows is found as protected and is never a detection result", async () => {
    const { host } = fakeHost({ files: [...GIT, ...MSYS], reg: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: "C:\\Program Files\\Git" } } });
    expect(await protectedRoots(host)).toContain("C:\\Program Files\\Git");
    for (const id of ["msys2", "mingw", "gnuwin32", "cygwin"] as const)
      for (const i of await detectLegacy(id, host)) expect(i.root.toLowerCase()).not.toContain("\\git");
    expect(touchesProtected("C:\\Program Files", ["C:\\Program Files\\Git"])).toBeDefined();
    expect(touchesProtected("C:\\msys64", ["C:\\Program Files\\Git"])).toBeUndefined();
  });

  test("cygwin root from the registry; gnuwin32 under Program Files (x86)", async () => {
    const cyg = fakeHost({ files: ["D:\\cyg\\bin\\cygwin1.dll"], reg: { "HKLM\\SOFTWARE\\Cygwin\\setup": { rootdir: "D:\\cyg" } } });
    const [c] = await detectLegacy("cygwin", cyg.host);
    expect(c!.root).toBe("D:\\cyg");
    expect(c!.registryKeys).toContain("HKLM\\SOFTWARE\\Cygwin");
    const gnu = fakeHost({ files: ["C:\\Program Files (x86)\\GnuWin32\\bin\\sed.exe"] });
    gnu.host.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)";
    expect((await detectLegacy("gnuwin32", gnu.host))[0]!.root).toBe("C:\\Program Files (x86)\\GnuWin32");
  });
});

describe("root normalisation", () => {
  test("a trailing backslash and the well-known path are one install with every uninstaller", async () => {
    const base = "C:\\Program Files (x86)\\GnuWin32";
    const { host } = fakeHost({
      files: [`${base}\\bin\\sed.exe`, `${base}\\uninstall\\a.exe`],
      uninstall: [
        { key: "HKLM\\U\\A", DisplayName: "GnuWin32: A", InstallLocation: `${base}\\`, UninstallString: `${base}\\uninstall\\a.exe` },
        { key: "HKLM\\U\\B", DisplayName: "GnuWin32: B", InstallLocation: base, UninstallString: `${base}\\uninstall\\b.exe` },
      ],
    });
    host.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)";
    const found = await detectLegacy("gnuwin32", host);
    expect(found.length).toBe(1);
    expect(found[0]!.uninstallers.length).toBe(2);
    expect(found[0]!.registryKeys).toEqual(["HKLM\\U\\A", "HKLM\\U\\B"]);
  });
});

describe("plan and execution", () => {
  async function msysPlan() {
    const fake = fakeHost({
      files: [...MSYS, ...GIT],
      uninstall: [{ key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MSYS2 64bit", DisplayName: "MSYS2 64bit", InstallLocation: "C:\\msys64", UninstallString: "C:\\msys64\\uninstall.exe" }],
      userPath: "C:\\msys64\\usr\\bin",
    });
    const installs = await detectLegacy("msys2", fake.host);
    const plan = planUninstall(installs, await protectedRoots(fake.host), "C:\\backup\\1");
    return { ...fake, plan };
  }

  test("dry run text lists paths, PATH, registry, backups and rollback; runs nothing", async () => {
    const { plan, log } = await msysPlan();
    const text = renderPlan(plan, false);
    expect(text).toContain("DRY RUN");
    expect(text).toContain("C:\\msys64");
    expect(text).toContain("PATH(user): C:\\msys64\\usr\\bin");
    expect(text).toContain("registry: HKLM");
    expect(text).toContain("pacman.exe -Qqe");
    expect(text).toContain("rollback:");
    expect(plan.steps.findIndex(s => s.kind === "gate")).toBeGreaterThan(plan.steps.findIndex(s => s.kind === "backup"));
    expect(plan.steps.findIndex(s => s.kind === "gate")).toBeLessThan(plan.steps.findIndex(s => s.kind === "uninstaller"));
    expect(log.exec).toEqual([]);
    expect(log.removed).toEqual([]);
  });

  test("a failing smoke test stops before any removal", async () => {
    const { plan, host, log } = await msysPlan();
    const r = await executePlan(plan, host, async () => [{ name: "ls", ok: false, detail: "shim missing" }]);
    expect(r.stoppedAt).toBe(plan.steps.findIndex(s => s.kind === "gate"));
    expect(log.removed).toEqual([]);
    expect(log.exec.some(c => c.includes("reg") && c.includes("delete"))).toBe(false);
    expect(log.exec.some(c => c[0].endsWith("uninstall.exe"))).toBe(false);
  });

  test("with passing smoke test: backup first, then uninstaller, PATH, registry, folder only", async () => {
    const { plan, host, log } = await msysPlan();
    const r = await executePlan(plan, host, async () => [{ name: "ls", ok: true, detail: "ok" }]);
    expect(r.stoppedAt).toBeUndefined();
    expect(log.written["C:\\backup\\1\\path.json"]).toContain("msys64");
    expect(log.written["C:\\backup\\1\\msys2-pacman-Qe.txt"]).toBe("pkg-a\npkg-b\n");
    const order = log.exec.map(c => c[0]);
    expect(order.findIndex(c => c.endsWith("pacman.exe"))).toBeLessThan(order.findIndex(c => c.endsWith("uninstall.exe")));
    expect(log.removed).toEqual(["C:\\msys64"]);
    expect(log.removed.join()).not.toContain("Git");
  });

  test("a tampered plan cannot delete anything but a detected root", async () => {
    const { plan, host, log } = await msysPlan();
    plan.steps.push({ kind: "delete-dir", title: "evil", path: "C:\\Program Files\\Git" });
    const r = await executePlan(plan, host, async () => [{ name: "ls", ok: true, detail: "ok" }]);
    expect(r.stoppedAt).toBe(plan.steps.length - 1);
    expect(log.removed).toEqual(["C:\\msys64"]);
  });

  test("an install overlapping Git for Windows is dropped from the plan with a warning", async () => {
    const { host } = fakeHost({ files: GIT });
    const fake = {
      id: "msys2" as const, mode: "portable" as const, root: "C:\\Program Files\\Git", uninstallers: [], registryKeys: [], pathEntries: [], shortcuts: [], dependents: [], notes: [],
    };
    const plan = planUninstall([fake], await protectedRoots(host), "C:\\b");
    expect(plan.installs).toEqual([]);
    expect(plan.warnings[0]).toContain("skipped");
    expect(plan.steps.some(s => s.kind === "delete-dir")).toBe(false);
  });
});
