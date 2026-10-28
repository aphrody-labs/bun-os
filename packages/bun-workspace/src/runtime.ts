export interface RuntimePin {
  version: string;
  repository: string;
  revision: string;
}

export type RuntimeTarget =
  | "windows-x64"
  | "windows-arm64"
  | "linux-x64"
  | "linux-arm64"
  | "linux-x64-musl"
  | "linux-arm64-musl"
  | "darwin-x64"
  | "darwin-arm64";

export interface RuntimeFacts {
  version: string;
  revision: string;
  sourceUrl: string | null;
  executable: string;
}

export interface Runtime extends RuntimeFacts {
  recognizedFork: boolean;
  versionMatches: boolean;
  revisionMatches: boolean;
  expected: RuntimePin;
}

const revisionPattern = /^[0-9a-f]{40}$/;
export const runtimeVersionPattern = /^\d+\.\d+\.\d+$/;

export function nativeRuntimeTarget(): RuntimeTarget | undefined {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch;
  const libc =
    platform === "linux" &&
    !(process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header
      ?.glibcVersionRuntime
      ? "-musl"
      : "";
  const target = `${platform}-${architecture}${libc}`;
  return [
    "windows-x64",
    "windows-arm64",
    "linux-x64",
    "linux-arm64",
    "linux-x64-musl",
    "linux-arm64-musl",
    "darwin-x64",
    "darwin-arm64",
  ].includes(target)
    ? (target as RuntimeTarget)
    : undefined;
}

export function currentRuntimeFacts(): RuntimeFacts {
  const release = process.release as typeof process.release & {
    sourceUrl?: string;
  };
  return {
    version: Bun.version,
    revision: Bun.revision,
    sourceUrl: release.sourceUrl ?? null,
    executable: process.execPath,
  };
}

/** Inspect declared provenance separately from archive or executable digest verification. */
export function runtimeFromFacts(expected: RuntimePin, facts: RuntimeFacts): Runtime {
  if (
    expected.repository !== "oven-sh/bun" ||
    !runtimeVersionPattern.test(expected.version) ||
    !revisionPattern.test(expected.revision)
  ) {
    throw new Error("A pinned Aphrody Bun runtime is required.");
  }
  const { version, revision, sourceUrl } = facts;
  let recognizedFork = false;
  if (sourceUrl) {
    try {
      const source = new URL(sourceUrl);
      const path = source.pathname.split("/");
      const tag = path[5];
      const revisionTag = tag?.startsWith(`${expected.version}+`) ? tag.slice(expected.version.length + 1) : null;
      const pinnedTag =
        revisionTag !== null && /^[0-9a-f]{7,40}$/.test(revisionTag) && revision.startsWith(revisionTag);
      recognizedFork =
        source.protocol === "https:" &&
        source.hostname === "github.com" &&
        source.port === "" &&
        source.username === "" &&
        source.password === "" &&
        path[1] === "oven-sh" &&
        path[2] === "bun" &&
        path[3] === "releases" &&
        path[4] === "download" &&
        path.length === 7 &&
        Boolean(path[6]) &&
        revisionPattern.test(revision) &&
        (tag === `bun-v${expected.version}` || pinnedTag);
    } catch {
      recognizedFork = false;
    }
  }
  return {
    ...facts,
    recognizedFork,
    versionMatches: version === expected.version,
    revisionMatches: revision === expected.revision,
    expected: { ...expected },
  };
}

/** Usable by compiled applications without checkout configuration or Git. */
export function assertRuntimeFacts(expected: RuntimePin, facts: RuntimeFacts, allowRevisionDrift = false): Runtime {
  const runtime = runtimeFromFacts(expected, facts);
  if (!runtime.recognizedFork || !runtime.versionMatches || (!allowRevisionDrift && !runtime.revisionMatches)) {
    throw new Error(
      `Required runtime: ${expected.repository} ${expected.version}+${expected.revision}. Observed: ${runtime.version}+${runtime.revision}; provenance ${runtime.recognizedFork ? "valid" : "invalid"}.`,
    );
  }
  return runtime;
}
