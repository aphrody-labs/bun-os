import { describe, expect, test } from "bun:test";
import {
  detectLegacy,
  executePlan,
  isInnoUninstaller,
  scoopInfo,
  WINGET_IDS,
  type LegacyInstall,
  planUninstall,
  protectedRoots,
  renderPlan,
  touchesProtected,
  type LegacyHost,
  type UninstallEntry,
} from "../src/legacy.ts";

/**
 * A simulated machine: directories and files, a registry (the keys of the Add/Remove Programs entries plus extras), a PATH,
 * recorded commands. Commands have effects like the real ones, except those listed in `silent`: they exit 0 and change
 * nothing (what a non-elevated `reg delete` or an Inno uninstaller that re-launches itself looks like).
 */
function fakeHost(opts: {
  files: string[];
  uninstall?: UninstallEntry[];
  reg?: Record<string, Record<string, string>>;
  userPath?: string;
  machinePath?: string;
  configs?: Record<string, string>;
  elevated?: boolean;
  silent?: ("uninstaller" | "reg-delete" | "winget-uninstall" | "scoop")[];
  /** winget package ids reported by `winget list`. */
  winget?: string[];
  env?: Record<string, string>;
  /** Effect of the uninstaller appears this long after it returned. */
  uninstallerDelayMs?: number;
  eperm?: string[];
}) {
  const files = new Set(opts.files.map(f => f.toLowerCase()));
  const dirs = new Set<string>();
  const addDirs = (f: string) => {
    const parts = f.split("\\");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("\\").toLowerCase());
  };
  for (const f of opts.files) addDirs(f);
  const winget = new Set(opts.winget ?? []);
  const keys = new Set((opts.uninstall ?? []).map(e => e.key.toLowerCase()));
  const state = { user: opts.userPath ?? "", machine: opts.machinePath ?? "" };
  const log = {
    exec: [] as { argv: string[]; timeoutMs?: number }[],
    removed: [] as string[],
    written: {} as Record<string, string>,
  };
  const norm = (p: string) => p.toLowerCase().replace(/\\+$/, "");
  const host: LegacyHost = {
    env: {
      ProgramFiles: "C:\\Program Files",
      USERPROFILE: "C:\\Users\\me",
      PATH: "C:\\msys64\\usr\\bin;C:\\Windows",
      ...opts.env,
    },
    exists: p => files.has(norm(p)) || dirs.has(norm(p)),
    isDir: p => dirs.has(norm(p)),
    list: p => {
      const prefix = norm(p) + "\\";
      const names = new Set<string>();
      for (const f of [...files]) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("\\")[0]!);
      return [...names];
    },
    readText: p => opts.configs?.[p],
    uninstallEntries: async () => opts.uninstall ?? [],
    regValues: async k => opts.reg?.[k],
    persistentPath: async () => ({ user: state.user, machine: state.machine }),
    regKeyExists: async k => keys.has(k.toLowerCase()),
    isElevated: async () => opts.elevated ?? true,
    exec: async (argv, o) => {
      log.exec.push({ argv, timeoutMs: o?.timeoutMs });
      const [cmd] = argv;
      if (cmd === "winget" && argv[1] === "list") {
        const id = argv[argv.indexOf("--id") + 1]!;
        return { code: winget.has(id) ? 0 : 2316632084, stdout: "", stderr: "" };
      } else if (cmd === "winget" && argv[1] === "uninstall") {
        const id = argv[argv.indexOf("--id") + 1]!;
        if (!opts.silent?.includes("winget-uninstall")) winget.delete(id);
      } else if (cmd === "scoop" && argv[1] === "uninstall") {
        if (!opts.silent?.includes("scoop")) {
          const marker = "\\apps\\" + argv[2]!.toLowerCase();
          for (const set of [files, dirs])
            for (const x of [...set]) if (x.includes(marker + "\\") || x.endsWith(marker)) set.delete(x);
        }
      } else if (cmd === "reg" && argv[1] === "delete") {
        if (!opts.silent?.includes("reg-delete")) keys.delete(argv[2]!.toLowerCase());
      } else if (cmd === "robocopy") {
        addDirs(argv[2]! + "\\_");
      } else if (cmd === "reg" && argv[1] === "export") {
        files.add(norm(argv[3]!));
      } else if (cmd === "powershell") {
        const m = /\$s='(User|Machine)'.*?-ne '([^']+)'/.exec(argv[3]!);
        if (m) {
          const slot = m[1] === "User" ? "user" : "machine";
          state[slot] = state[slot]
            .split(";")
            .filter(x => x && x !== m[2])
            .join(";");
        }
      } else if (/\.exe$/i.test(cmd!) && (opts.uninstall ?? []).some(e => e.UninstallString === cmd)) {
        const entry = opts.uninstall!.find(e => e.UninstallString === cmd)!;
        const remove = () => {
          keys.delete(entry.key.toLowerCase());
          files.delete(norm(cmd!));
        };
        if (!opts.silent?.includes("uninstaller")) {
          if (opts.uninstallerDelayMs) setTimeout(remove, opts.uninstallerDelayMs);
          else remove();
        }
      }
      return { code: 0, stdout: "pkg-a\npkg-b\n", stderr: "" };
    },
    removeDir: p => {
      if (opts.eperm?.some(x => norm(x) === norm(p))) throw new Error(`EPERM: operation not permitted, rmdir '${p}'`);
      log.removed.push(p);
      for (const set of [files, dirs])
        for (const x of [...set]) if (x === norm(p) || x.startsWith(norm(p) + "\\")) set.delete(x);
    },
    writeFile: (p, t) => {
      log.written[p] = t;
      files.add(norm(p));
    },
    configFiles: () => Object.keys(opts.configs ?? {}),
  };
  return { host, log, keys, state };
}

