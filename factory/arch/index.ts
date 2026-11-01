import { join } from "node:path";
import { planChimeraOs } from "./chimeraos/index.ts";
import profileContract from "../profile.json";
import cachyosIntegration from "./cachyos/integration.json";
import omarchyIntegration from "./omarchy/integration.json";

export type Composition = "server" | "desktop" | "gaming";
export type DesktopSession = "cosmic" | "omarchy-hyprland";
export const compositions: Composition[] = ["server", "desktop", "gaming"];
export interface ArchDistributionOptions {
  target: string;
  composition: Composition;
  /** Desktop session is independent of the installed OS composition. Desktop defaults to COSMIC. */
  desktopSession?: DesktopSession;
  snapshot?: string;
}

/** Load exactly the source catalogs selected by the root Arch profile. */
export async function loadSelectedSourceCatalogs(
  selected: readonly string[],
  loaders: Record<string, () => Promise<unknown>>,
): Promise<Record<string, unknown>> {
  if (new Set(selected).size !== selected.length) throw new Error("Arch source catalog identifiers must be unique.");
  for (const id of selected) {
    if (!Object.hasOwn(loaders, id) || typeof loaders[id] !== "function")
      throw new Error(`Unknown Arch source catalog: ${id}`);
  }
  const entries = await Promise.all(selected.map(async id => [id, await loaders[id]!()] as const));
  return Object.fromEntries(entries);
}

export function selectDesktopSession(
  composition: Composition,
  requested?: DesktopSession,
  defaultSession: DesktopSession = profileContract.compositions.desktop.defaultSession as DesktopSession,
): DesktopSession | null {
  if (requested !== undefined && requested !== "cosmic" && requested !== "omarchy-hyprland")
    throw new Error("Unknown desktop session.");
  if (requested && composition !== "desktop")
    throw new Error("A desktop session can only be selected for the desktop composition.");
  return composition === "desktop" ? (requested ?? defaultSession) : null;
}

