import type { MentionItem } from "./MentionTextarea";

// design:content: @-mention highlight hues. Each hue identifies one reference
// (image, video, audio or character) across the prompt and its thumbnails,
// like chart series, so they are data colours rather than theme roles.
const IMAGE_COLORS = [
  "rgb(96, 165, 250)", // design:content
  "rgb(251, 146, 60)", // design:content
  "rgb(167, 139, 250)", // design:content
  "rgb(52, 211, 153)", // design:content
  "rgb(251, 113, 133)", // design:content
];

const VIDEO_COLORS = ["rgb(250, 204, 21)", "rgb(245, 158, 11)", "rgb(74, 222, 128)"]; // design:content

const AUDIO_COLORS = ["rgb(192, 132, 252)", "rgb(232, 121, 249)"]; // design:content

const CHARACTER_COLORS = [
  "rgb(45, 212, 191)", // design:content: teal
  "rgb(34, 197, 94)", // design:content: emerald
  "rgb(14, 165, 233)", // design:content: sky
];

/** The highlight hue of a mention, or undefined when the label is not a known reference. */
export function getMentionColor(label: string, mentionItems?: MentionItem[]): string | undefined {
  const imgMatch = label.match(/^@Image(\d+)$/);
  if (imgMatch) return IMAGE_COLORS[(parseInt(imgMatch[1]) - 1) % IMAGE_COLORS.length];
  const vidMatch = label.match(/^@Video(\d+)$/);
  if (vidMatch) return VIDEO_COLORS[(parseInt(vidMatch[1]) - 1) % VIDEO_COLORS.length];
  const audMatch = label.match(/^@Audio(\d+)$/);
  if (audMatch) return AUDIO_COLORS[(parseInt(audMatch[1]) - 1) % AUDIO_COLORS.length];
  // Character mentions: match by name from mentionItems
  if (mentionItems) {
    const charItems = mentionItems.filter(m => m.type === "character");
    const idx = charItems.findIndex(m => m.label === label);
    if (idx !== -1) return CHARACTER_COLORS[idx % CHARACTER_COLORS.length];
  }
  return undefined;
}

export function buildMentionColorMap(mentionItems?: MentionItem[]): Record<string, string> {
  if (!mentionItems?.length) return {};
  const map: Record<string, string> = {};
  for (const item of mentionItems) {
    const color = getMentionColor(item.label, mentionItems);
    if (color) map[item.label] = color;
  }
  return map;
}
