// Windows 11 feature probes: each one asks the running system and reports what it found. Nothing is assumed.
// WinRT types are loaded from Windows PowerShell 5.1 (it projects WinRT types with [Type,Namespace,ContentType=WindowsRuntime]).
// Docs: https://learn.microsoft.com/uwp/api/ (type pages), https://learn.microsoft.com/windows/dev-drive/
export interface Probe {
  name: string;
  /** What was asked of the system. */
  check: string;
  available: boolean;
  detail: string;
}

const ps51 = (script: string) => ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script];
async function run(argv: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, , code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out.trim() };
}

const appx = async (name: string) =>
  (await run(ps51(`(Get-AppxPackage -Name '${name}' | Select-Object -First 1).Version`))).out;
const winrtClass = async (ns: string, type: string, asm = ns) =>
  (await run(ps51(`try { [void][${ns}.${type}, ${asm}, ContentType=WindowsRuntime]; '${type}' } catch { '' }`))).out;

export async function probeWindows11(): Promise<Probe[]> {
  if (process.platform !== "win32") return [];
  const out: Probe[] = [];
  const add = (name: string, check: string, detail: string) => out.push({ name, check, available: !!detail, detail });

  add(
    "Widgets board",
    "Appx package MicrosoftWindows.Client.WebExperience",
    await appx("MicrosoftWindows.Client.WebExperience"),
  );
  add(
    "Windows App SDK runtime",
    "Appx package Microsoft.WindowsAppRuntime.* (framework packages)",
    (
      await run(
        ps51(
          "(Get-AppxPackage -Name 'Microsoft.WindowsAppRuntime.*' | Select-Object -ExpandProperty Name -Unique) -join ','",
        ),
      )
    ).out,
  );
  add(
    "Windows ML",
    "WinRT type Windows.AI.MachineLearning.LearningModel",
    await winrtClass("Windows.AI.MachineLearning", "LearningModel"),
  );
  add(
    "Toast notifications",
    "WinRT type Windows.UI.Notifications.ToastNotificationManager",
    await winrtClass("Windows.UI.Notifications", "ToastNotificationManager"),
  );
  add(
    "Share (DataTransferManager)",
    "WinRT type Windows.ApplicationModel.DataTransfer.DataTransferManager",
    await winrtClass("Windows.ApplicationModel.DataTransfer", "DataTransferManager"),
  );
  add(
    "Jump Lists",
    "WinRT type Windows.UI.StartScreen.JumpList",
    await winrtClass("Windows.UI.StartScreen", "JumpList"),
  );
  const dev = await run(["fsutil.exe", "devdrv", "query"]);
  out.push({
    name: "Dev Drive",
    check: "fsutil devdrv query",
    available: dev.code === 0,
    detail: dev.out.split(/\r?\n/).slice(0, 2).join(" | "),
  });
  add(
    "Windows Terminal",
    "Appx package Microsoft.WindowsTerminal*",
    (await run(ps51("(Get-AppxPackage -Name 'Microsoft.WindowsTerminal*' | Select-Object -First 1).Version"))).out,
  );
  const wasdk = await run(ps51("(Get-AppxPackage -Name 'Microsoft.Windows.AI*' | Select-Object -First 1).Name"));
  add("Windows AI APIs (Windows App SDK)", "Appx package Microsoft.Windows.AI*", wasdk.out);
  return out;
}

/** Features of the owner's list that are not built, with the reason (kept next to the probes so the document is generated from one place). */
export const notBuilt: { feature: string; reason: string }[] = [
  {
    feature: "App Actions on Windows",
    reason:
      "needs a packaged app that declares actions in its manifest plus Copilot+ hardware to invoke them; the unpackaged WinUI app here cannot register actions",
  },
  {
    feature: "Windows App SDK AI (Phi Silica, text recognition)",
    reason: "needs a Copilot+ PC NPU and the Windows AI package; not present on this machine",
  },
  {
    feature: "Widgets provider",
    reason:
      "a widget provider is a packaged COM server; MSIX packaging and signing belong to the Store and signing owner",
  },
  {
    feature: "Jump List creation from the app",
    reason: "requires a packaged identity or an AppUserModelID shortcut; only the WinRT type availability is probed",
  },
];
