// MSIX / AppxManifest and winget parsing, with a compatibility classification.
// Manifest schema: https://learn.microsoft.com/uwp/schemas/appxpackage/uapmanifestschema/schema-root
export interface ManifestApp {
  id: string;
  executable?: string;
  entryPoint?: string;
}
export interface Manifest {
  name: string;
  publisher: string;
  version: string;
  architecture: string;
  minVersion?: string;
  apps: ManifestApp[];
  capabilities: string[];
  restrictedCapabilities: string[];
  dependencies: string[];
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const tags = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`, "g"))].map(m => m[0]);

export function parseManifest(xml: string): Manifest {
  const identity = tags(xml, "Identity")[0] ?? "";
  return {
    name: attr(identity, "Name") ?? "",
    publisher: attr(identity, "Publisher") ?? "",
    version: attr(identity, "Version") ?? "",
    architecture: attr(identity, "ProcessorArchitecture") ?? "neutral",
    minVersion: attr(tags(xml, "TargetDeviceFamily")[0] ?? "", "MinVersion"),
    apps: tags(xml, "Application").map(t => ({
      id: attr(t, "Id") ?? "",
      executable: attr(t, "Executable"),
      entryPoint: attr(t, "EntryPoint"),
    })),
    capabilities: tags(xml, "Capability")
      .filter(t => !/rescap:/.test(t))
      .map(t => attr(t, "Name") ?? ""),
    restrictedCapabilities: tags(xml, "Capability")
      .filter(t => /rescap:/.test(t))
      .map(t => attr(t, "Name") ?? ""),
    dependencies: tags(xml, "PackageDependency").map(t => attr(t, "Name") ?? ""),
  };
}

export type Kind = "win32-packaged" | "uwp" | "winui-or-appsdk-dependent" | "no-app";

/** Which technology the package is built on, from its manifest only. */
export function classify(m: Manifest): { kind: Kind; wineCoverageApplies: boolean; note: string } {
  if (!m.apps.length) return { kind: "no-app", wineCoverageApplies: false, note: "framework or resource package" };
  const full = m.apps.some(
    a => a.entryPoint === "Windows.FullTrustApplication" || m.restrictedCapabilities.includes("runFullTrust"),
  );
  const appSdk = m.dependencies.some(d => /WindowsAppRuntime|WinUI|Microsoft\.UI\.Xaml/i.test(d));
  if (full && !appSdk)
    return {
      kind: "win32-packaged",
      wineCoverageApplies: true,
      note: "Win32/.NET process with package identity: PE import coverage applies",
    };
  if (appSdk)
    return {
      kind: "winui-or-appsdk-dependent",
      wineCoverageApplies: false,
      note: "needs the Windows App SDK / WinUI runtime and package identity: not covered by Wine import coverage",
    };
  return { kind: "uwp", wineCoverageApplies: false, note: "UWP: needs the WinRT runtime and AppContainer" };
}

/** Read AppxManifest.xml out of a .msix/.appx (a zip) with the system bsdtar. */
export async function readMsixManifest(path: string): Promise<Manifest> {
  const tar =
    process.platform === "win32" ? `${process.env.SystemRoot}\\System32\\tar.exe` : (Bun.which("bsdtar") ?? "tar");
  const p = Bun.spawn([tar, "-xOf", path, "AppxManifest.xml"], { stdout: "pipe", stderr: "pipe" });
  const [xml, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) throw new Error(`cannot read AppxManifest.xml from ${path}`);
  return parseManifest(xml);
}

export interface WingetRow {
  name: string;
  id: string;
  version: string;
}

/** Parse the table printed by `winget list` (column offsets from the header line, so names with spaces work). */
export function parseWingetList(text: string): WingetRow[] {
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex(l => /^-{5,}\s*$/.test(l));
  if (sep < 1) return [];
  const header = lines[sep - 1]!;
  // column starts: the header words of Name / Id / Version in any of winget's UI languages are the first three words separated by 2+ spaces
  const starts = [...header.matchAll(/\S+(?: \S+)*/g)].map(m => m.index!);
  if (starts.length < 3) return [];
  return lines
    .slice(sep + 1)
    .filter(l => l.trim())
    .map(l => ({
      name: l.slice(starts[0], starts[1]).trim(),
      id: l.slice(starts[1], starts[2]).trim(),
      version: l.slice(starts[2], starts[3] ?? undefined).trim(),
    }));
}
