// SPDX-License-Identifier: Apache-2.0
// Typed turn input items (text, file, image, link) built from chat text and attachment paths or URLs.

export const AUDIO_VIDEO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "aac",
  "wma",
  "mp4",
  "mkv",
  "mov",
  "webm",
  "avi",
  "wmv",
  "m4v",
]);

/**
 * Classifies an attachment into image, text/code, audio/video, or link.
 */
export type AttachmentKind = "image" | "audio_video" | "link" | "file";

export interface TurnInputItem {
  type: "text" | "file" | "image" | "link";
  text?: string;
  path?: string;
  url?: string;
  mediaType?: string;
}

export function classifyAttachment(pathOrUrl: string): {
  kind: AttachmentKind;
  extension?: string;
  isUrl: boolean;
} {
  const trimmed = pathOrUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { kind: "link", isUrl: true };
  }

  const ext = trimmed.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "heic"].includes(ext)) {
    return { kind: "image", extension: ext, isUrl: false };
  }
  if (AUDIO_VIDEO_EXTENSIONS.has(ext)) {
    return { kind: "audio_video", extension: ext, isUrl: false };
  }
  return { kind: "file", extension: ext, isUrl: false };
}

/**
 * Transforms user text and raw attachment paths/URLs into typed turn input items
 * compatible with the broker, local models (vision / audio / files), and JSON-RPC app-server.
 */
export function buildTurnInputItems(text: string, attachments: string[] = []): TurnInputItem[] {
  const items: TurnInputItem[] = [];

  if (text.trim()) {
    items.push({ type: "text", text: text.trim() });
  }

  for (const att of attachments) {
    const classified = classifyAttachment(att);
    if (classified.isUrl) {
      items.push({ type: "link", url: att.trim() });
    } else if (classified.kind === "image") {
      items.push({
        type: "image",
        path: att,
        mediaType: `image/${classified.extension === "jpg" ? "jpeg" : classified.extension}`,
      });
    } else {
      items.push({ type: "file", path: att });
    }
  }

  return items;
}
