import {
  BoxIcon,
  CrosshairIcon,
  DropletIcon,
  FilmIcon,
  GlobeIcon,
  GroupIcon,
  ImageIcon,
  ImagesIcon,
  MusicIcon,
  PenToolIcon,
  PencilIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { useExperimentalStore, useStoryboardPageEnabled } from "@storyteller/ui-settings-modal";
import { useTabStore, TabId } from "~/pages/Stores/TabState";

export type AppId =
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "EDIT"
  | "2D"
  | "3D"
  | "VIDEO_FRAME_EXTRACTOR"
  | "VIDEO_WATERMARK_REMOVAL"
  | "IMAGE_WATERMARK_REMOVAL"
  | "IMAGE_TO_3D_OBJECT"
  | "IMAGE_TO_3D_WORLD"
  | "REMOVE_BACKGROUND"
  | "ANGLES"
  | "STORYBOARD"
  | "BACKGROUND_CHANGE"
  | "VIDEO_EDITOR"
  | "MOODBOARD";

export interface AppDescriptor {
  id: AppId;
  label: string;
  icon: LucideIcon;
  imageSrc?: string;
  description?: string;
  large?: boolean;
}

export const APP_DESCRIPTORS: AppDescriptor[] = [
  {
    id: "IMAGE",
    label: "Create Image",
    icon: ImageIcon,
  },
  {
    id: "VIDEO",
    label: "Create Video",
    icon: FilmIcon,
  },
  {
    id: "AUDIO",
    label: "Create Audio",
    icon: MusicIcon,
  },
  {
    id: "2D",
    label: "Image Editor",
    icon: PenToolIcon,
    imageSrc: "/resources/gifs/2D_CANVAS_DEMO.webp",
    description: "Easy edits. Great for graphic design.",
    large: true,
  },
  {
    id: "3D",
    label: "3D Stage",
    icon: BoxIcon,
    imageSrc: "/resources/gifs/3D_CANVAS_DEMO.webp",
    description: "Precision control. Great for AI film.",
    large: true,
  },
];

export interface FullAppItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: "generate" | "edit";
  badge?: "NEW" | "BEST" | "SOON" | "BETA";
  action?: AppId;
  /** Legacy single-tone icon-square background (e.g. "bg-primary/40"). Still
   *  used as the fallback for the apps-page card styling. */
  color?: string;
}

// Per-app card palette for the Apps page (webapp-home-style cards). Derived
// from each app's Tailwind color family so the icon tile, its border, and the
// hover state all share a hue. Keyed by app id; falls back to a neutral tone
// when an id is missing.
interface AppCardPalette {
  /** Hover tint for the card, e.g. "from-primary/20 to-primary/0". Legacy. */
  accent: string;
  /** Icon tile background + border, e.g. "bg-primary/20 border-primary/40". */
  iconBg: string;
  /** Icon glyph color, e.g. "text-primary". */
  iconColor: string;
  /** Card hover border + background, e.g. "hover:border-primary/60 hover:bg-primary/10". */
  hoverStyle: string;
}

