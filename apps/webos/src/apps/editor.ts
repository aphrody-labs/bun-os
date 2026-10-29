// SPDX-License-Identifier: Apache-2.0
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { h } from "../dom";
import { languageFor } from "./editor-lang";
import { webos } from "../os";

/** Text editor (CodeMirror 6) over the Rust file system; Ctrl+S saves to OPFS. */
export async function editorApp(root: HTMLElement, path: string, text: string) {
  const os = await webos();
  const status = h("div", { class: "files-status" }, path);
  const save = async () => {
    try {
      os.fs.write(path, new TextEncoder().encode(view.state.doc.toString()));
      await os.flush();
      status.textContent = `${path} · saved`;
    } catch (error) {
      status.textContent = String(error);
    }
    return true;
  };
  const host = h("div", { class: "editor", "aria-label": path });
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        languageFor(path),
        keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (void save(), true) }]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) status.textContent = `${path} · modified`;
        }),
      ],
    }),
  });
  root.append(h("div", { class: "editor-wrap" }, host, status));
}