const MSYS = [
  "C:\\msys64\\usr\\bin\\msys-2.0.dll",
  "C:\\msys64\\usr\\bin\\pacman.exe",
  "C:\\msys64\\home\\me\\.bashrc",
  "C:\\msys64\\uninstall.exe",
];
const GIT = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"];

describe("detection (read-only)", () => {
  test("msys2: mode installer, PATH entry, registry key, dependents", async () => {
    const { host } = fakeHost({
      files: [...MSYS, ...GIT],
      uninstall: [
        {
          key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MSYS2 64bit",
          DisplayName: "MSYS2 64bit",
          DisplayVersion: "20260927",
          InstallLocation: "C:\\msys64",
          UninstallString: "C:\\msys64\\uninstall.exe",
        },
      ],
      userPath: "C:\\msys64\\ucrt64\\bin;C:\\Tools",
      configs: {
        "C:\\Users\\me\\AppData\\Roaming\\Code\\User\\settings.json":
          '{"terminal":"C:\\\\msys64\\\\usr\\\\bin\\\\bash.exe"}',
      },
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
    const { host } = fakeHost({
      files: [...GIT, ...MSYS],
      reg: { "HKLM\\SOFTWARE\\GitForWindows": { InstallPath: "C:\\Program Files\\Git" } },
    });
    expect(await protectedRoots(host)).toContain("C:\\Program Files\\Git");
    for (const id of ["msys2", "mingw", "gnuwin32", "cygwin"] as const)
      for (const i of await detectLegacy(id, host)) expect(i.root.toLowerCase()).not.toContain("\\git");
    expect(touchesProtected("C:\\Program Files", ["C:\\Program Files\\Git"])).toBeDefined();
    expect(touchesProtected("C:\\msys64", ["C:\\Program Files\\Git"])).toBeUndefined();
  });

  test("cygwin root from the registry; gnuwin32 under Program Files (x86)", async () => {
    const cyg = fakeHost({
      files: ["D:\\cyg\\bin\\cygwin1.dll"],
      reg: { "HKLM\\SOFTWARE\\Cygwin\\setup": { rootdir: "D:\\cyg" } },
    });
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
        {
          key: "HKLM\\U\\A",
          DisplayName: "GnuWin32: A",
          InstallLocation: `${base}\\`,
          UninstallString: `${base}\\uninstall\\a.exe`,
        },
        {
          key: "HKLM\\U\\B",
          DisplayName: "GnuWin32: B",
          InstallLocation: base,
          UninstallString: `${base}\\uninstall\\b.exe`,
        },
      ],
    });
    host.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)";
    const found = await detectLegacy("gnuwin32", host);
    expect(found.length).toBe(1);
    expect(found[0]!.uninstallers.length).toBe(2);
    expect(found[0]!.registryKeys).toEqual(["HKLM\\U\\A", "HKLM\\U\\B"]);
  });
});

