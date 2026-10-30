// SPDX-License-Identifier: Apache-2.0
// Store catalog: the WebOS registry, the inventory of the repository and the indexes of the served repositories,
// merged into /api/store/catalog (STORE_ROOT/catalog.json). Only real data: nothing here is invented, an app
// without an install path says why (`unavailable`).
import { join } from "node:path";
import { FORMATS, readIndex, type Ctx, type Format, type FormatIndex, type IndexEntry } from "./common";
import type { SourceId, StoreApp, StoreCatalog, StoreQualification, StoreSource } from "./types";

interface InvMember {
  kind: string;
  id: string;
  name: string;
  desc: string;
  path?: string;
  version?: string;
  license?: string;
  run?: string;
  tags: string[];
  links: { label: string; url: string }[];
  surface: { type: string; page: string; opens?: string; reason: string };
}
interface RegEntry {
  id: string;
  name: string;
  version: string;
  category: "games" | "create" | "tools";
  description: string;
  license: string;
  glyph: string;
  size: number;
  threads?: boolean;
  manifest: string;
}

const CATEGORIES: Record<string, string> = {
  games: "Games",
  create: "Create",
  tools: "Tools",
  system: "System",
  libraries: "Developer libraries",
  linux: "Linux packages",
  android: "Android",
};

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return (await Bun.file(path).json()) as T;
  } catch {
    return undefined;
  }
}

