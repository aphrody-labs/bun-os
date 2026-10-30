// SPDX-License-Identifier: 0BSD
/**
 * Repository layers by CPU level, after CachyOS/cachyos-repo-add-script (cachyos-repo.sh, install-repo.awk,
 * install-v4-repo.awk, install-znver4-repo.awk @ e2c90c6, 2026-10-17). Pure functions: nothing here touches a
 * host. Layers are inserted before [core]; the most specific tier comes first so pacman prefers it.
 * `Architecture = auto` needs CachyOS's pacman fork (7.1.0.r9.g54d9411-5 per CachyOS-PKGBUILDS), which
 * understands x86_64_v3 / x86_64_v4; stock Arch pacman does not. Qualification is pending (no host run).
 */
export type IsaTier = "x86-64" | "x86-64-v3" | "x86-64-v4" | "znver4";
export const isaTiers: readonly IsaTier[] = ["x86-64", "x86-64-v3", "x86-64-v4", "znver4"];

/**
 * cachyos-repo.sh: `/lib/ld-linux-x86-64.so.2 --help` lists "x86-64-v4 (supported, searched)"; Zen 4/5 is
 * read from `gcc -march=native -Q --help=target`. Order: znver4/5, then v4, then v3, else x86-64.
 */
export function detectIsa(input: { ldHelp: string; gccTarget?: string }): IsaTier {
  const supported = (level: string) => new RegExp(`${level} \\(supported, searched\\)`).test(input.ldHelp);
  const zen = /^\s*-march=\s+(znver4|znver5)\b/m.test(input.gccTarget ?? "");
  if (zen && supported("x86-64-v4")) return "znver4";
  if (supported("x86-64-v4")) return "x86-64-v4";
  if (supported("x86-64-v3")) return "x86-64-v3";
  return "x86-64";
}

export interface RepoLayer {
  name: string;
  /** pacman.conf Include path; when absent `server` is written as `Server =`. */
  include?: string;
  server?: string;
}

const cachyosTier = (suffix: string, mirrorlist: string): RepoLayer[] =>
  ["cachyos", "cachyos-core", "cachyos-extra"].map(base => ({ name: `${base}-${suffix}`, include: mirrorlist }));

/** The CachyOS layers of a tier, in pacman.conf order (znver4 reuses the v4 mirror list, as upstream does). */
export function cachyosLayers(tier: IsaTier): RepoLayer[] {
  const base: RepoLayer = { name: "cachyos", include: "/etc/pacman.d/cachyos-mirrorlist" };
  switch (tier) {
    case "znver4":
      return [...cachyosTier("znver4", "/etc/pacman.d/cachyos-v4-mirrorlist"), base];
    case "x86-64-v4":
      return [...cachyosTier("v4", "/etc/pacman.d/cachyos-v4-mirrorlist"), base];
    case "x86-64-v3":
      return [...cachyosTier("v3", "/etc/pacman.d/cachyos-v3-mirrorlist"), base];
    default:
      return [base];
  }
}

/** Bun OS's own repository layers: `[bunos-<tier>]` before `[bunos]` (v3/v4 builds of the same recipes). */
export function bunosLayers(tier: IsaTier, server: string): RepoLayer[] {
  const suffix = { "x86-64": "", "x86-64-v3": "v3", "x86-64-v4": "v4", znver4: "v4" }[tier];
  const layers: RepoLayer[] = [];
  if (suffix) layers.push({ name: `bunos-${suffix}`, server: server.replaceAll("$arch", `$arch_${suffix}`) });
  layers.push({ name: "bunos", server });
  return layers;
}

export function renderLayers(layers: RepoLayer[]): string {
  return layers.map(l => `[${l.name}]\n${l.include ? `Include = ${l.include}` : `Server = ${l.server}`}`).join("\n\n");
}

/**
 * Insert layers before the first repository section and set `Architecture = auto`, like the upstream awk
 * scripts. Idempotent: a layer already present by name is not added twice.
 */
export function applyLayers(pacmanConf: string, layers: RepoLayer[]): string {
  const present = new Set([...pacmanConf.matchAll(/^\[([^\]]+)\]/gm)].map(m => m[1]));
  const fresh = layers.filter(l => !present.has(l.name));
  let out = pacmanConf.replace(/^Architecture\s*=.*$/m, "Architecture = auto");
  if (!/^Architecture\s*=/m.test(out)) out = out.replace(/^\[options\][^\n]*\n/m, m => m + "Architecture = auto\n");
  if (!fresh.length) return out;
  const first = out.search(/^\[(?!options\])[^\]]+\]/m);
  const block = renderLayers(fresh) + "\n\n";
  return first < 0 ? out.trimEnd() + "\n\n" + block : out.slice(0, first) + block + out.slice(first);
}
