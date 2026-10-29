/**
 * Windows packaging plans. Every function returns commands and file contents; nothing here signs, uploads or accepts a licence.
 * Order of preference: MSIX, Inno Setup exe, WiX msi, portable zip + winget manifest.
 */

export type PackageFormat = "msix" | "appx" | "msi" | "exe" | "zip";

export interface AppIdentity {
  /** Package identity name, for example Aphrody.BunOS. */
  name: string;
  /** Must equal the signing certificate subject (the Store re-signs, so it is replaced on submission). */
  publisher: string;
  displayName: string;
  publisherDisplayName: string;
  /** Four-part version, for example 1.4.7.0. */
  version: string;
  /** Executable inside the package directory. */
  executable: string;
  description?: string;
  arch?: "x64" | "arm64" | "x86";
}

const NAME = /^[-.A-Za-z0-9]{3,50}$/;

export function fourPartVersion(version: string): string {
  const core = version
    .split(/[-+]/)[0]!
    .split(".")
    .map(part => Number.parseInt(part, 10));
  if (core.some(Number.isNaN) || core.length > 4) throw new Error(`Not a version: ${version}`);
  while (core.length < 4) core.push(0);
  return core.join(".");
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal full-trust desktop manifest: runFullTrust plus uap10:RuntimeBehavior="packagedClassicApp". */
export function msixManifest(app: AppIdentity): string {
  if (!NAME.test(app.name)) throw new Error(`Invalid package identity name: ${app.name}`);
  const arch = app.arch ?? "x64";
  const x = escapeXml;
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="${x(app.name)}" Publisher="${x(app.publisher)}" Version="${x(fourPartVersion(app.version))}" ProcessorArchitecture="${arch}" />
  <Properties>
    <DisplayName>${x(app.displayName)}</DisplayName>
    <PublisherDisplayName>${x(app.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="${x(app.executable)}" EntryPoint="Windows.FullTrustApplication" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="${x(app.displayName)}" Description="${x(app.description ?? app.displayName)}" BackgroundColor="transparent"
        Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
}

/** `makeappx pack /d <dir> /p <out> /o` (Windows SDK). */
export function makeappxPack(directory: string, output: string): string[] {
  return ["makeappx", "pack", "/d", directory, "/p", output, "/o"];
}

/** Azure Artifact Signing through SignTool: needs the dlib and metadata file, and a timestamp because certificates live 3 days. */
export function signtoolArtifactSigning(file: string, dlib: string, metadata: string): string[] {
  return [
    "signtool",
    "sign",
    "/v",
    "/fd",
    "SHA256",
    "/tr",
    "http://timestamp.acs.microsoft.com",
    "/td",
    "SHA256",
    "/dlib",
    dlib,
    "/dmdf",
    metadata,
    file,
  ];
}

/** Local certificate signing (thumbprint in the machine store). Always timestamped. */
export function signtoolThumbprint(
  file: string,
  thumbprint: string,
  timestampUrl = "http://timestamp.digicert.com",
): string[] {
  return ["signtool", "sign", "/fd", "SHA256", "/sha1", thumbprint, "/tr", timestampUrl, "/td", "SHA256", file];
}

export interface InnoOptions {
  appName: string;
  version: string;
  publisher: string;
  sourceDir: string;
  executable: string;
  outputDir: string;
  outputBaseName: string;
  /** A stable GUID string without braces, kept across releases. */
  appId: string;
}

/** Inno Setup script for an exe installer. */
export function innoScript(o: InnoOptions): string {
  if (!/^[0-9A-Fa-f-]{36}$/.test(o.appId)) throw new Error("appId must be a GUID.");
  return `[Setup]
AppId={{${o.appId}}
AppName=${o.appName}
AppVersion=${o.version}
AppPublisher=${o.publisher}
DefaultDirName={autopf}\\${o.appName}
DefaultGroupName=${o.appName}
OutputDir=${o.outputDir}
OutputBaseFilename=${o.outputBaseName}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Files]
Source: "${o.sourceDir}\\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\\${o.appName}"; Filename: "{app}\\${o.executable}"
`;
}

/** WiX build is `dotnet build` with WixToolset.Sdk. The OSMF EULA must be accepted by the owner: buncc never accepts it. */
export const WIX_EULA_COMMAND = ["wix", "eula", "accept", "wix7"];

export interface PlanStep {
  title: string;
  command?: string[];
  writes?: { path: string; content: string }[];
  /** True when the step publishes, signs for real or accepts a licence; never run without an explicit flag from the owner. */
  needsApproval?: boolean;
}

export interface PackagePlan {
  format: PackageFormat;
  steps: PlanStep[];
  requires: string[];
}

export function packagePlan(format: PackageFormat, app: AppIdentity, directory: string, outDir: string): PackagePlan {
  const base = `${app.name}-${fourPartVersion(app.version)}`;
  if (format === "msix" || format === "appx") {
    const out = `${outDir}/${base}.${format}`;
    return {
      format,
      requires: ["makeappx"],
      steps: [
        {
          title: "write AppxManifest.xml",
          writes: [{ path: `${directory}/AppxManifest.xml`, content: msixManifest(app) }],
        },
        { title: `pack ${format}`, command: makeappxPack(directory, out) },
      ],
    };
  }
  if (format === "exe") {
    const script = `${outDir}/${base}.iss`;
    return {
      format,
      requires: ["iscc"],
      steps: [
        {
          title: "write the Inno Setup script",
          writes: [
            {
              path: script,
              content: innoScript({
                appName: app.displayName,
                version: fourPartVersion(app.version),
                publisher: app.publisherDisplayName,
                sourceDir: directory,
                executable: app.executable,
                outputDir: outDir,
                outputBaseName: `${base}-setup`,
                appId: stableGuid(app.name),
              }),
            },
          ],
        },
        { title: "compile the installer", command: ["iscc", script] },
      ],
    };
  }
  if (format === "msi")
    return {
      format,
      requires: ["dotnet", "wix"],
      steps: [
        { title: "WiX needs the OSMF EULA accepted by the owner", command: WIX_EULA_COMMAND, needsApproval: true },
        { title: "build the msi with WixToolset.Sdk", command: ["dotnet", "build", "-c", "Release", "-o", outDir] },
      ],
    };
  return {
    format: "zip",
    requires: [],
    steps: [
      {
        title: "portable archive",
        command:
          process.platform === "win32"
            ? ["tar", "-a", "-c", "-f", `${outDir}/${base}.zip`, "-C", directory, "."]
            : ["zip", "-r", `${outDir}/${base}.zip`, "."],
      },
    ],
  };
}

/** Deterministic GUID from a name (version-5 style layout over SHA-1) so installers keep their identity between releases. */
export function stableGuid(name: string): string {
  const hash = new Bun.CryptoHasher("sha1").update(`aphrody-buncc:${name}`).digest("hex");
  const variant = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

/** Microsoft Store submission uploads the package unsigned (the Store re-signs). Always requires an explicit owner approval. */
export function storePlan(packagePath: string): PlanStep[] {
  return [
    {
      title: "run the Windows App Certification Kit locally (Windows only)",
      command: ["appcert", "test", "-appxpackagepath", packagePath, "-reportoutputpath", "wack-report.xml"],
    },
    {
      title: "submit to Partner Center with the Store CLI",
      command: ["msstore", "publish", packagePath],
      needsApproval: true,
    },
  ];
}
