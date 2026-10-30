// SPDX-License-Identifier: Apache-2.0
// Minimal, safe Markdown renderer for member READMEs in Atlas and member windows.
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, safe Markdown renderer: headings, lists, emphasis, inline code, links (text only), tables as rows. */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  for (const raw of src.split("\n")) {
    if (raw.trimStart().startsWith("```")) {
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }
    const line = esc(raw);
    const h2 = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (inList && !li) {
      out.push("</ul>");
      inList = false;
    }
    if (h2) out.push(`<h${h2[1]!.length + 1}>${inline(h2[2]!)}</h${h2[1]!.length + 1}>`);
    else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1]!)}</li>`);
    } else if (line.trim() === "") out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, "$1");
}

