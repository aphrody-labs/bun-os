import type { TrackType } from "../types";

// The waveform is chrome drawn on a canvas: the canvas carries this role class
// and the renderer paints with its computed `color`.
export const TIMELINE_AUDIO_WAVEFORM_CLASS = "text-on-surface-variant";

// design:content: the clip-type hues identify each track kind on the timeline
// (document data, like chart series). The label ink and the header fade sit on
// those hues and on arbitrary video frames, so they stay fixed too.
export const TIMELINE_TRACK_THEME: Record<
  TrackType,
  {
    elementClassName: string;
  }
> = {
  video: { elementClassName: "transparent" },
  text: { elementClassName: "bg-[#5DBAA0]" }, // design:content
  audio: { elementClassName: "bg-[#8F5DBA]" }, // design:content
  graphic: { elementClassName: "bg-[#BA5D7A]" }, // design:content
  effect: { elementClassName: "bg-[#5d93ba]" }, // design:content
} as const;
export const TIMELINE_CLIP_INK_CLASS = "text-white"; // design:content
export const TIMELINE_CLIP_SUBTLE_INK_CLASS = "text-white/75"; // design:content
export const TIMELINE_CLIP_FADE_CLASS = "from-black/30"; // design:content

export const SELECTED_TRACK_ROW_CLASS = "bg-accent/50";
export const DEFAULT_TIMELINE_BOOKMARK_COLOR = "#009dff"; // design:content: default marker colour stored on a new bookmark

export function getTimelineElementClassName({ type }: { type: TrackType }): string {
  return TIMELINE_TRACK_THEME[type].elementClassName.trim();
}
