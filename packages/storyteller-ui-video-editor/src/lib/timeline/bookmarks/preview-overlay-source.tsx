import type { Bookmark } from "../types";
import {
  EMPTY_PREVIEW_OVERLAY_SOURCE_RESULT,
  type PreviewOverlayDefinition,
  type PreviewOverlaySourceResult,
} from "../../preview/overlays";
import { getBookmarksActiveAtTime } from "./utils";
import type { MediaTime } from "../../wasm";

export const bookmarkNotesPreviewOverlay: PreviewOverlayDefinition = {
  id: "bookmark-notes",
  label: "Show bookmark notes",
  defaultVisible: true,
};

function BookmarkNotesOverlay({ bookmarks }: { bookmarks: Array<{ time: MediaTime; note: string; color?: string }> }) {
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {bookmarks.map(bookmark => (
        <div
          key={bookmark.time}
          className="flex max-w-[min(200px,50vw)] px-2.5 py-1.5 text-left text-on-surface text-xs bg-surface/70 shadow-md"
          style={{
            borderLeft: bookmark.color ? `3px solid ${bookmark.color}` : "3px solid var(--md-sys-color-primary)",
          }}
        >
          {bookmark.note}
        </div>
      ))}
    </div>
  );
}

export function getBookmarkPreviewOverlaySource({
  bookmarks,
  time,
  isVisible,
}: {
  bookmarks: Bookmark[];
  time: MediaTime;
  isVisible: boolean;
}): PreviewOverlaySourceResult {
  const bookmarksWithNotes = getBookmarksActiveAtTime({
    bookmarks,
    time,
  }).flatMap(bookmark => {
    if (bookmark.note == null || bookmark.note.trim() === "") {
      return [];
    }

    return [
      {
        time: bookmark.time,
        note: bookmark.note,
        color: bookmark.color,
      },
    ];
  });

  if (!isVisible || bookmarksWithNotes.length === 0) {
    return {
      ...EMPTY_PREVIEW_OVERLAY_SOURCE_RESULT,
      definitions: [bookmarkNotesPreviewOverlay],
    };
  }

  return {
    definitions: [bookmarkNotesPreviewOverlay],
    instances: [
      {
        id: bookmarkNotesPreviewOverlay.id,
        mount: { kind: "hud", anchor: "top-left", order: 0 },
        plane: "over-interaction",
        pointerEvents: "none",
        render: () => <BookmarkNotesOverlay bookmarks={bookmarksWithNotes} />,
      },
    ],
  };
}
