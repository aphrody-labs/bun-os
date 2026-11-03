// SPDX-License-Identifier: Apache-2.0
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  exportGoogleDocForWordCraft,
  googleDocSnapshotToWordCraftMarkdown,
  saveGoogleDocSnapshot,
} from "./docs-wordcraft.ts";
import type { NativeDocument } from "./drive-markdown.ts";

const usage = `Usage: yolo google docs <command>
  snapshot <document-id> <new-file.json> Save a Docs API snapshot with tabs for offline use
  project <snapshot.json> <new-file.md>  Project a saved Docs API snapshot offline for WordCraft
  export <document-id> <new-file.docx> Export a selected Google Doc to WordCraft via Drive
  open <document> [--binary <wordcraft>] Open a local document in the WordCraft desktop editor`;

export async function runDocsWordCraftCli(
  args: readonly string[],
): Promise<number> {
  const [action, input, output] = args;
  if (
    args.length === 0 ||
    action === "--help" ||
    action === "-h" ||
    action === "help"
  ) {
    console.log(usage);
    return args.length ? 0 : 2;
  }
  if (action === "open") {
    if (
      !input ||
      (args.length !== 2 &&
        (args.length !== 4 || output !== "--binary" || !args[3]))
    ) {
      console.error(usage);
      return 2;
    }
    const document = resolve(input);
    if (!(await Bun.file(document).exists()))
      throw new Error("Local document does not exist");
    const binary =
      args.length === 4 ? resolve(args[3]!) : Bun.which("wordcraft");
    if (!binary)
      throw new Error(
        "WordCraft is not installed or not in PATH; provide --binary",
      );
    const child = Bun.spawn([binary, document], {
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
    console.log(
      `Started WordCraft for ${document} (PID ${child.pid}); check the editor for open errors.`,
    );
    return 0;
  }
  if (
    (action !== "project" && action !== "export" && action !== "snapshot") ||
    args.length !== 3 ||
    !input ||
    !output
  ) {
    console.error(usage);
    return 2;
  }
  const path = resolve(output);
  if (action === "snapshot") {
    const { googleApi } = await import("./api.ts");
    const { docs } = await googleApi();
    const result = await saveGoogleDocSnapshot(docs, input, path);
    console.log(`Saved ${result.bytes} bytes to ${result.path}`);
    return 0;
  }
  if (action === "export") {
    const { googleApi } = await import("./api.ts");
    const { drive } = await googleApi();
    const result = await exportGoogleDocForWordCraft(drive, input, path);
    console.log(`Saved ${result.bytes} bytes to ${result.path}`);
    return 0;
  }
  if (!path.toLowerCase().endsWith(".md"))
    throw new Error("Projection destination must end in .md");
  const source = Bun.file(resolve(input));
  if (!(await source.exists()) || source.size > 32 * 1024 * 1024)
    throw new Error("Snapshot missing or exceeds 32 MiB");
  const snapshot: unknown = await source.json();
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Snapshot must contain a Docs API body or tabs");
  const document = snapshot as { body?: { content?: unknown }; tabs?: unknown };
  if (!Array.isArray(document.body?.content) && !Array.isArray(document.tabs))
    throw new Error("Snapshot must contain a Docs API body or tabs");
  const markdown = googleDocSnapshotToWordCraftMarkdown(
    snapshot as NativeDocument,
  );
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(markdown, "utf8");
    await file.close();
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
  console.log(`Saved offline projection to ${path}`);
  return 0;
}