export async function buildCatalog(ctx: Ctx, dist: string): Promise<StoreCatalog> {
  const inventory = await readJson<{ members: InvMember[] }>(join(dist, "api/inventory.json"));
  const registry = (await readJson<{ packages: RegEntry[] }>(join(dist, "registry.json")))?.packages ?? [];
  const qualification = await readJson<StoreQualification>(join(ctx.store, "qualification.json"));
  const qualified = (source: SourceId): boolean | undefined => {
    const format = source === "arch" ? "pacman" : source;
    const r = qualification?.results.find((x) => x.format === format);
    return r ? r.ok : undefined;
  };
  const members = inventory?.members ?? [];
  const byKindId = (kind: string, id: string) => members.find((m) => m.kind === kind && m.id === id);
  const indexes = new Map<Format, FormatIndex>();
  for (const f of FORMATS) {
    const index = await readIndex(ctx, f);
    if (index) indexes.set(f, index);
  }
  const apps: StoreApp[] = [];
  const add = (app: Omit<StoreApp, "rating">) => apps.push({ ...app, rating: null });
  const memberOf = (path?: string) => {
    if (!path) return undefined;
    const [kind, id] = path.split("/");
    const m = byKindId(kind!, id!);
    return m ? { kind: m.kind, id: m.id, path: m.path } : { kind: kind!, id: id!, path };
  };

  // 1. Browser apps of the WebOS registry (install into the browser, work offline).
  const registered = new Set<string>();
  for (const e of registry) {
    registered.add(e.id);
    const manifest = await readJson<{ files: { path: string; bytes: number }[] }>(join(dist, "apps", e.id, "app.json"));
    const permissions = ["Stores its files in your browser (Cache Storage, OPFS)"];
    if (manifest?.files.some((f) => f.path.endsWith(".wasm"))) permissions.push("Runs WebAssembly code");
    if (e.threads) permissions.push("Uses worker threads (SharedArrayBuffer)");
    const owner = members.find((m) => m.surface.opens === e.id);
    add({
      id: `bunos:${e.id}`,
      name: e.name,
      pkg: e.id,
      source: "bunos",
      category: e.category,
      summary: e.description,
      version: e.version,
      size: e.size,
      license: e.license,
      icon: e.glyph,
      homepage: owner?.surface.page,
      member: owner ? { kind: owner.kind, id: owner.id, path: owner.path } : undefined,
      permissions,
      versions: [{ version: e.version, size: e.size }],
      install: { pwa: e.id },
      featured: true,
    });
  }
  // Inventory games and apps that are not registry packages: listed with the reason they cannot install here.
  for (const m of members.filter((x) => x.kind === "games" || x.kind === "apps")) {
    if (m.surface.opens && registered.has(m.surface.opens)) continue;
    if (apps.some((a) => a.member?.kind === m.kind && a.member.id === m.id)) continue;
    add({
      id: `bunos:${m.kind}/${m.id}`,
      name: m.name,
      pkg: m.id,
      source: "bunos",
      category: m.kind === "games" ? "games" : m.run === "android" ? "android" : "tools",
      summary: m.desc,
      version: m.version ?? "",
      license: m.license,
      homepage: m.surface.page,
      member: { kind: m.kind, id: m.id, path: m.path },
      install: {},
      // Inventory pages state how each member is reachable; the Store links to them.
      ...(m.surface.type === "app" && m.surface.opens ? { install: { pwa: m.surface.opens } } : {}),
    } as Omit<StoreApp, "rating">);
    const last = apps[apps.length - 1]!;
    if (!last.install.pwa) last.unavailable = m.surface.reason;
  }

  // 2. Served repositories.
  const fromIndex = (format: Format, source: SourceId, category: string, install: (e: IndexEntry) => StoreApp["install"]) => {
    for (const e of indexes.get(format)?.entries ?? []) {
      const owner = memberOf(e.member);
      add({
        id: `${source}:${e.name}`,
        name: e.name,
        pkg: e.name,
        source,
        category,
        summary: e.desc || `${e.name} ${e.version}`,
        version: e.version,
        size: e.size,
        license: e.license,
        homepage: owner ? `/inventory/${owner.kind}/${owner.id}` : e.homepage,
        member: owner,
        versions: [{ version: e.version, size: e.size }],
        install: install(e),
        qualified: qualified(source),
        ...(e.meta?.display ? { name: String(e.meta.display) } : {}),
      } as Omit<StoreApp, "rating">);
    }
  };
  const origin = ctx.origin;
  fromIndex("pacman", "pacman", "system", (e) => ({
    command: `sudo pacman -S ${e.name}`,
    removeCommand: `sudo pacman -Rns ${e.name}`,
    download: e.file ? { url: `${origin}${e.file}`, size: e.size, sha256: e.sha256, name: e.file.split("/").pop() } : undefined,
    agent: { manager: "pacman", name: e.name },
  }));
  fromIndex("apk", "apk", "system", (e) => ({
    command: `apk add ${e.name}`,
    removeCommand: `apk del ${e.name}`,
    download: e.file ? { url: `${origin}${e.file}`, size: e.size, sha256: e.sha256, name: e.file.split("/").pop() } : undefined,
    agent: { manager: "apk", name: e.name },
  }));
  fromIndex("flatpak", "flatpak", "tools", (e) => ({
    command: `flatpak remote-add --if-not-exists aphrody ${origin}/repo/flatpak/aphrody.flatpakrepo && flatpak install aphrody ${e.name}`,
    removeCommand: `flatpak uninstall ${e.name}`,
    download: { url: `${origin}/repo/flatpak/${e.name}.flatpakref`, name: `${e.name}.flatpakref` },
    agent: { manager: "flatpak", name: e.name },
  }));
  fromIndex("npm", "npm", "libraries", (e) => ({
    command: `bun add ${e.name}`,
    removeCommand: `bun remove ${e.name}`,
    download: e.file ? { url: `${origin}${e.file}`, size: e.size, sha256: e.sha256, name: e.file.split("/").pop() } : undefined,
    agent: { manager: "bun", name: e.name },
  }));
  fromIndex("cargo", "cargo", "libraries", (e) => ({
    command: `cargo add ${e.name} --registry aphrody`,
    removeCommand: `cargo remove ${e.name}`,
    download: e.file ? { url: `${origin}${e.file}`, size: e.size, sha256: e.sha256, name: `${e.name}-${e.version}.crate` } : undefined,
    agent: { manager: "cargo", name: e.name },
  }));
  fromIndex("android", "android", "android", (e) => ({
    download: e.file ? { url: `${origin}${e.file}`, size: e.size, sha256: e.sha256, name: e.file.split("/").pop() } : undefined,
  }));

  // 3. Inventory members that are not in a served repository, under the source that would carry them.
  const unpublished = (format: Format, kind: string, source: SourceId, install: (name: string) => string) => {
    const index = indexes.get(format);
    const published = new Set((index?.entries ?? []).map((e) => e.member));
    const reasons = new Map((index?.skipped ?? []).map((s) => [s.name, s.reason]));
    for (const m of members.filter((x) => x.kind === kind)) {
      if (published.has(m.path)) continue;
      const name = m.kind === "packages" ? (m.name.startsWith("@") ? m.name : `@aphrody/${m.name}`) : m.name;
      add({
        id: `${source}:${name}`,
        name,
        pkg: name,
        source,
        category: "libraries",
        summary: m.desc,
        version: m.version ?? "",
        license: m.license,
        homepage: m.surface.page,
        member: { kind: m.kind, id: m.id, path: m.path },
        install: {},
        unavailable: reasons.get(name) ?? reasons.get(m.name) ?? "Not published to this registry in the current build.",
      } as Omit<StoreApp, "rating">);
    }
    return install;
  };
  if (indexes.has("npm")) unpublished("npm", "packages", "npm", (n) => `bun add ${n}`);
  if (indexes.has("cargo")) unpublished("cargo", "crates", "cargo", (n) => `cargo add ${n}`);

  // 4. Arch-family catalogs of the factory (upstream repositories: Arch, CachyOS, Omarchy, ChimeraOS).
  for (const m of members.filter((x) => x.kind === "ospackages")) {
    const catalog = m.id.split("/")[0]!;
    add({
      id: `arch:${m.id}`,
      name: m.name,
      pkg: m.name,
      source: "arch",
      category: "linux",
      summary: m.desc,
      license: m.license,
      version: m.version ?? "",
      homepage: m.links.find((l) => l.label === "Arch package search")?.url,
      member: { kind: m.kind, id: m.id, path: m.path },
      install: {
        command: `sudo pacman -S ${m.name}`,
        removeCommand: `sudo pacman -Rns ${m.name}`,
        agent: { manager: "pacman", name: m.name },
      },
      qualified: qualified("arch"),
      permissions: [`Catalog: ${catalog} (${m.tags.filter((t) => t !== catalog).join(", ") || "default"})`],
    } as Omit<StoreApp, "rating">);
  }

  const counts = new Map<string, number>();
  for (const a of apps) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  const sources: StoreSource[] = [
    { id: "bunos", label: "Bun OS", desc: "Web apps and games that install into your browser and work offline.", count: counts.get("bunos") ?? 0 },
    {
      id: "pacman",
      label: "Bun OS pacman",
      desc: "Signed libalpm repository built from the factory PKGBUILDs.",
      repo: `${origin}/repo/os/$arch`,
      setup: `curl -fsS ${origin}/repo/os/aphrody.gpg | sudo pacman-key --add - && sudo pacman-key --lsign-key $(gpg --show-keys --with-colons <(curl -fsS ${origin}/repo/os/aphrody.gpg) | awk -F: '/^fpr/{print $10; exit}') && printf '\\n[aphrody]\\nServer = ${origin}/repo/os/$arch\\n' | sudo tee -a /etc/pacman.conf && sudo pacman -Sy`,
      count: counts.get("pacman") ?? 0,
    },
    {
      id: "arch",
      label: "Arch, CachyOS, Omarchy, ChimeraOS",
      desc: "Package catalogs of the Bun OS factory; installed with pacman from their upstream repositories.",
      count: counts.get("arch") ?? 0,
    },
    {
      id: "apk",
      label: "Bun OS Alpine",
      desc: "Signed apk repository built from the factory aports.",
      repo: `${origin}/repo/apk/v3.22/main`,
      setup: `sudo wget -O /etc/apk/keys/aphrody-store.rsa.pub ${origin}/repo/apk/keys/aphrody-store.rsa.pub && echo ${origin}/repo/apk/v3.22/main | sudo tee -a /etc/apk/repositories && sudo apk update`,
      count: counts.get("apk") ?? 0,
    },
    {
      id: "flatpak",
      label: "Bun OS Flatpak",
      desc: "OSTree repository with static deltas and appstream.",
      repo: `${origin}/repo/flatpak/repo/`,
      setup: `flatpak remote-add --if-not-exists aphrody ${origin}/repo/flatpak/aphrody.flatpakrepo`,
      count: counts.get("flatpak") ?? 0,
    },
    {
      id: "npm",
      label: "Bun OS npm",
      desc: "npm registry protocol: every @aphrody/* workspace package.",
      repo: `${origin}/npm/`,
      setup: `printf '[install.scopes]\\n"@aphrody" = "${origin}/npm/"\\n' >> bunfig.toml`,
      count: counts.get("npm") ?? 0,
    },
    {
      id: "cargo",
      label: "Bun OS crates",
      desc: "Cargo sparse registry of the workspace crates.",
      repo: `sparse+${origin}/cargo/index/`,
      setup: `printf '[registries.aphrody]\\nindex = "sparse+${origin}/cargo/index/"\\n' >> ~/.cargo/config.toml`,
      count: counts.get("cargo") ?? 0,
    },
    {
      id: "android",
      label: "Android APK",
      desc: "APK catalog built from apps/bun-android and the Android owners.",
      repo: `${origin}/repo/android/index.json`,
      count: counts.get("android") ?? 0,
    },
  ];
  const cats = new Map<string, number>();
  for (const a of apps) cats.set(a.category, (cats.get(a.category) ?? 0) + 1);
  const categories = [...cats].map(([id, count]) => ({ id, label: CATEGORIES[id] ?? id, count })).sort((a, b) => b.count - a.count);
  const featured = apps
    .filter((a) => a.featured || (a.source === "flatpak" && a.pkg === "com.aphrody.WebOS") || (a.source === "pacman" && a.pkg === "bun-canary"))
    .slice(0, 12)
    .map((a) => a.id);
  return { schemaVersion: 1, generated: new Date().toISOString(), origin, sources, categories, apps, featured };
}
