import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dotnetLinuxMain } from "../src/dotnet-linux/cli.ts";
import { installPinned, prefixEnv } from "../src/dotnet-linux/install.ts";
import { pwshJson } from "../src/dotnet-linux/interop.ts";
import { loadPins, resolvePinned, WHAT } from "../src/dotnet-linux/pins.ts";
import { publishPlan } from "../src/dotnet-linux/publish.ts";
import { ChecksumError } from "../src/providers/_shared.ts";

const root = resolve(import.meta.dir, "../../..");
const pins = loadPins(root);

test("pins carry a complete, well-formed hash for every supported RID", () => {
  for (const ch of ["10.0", "11.0"] as const) {
    expect(pins.dotnet[ch].sdk.startsWith(`${ch}.`)).toBe(true);
    for (const rid of ["linux-x64", "linux-arm64", "linux-musl-x64", "linux-musl-arm64"]) {
      const a = pins.dotnet[ch].assets[rid]!;
      expect(a.sha512).toMatch(/^[0-9a-f]{128}$/);
      expect(a.url).toBe(`https://builds.dotnet.microsoft.com/dotnet/Sdk/${pins.dotnet[ch].sdk}/dotnet-sdk-${pins.dotnet[ch].sdk}-${rid}.tar.gz`);
    }
  }
  for (const k of ["stable", "preview"] as const) {
    for (const rid of ["linux-x64", "linux-arm64", "linux-musl-x64"]) {
      const a = pins.powershell[k].assets[rid]!;
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.url).toBe(`https://github.com/PowerShell/PowerShell/releases/download/${pins.powershell[k].tag}/powershell-${pins.powershell[k].version}-${rid}.tar.gz`);
    }
    expect(pins.powershell[k].assets["linux-musl-arm64"]).toBeUndefined(); // upstream ships none: must fail loudly, not guess
  }
  expect(pins.powershell.stable.version.includes("-")).toBe(false);
  expect(pins.powershell.preview.version).toContain("preview");
});

test("resolvePinned picks algorithm and refuses a RID upstream does not ship", () => {
  expect(resolvePinned(pins, "sdk10", "linux-musl-x64").algorithm).toBe("sha512");
  expect(resolvePinned(pins, "pwsh", "linux-arm64").algorithm).toBe("sha256");
  expect(() => resolvePinned(pins, "pwsh", "linux-musl-arm64")).toThrow(/upstream ships/);
  expect(WHAT).toEqual(["sdk10", "sdk11", "pwsh", "pwsh-preview"]);
});

test("a tampered archive never reaches the prefix", async () => {
  const prefix = mkdtempSync(join(tmpdir(), "bunos-dl-"));
  try {
    const fetcher = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    await expect(installPinned({ root, what: "pwsh", rid: "linux-x64", prefix, pins, fetcher })).rejects.toBeInstanceOf(ChecksumError);
    expect(await Bun.file(join(prefix, "pwsh")).exists()).toBe(false);
    const dry = await installPinned({ root, what: "sdk10", rid: "linux-x64", prefix, pins, dryRun: true });
    expect(dry.status).toBe("dry-run");
    expect(dry.algorithm).toBe("sha512");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("prefix environment opts out of telemetry and finds the SDK", () => {
  const env = prefixEnv("/opt/x", { PATH: "/usr/bin" });
  expect(env.DOTNET_ROOT).toBe(join("/opt/x", "dotnet"));
  expect(env.POWERSHELL_TELEMETRY_OPTOUT).toBe("1");
  expect(env.PATH.startsWith(join("/opt/x", "bin"))).toBe(true);
});

test("publish plan: NativeAOT cross-OS is refused as Microsoft documents, cross-arch needs a toolchain, plain publish crosses OS", () => {
  const winHost = publishPlan({ rid: "linux-x64", aot: true, hostRid: "win-x64" });
  expect(winHost.ok).toBe(false);
  expect(winHost.errors[0]).toContain("cross-OS");

  const arm = publishPlan({ project: "a.csproj", rid: "linux-arm64", aot: true, hostRid: "linux-x64" });
  expect(arm.ok).toBe(true);
  expect(arm.needs.join(" ")).toContain("cross toolchain for arm64");
  expect(arm.args).toContain("-p:PublishAot=true");
  expect(arm.args).toContain("linux-arm64");

  const musl = publishPlan({ rid: "linux-musl-x64", aot: true, hostRid: "linux-x64" });
  expect(musl.needs.join(" ")).toContain("Alpine");

  const native = publishPlan({ rid: "linux-x64", aot: true, nativeLib: "Shared", hostRid: "linux-x64", channel: "11.0" });
  expect(native.ok).toBe(true);
  expect(native.needs).toEqual(["clang", "zlib development headers (zlib1g-dev / zlib-dev)"]);
  expect(native.args).toEqual(expect.arrayContaining(["-f", "net11.0", "-p:NativeLib=Shared"]));

  const jit = publishPlan({ rid: "linux-x64", selfContained: true, hostRid: "win-x64" });
  expect(jit.ok).toBe(true);
  expect(jit.args).toContain("-p:SelfContained=true");
  expect(jit.args).not.toContain("-p:PublishAot=true");
});

test("buncc dotnet pins prints the pinned versions", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    expect(await dotnetLinuxMain(["pins"], root)).toBe(0);
  } finally {
    console.log = log;
  }
  expect(lines.join("\n")).toContain(`SDK ${pins.dotnet["10.0"].sdk}`);
  expect(lines.join("\n")).toContain(pins.powershell.stable.version);
});

const havePwsh = !!Bun.which("pwsh");
test.skipIf(!havePwsh)("pwshJson: objects cross the process boundary as JSON", async () => {
  const out = await pwshJson<{ a: number; b: string[]; v: string }>(
    "[pscustomobject]@{ a = 40 + 2; b = @('x','y'); v = $PSVersionTable.PSVersion.ToString() }",
  );
  expect(out.a).toBe(42);
  expect(out.b).toEqual(["x", "y"]);
  expect(out.v).toMatch(/^\d+\.\d+\.\d+/);
});
