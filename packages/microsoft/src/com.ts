// COM / IDispatch automation from Bun. Mechanism: a PowerShell child process creates the object (New-Object -ComObject, which is
// CoCreateInstance of the ProgID) and late-binds through IDispatch; the script result crosses the process boundary as JSON.
// Windows only. Office automation model: https://learn.microsoft.com/office/vba/api/overview/
const shell = () => Bun.which("pwsh") ?? Bun.which("powershell") ?? "powershell";

/** True when the ProgID is registered (its CLSID key exists in HKEY_CLASSES_ROOT). */
export async function isRegistered(progId: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const key = `Registry::HKEY_CLASSES_ROOT\\${progId.replace(/'/g, "''")}\\CLSID`;
  const p = Bun.spawn(
    [shell(), "-NoProfile", "-NonInteractive", "-Command", `if (Test-Path '${key}') { 'yes' } else { 'no' }`],
    {
      stdout: "pipe",
    },
  );
  return (await new Response(p.stdout).text()).trim() === "yes";
}

/** Run a PowerShell body with `$obj` bound to the COM object of `progId`; the body's output is returned parsed from JSON. The object is Quit() and released. */
export async function withCom<T = unknown>(progId: string, body: string, timeoutMs = 120_000): Promise<T> {
  if (process.platform !== "win32") throw new Error("COM automation needs Windows");
  const id = progId.replace(/'/g, "''");
  const script =
    `$ErrorActionPreference='Stop'; $obj = New-Object -ComObject '${id}'; ` +
    `try { & { ${body} } | ConvertTo-Json -Compress -Depth 6 } ` +
    `finally { if ($obj.PSObject.Methods['Quit']) { try { $obj.Quit() } catch {} }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj) }`;
  const p = Bun.spawn([shell(), "-NoProfile", "-NonInteractive", "-Command", script], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`COM ${progId}: ${err.trim() || out.trim()}`);
  return JSON.parse(out) as T;
}

export const officeProgIds = [
  "Excel.Application",
  "Word.Application",
  "PowerPoint.Application",
  "Outlook.Application",
  "Access.Application",
] as const;
