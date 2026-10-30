/**
 * Windows packaging: MSIX/APPX with MakeAppx.exe and SignTool.exe from the Windows SDK, and MSI/EXE bundles with the WiX CLI.
 * https://learn.microsoft.com/windows/msix/package/create-app-package-with-makeappx-tool
 * https://learn.microsoft.com/windows/win32/seccrypto/signtool
 * https://docs.firegiant.com/wix/ (WiX v4+ `wix build`)
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../process.ts";
import { hostArch, missing } from "./_shared.ts";
import { toolProvider } from "./_tool.ts";
import type { AppIdentity } from "../packaging/index.ts";
import { compareVersions, type Context, type Detection, type Provider } from "./types.ts";

/** Latest `Windows Kits\10\bin\<version>\<arch>\<tool>.exe` that exists. */
export function findSdkTool(
  tool: string,
  env: Record<string, string | undefined> = Bun.env,
  arch = hostArch(),
): string | undefined {
  const root = join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  let versions: string[] = [];
  try {
    versions = readdirSync(root).filter(v => /^\d+\.\d+\.\d+\.\d+$/.test(v));
  } catch {
    return undefined;
  }
  for (const v of versions.sort(compareVersions).reverse()) {
    const p = join(root, v, arch, `${tool}.exe`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export async function detectSdkTool(tool: string, ctx: Context): Promise<Detection> {
  const exe = findSdkTool(tool, ctx.env);
  if (!exe) return missing("winget install Microsoft.WindowsSDK.10.0.26100   (Windows SDK: MakeAppx, SignTool)");
  const version = exe.match(/bin\\(\d+\.\d+\.\d+\.\d+)\\/)?.[1];
  return { found: true, path: exe, version };
}

export const msixProvider: Provider = {
  id: "msix",
  description: "MakeAppx + SignTool from the Windows SDK for MSIX/APPX packages",
  platforms: ["win32"],
  async detect(ctx) {
    const makeappx = await detectSdkTool("makeappx", ctx);
    if (!makeappx.found) return makeappx;
    const signtool = findSdkTool("signtool", ctx.env);
    return { ...makeappx, notes: signtool ? [`signtool: ${signtool}`] : ["signtool.exe missing"] };
  },
  install: () => ({
    commands: [
      [
        "winget",
        "install",
        "--id",
        "Microsoft.WindowsSDK.10.0.26100",
        "--exact",
        "--source",
        "winget",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
    ],
  }),
  async env(ctx): Promise<Record<string, string>> {
    const m = findSdkTool("makeappx", ctx.env);
    return m ? { WINDOWS_SDK_BIN: m.replace(/[\\/][^\\/]+$/, "") } : {};
  },
};

export const wixProvider = toolProvider({
  id: "wix",
  description: "WiX Toolset CLI (MSI and bundle authoring)",
  binary: "wix",
  versionArgs: ["--version"],
  platforms: ["win32", "linux", "darwin"],
  packages: { winget: "WiXToolset.WiXCLI" },
  manual: "dotnet tool install --global wix",
});

// ---------------------------------------------------------------------------------------------------------------
// MakeAppx
// ---------------------------------------------------------------------------------------------------------------

export function packArgs(o: {
  dir: string;
  out: string;
  overwrite?: boolean;
  skipValidation?: boolean;
  hash?: "SHA256" | "SHA384" | "SHA512";
}): string[] {
  const args = ["pack", "/d", o.dir, "/p", o.out];
  if (o.overwrite ?? true) args.push("/o");
  if (o.skipValidation) args.push("/nv");
  if (o.hash) args.push("/h", o.hash);
  return args;
}

export function unpackArgs(o: { pkg: string; dir: string; overwrite?: boolean }): string[] {
  return ["unpack", "/p", o.pkg, "/d", o.dir, ...((o.overwrite ?? true) ? ["/o"] : [])];
}

export function bundleArgs(o: { dir: string; out: string; version?: string; overwrite?: boolean }): string[] {
  const args = ["bundle", "/d", o.dir, "/p", o.out];
  if (o.version) args.push("/bv", o.version);
  if (o.overwrite ?? true) args.push("/o");
  return args;
}

// ---------------------------------------------------------------------------------------------------------------
// SignTool
// ---------------------------------------------------------------------------------------------------------------

export type SignCertificate =
  | { kind: "store-thumbprint"; sha1: string }
  | { kind: "auto" }
  | {
      kind: "pfx";
      file: string;
      /** Name of the environment variable that holds the password; never the password. */ passwordEnv?: string;
    };

export const DEFAULT_TIMESTAMP = "http://timestamp.digicert.com";

/** `signtool sign /fd SHA256 ... <file>`. The PFX password is read from the named environment variable when the command is built. */
export function signArgs(
  o: { file: string; cert: SignCertificate; timestamp?: string | false; digest?: "SHA256" | "SHA384" | "SHA512" },
  env: Record<string, string | undefined> = Bun.env,
): string[] {
  const digest = o.digest ?? "SHA256";
  const args = ["sign", "/fd", digest];
  switch (o.cert.kind) {
    case "store-thumbprint":
      if (!/^[0-9a-fA-F]{40}$/.test(o.cert.sha1)) throw new Error("thumbprint must be 40 hex characters");
      args.push("/sha1", o.cert.sha1);
      break;
    case "auto":
      args.push("/a");
      break;
    case "pfx": {
      args.push("/f", o.cert.file);
      if (o.cert.passwordEnv) {
        const password = env[o.cert.passwordEnv];
        if (!password) throw new Error(`environment variable ${o.cert.passwordEnv} is not set`);
        args.push("/p", password);
      }
    }
  }
  if (o.timestamp !== false) args.push("/tr", o.timestamp ?? DEFAULT_TIMESTAMP, "/td", digest);
  args.push(o.file);
  return args;
}

/** Same command with the password hidden, for logs and dry runs. */
export function redact(args: string[]): string[] {
  return args.map((a, i) => (args[i - 1] === "/p" ? "***" : a));
}

export function verifyArgs(file: string): string[] {
  return ["verify", "/pa", "/v", file];
}

// ---------------------------------------------------------------------------------------------------------------
// AppxManifest
// ---------------------------------------------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/;

/** Problems the Store or MakeAppx would reject in an identity. The manifest itself is generated by `msixManifest` in ../packaging. */
export function manifestProblems(o: Pick<AppIdentity, "name" | "publisher" | "version" | "executable">): string[] {
  const problems: string[] = [];
  if (!NAME_RE.test(o.name)) problems.push("name must be 3-50 characters: letters, digits, '.' and '-'");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(o.version)) problems.push("version must have four numeric parts, e.g. 1.4.7.0");
  else if (o.version.split(".").some(p => Number(p) > 65535)) problems.push("version parts must be at most 65535");
  if (!/^CN=/i.test(o.publisher)) problems.push("publisher must be a distinguished name starting with CN=");
  if (!o.executable) problems.push("executable is required");
  return problems;
}

/** Read the identity out of an existing manifest (no XML parser needed for these attributes). */
export function readIdentity(xml: string): { name?: string; publisher?: string; version?: string; arch?: string } {
  const tag = /<Identity\b[^>]*>/.exec(xml)?.[0] ?? "";
  const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(tag)?.[1];
  return {
    name: attr("Name"),
    publisher: attr("Publisher"),
    version: attr("Version"),
    arch: attr("ProcessorArchitecture"),
  };
}

export async function makeMsix(
  ctx: Context,
  o: { dir: string; out: string; sign?: { cert: SignCertificate; timestamp?: string | false } },
) {
  const makeappx = findSdkTool("makeappx", ctx.env);
  if (!makeappx) throw new Error("makeappx.exe not found; install the Windows SDK");
  if (!existsSync(join(o.dir, "AppxManifest.xml"))) throw new Error(`${o.dir} has no AppxManifest.xml`);
  const pack = await run([makeappx, ...packArgs({ dir: o.dir, out: o.out })], { env: ctx.env, output: "inherit" });
  if (pack.code !== 0) throw new Error(`makeappx pack exited with ${pack.code}`);
  if (o.sign) {
    const signtool = findSdkTool("signtool", ctx.env);
    if (!signtool) throw new Error("signtool.exe not found");
    const sign = await run([signtool, ...signArgs({ file: o.out, ...o.sign }, ctx.env)], {
      env: ctx.env,
      output: "inherit",
    });
    if (sign.code !== 0) throw new Error(`signtool sign exited with ${sign.code}`);
  }
  return o.out;
}

// ---------------------------------------------------------------------------------------------------------------
// WiX
// ---------------------------------------------------------------------------------------------------------------

export function wixBuildArgs(o: {
  sources: string[];
  out: string;
  arch?: "x64" | "x86" | "arm64";
  defines?: Record<string, string>;
  extensions?: string[];
  culture?: string;
}): string[] {
  const args = ["build", "-o", o.out];
  if (o.arch) args.push("-arch", o.arch);
  for (const [k, v] of Object.entries(o.defines ?? {})) args.push("-d", `${k}=${v}`);
  for (const e of o.extensions ?? []) args.push("-ext", e);
  if (o.culture) args.push("-culture", o.culture);
  return [...args, ...o.sources];
}
