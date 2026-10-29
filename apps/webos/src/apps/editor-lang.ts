// SPDX-License-Identifier: Apache-2.0
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import type { Extension } from "@codemirror/state";

/** Language support by file extension (CodeMirror 6 language packages). */
export function languageFor(path: string): Extension {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (["js", "mjs", "cjs", "jsx"].includes(ext)) return javascript({ jsx: true });
  if (["ts", "mts", "cts", "tsx"].includes(ext)) return javascript({ jsx: true, typescript: true });
  if (ext === "json" || ext === "jsonc") return json();
  if (ext === "md" || ext === "markdown") return markdown();
  if (ext === "css") return css();
  if (ext === "html" || ext === "htm") return html();
  if (ext === "rs") return rust();
  return [];
}
