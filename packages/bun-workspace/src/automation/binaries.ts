import { basename, join } from "node:path";
import { infraRoot } from "./runtime.ts";

export type AphrodyBinary = {
  name: string;
  path: string;
  source: "local-bin" | "release" | "debug";
  catalogued: boolean;
};

type Ecosystem = {
  cli?: Array<{ binary?: string }>;
  binariesWithoutClap?: Array<{ binary?: string }>;
};

function isAphrodyBinary(name: string): boolean {
  return (
    name === "aphrody" ||
    name === "n2b" ||
    name === "aphrody-mcp" ||
    name.startsWith("aphrody-")
  );
}

async function cataloguedNames(root: string): Promise<Set<string>> {
  const ecosystem = (await Bun.file(
    join(root, "docs", "ecosystem", "ecosystem.json"),
  ).json()) as Ecosystem;
  return new Set(
    [
      ...(ecosystem.cli ?? []),
      ...(ecosystem.binariesWithoutClap ?? []),
    ].flatMap((entry) => (entry.binary ? [entry.binary] : [])),
  );
}

/** Discover only trusted installed binaries and the supplied workspace build outputs, never arbitrary PATH files. */
export async function discoverAphrodyBinaries(
  root = infraRoot(),
): Promise<AphrodyBinary[]> {
  const catalogued = await cataloguedNames(root);
  const found = new Map<string, AphrodyBinary>();
  const resolveCandidate = async (
    path: string,
    source: AphrodyBinary["source"],
  ): Promise<AphrodyBinary | undefined> => {
    const name = basename(path).replace(/\.exe$/i, "");
    if (
      !isAphrodyBinary(name) ||
      name.includes(".") ||
      !(await Bun.file(path).exists())
    )
      return undefined;
    return { name, path, source, catalogued: catalogued.has(name) };
  };
  // The first candidate per name wins: local-bin, then release, then debug.
  const register = (binary: AphrodyBinary | undefined): void => {
    if (binary && !found.has(binary.name)) found.set(binary.name, binary);
  };

  const home = process.env.HOME;
  if (home) {
    const localBins = await Promise.all(
      [...new Set([...catalogued, "n2b"])].map((name) =>
        resolveCandidate(
          join(
            home,
            ".local",
            "bin",
            `${name}${process.platform === "win32" ? ".exe" : ""}`,
          ),
          "local-bin",
        ),
      ),
    );
    for (const binary of localBins) register(binary);
  }
  const profileCandidates = await Promise.all(
    (["release", "debug"] as const).map(async (profile) => {
      const paths = await Array.fromAsync(
        new Bun.Glob(`target/${profile}/*`).scan({ cwd: root, absolute: true }),
      );
      return Promise.all(paths.map((path) => resolveCandidate(path, profile)));
    }),
  );
  for (const binary of profileCandidates.flat()) register(binary);
  return [...found.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function runAphrodyBinary(
  name: string,
  args: string[],
): Promise<number> {
  if (!isAphrodyBinary(name))
    throw new Error(`unsupported Aphrody binary name: ${name}`);
  const binary = (await discoverAphrodyBinaries()).find(
    (entry) => entry.name === name,
  );
  if (!binary) throw new Error(`Aphrody binary is not installed: ${name}`);
  const child = Bun.spawn([binary.path, ...args], {
    windowsHide: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
