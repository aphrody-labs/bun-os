import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AOT_PROFILES,
  CHANNELS,
  ChecksumError,
  aotPublishArgs,
  channelEntry,
  compareSdk,
  installCommands,
  installSdk,
  listInstalls,
  parseGlobalJson,
  parseSdkVersion,
  resolveArchive,
  resolveInstall,
  runtimeIdentifier,
  selectSdk,
  writeGlobalJson,
} from "../src/providers/dotnet.ts";

const sdks = ["8.0.427", "9.0.320", "10.0.100", "10.0.203", "10.0.403", "11.0.100-rc.3.26522.148"];

test("version ordering puts a prerelease before its release", () => {
  const v = (s: string) => parseSdkVersion(s)!;
  expect(compareSdk(v("11.0.100-rc.3.1"), v("11.0.100"))).toBeLessThan(0);
  expect(compareSdk(v("11.0.100-rc.10.1"), v("11.0.100-rc.9.1"))).toBeGreaterThan(0);
  expect(compareSdk(v("10.0.403"), v("10.0.203"))).toBeGreaterThan(0);
  expect(v("10.0.403").band).toBe(4);
});

test("global.json roll-forward policies", () => {
  expect(selectSdk(sdks, { version: "10.0.100" })).toBe("10.0.100"); // latestPatch: same band only
  expect(selectSdk(sdks, { version: "10.0.100", rollForward: "latestFeature" })).toBe("10.0.403");
  expect(selectSdk(sdks, { version: "10.0.150", rollForward: "feature" })).toBe("10.0.203");
  expect(selectSdk(sdks, { version: "10.0.150", rollForward: "patch" })).toBeUndefined();
  expect(selectSdk(sdks, { version: "10.0.100", rollForward: "disable" })).toBe("10.0.100");
  expect(selectSdk(sdks, { version: "10.0.101", rollForward: "disable" })).toBeUndefined();
  expect(selectSdk(sdks, { version: "9.0.100", rollForward: "latestMinor" })).toBe("9.0.320");
  expect(selectSdk(sdks, { version: "8.0.100", rollForward: "major" })).toBe("8.0.427");
  expect(selectSdk(sdks, { version: "11.0.100", rollForward: "latestMajor", allowPrerelease: false })).toBeUndefined();
  expect(selectSdk(sdks, {})).toBe("11.0.100-rc.3.26522.148");
  expect(selectSdk(sdks, { allowPrerelease: false })).toBe("10.0.403");
});

test("global.json parsing tolerates comments and trailing commas", () => {
  const parsed = parseGlobalJson(`{ // pin
    "sdk": { "version": "10.0.403", "rollForward": "latestFeature", /* x */ "allowPrerelease": false, },
  }`);
  expect(parsed).toEqual({ version: "10.0.403", rollForward: "latestFeature", allowPrerelease: false });
});

