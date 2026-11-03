// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Seven native documents and their evidence are reconciled sequentially. */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { drive_v3 } from "@googleapis/drive";
import { googleApi } from "./api.ts";
import { nativeMarkdown, projectionAction, projectionMarkdown, type NativeDocument } from "./drive-markdown.ts";
import syncContract from "./sync-contract.json";

export const AGENT_HOME_DEFAULT_DOCS: readonly string[] = syncContract;
const DEFAULT_DOCS = new Set<string>(AGENT_HOME_DEFAULT_DOCS);
const DOC_MIME = "application/vnd.google-apps.document";
type RemoteDoc = { id: string; name: string; modifiedTime: string };
type Entry = {
  id: string;
  localHash: string;
  remoteHash: string;
  remoteModifiedTime: string;
  sourceSnapshotHash?: string;
  sourceRenderedHash?: string;
};
type State = {
  version: 1;
  kind: "native-markdown-download-only";
  rootFolderId: string;
  files: Record<string, Entry>;
};
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in Aphrody .env`);
  return value;
}
function digest(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}
/** A reviewed snapshot must still describe the current remote content when promoted. */
export function reviewedSnapshotHashes(snapshot: string, remoteHash: string) {
  const sourceRenderedHash = digest(nativeMarkdown(JSON.parse(snapshot) as NativeDocument));
  if (sourceRenderedHash !== remoteHash)
    throw new Error("Reviewed native snapshot no longer matches current remote content");
  return { sourceSnapshotHash: digest(snapshot), sourceRenderedHash };
}
async function save(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await Bun.write(temp, data, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe retrieval projection directory");
  await chmod(path, 0o700);
}
/** Index candidates separately from their private local/baseline/native evidence. */
export async function projectRetrievalCandidate(
  privateRoot: string,
  snapshot: string,
  markdown: string,
): Promise<void> {
  const match = /^([A-Z][A-Z0-9_-]*\.md)-[a-f0-9]{16}-[a-f0-9]{16}$/.exec(snapshot);
  if (!match || !DEFAULT_DOCS.has(match[1]!)) throw new Error("Unsafe retrieval snapshot name");
  const root = join(privateRoot, "retrieval-markdown"),
    directory = join(root, snapshot),
    path = join(directory, "remote.candidate.md");
  for (const folder of [root, directory]) await privateDirectory(folder);
  const previous = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw new Error("Unsafe retrieval projection file");
  if (previous && (await Bun.file(path).text()) === markdown) {
    await chmod(path, 0o600);
    return;
  }
  await save(path, markdown);
}
export async function remoteDocs(drive: drive_v3.Drive, rootId: string): Promise<Map<string, RemoteDoc>> {
  const docs = new Map<string, RemoteDoc>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await drive.files.list({
      q: `'${rootId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const file of page.data.files ?? []) {
      if (!file.name || !DEFAULT_DOCS.has(file.name)) continue;
      if (!file.id || file.mimeType !== DOC_MIME || docs.has(file.name))
        throw new Error(`Missing, duplicate or non-native Agent Home document: ${file.name}`);
      docs.set(file.name, { id: file.id, name: file.name, modifiedTime: file.modifiedTime ?? "" });
    }
    pageToken = page.data.nextPageToken ?? undefined;
    if (pageToken) {
      if (seenTokens.has(pageToken)) throw new Error("Google Drive returned a repeated page token");
      seenTokens.add(pageToken);
    }
  } while (pageToken);
  for (const name of DEFAULT_DOCS)
    if (!docs.has(name)) throw new Error(`Required native Agent Home document missing: ${name}`);
  return docs;
}
export async function syncAgentHome(options: { dryRun?: boolean; seedReviewed?: string } = {}): Promise<void> {
  const root = resolve(required("APHRODY_AGENT_HOME")),
    rootFolderId = required("APHRODY_GOOGLE_DRIVE_FOLDER_ID");
  const privateRoot = join(homedir(), ".aphrody/drive-sync");
  const statePath = join(privateRoot, "dbfr-google-markdown.json"),
    lock = join(privateRoot, "dbfr-google-api.lock");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(
      await Bun.file(join(lock, "pid"))
        .text()
        .catch(() => "0"),
    );
    if (pid > 1) {
      try {
        process.kill(pid, 0);
        throw new Error("Google Drive sync is already running", { cause: error });
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      }
    }
    await rm(lock, { recursive: true });
    await mkdir(lock, { mode: 0o700 });
  }
  await Bun.write(join(lock, "pid"), `${process.pid}\n`, { mode: 0o600 });
  try {
    // A fresh worker may have no staged differences; its retrieval root is still indexable.
    if (!options.dryRun) await privateDirectory(join(privateRoot, "retrieval-markdown"));
    const state: State = (await Bun.file(statePath).exists())
      ? await Bun.file(statePath).json()
      : { version: 1, kind: "native-markdown-download-only", rootFolderId, files: {} };
    if (state.version !== 1 || state.kind !== "native-markdown-download-only" || state.rootFolderId !== rootFolderId)
      throw new Error("Native Markdown state scope mismatch");
    if (Object.keys(state.files).some(name => !DEFAULT_DOCS.has(name)))
      throw new Error("Native Markdown state contains out-of-scope entries");
    const service = await googleApi(),
      remote = await remoteDocs(service.drive, rootFolderId);
    const local = new Set(
      (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name),
    );
    const summary = {
      mode: state.kind,
      seeded: 0,
      unchanged: 0,
      localAhead: 0,
      staged: 0,
      unsupported: 0,
      uploaded: 0,
    };
    for (const name of AGENT_HOME_DEFAULT_DOCS) {
      const doc = remote.get(name)!;
      const native = (await service.docs.documents.get({ documentId: doc.id, includeTabsContent: true })).data;
      const nativeJson = JSON.stringify(native, null, 2);
      const localText = local.has(name) ? await Bun.file(join(root, name)).text() : "";
      const localHash = digest(localText);
      let remoteHash: string;
      try {
        remoteHash = digest(nativeMarkdown(native as NativeDocument));
      } catch {
        summary.unsupported++;
        if (!options.dryRun) {
          const directory = join(
            privateRoot,
            "incoming-native",
            `${name}-${digest(nativeJson).slice(0, 16)}-${localHash.slice(0, 16)}`,
          );
          await save(join(directory, "remote.native.json"), nativeJson + "\n");
          await save(join(directory, "local.md"), localText);
          const baseline = Bun.file(join(privateRoot, "markdown-reviewed-baseline", name));
          if (await baseline.exists()) await save(join(directory, "reviewed-baseline.md"), await baseline.text());
          await save(
            join(directory, "evidence.json"),
            JSON.stringify(
              {
                name,
                reason: "Unsupported native content retained for agent/A2A semantic review",
                localHash,
                activeMarkdownPreserved: true,
                googleDocsWrites: 0,
              },
              null,
              2,
            ) + "\n",
          );
        }
        continue;
      }
      if (options.seedReviewed) {
        if (!local.has(name)) throw new Error(`Reviewed local Markdown missing: ${name}`);
        const snapshot = await Bun.file(join(resolve(options.seedReviewed), name + ".json")).text();
        const baseline = {
          id: doc.id,
          localHash,
          remoteHash,
          remoteModifiedTime: doc.modifiedTime,
          ...reviewedSnapshotHashes(snapshot, remoteHash),
        };
        if (!options.dryRun) {
          await save(join(privateRoot, "markdown-reviewed-baseline", name), localText);
          await save(join(privateRoot, "markdown-reviewed-baseline", name + ".native.json"), snapshot);
          state.files[name] = baseline;
        }
        summary.seeded++;
        continue;
      }
      const previous = state.files[name];
      const action = projectionAction(previous?.id === doc.id ? previous : undefined, remoteHash, localHash);
      if (action === "unchanged") {
        summary.unchanged++;
        continue;
      }
      if (action === "local-ahead") {
        summary.localAhead++;
        continue;
      }
      summary.staged++;
      if (!options.dryRun) {
        const snapshot = `${name}-${remoteHash.slice(0, 16)}-${localHash.slice(0, 16)}`,
          directory = join(privateRoot, "incoming-markdown", snapshot);
        const candidate = projectionMarkdown(native as NativeDocument, localText);
        await save(join(directory, "remote.native.json"), nativeJson + "\n");
        await save(join(directory, "remote.candidate.md"), candidate);
        await save(join(directory, "local.md"), localText);
        const baseline = Bun.file(join(privateRoot, "markdown-reviewed-baseline", name));
        if (await baseline.exists()) await save(join(directory, "reviewed-baseline.md"), await baseline.text());
        await save(
          join(directory, "evidence.json"),
          JSON.stringify(
            {
              name,
              reason: "Agent/A2A semantic review required; no human approval requested",
              id: doc.id,
              remoteModifiedTime: doc.modifiedTime,
              localHash,
              remoteHash,
              baseline: previous ?? null,
              activeMarkdownPreserved: true,
              googleDocsWrites: 0,
            },
            null,
            2,
          ) + "\n",
        );
        await projectRetrievalCandidate(privateRoot, snapshot, candidate);
      }
    }
    if (!options.dryRun) await save(statePath, JSON.stringify(state, null, 2) + "\n");
    console.log(JSON.stringify(summary));
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