/** Source catalogs are complete inputs, not a request to install conflicting sessions. */
export async function planArchDistribution(options: ArchDistributionOptions) {
  const profile = (await Bun.file(join(import.meta.dir, "../profile.json")).json()) as {
    compositions: Record<
      Composition,
      {
        packages: string[];
        extends?: Composition;
        defaultSession?: DesktopSession;
      }
    >;
    desktopSessions: Record<
      DesktopSession,
      {
        owner: string;
        session: string;
        packages: string[];
        state: "blocked" | "unqualified";
        blockers: string[];
      }
    >;
    sourceCatalogs: string[];
  };
  if (!Array.isArray(profile.sourceCatalogs) || profile.sourceCatalogs.some(id => typeof id !== "string"))
    throw new Error("The root Arch profile must declare its source catalogs.");
  const loaders = {
    searxng: async () => {
      const catalog = (await Bun.file(join(import.meta.dir, "sources.json")).json()) as {
        sources: Array<{
          id: string;
          repository: string;
          mount: string;
          checkoutRevision: string;
          initialized: boolean;
        }>;
      };
      const source = catalog.sources.find(entry => entry.id === "searxng");
      if (!source) throw new Error("SearXNG source fork is missing from the source catalog.");
      return {
        path: source.mount,
        repository: source.repository,
        revision: source.checkoutRevision,
        initialized: source.initialized,
        license: "AGPL-3.0",
      };
    },
    cachyos: async () => ({
      path: "factory/arch/cachyos",
      recipes: "catalog.json",
      integration: await Bun.file(join(import.meta.dir, "cachyos/integration.json")).json(),
    }),
    chimeraos: async () => {
      const source = (await Bun.file(join(import.meta.dir, "chimeraos/sources.json")).json()) as { sources: unknown };
      return {
        path: "factory/arch/chimeraos",
        sources: source.sources,
        plan: planChimeraOs({
          target: options.target,
          archiveDate: options.snapshot?.replaceAll("-", "/"),
        }),
      };
    },
    omarchy: async () => ({
      path: "factory/arch/omarchy",
      recipes: "pkgbuilds.json",
      rust: "rust.json",
      integration: await Bun.file(join(import.meta.dir, "omarchy/integration.json")).json(),
    }),
  };
  const [catalogs, forks] = await Promise.all([
    loadSelectedSourceCatalogs(profile.sourceCatalogs, loaders),
    Bun.file(join(import.meta.dir, "sources.json")).json(),
  ]);
  const selected = profile.compositions[options.composition];
  if (!selected || !compositions.includes(options.composition)) throw new Error("Unknown Arch composition");
  const effectiveDesktopSession = selectDesktopSession(
    options.composition,
    options.desktopSession,
    profile.compositions.desktop.defaultSession,
  );
  if (
    options.composition === "desktop" &&
    (!effectiveDesktopSession || !profile.desktopSessions[effectiveDesktopSession])
  )
    throw new Error("The desktop composition requires a known desktop session.");
  const session = effectiveDesktopSession ? profile.desktopSessions[effectiveDesktopSession] : undefined;
  const packages: string[] = [
    ...(selected.extends ? profile.compositions[selected.extends].packages : []),
    ...selected.packages,
    ...(session?.packages ?? []),
  ];
  const blockers = [
    "A signed, exact pacman binary closure must be resolved for this composition and archive date.",
    "Kernel, SDK/library builds, boot and GPU/input/audio/update qualification need independent artifact receipts.",
  ];
  if (options.target !== "linux-x64")
    blockers.push("The current Arch bootstrap and package closure target Linux x86_64/glibc only.");
  if (!options.snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(options.snapshot))
    blockers.push("Select an absolute Arch archive date (YYYY-MM-DD).");
  if (session) blockers.push(...session.blockers);
  return {
    schemaVersion: 2,
    kind: "bun-os-arch-distribution-plan",
    target: options.target,
    composition: options.composition,
    desktopSession: effectiveDesktopSession ?? null,
    desktopSessionOwner: session?.owner ?? null,
    desktopSessionState: session?.state ?? "not-applicable",
    packageManager: "pacman/libalpm",
    profile,
    requestedPackages: [...new Set(packages)],
    snapshot: options.snapshot ?? null,
    catalogs,
    sources: forks,
    graph: [
      { id: "arch:sources", owner: "factory/arch/sources.json", dependsOn: [] },
      {
        id: "arch:resolve",
        owner: "factory/arch/resolve.ts",
        dependsOn: ["arch:sources"],
      },
      {
        id: "arch:rootfs",
        owner: "factory/arch/pacman.ts",
        dependsOn: ["arch:resolve"],
      },
      {
        id: "arch:payload",
        owner: "src/distribution.ts stageRuntime",
        dependsOn: ["arch:sources"],
      },
      {
        id: "arch:image",
        owner: "src/distribution.ts buildImage",
        dependsOn: ["arch:rootfs", "arch:payload"],
      },
      {
        id: "arch:qualify",
        owner: "factory/native-targets.ts + existing product receipt owners",
        dependsOn: ["arch:image"],
      },
    ],
    servicesEnabled: [],
    executable: false,
    qualified: false,
    blockers,
  };
}

export interface PacmanRepository {
  name: string;
  family: "cachyos" | "archlinux" | "omarchy";
  /** Mirror architecture directory, for example x86_64 or x86_64_v3. */
  arch: string;
  /** Minimum x86-64 microarchitecture level required by the binaries. */
  isa: "x86-64" | "x86-64-v3";
  /** pacman Server templates with $repo and $arch. */
  servers: string[];
  signingKey?: string;
}

const archOfficial: PacmanRepository[] = ["core", "extra", "multilib"].map(name => ({
  name,
  family: "archlinux",
  arch: "x86_64",
  isa: "x86-64",
  servers: ["https://geo.mirror.pkgbuild.com/$repo/os/$arch", "https://mirrors.kernel.org/archlinux/$repo/os/$arch"],
}));

/** Binary repositories available to the package index, in pacman.conf order. */
export function pacmanRepositories(): PacmanRepository[] {
  // Keep reference catalogs inert until the owning product integration has
  // explicitly enabled, qualified, and authorized execution of its repo.
  const omarchyRepositories =
    omarchyIntegration.enabled === true &&
    omarchyIntegration.qualified === true &&
    omarchyIntegration.executable === true
      ? (omarchyIntegration.repositories as PacmanRepository[])
      : [];
  return [...(cachyosIntegration.repositories as PacmanRepository[]), ...archOfficial, ...omarchyRepositories];
}

export function repositoryUrls(repository: PacmanRepository, file: string): string[] {
  return repository.servers.map(
    server => `${server.replaceAll("$repo", repository.name).replaceAll("$arch", repository.arch)}/${file}`,
  );
}