test("resolveInstall honors global.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "buncc-dn-"));
  try {
    const root = join(dir, "dotnet");
    for (const v of ["10.0.403", "11.0.100-rc.3.26522.148"]) mkdirSync(join(root, "sdk", v), { recursive: true });
    const project = join(dir, "proj");
    mkdirSync(project);
    writeGlobalJson(project, { version: "10.0.403", rollForward: "latestPatch" });
    const installs = listInstalls([root]);
    expect(resolveInstall(installs, project)).toMatchObject({ sdk: "10.0.403", root });
    expect(() => writeGlobalJson(project, { version: "10.0.403" })).toThrow();
    expect(JSON.parse(readFileSync(join(project, "global.json"), "utf8")).sdk.allowPrerelease).toBe(false);
    const pre = join(dir, "pre");
    mkdirSync(pre);
    writeGlobalJson(pre, { version: "11.0.100-rc.3.26522.148" });
    expect(resolveInstall(installs, pre)?.sdk).toBe("11.0.100-rc.3.26522.148");
    expect(JSON.parse(readFileSync(join(pre, "global.json"), "utf8")).sdk.allowPrerelease).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const index = [
  {
    "channel-version": "11.0",
    "latest-sdk": "11.0.100-rc.3.1",
    "latest-release": "11.0.0-rc.3",
    "release-type": "sts",
    "support-phase": "go-live",
    "releases.json": "https://x/11/releases.json",
  },
  {
    "channel-version": "10.0",
    "latest-sdk": "10.0.403",
    "latest-release": "10.0.14",
    "release-type": "lts",
    "support-phase": "active",
    "releases.json": "https://x/10/releases.json",
  },
  {
    "channel-version": "9.0",
    "latest-sdk": "9.0.320",
    "latest-release": "9.0.22",
    "release-type": "sts",
    "support-phase": "maintenance",
    "releases.json": "https://x/9/releases.json",
  },
  {
    "channel-version": "7.0",
    "latest-sdk": "7.0.410",
    "latest-release": "7.0.20",
    "release-type": "sts",
    "support-phase": "eol",
    "releases.json": "https://x/7/releases.json",
  },
];

test("channel names resolve through the releases index", () => {
  expect(channelEntry(index, "LTS")?.["channel-version"]).toBe("10.0");
  expect(channelEntry(index, "latest")?.["channel-version"]).toBe("11.0");
  expect(channelEntry(index, "STS")?.["channel-version"]).toBe("9.0");
  expect(channelEntry(index, "10.0.1xx")?.["channel-version"]).toBe("10.0");
});

function fakeFetcher(): typeof fetch {
  const files = (v: string) => [
    { name: "dotnet-sdk-win-x64.zip", rid: "win-x64", url: `https://x/${v}/win-x64.zip`, hash: "00" },
    { name: "dotnet-sdk-linux-x64.tar.gz", rid: "linux-x64", url: `https://x/${v}/linux-x64.tar.gz`, hash: "11" },
  ];
  return (async (url: string) => {
    if (url.endsWith("releases-index.json")) return Response.json({ "releases-index": index });
    if (url.endsWith("/10/releases.json"))
      return Response.json({
        releases: [
          {
            sdk: { version: "10.0.403", files: files("10.0.403") },
            sdks: [
              { version: "10.0.302", files: files("10.0.302") },
              { version: "10.0.203", files: files("10.0.203") },
            ],
          },
        ],
      });
    if (url.endsWith("/11/releases.json"))
      return Response.json({ releases: [{ sdk: { version: "11.0.100-rc.3.1", files: files("11.0.100-rc.3.1") } }] });
    return new Response("not the real archive", { status: 200 });
  }) as unknown as typeof fetch;
}

test("archive resolution picks the newest SDK, a band, or an exact version", async () => {
  const f = fakeFetcher();
  expect((await resolveArchive({ channel: "10.0", rid: "linux-x64", fetcher: f })).url).toBe(
    "https://x/10.0.403/linux-x64.tar.gz",
  );
  expect((await resolveArchive({ channel: "10.0", band: "2xx", rid: "win-x64", fetcher: f })).version).toBe("10.0.203");
  expect((await resolveArchive({ channel: "10.0", version: "10.0.302", rid: "win-x64", fetcher: f })).sha512).toBe(
    "00",
  );
  expect((await resolveArchive({ channel: "11.0", rid: "win-x64", fetcher: f })).version).toBe("11.0.100-rc.3.1");
  await expect(resolveArchive({ channel: "10.0", version: "10.0.999", fetcher: f })).rejects.toThrow("no .NET SDK");
});

test("a failed checksum installs nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "buncc-dn-"));
  try {
    const f = fakeFetcher();
    const dry = await installSdk({ channel: "10.0", installDir: dir, dryRun: true, rid: "win-x64", fetcher: f });
    expect(dry.status).toBe("dry-run");
    await expect(installSdk({ channel: "10.0", installDir: dir, rid: "win-x64", fetcher: f })).rejects.toBeInstanceOf(
      ChecksumError,
    );
    expect(listInstalls([dir])).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NativeAOT publish for .NET 10 and .NET 11 profiles", () => {
  expect(aotPublishArgs({ profile: "aot-dotnet10", rid: "linux-x64", project: "App.csproj", output: "out" })).toEqual([
    "publish",
    "App.csproj",
    "-c",
    "Release",
    "--nologo",
    "-r",
    "linux-x64",
    "-f",
    "net10.0",
    "-o",
    "out",
    "-p:PublishAot=true",
  ]);
  const lib = aotPublishArgs({
    profile: "aot-dotnet11",
    rid: "win-x64",
    nativeLib: "Shared",
    size: true,
    stripSymbols: false,
  });
  expect(lib[lib.indexOf("-f") + 1]).toBe("net11.0");
  expect(lib).toContain("-p:NativeLib=Shared");
  expect(lib).toContain("-p:OptimizationPreference=Size");
  expect(lib).toContain("-p:StripSymbols=false");
  expect(Object.keys(AOT_PROFILES)).toEqual(["aot-dotnet10", "aot-dotnet11"]);
});

test("install commands use winget ids on Windows and dotnet-install elsewhere", () => {
  const win10 = installCommands(CHANNELS["10.0"], "win32")[0];
  expect(win10).toContain("Microsoft.DotNet.SDK.10");
  expect(win10).toContain("--silent");
  expect(installCommands(CHANNELS["11.0"], "win32")[0]).toContain("Microsoft.DotNet.SDK.Preview");
  const linux = installCommands(CHANNELS["11.0"], "linux", "/opt/dn");
  expect(linux[1].slice(2)).toEqual([
    "--channel",
    "11.0",
    "--quality",
    "preview",
    "--install-dir",
    "/opt/dn",
    "--no-path",
  ]);
  expect(runtimeIdentifier("linux", "arm64", true)).toBe("linux-musl-arm64");
  expect(runtimeIdentifier("darwin", "arm64")).toBe("osx-arm64");
});
