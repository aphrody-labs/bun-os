// SPDX-License-Identifier: Apache-2.0
import { open, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";
import { nativeMarkdown, type NativeDocument } from "./drive-markdown.ts";

/** DOCX is a native WordCraft input; the Google document remains untouched. */
export const WORDCRAFT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

/** Save a selected Docs API snapshot, including its tabs, for later offline projection. */
export async function saveGoogleDocSnapshot(
  docs: docs_v1.Docs,
  documentId: string,
  destination: string,
): Promise<{ path: string; bytes: number }> {
  if (!documentId.trim()) throw new Error("A Google document ID is required");
  if (!isAbsolute(destination) || !destination.toLowerCase().endsWith(".json"))
    throw new Error("Destination must be an absolute .json path");
  const file = await open(destination, "wx", 0o600);
  try {
    const response = await docs.documents.get({
      documentId,
      includeTabsContent: true,
    });
    const contents = `${JSON.stringify(response.data)}\n`;
    const bytes = Buffer.byteLength(contents, "utf8");
    if (bytes > MAX_EXPORT_BYTES) throw new Error("Google Docs snapshot exceeds 32 MiB");
    await file.writeFile(contents, "utf8");
    await file.close();
    return { path: destination, bytes };
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(destination).catch(() => {});
    throw error;
  }
}

/**
 * Convert an already downloaded Docs API snapshot to WordCraft-readable Markdown offline.
 * This is a projection, not a lossless conversion; unsupported elements can raise an error.
 */
export function googleDocSnapshotToWordCraftMarkdown(snapshot: NativeDocument): string {
  return nativeMarkdown(snapshot);
}

/**
 * Export an explicitly selected Google document to a new local DOCX for WordCraft.
 * The destination must not already exist. Nothing is uploaded or synchronized.
 * Google conversion may not retain all document features; keep the source document.
 */
export async function exportGoogleDocForWordCraft(
  drive: drive_v3.Drive,
  documentId: string,
  destination: string,
): Promise<{ path: string; bytes: number }> {
  if (!documentId.trim()) throw new Error("A Google document ID is required");
  if (!isAbsolute(destination) || !destination.toLowerCase().endsWith(".docx"))
    throw new Error("Destination must be an absolute .docx path");

  // Exclusive creation prevents accidental overwrites, including symlinks.
  const file = await open(destination, "wx", 0o600);
  let stream: NodeJS.ReadableStream | undefined;
  let bytes = 0;
  const signature: number[] = [];
  try {
    const response = await drive.files.export(
      { fileId: documentId, mimeType: WORDCRAFT_DOCX_MIME },
      { responseType: "stream" },
    );
    stream = response.data;
    for await (const chunk of response.data) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Google returned invalid DOCX bytes");
      for (let i = 0; i < chunk.length && signature.length < 4; i++) signature.push(chunk[i]!);
      bytes += chunk.byteLength;
      if (bytes > MAX_EXPORT_BYTES) throw new Error("Google DOCX export exceeds 32 MiB");
      await file.writeFile(chunk);
    }
    if (signature.length !== 4 || signature.some((value, index) => value !== [0x50, 0x4b, 0x03, 0x04][index]))
      throw new Error("Google DOCX export is not a ZIP package");
    await file.close();
    return { path: destination, bytes };
  } catch (error) {
    if (stream && "destroy" in stream && typeof stream.destroy === "function") stream.destroy();
    await file.close().catch(() => {});
    await unlink(destination).catch(() => {});
    throw error;
  }
}