const APP_CARD_PALETTES: Record<string, AppCardPalette> = {
  "text-to-image": {
    accent: "from-primary/20 to-primary/0",
    iconBg: "bg-primary/20 border-primary/40",
    iconColor: "text-primary",
    hoverStyle: "hover:border-primary/60 hover:bg-primary/10",
  },
  "image-to-video": {
    accent: "from-tertiary/20 to-tertiary/0",
    iconBg: "bg-tertiary/20 border-tertiary/40",
    iconColor: "text-tertiary",
    hoverStyle: "hover:border-tertiary/60 hover:bg-tertiary/10",
  },
  "create-audio": {
    accent: "from-tertiary/20 to-tertiary/0",
    iconBg: "bg-tertiary/20 border-tertiary/40",
    iconColor: "text-tertiary",
    hoverStyle: "hover:border-tertiary/60 hover:bg-tertiary/10",
  },
  "image-to-3d-object": {
    accent: "from-tertiary/20 to-tertiary/0",
    iconBg: "bg-tertiary/20 border-tertiary/40",
    iconColor: "text-tertiary",
    hoverStyle: "hover:border-tertiary/60 hover:bg-tertiary/10",
  },
  "image-to-3d-world": {
    accent: "from-success/20 to-success/0",
    iconBg: "bg-success/20 border-success/40",
    iconColor: "text-success",
    hoverStyle: "hover:border-success/60 hover:bg-success/10",
  },
  "3d-editor": {
    accent: "from-warning/20 to-warning/0",
    iconBg: "bg-warning/20 border-warning/40",
    iconColor: "text-warning",
    hoverStyle: "hover:border-warning/60 hover:bg-warning/10",
  },
  "background-change": {
    accent: "from-success/20 to-success/0",
    iconBg: "bg-success/20 border-success/40",
    iconColor: "text-success",
    hoverStyle: "hover:border-success/60 hover:bg-success/10",
  },
  "video-editor": {
    accent: "from-error/20 to-error/0",
    iconBg: "bg-error/20 border-error/40",
    iconColor: "text-error",
    hoverStyle: "hover:border-error/60 hover:bg-error/10",
  },
  moodboard: {
    accent: "from-primary/20 to-primary/0",
    iconBg: "bg-primary/20 border-primary/40",
    iconColor: "text-primary",
    hoverStyle: "hover:border-primary/60 hover:bg-primary/10",
  },
  "video-frame-extractor": {
    accent: "from-warning/20 to-warning/0",
    iconBg: "bg-warning/20 border-warning/40",
    iconColor: "text-warning",
    hoverStyle: "hover:border-warning/60 hover:bg-warning/10",
  },
  "edit-image": {
    accent: "from-primary/20 to-primary/0",
    iconBg: "bg-primary/20 border-primary/40",
    iconColor: "text-primary",
    hoverStyle: "hover:border-primary/60 hover:bg-primary/10",
  },
  "2d-canvas": {
    accent: "from-primary/20 to-primary/0",
    iconBg: "bg-primary/20 border-primary/40",
    iconColor: "text-primary",
    hoverStyle: "hover:border-primary/60 hover:bg-primary/10",
  },
  "remove-background": {
    accent: "from-tertiary/20 to-tertiary/0",
    iconBg: "bg-tertiary/20 border-tertiary/40",
    iconColor: "text-tertiary",
    hoverStyle: "hover:border-tertiary/60 hover:bg-tertiary/10",
  },
  angles: {
    accent: "from-success/20 to-success/0",
    iconBg: "bg-success/20 border-success/40",
    iconColor: "text-success",
    hoverStyle: "hover:border-success/60 hover:bg-success/10",
  },
  storyboard: {
    accent: "from-tertiary/20 to-tertiary/0",
    iconBg: "bg-tertiary/20 border-tertiary/40",
    iconColor: "text-tertiary",
    hoverStyle: "hover:border-tertiary/60 hover:bg-tertiary/10",
  },
  "video-watermark-removal": {
    accent: "from-warning/20 to-warning/0",
    iconBg: "bg-warning/20 border-warning/40",
    iconColor: "text-warning",
    hoverStyle: "hover:border-warning/60 hover:bg-warning/10",
  },
  "image-watermark-removal": {
    accent: "from-error/20 to-error/0",
    iconBg: "bg-error/20 border-error/40",
    iconColor: "text-error",
    hoverStyle: "hover:border-error/60 hover:bg-error/10",
  },
};

const FALLBACK_APP_CARD_PALETTE: AppCardPalette = {
  accent: "from-on-surface/10 to-on-surface/0",
  iconBg: "bg-ui-controls border-ui-controls-border",
  iconColor: "text-base-fg",
  hoverStyle: "hover:border-outline hover:bg-on-surface/10",
};

export const getAppCardPalette = (id: string): AppCardPalette => APP_CARD_PALETTES[id] ?? FALLBACK_APP_CARD_PALETTE;

