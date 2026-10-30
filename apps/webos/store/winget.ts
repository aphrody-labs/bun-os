// SPDX-License-Identifier: Apache-2.0
// winget source of Bun OS: the Windows binaries cross-compiled on the VPS (x86_64-pc-windows-msvc) published as
// portable installers under /repo/winget/, with YAML manifests (schema 1.6.0) and a static REST source compatible
// with winget-cli-restsource at /api/store/winget/ (information, manifestSearch, packageManifests).
//   winget source add -n aphrody -a https://aphrody.com/api/store/winget -t "Microsoft.Rest"
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, run, step, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const MANIFEST_VERSION = "1.6.0";
const PUBLISHER = "Aphrody";

/** Windows binaries of the workspace: file name in the cross target directory -> crate that builds it. */
const BINARIES = [
  { file: "aphrody.exe", crate: "crates/aphrody", id: "Aphrody.Aphrody", name: "Aphrody", command: "aphrody" },
  { file: "bunos-infra.exe", crate: "crates/aphrody-infra", id: "Aphrody.BunOSInfra", name: "Bun OS Infra", command: "bunos-infra" },
];

interface RestVersion {
  PackageVersion: string;
  DefaultLocale: Record<string, unknown>;
  Installers: Record<string, unknown>[];
  Locales: unknown[];
}
interface RestPackage {
  PackageIdentifier: string;
  PackageName: string;
  Publisher: string;
  Versions: RestVersion[];
}

const yaml = (obj: Record<string, unknown>, indent = ""): string =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v))
        return `${indent}${k}:\n${v
          .map((item) =>
            typeof item === "object"
              ? `${indent}- ${yaml(item as Record<string, unknown>, `${indent}  `).trimStart()}`
              : `${indent}- ${JSON.stringify(item)}`,
          )
          .join("\n")}`;
      return `${indent}${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");

async function crateInfo(root: string, crate: string) {
  const toml = Bun.TOML.parse(await Bun.file(join(root, crate, "Cargo.toml")).text()) as { package: Record<string, any> };
  const ws = (Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as { workspace?: { package?: Record<string, any> } }).workspace?.package ?? {};
  const field = (k: string) => (typeof toml.package[k] === "object" && toml.package[k]?.workspace ? ws[k] : toml.package[k]);
  return { version: String(field("version")), license: String(field("license") ?? "Apache-2.0"), description: String(field("description") ?? "") };
}

export async function build(ctx: Ctx) {
  // Cross build outputs, newest lane first: the shared factory target, then the canonical checkout target.
  const dirs = (Bun.env.WINGET_ARTIFACTS ?? `/var/cache/aphrody-target/x86_64-pc-windows-msvc/release:${join(Bun.env.HOME ?? "/root", "bunos/target/x86_64-pc-windows-msvc/release")}`).split(":");
  const repo = join(ctx.store, "repo/winget");
  const data = join(ctx.store, "winget");
  await rm(repo, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
  await mkdir(data, { recursive: true });
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const packages: RestPackage[] = [];
  for (const bin of BINARIES) {
    let artifacts = dirs[0]!;
    for (const d of dirs) if (await Bun.file(join(d, bin.file)).exists()) { artifacts = d; break; }
    const source = Bun.file(join(artifacts, bin.file));
    if (!(await source.exists())) {
      skipped.push({ name: bin.id, reason: `${bin.file} is not built in ${dirs.join(", ")}` });
      continue;
    }
    const pe = await run(["file", "-b", join(artifacts, bin.file)]);
    if (!pe.out.startsWith("PE32+")) {
      skipped.push({ name: bin.id, reason: `${bin.file} is not a PE32+ executable` });
      continue;
    }
    const info = await crateInfo(ctx.root, bin.crate);
    const dir = join(repo, bin.id, info.version);
    await mkdir(dir, { recursive: true });
    await Bun.write(join(dir, bin.file), source);
    const sha = new Bun.CryptoHasher("sha256").update(await Bun.file(join(dir, bin.file)).bytes()).digest("hex").toUpperCase();
    const url = `${ctx.origin}/repo/winget/${bin.id}/${info.version}/${bin.file}`;
    const description = info.description || `${bin.name} for Windows`;
    const locale = {
      PackageLocale: "en-US",
      Publisher: PUBLISHER,
      PublisherUrl: ctx.origin,
      PackageName: bin.name,
      PackageUrl: `https://github.com/aphrody-labs/bun-os/tree/main/${bin.crate}`,
      License: info.license,
      ShortDescription: description.slice(0, 256),
      Moniker: bin.command,
    };
    const installer = {
      InstallerIdentifier: `${bin.id}-${info.version}-x64`,
      Architecture: "x64",
      InstallerType: "portable",
      InstallerUrl: url,
      InstallerSha256: sha,
      Commands: [bin.command],
    };
    await Bun.write(
      join(dir, `${bin.id}.yaml`),
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_VERSION}.schema.json\n${yaml({ PackageIdentifier: bin.id, PackageVersion: info.version, DefaultLocale: "en-US", ManifestType: "version", ManifestVersion: MANIFEST_VERSION })}\n`,
    );
    await Bun.write(
      join(dir, `${bin.id}.locale.en-US.yaml`),
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${MANIFEST_VERSION}.schema.json\n${yaml({ PackageIdentifier: bin.id, PackageVersion: info.version, ...locale, ManifestType: "defaultLocale", ManifestVersion: MANIFEST_VERSION })}\n`,
    );
    const { InstallerIdentifier: _id, ...yamlInstaller } = installer;
    await Bun.write(
      join(dir, `${bin.id}.installer.yaml`),
      `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_VERSION}.schema.json\n${yaml({ PackageIdentifier: bin.id, PackageVersion: info.version, Installers: [yamlInstaller], ManifestType: "installer", ManifestVersion: MANIFEST_VERSION })}\n`,
    );
    packages.push({
      PackageIdentifier: bin.id,
      PackageName: bin.name,
      Publisher: PUBLISHER,
      Versions: [{ PackageVersion: info.version, DefaultLocale: locale, Installers: [installer], Locales: [] }],
    });
    entries.push({
      name: bin.id,
      version: info.version,
      desc: description,
      license: info.license,
      size: source.size,
      sha256: sha.toLowerCase(),
      file: `/repo/winget/${bin.id}/${info.version}/${bin.file}`,
      member: bin.crate,
      meta: { display: bin.name, command: bin.command },
    });
  }
  await Bun.write(join(data, "packages.json"), JSON.stringify(packages));
  await writeIndex(ctx, { format: "winget", generated: new Date().toISOString(), url: `${ctx.origin}/api/store/winget`, entries, skipped });
  console.log(`winget: ${entries.length} packages, ${skipped.length} skipped`);
}

