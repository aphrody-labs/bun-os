// SPDX-License-Identifier: Apache-2.0
/**
 * `bun-os-platform check`: fails on
 *   - catalog errors: unparsable `.ftl`, ids or variables differing from `en` in any locale,
 *     keys used by the shell, play or the engine runtime missing from `en`;
 *   - hardcoded user-visible strings in the shell, play and engine UI code;
 *   - raw colors, sizes or durations in UI code outside the token sources.
 * Findings are compared with `check-baseline.json` (a ratchet): a count above the baseline or a
 * new file fails; `--update-baseline` records the current state after a migration step.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FluentResource, patternVariables } from "./i18n/fluent";
import { packageRoot, repoRoot } from "./paths";

export interface Finding {
  rule: string;
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, filter: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(repoRoot, p).replace(/\\/g, "/");

function lines(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/);
}

// ------------------------------------------------------------------ catalogs

export function checkCatalogs(): Finding[] {
  const out: Finding[] = [];
  const root = join(packageRoot, "locales");
  const tags = readdirSync(root).filter(d => statSync(join(root, d)).isDirectory());
  const parse = (tag: string, domain: string) => {
    const file = join(root, tag, `${domain}.ftl`);
    if (!existsSync(file)) return null;
    const r = new FluentResource(readFileSync(file, "utf8"));
    for (const e of r.errors)
      out.push({
        rule: "ftl-syntax",
        file: rel(file),
        line: e.line,
        text: e.message,
      });
    return r;
  };
  const domains = readdirSync(join(root, "en"))
    .filter(f => f.endsWith(".ftl"))
    .map(f => f.slice(0, -4));
  for (const domain of domains) {
    const en = parse("en", domain) as FluentResource;
    for (const tag of tags.filter(t => t !== "en")) {
      const file = rel(join(root, tag, `${domain}.ftl`));
      const other = parse(tag, domain);
      if (!other) {
        out.push({
          rule: "ftl-missing-file",
          file,
          line: 0,
          text: `${tag} has no ${domain}.ftl`,
        });
        continue;
      }
      for (const [id, msg] of en.entries) {
        const o = other.entries.get(id);
        if (!o) {
          out.push({ rule: "ftl-missing-key", file, line: 0, text: id });
          continue;
        }
        const a = [...patternVariables(msg.value)].sort().join(",");
        const b = [...patternVariables(o.value)].sort().join(",");
        if (a !== b)
          out.push({
            rule: "ftl-variables",
            file,
            line: 0,
            text: `${id}: en {${a}} vs ${tag} {${b}}`,
          });
      }
      for (const id of other.entries.keys())
        if (!en.entries.has(id)) out.push({ rule: "ftl-extra-key", file, line: 0, text: id });
    }
  }
  // Keys used by the code must exist in en.
  const enIds = (domain: string) => new Set((parse("en", domain) as FluentResource | null)?.entries.keys() ?? []);
  const uses: [string, string, RegExp[], string[]][] = [
    ["crates/bun-os-shell/src", "shell", [/\btf?\(\s*"([a-z0-9.-]+)"/g], ["common", "shell"]],
    [
      "crates/bun-engine-core/src/runtime",
      "engine",
      [/\bbun_os_platform::tf?\(\s*"([a-z0-9.-]+)"/g],
      ["common", "engine"],
    ],
  ];
  for (const [dir, , patterns, domainsOf] of uses) {
    const known = new Set(domainsOf.flatMap(d => [...enIds(d)]));
    for (const file of walk(join(repoRoot, dir), f => /\.(rs|ts|html)$/.test(f))) {
      lines(file).forEach((text, i) => {
        for (const re of patterns)
          for (const m of text.matchAll(re)) {
            const id = (m[1] as string).replace(/\./g, "-");
            if (!known.has(id))
              out.push({
                rule: "ftl-unknown-key",
                file: rel(file),
                line: i + 1,
                text: m[1] as string,
              });
          }
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ hardcoded strings

const WORDS = /[A-Za-z]{2,}[^"]*\s[A-Za-z]|^[A-Z][a-z]{2,}/;

export function checkStrings(): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, file: string, i: number, text: string) =>
    out.push({
      rule,
      file: rel(file),
      line: i + 1,
      text: text.trim().slice(0, 120),
    });
  // Shell and engine runtime: literals reaching Text, labels, toasts and format! UI strings.
  const rustUi = [
    ...walk(join(repoRoot, "crates/bun-os-shell/src"), f => f.endsWith(".rs") && !/[\\/](text|theme)\.rs$/.test(f)),
    ...walk(join(repoRoot, "crates/bun-engine-core/src/runtime"), f => f.endsWith(".rs")),
  ];
  const rustSinks =
    /(?:\.text\(|Text::new\(|Text\(|a11y_button\(|toast\(|label:\s*|title:\s*|windowed\()\s*(?:&?format!\(\s*)?"([^"]*)"/g;
  for (const file of rustUi)
    lines(file).forEach((text, i) => {
      if (/^\s*(\/\/|#\[|eprintln!|println!|log::|debug!|info!|warn!|error!|trace!)/.test(text)) return;
      for (const m of text.matchAll(rustSinks)) if (WORDS.test(m[1] as string)) add("hardcoded-string", file, i, m[0]);
    });
  return out;
}

// ------------------------------------------------------------------ raw tokens

export function checkTokens(): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, file: string, i: number, text: string) =>
    out.push({
      rule,
      file: rel(file),
      line: i + 1,
      text: text.trim().slice(0, 120),
    });
  // UI modules only: timers of system pollers (nvidia.rs, runtime.rs) are not motion tokens.
  const rustUi = walk(join(repoRoot, "crates/bun-os-shell/src"), f =>
    /[\\/](screens|ui|overlay|app|text)\.rs$/.test(f),
  );
  for (const file of rustUi)
    lines(file).forEach((text, i) => {
      if (/^\s*\/\//.test(text)) return;
      for (const m of text.matchAll(
        /Color::(srgb|srgba|srgb_u8|srgba_u8|hsl|hsla|linear_rgb|oklch)\(|Color::(BLACK|WHITE)\b/g,
      ))
        add("raw-color", file, i, m[0]);
      for (const m of text.matchAll(/Val::(Px|Vw|Vh)\(\s*-?\d+(\.\d+)?\s*\)/g))
        if (!/\(\s*0(\.0)?\s*\)/.test(m[0])) add("raw-size", file, i, m[0]);
      for (const m of text.matchAll(/(font_size|BorderRadius::all\(Val::Px|radius\()\s*[:(]?\s*\d+(\.\d+)?/g))
        add("raw-size", file, i, m[0]);
      for (const m of text.matchAll(/Duration::from_(millis|secs_f32|secs)\(\s*\d/g))
        add("raw-duration", file, i, m[0]);
    });
  return out;
}

// ------------------------------------------------------------------ ratchet

const BASELINE = join(packageRoot, "check-baseline.json");
type Counts = Record<string, Record<string, number>>;

function count(findings: Finding[]): Counts {
  const c: Counts = {};
  for (const f of findings) {
    c[f.rule] ??= {};
    (c[f.rule] as Record<string, number>)[f.file] = ((c[f.rule] as Record<string, number>)[f.file] ?? 0) + 1;
  }
  return c;
}

export function runCheck(options: { updateBaseline?: boolean; verbose?: boolean } = {}): number {
  const catalogs = checkCatalogs();
  const ui = [...checkStrings(), ...checkTokens()];
  const now = count(ui);
  if (options.updateBaseline) {
    Bun.write(
      BASELINE,
      `${JSON.stringify({ $comment: "Ratchet of bun-os-platform check: counts may only go down. Regenerate with `bun-os-platform check --update-baseline` after migrating.", counts: now }, null, 2)}\n`,
    );
  }
  const base: Counts = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, "utf8")) as { counts: Counts }).counts
    : {};
  let failed = 0;
  for (const f of catalogs) {
    failed++;
    console.log(`error ${f.rule} ${f.file}:${f.line} ${f.text}`);
  }
  for (const [rule, files] of Object.entries(now))
    for (const [file, n] of Object.entries(files)) {
      const allowed = base[rule]?.[file] ?? 0;
      if (n > allowed) {
        failed++;
        console.log(`error ${rule} ${file}: ${n} (baseline ${allowed})`);
        for (const f of ui.filter(u => u.rule === rule && u.file === file))
          console.log(`  ${f.file}:${f.line} ${f.text}`);
      } else if (options.verbose) console.log(`debt ${rule} ${file}: ${n} (baseline ${allowed})`);
    }
  const total = (rule: string) => Object.values(now[rule] ?? {}).reduce((a, b) => a + b, 0);
  console.log(
    `catalog errors ${catalogs.length}; UI debt: hardcoded strings ${total("hardcoded-string") + total("hardcoded-attribute")}, raw colors ${total("raw-color")}, raw sizes ${total("raw-size")}, raw durations ${total("raw-duration")}${failed ? `; ${failed} failure(s)` : ""}`,
  );
  return failed ? 1 : 0;
}
