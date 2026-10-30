// Installed Windows apps: Start menu entries with their AppUserModelID. Packaged apps expose `<PackageFamilyName>!<AppId>` and are
// launched with `shell:AppsFolder\<AUMID>`. Source: Get-StartApps (https://learn.microsoft.com/powershell/module/startlayout/get-startapps).
export interface StartApp {
  name: string;
  aumid: string;
  packaged: boolean;
}

export const isPackagedAumid = (id: string) => /^[^\\/:]+_[a-z0-9]{13}!/.test(id);

export async function listStartApps(): Promise<StartApp[]> {
  if (process.platform !== "win32") return [];
  const p = Bun.spawn(
    [
      "pwsh",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
    ],
    { stdout: "pipe" },
  );
  const text = (await new Response(p.stdout).text()).trim();
  if (!text) return [];
  const rows = ([] as { Name: string; AppID: string }[]).concat(JSON.parse(text));
  return rows.map(r => ({ name: r.Name, aumid: r.AppID, packaged: isPackagedAumid(r.AppID) }));
}