// ---------------------------------------------------------------------------------------------------------
// REST source (winget-cli-restsource protocol, read-only).

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });

interface SearchRequest {
  MaximumResults?: number;
  FetchAllManifests?: boolean;
  Query?: { KeyWord?: string; MatchType?: string };
  Inclusions?: { PackageMatchField?: string; RequestMatch?: { KeyWord?: string; MatchType?: string } }[];
  Filters?: { PackageMatchField?: string; RequestMatch?: { KeyWord?: string; MatchType?: string } }[];
}

function matches(value: string | undefined, keyword: string | undefined, type = "Substring"): boolean {
  if (keyword === undefined) return true;
  if (value === undefined) return false;
  const a = value.toLowerCase();
  const b = keyword.toLowerCase();
  if (type === "Exact") return value === keyword;
  if (type === "CaseInsensitive") return a === b;
  if (type === "StartsWith") return a.startsWith(b);
  return a.includes(b);
}
const field = (p: RestPackage, name?: string): string[] => {
  const v = p.Versions[0]!;
  const locale = v.DefaultLocale as Record<string, string>;
  switch (name) {
    case "PackageIdentifier":
      return [p.PackageIdentifier];
    case "PackageName":
      return [p.PackageName];
    case "Moniker":
      return [locale.Moniker ?? ""];
    case "Command":
      return v.Installers.flatMap((i) => (i.Commands as string[]) ?? []);
    case "Tag":
      return [];
    default:
      return [p.PackageIdentifier, p.PackageName, locale.Moniker ?? "", locale.ShortDescription ?? ""];
  }
};

