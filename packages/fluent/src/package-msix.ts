#!/usr/bin/env bun
// Packs the WinUI app as an MSIX with `buncc package msix` (makeappx from Microsoft.Windows.SDK.BuildTools) and signs it with a throw-away
// local test certificate (created in CurrentUser\My, exported to a temp PFX, removed afterwards; never committed, never added to a trust store).
// The package is NOT installed: installing it would need the certificate in a trust store. Output: packages/fluent/out/msix/*.msix
//   bun packages/fluent/src/package-msix.ts
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const bin = join(root, "app", "bin", "x64", "Release", "net10.0-windows10.0.26100.0", "win-x64");
if (!existsSync(join(bin, "FluentApp.exe")))
  throw new Error("build the app first: dotnet build packages/fluent/app/FluentApp.csproj -c Release -p:Platform=x64");
const stage = join(root, "out", "msix-stage");
const outDir = join(root, "out", "msix");
rmSync(stage, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(bin, stage, { recursive: true });

// Solid-colour PNG (Fluent brand blue) for the tile assets: zlib + CRC32, no dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};
function png(w: number, h: number, rgb: [number, number, number]) {
  const row = new Uint8Array(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * h);
  for (let y = 0; y < h; y++) raw.set(row, y * row.length);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 0x1a, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}
mkdirSync(join(stage, "Assets"), { recursive: true });
for (const [name, size] of [
  ["StoreLogo", 50],
  ["Square44x44Logo", 44],
  ["Square150x150Logo", 150],
] as const)
  writeFileSync(join(stage, "Assets", `${name}.png`), png(size, size, [0x0f, 0x6c, 0xbd]));

const buildTools = join(Bun.env.USERPROFILE ?? tmpdir(), ".nuget", "packages", "microsoft.windows.sdk.buildtools");
const toolDir = (() => {
  const v = readdirSync(buildTools).sort().at(-1)!;
  const sub = readdirSync(join(buildTools, v, "bin"))
    .filter(d => d.startsWith("10."))
    .sort()
    .at(-1)!;
  return join(buildTools, v, "bin", sub, "x64");
})();
const env = { ...Bun.env, PATH: `${toolDir};${Bun.env.PATH}` } as Record<string, string>;
const buncc = join(root, "..", "buncc", "src", "cli.ts");
const pack = Bun.spawnSync(
  [
    process.execPath,
    buncc,
    "package",
    "msix",
    "--dir",
    stage,
    "--out",
    outDir,
    "--name",
    "BunOs.Fluent",
    "--publisher",
    "CN=BunOsLocalTest",
    "--display-name",
    "Bun OS Fluent",
    "--publisher-name",
    "Bun OS",
    "--version",
    "1.4.7",
    "--exe",
    "FluentApp.exe",
    "--run",
  ],
  { env, stdout: "inherit", stderr: "inherit" },
);
if (pack.exitCode !== 0) throw new Error(`buncc package msix exited ${pack.exitCode}`);
const msix = readdirSync(outDir).find(f => f.endsWith(".msix"))!;
const file = join(outDir, msix);

// Local test signature. The cert subject must equal the manifest Publisher.
const pfx = join(tmpdir(), `bunos-localtest-${process.pid}.pfx`);
const ps = `
$ErrorActionPreference = 'Stop'
$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=BunOsLocalTest' -KeyUsage DigitalSignature -FriendlyName 'Bun OS local test (delete me)' -CertStoreLocation 'Cert:\\CurrentUser\\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
try {
  $pw = ConvertTo-SecureString -String ([guid]::NewGuid().ToString()) -Force -AsPlainText
  [void](Export-PfxCertificate -Cert $cert -FilePath '${pfx.replace(/\\/g, "\\\\")}' -Password $pw)
  & '${join(toolDir, "signtool.exe").replace(/\\/g, "\\\\")}' sign /fd SHA256 /a /f '${pfx.replace(/\\/g, "\\\\")}' /p ([System.Net.NetworkCredential]::new('', $pw).Password) '${file.replace(/\\/g, "\\\\")}'
  if ($LASTEXITCODE -ne 0) { throw "signtool exit $LASTEXITCODE" }
  $sig = Get-AuthenticodeSignature '${file.replace(/\\/g, "\\\\")}'
  [pscustomobject]@{ subject = $sig.SignerCertificate.Subject; status = [string]$sig.Status } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath '${pfx.replace(/\\/g, "\\\\")}' -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}`;
const sign = Bun.spawnSync(["pwsh", "-NoProfile", "-NonInteractive", "-Command", ps], {
  stdout: "pipe",
  stderr: "pipe",
});
console.log(sign.stdout.toString().trim().split("\n").at(-1));
if (sign.exitCode !== 0) throw new Error(sign.stderr.toString() || sign.stdout.toString());
console.log(JSON.stringify({ msix: file, bytes: statSync(file).size }));