const KEY = "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MSYS2 64bit";
const OK = async () => [{ name: "ls", ok: true, detail: "ok" }];
const fast = { verifyMs: 0 };

describe("plan and execution", () => {
  async function msysPlan(
    extra: Parameters<typeof fakeHost>[0] extends infer T ? Partial<T> : never = {},
    elevated = true,
  ) {
    const fake = fakeHost({
      files: [...MSYS, ...GIT],
      uninstall: [
        {
          key: KEY,
          DisplayName: "MSYS2 64bit",
          InstallLocation: "C:\\msys64",
          UninstallString: "C:\\msys64\\uninstall.exe",
        },
      ],
      userPath: "C:\\msys64\\usr\\bin",
      elevated,
      ...extra,
    });
    const installs = await detectLegacy("msys2", fake.host);
    const plan = planUninstall(installs, await protectedRoots(fake.host), "C:\\backup\\1", elevated);
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
    expect(plan.steps.findIndex(s => s.kind === "gate")).toBeGreaterThan(
      plan.steps.findIndex(s => s.kind === "backup"),
    );
    expect(plan.steps.findIndex(s => s.kind === "gate")).toBeLessThan(
      plan.steps.findIndex(s => s.kind === "uninstaller"),
    );
    expect(log.exec).toEqual([]);
    expect(log.removed).toEqual([]);
  });

  test("a failing smoke test stops before any removal", async () => {
    const { plan, host, log } = await msysPlan();
    const r = await executePlan(plan, host, async () => [{ name: "ls", ok: false, detail: "shim missing" }], fast);
    expect(r.stoppedAt).toBe(plan.steps.findIndex(s => s.kind === "gate"));
    expect(log.removed).toEqual([]);
    expect(log.exec.some(c => c.argv.includes("delete"))).toBe(false);
    expect(log.exec.some(c => c.argv[0]!.endsWith("uninstall.exe"))).toBe(false);
  });

  test("with a passing smoke test every step is verified: backup first, then uninstaller, PATH, registry, folder only", async () => {
    const { plan, host, log, keys, state } = await msysPlan();
    const r = await executePlan(plan, host, OK, fast);
    expect(r.stoppedAt).toBeUndefined();
    expect(r.executed.every(e => e.ok)).toBe(true);
    expect(r.executed.filter(e => e.detail === "effect verified").length).toBeGreaterThanOrEqual(4);
    expect(keys.has(KEY.toLowerCase())).toBe(false);
    expect(state.user).toBe("");
    expect(log.written["C:\\backup\\1\\msys2-pacman-Qe.txt"]).toBe("pkg-a\npkg-b\n");
    const order = log.exec.map(c => c.argv[0]!);
    expect(order.findIndex(c => c.endsWith("pacman.exe"))).toBeLessThan(
      order.findIndex(c => c.endsWith("uninstall.exe")),
    );
    expect(log.removed).toEqual(["C:\\msys64"]);
  });

  test("an uninstaller that exits 0 but changes nothing is a FAIL, never done, and later steps do not run", async () => {
    const { plan, host, log } = await msysPlan({ silent: ["uninstaller"] });
    const r = await executePlan(plan, host, OK, fast);
    const at = plan.steps.findIndex(s => s.kind === "uninstaller");
    expect(r.stoppedAt).toBe(at);
    const last = r.executed.at(-1)!;
    expect(last.ok).toBe(false);
    expect(last.detail).toContain("registry key still exists");
    expect(log.removed).toEqual([]);
    expect(log.exec.some(c => c.argv[0] === "reg" && c.argv[1] === "delete")).toBe(false);
  });

  test("reg delete that exits 0 without deleting (not elevated) is a FAIL", async () => {
    const { plan, host, log } = await msysPlan({ silent: ["reg-delete"], uninstallerDelayMs: 0 });
    // make the uninstaller step a no-op so the registry key survives to the registry step
    plan.steps = plan.steps.filter(s => s.kind !== "uninstaller");
    const r = await executePlan(plan, host, OK, fast);
    const at = plan.steps.findIndex(s => s.kind === "registry");
    expect(r.stoppedAt).toBe(at);
    expect(r.executed.at(-1)!.detail).toContain("registry key still exists");
    expect(log.removed).toEqual([]);
  });

  test("an uninstaller whose effect appears after it returned is accepted by polling", async () => {
    const { plan, host, keys } = await msysPlan({ uninstallerDelayMs: 40 });
    const r = await executePlan(plan, host, OK, { verifyMs: 2000, pollMs: 10 });
    expect(r.stoppedAt).toBeUndefined();
    expect(keys.size).toBe(0);
  });

  test("EPERM while deleting the folder is a FAIL with the reason", async () => {
    const { plan, host } = await msysPlan({ eperm: ["C:\\msys64"] });
    const r = await executePlan(plan, host, OK, fast);
    expect(r.stoppedAt).toBe(plan.steps.findIndex(s => s.kind === "delete-dir"));
    expect(r.executed.at(-1)!.detail).toContain("EPERM");
  });

  test("not elevated: the plan says so, and the first HKLM or Program Files step is never attempted or marked done", async () => {
    const { plan, host, log } = await msysPlan({}, false);
    const text = renderPlan(plan, false);
    expect(text).toContain("elevated: no");
    expect(text).toContain("needs elevation");
    expect(text).toContain("[needs elevation]");
    expect(plan.steps.find(s => s.kind === "registry")!.needsElevation).toBe(true);
    const r = await executePlan(plan, host, OK, fast);
    const last = r.executed.at(-1)!;
    expect(last.ok).toBe(false);
    expect(last.detail).toContain("needs elevation");
    expect(r.stoppedAt).toBe(plan.steps.findIndex(s => s.kind === "uninstaller"));
    expect(log.exec.some(c => c.argv[0]!.endsWith("uninstall.exe"))).toBe(false);
    expect(log.removed).toEqual([]);
  });

  test("Inno Setup uninstaller gets the documented silent switches and a timeout; others stay as registered", async () => {
    const base = "C:\\Program Files (x86)\\GnuWin32";
    const inno = fakeHost({
      files: [`${base}\\bin\\sed.exe`, `${base}\\uninstall\\unins000.exe`],
      uninstall: [
        {
          key: "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UnZip-5.51_is1",
          DisplayName: "GnuWin32: UnZip 5.51",
          InstallLocation: base,
          UninstallString: `${base}\\uninstall\\unins000.exe`,
        },
      ],
    });
    inno.host.env["ProgramFiles(x86)"] = "C:\\Program Files (x86)";
    const [gnu] = await detectLegacy("gnuwin32", inno.host);
    const plan = planUninstall([gnu!], [], "C:\\b", true);
    const step = plan.steps.find(s => s.kind === "uninstaller")!;
    expect(step.command).toEqual([
      `${base}\\uninstall\\unins000.exe`,
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
    ]);
    expect(step.timeoutMs).toBeGreaterThan(0);
    expect(step.needsElevation).toBe(true);
    const r = await executePlan(plan, inno.host, OK, fast);
    expect(r.stoppedAt).toBeUndefined();
    expect(inno.log.exec.find(c => c.argv.includes("/VERYSILENT"))!.timeoutMs).toBe(step.timeoutMs);
    expect(isInnoUninstaller("X\\unins001.exe")).toBe(true);
    expect(isInnoUninstaller("X\\setup.exe", "HKLM\\U\\App_is1")).toBe(true);
    expect(isInnoUninstaller("X\\uninstall.exe", "HKLM\\U\\MSYS2")).toBe(false);
    const m = (await msysPlan()).plan.steps.find(s => s.kind === "uninstaller")!;
    expect(m.command).toContain("--confirm-command");
    expect(m.command).not.toContain("/VERYSILENT");
  });

  test("a tampered plan cannot delete anything but a detected root", async () => {
    const { plan, host, log } = await msysPlan();
    plan.steps.push({ kind: "delete-dir", title: "evil", path: "C:\\Program Files\\Git" });
    const r = await executePlan(plan, host, OK, fast);
    expect(r.stoppedAt).toBe(plan.steps.length - 1);
    expect(log.removed).toEqual(["C:\\msys64"]);
  });

  test("an install overlapping Git for Windows is dropped from the plan with a warning", async () => {
    const { host } = fakeHost({ files: GIT });
    const fakeInstall = {
      id: "msys2" as const,
      mode: "portable" as const,
      root: "C:\\Program Files\\Git",
      uninstallers: [],
      uninstallerKeys: [],
      registryKeys: [],
      pathEntries: [],
      shortcuts: [],
      dependents: [],
      notes: [],
    };
    const plan = planUninstall([fakeInstall], await protectedRoots(host), "C:\\b");
    expect(plan.installs).toEqual([]);
    expect(plan.warnings[0]).toContain("skipped");
    expect(plan.steps.some(s => s.kind === "delete-dir")).toBe(false);
  });
});