export async function wingetApi(request: Request, store: string, rest: string): Promise<Response> {
  if (rest === "information" && request.method === "GET")
    return json({
      Data: {
        SourceIdentifier: "aphrody.com",
        ServerSupportedVersions: ["1.0.0", "1.1.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"],
        SourceAgreements: undefined,
        UnsupportedPackageMatchFields: ["Tag", "Market", "NormalizedPackageNameAndPublisher", "PackageFamilyName", "ProductCode", "UpgradeCode"],
        RequiredPackageMatchFields: [],
        UnsupportedQueryParameters: [],
        RequiredQueryParameters: [],
      },
    });
  const packages = ((await Bun.file(join(store, "winget/packages.json")).json().catch(() => [])) as RestPackage[]) ?? [];
  if (rest === "manifestSearch" && request.method === "POST") {
    let body: SearchRequest = {};
    try {
      body = (await request.json()) as SearchRequest;
    } catch {
      return json({ ErrorCode: 400, ErrorMessage: "Invalid JSON" }, 400);
    }
    const hit = packages.filter((p) => {
      const q = body.Query?.KeyWord === undefined || field(p).some((v) => matches(v, body.Query!.KeyWord, body.Query!.MatchType));
      const inc = !body.Inclusions?.length || body.Inclusions.some((i) => field(p, i.PackageMatchField).some((v) => matches(v, i.RequestMatch?.KeyWord, i.RequestMatch?.MatchType)));
      const fil = (body.Filters ?? []).every((f) => field(p, f.PackageMatchField).some((v) => matches(v, f.RequestMatch?.KeyWord, f.RequestMatch?.MatchType)));
      return q && inc && fil;
    });
    const data = hit.slice(0, body.MaximumResults || 1000).map((p) => ({
      PackageIdentifier: p.PackageIdentifier,
      PackageName: p.PackageName,
      Publisher: p.Publisher,
      Versions: p.Versions.map((v) => ({ PackageVersion: v.PackageVersion })),
    }));
    if (!data.length) return new Response(null, { status: 204 });
    return json({ Data: data, RequiredPackageMatchFields: [], UnsupportedPackageMatchFields: [] });
  }
  const m = /^packageManifests\/([^/]+)$/.exec(rest);
  if (m && request.method === "GET") {
    const p = packages.find((x) => x.PackageIdentifier.toLowerCase() === decodeURIComponent(m[1]!).toLowerCase());
    if (!p) return json({ ErrorCode: 404, ErrorMessage: "Package not found" }, 404);
    const version = new URL(request.url).searchParams.get("Version");
    const versions = version ? p.Versions.filter((v) => v.PackageVersion === version) : p.Versions;
    if (!versions.length) return new Response(null, { status: 204 });
    return json({ Data: { PackageIdentifier: p.PackageIdentifier, Versions: versions } });
  }
  return json({ ErrorCode: 404, ErrorMessage: "Not found" }, 404);
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const index = (await Bun.file(join(ctx.store, "index/winget.json")).json()) as { entries: IndexEntry[] };
  const image = "python:3-slim";
  if (!index.entries.length) {
    steps.push({ name: "winget packages", ok: false, ms: 0, log: "No Windows binary is published." });
    return { format: "winget", ok: false, at: new Date().toISOString(), steps };
  }
  // Official 1.6.0 schemas of microsoft/winget-cli, validated with jsonschema in a throw-away container.
  const dirs = index.entries.map((e) => `${e.name}/${e.version}`).join(" ");
  const script = `set -e
pip install -q jsonschema pyyaml >/dev/null 2>&1
base=https://raw.githubusercontent.com/microsoft/winget-cli/master/schemas/JSON/manifests/v${MANIFEST_VERSION}
python - <<'PY'
import json, sys, urllib.request, yaml, jsonschema, glob, os
base = os.environ["BASE"]
schemas = {t: json.load(urllib.request.urlopen(f"{base}/manifest.{t}.${MANIFEST_VERSION}.json")) for t in ["version", "defaultLocale", "installer"]}
bad = 0
for d in os.environ["DIRS"].split():
    for path in glob.glob(f"/repo/{d}/*.yaml"):
        doc = yaml.safe_load(open(path))
        try:
            jsonschema.validate(doc, schemas[doc["ManifestType"]])
            print("valid", path.split("/repo/")[1])
        except jsonschema.ValidationError as e:
            bad += 1
            print("INVALID", path, e.message)
sys.exit(1 if bad else 0)
PY`;
  await step(steps, `manifests validate against winget ${MANIFEST_VERSION} schemas (container ${image})`, () =>
    docker(image, `export BASE=https://raw.githubusercontent.com/microsoft/winget-cli/master/schemas/JSON/manifests/v${MANIFEST_VERSION} DIRS="${dirs}"; ${script}`, {
      mounts: [`${join(ctx.store, "repo/winget")}:/repo:ro`],
      timeout: 300_000,
    }),
  );
  const api = `${ctx.origin}/api/store/winget`;
  const pick = index.entries[0]!;
  await step(steps, "REST information", () => run(["sh", "-c", `curl -fsS ${api}/information | grep -q ServerSupportedVersions && curl -fsS ${api}/information`]));
  await step(steps, `REST manifestSearch ${pick.name}`, () =>
    run(["sh", "-c", `curl -fsS -X POST -H 'content-type: application/json' -d '{"Query":{"KeyWord":"${pick.meta?.command}","MatchType":"Substring"}}' ${api}/manifestSearch | grep -q '"${pick.name}"' && echo found`]),
  );
  await step(steps, `REST packageManifests + installer sha256 ${pick.name}`, () =>
    run([
      "sh",
      "-c",
      `set -e; m=$(curl -fsS ${api}/packageManifests/${pick.name}); echo "$m" | grep -q InstallerSha256; url=$(echo "$m" | grep -o '"InstallerUrl":"[^"]*"' | head -1 | cut -d'"' -f4); sum=$(curl -fsS "$url" | sha256sum | cut -d' ' -f1); echo "$m" | grep -qi "$sum" && echo "sha256 $sum matches"`,
    ]),
  );
  return { format: "winget", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image, steps };
}
