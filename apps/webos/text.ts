// SPDX-License-Identifier: Apache-2.0
// Front matter and MDX cleanup for the text that inventory descriptions are read from.
export function frontmatter(source: string): { meta: Record<string, string>; body: string } {
  if (!source.startsWith("---")) return { meta: {}, body: source };
  const end = source.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of source.slice(3, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: source.slice(end + 4).replace(/^\r?\n/, "") };
}

/** Remove MDX-only syntax (imports, exports, JSX wrappers) so the page is plain Markdown. */
export function plain(body: string): string {
  const lines: string[] = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) fence = !fence;
    if (!fence && (/^(import|export) /.test(line) || /^\s*<\/?[A-Z][A-Za-z]*[^>]*>\s*$/.test(line))) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