export const ALL_APPS: FullAppItem[] = [
  {
    id: "text-to-image",
    label: "Create Image",
    description: "Generate AI images",
    icon: ImageIcon,
    category: "generate",
    action: "IMAGE",
    color: "bg-primary/40",
  },
  {
    id: "image-to-video",
    label: "Create Video",
    description: "Create video from images",
    icon: FilmIcon,
    category: "generate",
    action: "VIDEO",
    color: "bg-warning/40",
  },
  {
    id: "create-audio",
    label: "Create Audio",
    description: "Generate music and sound effects",
    icon: MusicIcon,
    category: "generate",
    action: "AUDIO",
    color: "bg-tertiary/40",
  },
  {
    id: "image-to-3d-object",
    label: "Image to 3D Object",
    description: "Convert references into textured assets",
    icon: BoxIcon,
    category: "generate",
    action: "IMAGE_TO_3D_OBJECT",
    color: "bg-success/40",
  },
  {
    id: "image-to-3d-world",
    label: "Image to 3D World",
    description: "Turn mood boards into explorable worlds",
    icon: GlobeIcon,
    category: "generate",
    action: "IMAGE_TO_3D_WORLD",
    color: "bg-primary/40",
  },
  {
    id: "edit-image",
    label: "Edit Image",
    description: "Change with inpainting",
    icon: PencilIcon,
    category: "edit",
    action: "2D",
    color: "bg-tertiary/40",
  },
  {
    id: "video-frame-extractor",
    label: "Video Frame Extractor",
    description: "Extract frames from video",
    icon: ImagesIcon,
    category: "edit",
    action: "VIDEO_FRAME_EXTRACTOR",
    color: "bg-error/40",
  },
  {
    id: "video-watermark-removal",
    label: "Video Watermark Remover",
    description: "Remove watermarks from videos",
    icon: DropletIcon,
    category: "edit",
    badge: "SOON",
    color: "bg-tertiary/40",
  },
  {
    id: "image-watermark-removal",
    label: "Image Watermark Remover",
    description: "Remove watermarks from images",
    icon: DropletIcon,
    category: "edit",
    badge: "SOON",
    color: "bg-primary/40",
  },
  {
    id: "remove-background",
    label: "Remove Background",
    description: "Remove backgrounds from images",
    icon: WandSparklesIcon,
    category: "edit",
    action: "REMOVE_BACKGROUND",
    color: "bg-tertiary/40",
  },
  {
    id: "angles",
    label: "Angles",
    description: "Generate new camera angles from a single photo",
    icon: CrosshairIcon,
    category: "generate",
    action: "ANGLES",
    color: "bg-success/40",
    badge: "NEW",
  },

  {
    id: "storyboard",
    label: "Storyboard",
    description: "Plan your shots with a visual storyboard",
    icon: ImagesIcon,
    category: "generate",
    action: "STORYBOARD",
    color: "bg-tertiary/40",
    badge: "NEW",
  },
  {
    id: "moodboard",
    label: "Moodboard",
    description: "Collect references and steer generations from a board",
    icon: GroupIcon,
    category: "generate",
    action: "MOODBOARD",
    color: "bg-warning/40",
    badge: "BETA",
  },
  {
    id: "background-change",
    label: "Background Change",
    description: "Swap the backdrop of a video using a reference image",
    icon: SparklesIcon,
    category: "edit",
    action: "BACKGROUND_CHANGE",
    color: "bg-warning/40",
    badge: "NEW",
  },
  {
    id: "video-editor",
    label: "Video Editor",
    description: "Edit and assemble videos on a timeline",
    icon: FilmIcon,
    category: "edit",
    action: "VIDEO_EDITOR",
    color: "bg-success/40",
    badge: "BETA",
  },
  {
    id: "2d-canvas",
    label: "Image Editor",
    description: "Easy edits. Great for graphic design.",
    icon: PenToolIcon,
    category: "edit",
    action: "2D",
    color: "bg-primary/40",
  },
  {
    id: "3d-editor",
    label: "3D Stage",
    description: "Precision control. Great for AI film.",
    icon: BoxIcon,
    category: "generate",
    action: "3D",
    color: "bg-success/40",
  },
];

export const GENERATE_APPS = ALL_APPS.filter(app => app.category === "generate");
export const EDIT_APPS = ALL_APPS.filter(app => app.category === "edit");

export const useVisibleApps = (): FullAppItem[] => {
  const storyboardEnabled = useStoryboardPageEnabled();
  return useMemo(
    () =>
      ALL_APPS.filter(app => {
        // Background Change is hidden in the desktop app for now.
        if (app.action === "BACKGROUND_CHANGE") return false;
        if (app.action === "STORYBOARD") return storyboardEnabled;
        return true;
      }),
    [storyboardEnabled],
  );
};

export const useGenerateApps = (): FullAppItem[] => {
  const visible = useVisibleApps();
  return useMemo(() => visible.filter(app => app.category === "generate"), [visible]);
};

export const useEditApps = (): FullAppItem[] => {
  const visible = useVisibleApps();
  return useMemo(() => visible.filter(app => app.category === "edit"), [visible]);
};

export const getBadgeStyles = (badge?: string) => {
  switch (badge) {
    case "NEW":
      return "border-tertiary/40 text-tertiary";
    case "BEST":
      return "border-primary/30 text-ui-accent-ink";
    case "SOON":
      return "border-outline-variant text-base-fg/50";
    case "BETA":
      return "border-warning/40 text-warning";
    default:
      return "";
  }
};

export const goToApp = (action?: string) => {
  if (
    action &&
    [
      "IMAGE",
      "VIDEO",
      "AUDIO",
      "2D",
      "3D",
      "VIDEO_FRAME_EXTRACTOR",
      "VIDEO_WATERMARK_REMOVAL",
      "IMAGE_WATERMARK_REMOVAL",
      "IMAGE_TO_3D_OBJECT",
      "IMAGE_TO_3D_WORLD",
      "REMOVE_BACKGROUND",
      "ANGLES",
      "STORYBOARD",
      "BACKGROUND_CHANGE",
      "VIDEO_EDITOR",
      "MOODBOARD",
    ].includes(action)
  ) {
    if (action === "STORYBOARD") {
      const { enabled, storyboardPageEnabled } = useExperimentalStore.getState();
      if (!enabled || !storyboardPageEnabled) return;
    }
    useTabStore.getState().setActiveTab(action as TabId);
  }
};