const bare = (over: Partial<LegacyInstall>): LegacyInstall => ({
  id: "msys2",
  mode: "portable",
  root: "C:\\msys64",
  uninstallers: [],
  uninstallerKeys: [],
  registryKeys: [],
  pathEntries: [],
  shortcuts: [],
  dependents: [],
  notes: [],
  ...over,
});

describe("winget uninstall (exact id, checked first)", () => {
  test("plan: --id --exact --source winget, never --name; winget list --id runs first", () => {
    const plan = planUninstall([bare({ mode: "winget" })], [], "C:\\b", true);
    const step = plan.steps.find(s => s.kind === "winget")!;
    expect(step.command).toEqual([
      "winget",
      "uninstall",
      "--id",
      "MSYS2.MSYS2",
      "--exact",
      "--source",
      "winget",
      "--silent",
      "--disable-interactivity",
      "--accept-source-agreements",
    ]);
    expect(step.command).not.toContain("--name");
    expect(step.precheck!.slice(0, 5)).toEqual(["winget", "list", "--id", "MSYS2.MSYS2", "--exact"]);
    expect(renderPlan(plan, false)).toContain("only if");
  });

  test("not installed through winget: skipped, uninstall never runs", async () => {
    const { host, log } = fakeHost({ files: MSYS, winget: [] });
    const plan = planUninstall([bare({ mode: "winget" })], [], "C:\\b", true);
    plan.steps = plan.steps.filter(s => s.kind === "winget");
    const r = await executePlan(plan, host, OK, fast);
    expect(r.executed[0]!.ok).toBe(true);
    expect(r.executed[0]!.detail).toContain("skipped");
    expect(log.exec.some(c => c.argv[1] === "uninstall")).toBe(false);
  });

  test("installed: uninstall runs and is verified by winget list; a silent failure is a FAIL", async () => {
    const good = fakeHost({ files: MSYS, winget: ["MSYS2.MSYS2"] });
    const plan = planUninstall([bare({ mode: "winget" })], [], "C:\\b", true);
    plan.steps = plan.steps.filter(s => s.kind === "winget");
    expect((await executePlan(plan, good.host, OK, fast)).executed[0]!.detail).toBe("effect verified");
    const bad = fakeHost({ files: MSYS, winget: ["MSYS2.MSYS2"], silent: ["winget-uninstall"] });
    const r = await executePlan(plan, bad.host, OK, fast);
    expect(r.stoppedAt).toBe(0);
    expect(r.executed[0]!.detail).toContain("winget still lists MSYS2.MSYS2");
  });

  test("ids come from winget-pkgs; gnuwin32 has none and the plan says so", () => {
    expect(WINGET_IDS.cygwin).toEqual(["Cygwin.Cygwin"]);
    expect(WINGET_IDS.mingw[0]).toBe("BrechtSanders.WinLibs.POSIX.UCRT");
    const plan = planUninstall([bare({ id: "gnuwin32", mode: "winget", root: "C:\\GnuWin32" })], [], "C:\\b", true);
    expect(plan.steps.some(s => s.kind === "winget")).toBe(false);
    expect(plan.warnings.join()).toContain("no winget package id");
  });
});

