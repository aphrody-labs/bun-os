// Compatibility matrix: which Win32 imports of a program are implemented by Wine (pinned release), from its PE import table.
// This is a static estimate of API coverage, NOT a statement that the program runs: behaviour, drivers and DRM are not covered.
import { parsePe } from "./pe.ts";
import { coverage, parseSpec, type Coverage, type SpecCoverage } from "./wine.ts";

export const WINE_TAG = "wine-11.20";
const BASE = `https://raw.githubusercontent.com/wine-mirror/wine/${WINE_TAG}/dlls`;

/** DLLs whose Wine spec is fetched (each is `dlls/<name>/<name>.spec`). */
export const SPEC_DLLS = [
  "kernel32",
  "kernelbase",
  "ntdll",
  "user32",
  "gdi32",
  "advapi32",
  "shell32",
  "ole32",
  "oleaut32",
  "comctl32",
  "comdlg32",
  "shlwapi",
  "msvcrt",
  "ucrtbase",
  "ws2_32",
  "winmm",
  "version",
  "rpcrt4",
  "combase",
  "dwmapi",
  "d3d11",
  "dxgi",
  "crypt32",
  "bcrypt",
  "wininet",
  "winhttp",
  "uxtheme",
  "imm32",
  "setupapi",
  "psapi",
  "wtsapi32",
  "netapi32",
  "iphlpapi",
  "dbghelp",
  "propsys",
] as const;

export async function fetchSpecs(
  dlls: readonly string[] = SPEC_DLLS,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, SpecCoverage>> {
  const specs = new Map<string, SpecCoverage>();
  await Promise.all(
    dlls.map(async dll => {
      const r = await fetcher(`${BASE}/${dll}/${dll}.spec`);
      if (r.ok) specs.set(dll, parseSpec(await r.text()));
    }),
  );
  return specs;
}

export interface MatrixRow {
  file: string;
  machine: string;
  dotnet: boolean;
  dlls: number;
  coverage: Pick<Coverage, "total" | "implemented" | "stub" | "missing"> & { percent: number };
  unknownDlls: string[];
  missing: string[];
}

const MACHINES: Record<number, string> = { 0x8664: "x64", 0xaa64: "arm64", 0x14c: "x86" };

export async function analyze(path: string, specs: Map<string, SpecCoverage>): Promise<MatrixRow> {
  const pe = parsePe(new Uint8Array(await Bun.file(path).arrayBuffer()));
  const all = new Map(pe.imports);
  for (const [k, v] of pe.delayImports) all.set(k, [...(all.get(k) ?? []), ...v]);
  const c = coverage(all, specs);
  return {
    file: path,
    machine: MACHINES[pe.machine] ?? `0x${pe.machine.toString(16)}`,
    dotnet: pe.isDotnet,
    dlls: all.size,
    coverage: {
      total: c.total,
      implemented: c.implemented,
      stub: c.stub,
      missing: c.missing,
      percent: c.total ? Math.round((c.implemented / c.total) * 1000) / 10 : 100,
    },
    unknownDlls: c.unknownDlls.filter(d => !d.startsWith("api-ms-win-")),
    missing: c.missingNames.slice(0, 25),
  };
}
