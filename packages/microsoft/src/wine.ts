// Wine export coverage. A Wine `.spec` file lists the exports of a builtin DLL; `stub` entries are exported but not implemented.
export interface SpecCoverage {
  implemented: Set<string>;
  stubs: Set<string>;
}

const IMPLEMENTED = new Set(["stdcall", "cdecl", "varargs", "thiscall", "fastcall", "extern"]);

export function parseSpec(text: string): SpecCoverage {
  const implemented = new Set<string>();
  const stubs = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^(?:\d+|@)\s+(\w+)\s+(?:-[\w=,|!.]+\s+)*([^\s(]+)/.exec(line);
    if (!m) continue;
    const kind = m[1]!;
    const name = m[2]!;
    if (kind === "stub") stubs.add(name);
    else if (IMPLEMENTED.has(kind)) implemented.add(name);
  }
  return { implemented, stubs };
}

export interface Coverage {
  total: number;
  implemented: number;
  stub: number;
  missing: number;
  /** DLLs the program imports with no spec provided (not counted above; API sets resolve to kernelbase/ntdll). */
  unknownDlls: string[];
  missingNames: string[];
}

/** Coverage of a program's imports against Wine specs keyed by DLL base name without extension ("kernel32"). */
export function coverage(imports: Map<string, string[]>, specs: Map<string, SpecCoverage>): Coverage {
  const c: Coverage = { total: 0, implemented: 0, stub: 0, missing: 0, unknownDlls: [], missingNames: [] };
  for (const [dll, names] of imports) {
    const base = dll.replace(/\.(dll|drv|ocx)$/, "");
    const spec = specs.get(base);
    if (!spec) {
      c.unknownDlls.push(dll);
      continue;
    }
    for (const n of names) {
      if (n.startsWith("#")) continue;
      c.total++;
      if (spec.implemented.has(n)) c.implemented++;
      else if (spec.stubs.has(n)) {
        c.stub++;
        c.missingNames.push(`${base}!${n} (stub)`);
      } else {
        c.missing++;
        c.missingNames.push(`${base}!${n}`);
      }
    }
  }
  return c;
}