describe("scoop: per user, global, SCOOP and SCOOP_GLOBAL, --purge", () => {
  const env = {
    USERPROFILE: "C:\\Users\\me",
    ProgramData: "C:\\ProgramData",
    SCOOP: "D:\\sc",
    SCOOP_GLOBAL: "E:\\scg",
  };

  test("scoopInfo tells user from global and finds the app", () => {
    expect(scoopInfo("C:\\Users\\me\\scoop\\apps\\msys2\\current", env)).toMatchObject({ app: "msys2", global: false });
    expect(scoopInfo("D:\\sc\\apps\\gnuwin32\\current", env)).toMatchObject({ app: "gnuwin32", global: false });
    expect(scoopInfo("E:\\scg\\apps\\mingw\\current", env)).toMatchObject({
      app: "mingw",
      global: true,
      appDir: "E:\\scg\\apps\\mingw",
    });
    expect(
      scoopInfo("C:\\ProgramData\\scoop\\apps\\w64devkit\\current", { ...env, SCOOP_GLOBAL: undefined }),
    ).toMatchObject({ app: "w64devkit", global: true });
    expect(scoopInfo("C:\\msys64", env)).toBeUndefined();
  });

  test("a global install under SCOOP_GLOBAL is detected and planned with -g, elevation, no purge by default", async () => {
    const root = "E:\\scg\\apps\\msys2\\current";
    const { host } = fakeHost({ files: [`${root}\\usr\\bin\\msys-2.0.dll`], env });
    const [found] = await detectLegacy("msys2", host);
    expect(found!.mode).toBe("scoop");
    expect(found!.scoop).toMatchObject({ app: "msys2", global: true });
    const plan = planUninstall([found!], [], "C:\\b", false);
    const step = plan.steps.find(s => s.kind === "scoop")!;
    expect(step.command).toEqual(["scoop", "uninstall", "msys2", "-g"]);
    expect(step.needsElevation).toBe(true);
    expect(renderPlan(plan, false)).toContain("[needs elevation]");
  });

  test("--purge is opt in; per user installs need no elevation", async () => {
    const root = "D:\\sc\\apps\\mingw\\current";
    const { host } = fakeHost({ files: [`${root}\\bin\\gcc.exe`], env });
    const [found] = await detectLegacy("mingw", host);
    expect(found!.scoop).toMatchObject({ app: "mingw", global: false });
    const plain = planUninstall([found!], [], "C:\\b", false).steps.find(s => s.kind === "scoop")!;
    const purged = planUninstall([found!], [], "C:\\b", false, { purge: true }).steps.find(s => s.kind === "scoop")!;
    expect(plain.command).toEqual(["scoop", "uninstall", "mingw"]);
    expect(purged.command).toEqual(["scoop", "uninstall", "mingw", "--purge"]);
    expect(purged.title).toContain("persisted data");
    expect(plain.needsElevation).toBe(false);
  });

  test("scoop step is verified on the app directory; a silent failure is a FAIL", async () => {
    const root = "E:\\scg\\apps\\msys2\\current";
    const mk = (silent: boolean) =>
      fakeHost({ files: [`${root}\\usr\\bin\\msys-2.0.dll`], env, silent: silent ? ["scoop"] : [] });
    for (const silent of [false, true]) {
      const { host } = mk(silent);
      const [found] = await detectLegacy("msys2", host);
      const plan = planUninstall([found!], [], "C:\\b", true);
      plan.steps = plan.steps.filter(s => s.kind === "scoop");
      const r = await executePlan(plan, host, OK, fast);
      expect(r.executed[0]!.ok).toBe(!silent);
      if (silent) expect(r.executed[0]!.detail).toContain("still exists");
    }
  });
});
