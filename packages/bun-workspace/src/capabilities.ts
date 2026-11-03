/** Minimal configuration consumed by the catalog, usable by browser clients. */
export interface CapabilityConfig {
  modules: readonly { id: string; role?: string }[];
  priorities?: readonly string[];
  deployment?: { appPrefix: string; domain: string };
}

export type CraftHostId = "cad" | "deck" | "grid" | "pdf" | "photo";

/** Verified file protocol implemented by a Craft WebOS iframe host. */
export interface WebOsCraftFileBridge {
  id: CraftHostId;
  protocol: string;
  extensions: readonly string[];
  maxFileBytes: number;
}

export interface AppCapability {
  id: string;
  libraryId: string;
  title: string;
  description: string;
  /** Installable Web OS package when this owner has a browser build. */
  webosPackageId?: string;
  /** Present only when the browser app implements the same-origin open/save protocol. */
  webosFileBridge?: WebOsCraftFileBridge;
}

const capabilities: readonly AppCapability[] = [
  {
    id: "video",
    libraryId: "filmcraft",
    title: "Video",
    description: "Video editing and timeline processing.",
    webosPackageId: "craft-film",
  },
  {
    id: "generation",
    libraryId: "artcraft",
    title: "Generation",
    description: "Generation and creative processing.",
  },
  {
    id: "images",
    libraryId: "photocraft",
    title: "Images",
    description: "Image editing and processing.",
    webosPackageId: "craft-photo",
    webosFileBridge: {
      id: "photo",
      protocol: "photocraft",
      extensions: [
        "pcraft",
        "pdn",
        "ora",
        "kra",
        "krz",
        "psd",
        "psb",
        "psdt",
        "png",
        "jpg",
        "jpeg",
        "tif",
        "tiff",
        "webp",
        "gif",
        "bmp",
        "tga",
        "ico",
        "qoi",
        "exr",
        "hdr",
        "pbm",
        "pgm",
        "ppm",
        "pam",
        "pfm",
        "dds",
        "fits",
        "fit",
        "fts",
        "dpx",
        "heic",
        "heif",
        "hif",
        "dng",
        "cr2",
        "cr3",
        "nef",
        "nrw",
        "arw",
        "pef",
        "orf",
        "rw2",
        "raf",
        "abr",
        "grd",
        "svg",
        "svgz",
        "aco",
        "ase",
        "af",
        "afdesign",
        "afphoto",
        "afpub",
      ],
      maxFileBytes: 64 * 1024 * 1024,
    },
  },
  {
    id: "vectors",
    libraryId: "vectorcraft",
    title: "Vectors",
    description: "Vector drawing and geometry.",
    webosPackageId: "craft-vector",
  },
  {
    id: "compositing",
    libraryId: "effectcraft",
    title: "Compositing",
    description: "Motion graphics and compositing.",
    webosPackageId: "craft-effect",
  },
  {
    id: "photo-processing",
    libraryId: "lightcraft",
    title: "Photo processing",
    description: "Non-destructive photo processing.",
    webosPackageId: "craft-light",
  },
  {
    id: "pdf",
    libraryId: "pdfcraft",
    title: "PDF",
    description: "PDF reading and processing.",
    webosPackageId: "craft-pdf",
    webosFileBridge: {
      id: "pdf",
      protocol: "pdfcraft",
      extensions: ["pdf"],
      maxFileBytes: 64 * 1024 * 1024,
    },
  },
  {
    id: "documents",
    libraryId: "wordcraft",
    title: "Documents",
    description: "Document editing and processing.",
    webosPackageId: "craft-word",
  },
  {
    id: "audio",
    libraryId: "soundcraft",
    title: "Audio",
    description: "Audio editing and processing.",
    webosPackageId: "craft-sound",
  },
  {
    id: "layout",
    libraryId: "designcraft",
    title: "Layout",
    description: "Page composition and layout.",
    webosPackageId: "craft-design",
  },
  {
    id: "cad",
    libraryId: "cadcraft",
    title: "CAD",
    description: "Drafting and technical geometry.",
    webosPackageId: "craft-cad",
    webosFileBridge: {
      id: "cad",
      protocol: "cadcraft",
      extensions: ["dxf", "dwg"],
      maxFileBytes: 64 * 1024 * 1024,
    },
  },
  {
    id: "slides",
    libraryId: "deckcraft",
    title: "Slides",
    description: "Presentation composition.",
    webosPackageId: "craft-deck",
    webosFileBridge: {
      id: "deck",
      protocol: "deckcraft",
      extensions: ["deckcraft", "slidecraft", "pptx", "potx", "ppsx"],
      maxFileBytes: 64 * 1024 * 1024,
    },
  },
  {
    id: "tables",
    libraryId: "gridcraft",
    title: "Tables",
    description: "Spreadsheet processing.",
    webosPackageId: "craft-grid",
    webosFileBridge: {
      id: "grid",
      protocol: "gridcraft",
      extensions: ["xlsx"],
      maxFileBytes: 64 * 1024 * 1024,
    },
  },
  {
    id: "interface-layouts",
    libraryId: "figcraft",
    title: "Interface layouts",
    description: "Interface composition and prototyping.",
    webosPackageId: "craft-fig",
  },
];

/** The currently implemented file hosts; unlisted apps remain launch-only in WebOS. */
export function webosCraftFileBridges(): Array<{
  packageId: string;
  bridge: WebOsCraftFileBridge;
}> {
  return capabilities.flatMap(capability =>
    capability.webosPackageId && capability.webosFileBridge
      ? [
          {
            packageId: capability.webosPackageId,
            bridge: capability.webosFileBridge,
          },
        ]
      : [],
  );
}

/** Canonical product catalog for desktop, Bun packages, and browser OS surfaces. */
export function allAppCapabilities(): AppCapability[] {
  return capabilities.map(entry => ({ ...entry }));
}

/** Presentation and application IDs have one owner; source pins remain in the config. */
export function capabilityFor(libraryId: string): {
  title: string;
  description: string;
} {
  const capability = capabilities.find(entry => entry.libraryId === libraryId);
  if (capability) return { title: capability.title, description: capability.description };
  if (libraryId === "craft-libs")
    return {
      title: "Shared libraries",
      description: "Shared Rust processing libraries.",
    };
  if (libraryId === "craft-fonts")
    return {
      title: "Fonts",
      description: "Font resources for native processing.",
    };
  return { title: "Library", description: "Native processing library." };
}

export function appCapabilityFor(appId: string): AppCapability | undefined {
  const entry = capabilities.find(capability => capability.id === appId);
  return entry ? { ...entry } : undefined;
}

export function appCapabilityForLibrary(libraryId: string): AppCapability | undefined {
  const capability = capabilities.find(entry => entry.libraryId === libraryId);
  return capability ? { ...capability } : undefined;
}

export function appCapabilities(config: CapabilityConfig): AppCapability[] {
  const engines = new Set(config.modules.filter(module => module.role === "engine").map(module => module.id));
  for (const id of engines) {
    if (!capabilities.some(entry => entry.libraryId === id)) throw new Error(`Application capability missing: ${id}`);
  }
  const selected = capabilities.filter(entry => engines.has(entry.libraryId));
  const priorities = config.priorities ?? [];
  return selected
    .map(entry => ({ ...entry }))
    .sort((a, b) => Number(priorities.includes(b.libraryId)) - Number(priorities.includes(a.libraryId)));
}

export function appHostname(
  capabilityId: string,
  config: CapabilityConfig,
): string {
  if (!appCapabilities(config).some(entry => entry.id === capabilityId))
    throw new Error(`Unknown application: ${capabilityId}`);
  if (!config.deployment) throw new Error("Application deployment settings are required.");
  const label = `${config.deployment.appPrefix}${capabilityId}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    throw new Error(`Invalid application hostname: ${capabilityId}`);
  return `${label}.${config.deployment.domain}`;
}

/** Canonical app host plus the library-name DNS alias already used by clients. */
export function appHostnamesForLibrary(
  libraryId: string,
  config: CapabilityConfig,
): string[] {
  const capability = appCapabilityForLibrary(libraryId);
  if (!capability) throw new Error(`Unknown application library: ${libraryId}`);
  const primary = appHostname(capability.id, config);
  const alias = `${libraryId}.${config.deployment!.domain}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9.-]+$/.test(alias))
    throw new Error(`Invalid application hostname alias: ${libraryId}`);
  return [...new Set([primary, alias])];
}
