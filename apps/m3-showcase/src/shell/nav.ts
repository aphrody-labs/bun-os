// Destinations of the showcase: one per group of packages, each with the packages it demonstrates.
import appsIcon from "m3:icons/apps";
import appsFilled from "m3:icons/apps?fill=1";
import badgeIcon from "m3:icons/badge";
import badgeFilled from "m3:icons/badge?fill=1";
import designIcon from "m3:icons/design_services";
import designFilled from "m3:icons/design_services?fill=1";
import devicesIcon from "m3:icons/devices";
import devicesFilled from "m3:icons/devices?fill=1";
import editIcon from "m3:icons/edit_note";
import editFilled from "m3:icons/edit_note?fill=1";
import folderIcon from "m3:icons/folder";
import folderFilled from "m3:icons/folder?fill=1";
import homeIcon from "m3:icons/home";
import homeFilled from "m3:icons/home?fill=1";
import motionIcon from "m3:icons/animation";
import motionFilled from "m3:icons/animation?fill=1";
import paletteIcon from "m3:icons/palette";
import paletteFilled from "m3:icons/palette?fill=1";
import readerIcon from "m3:icons/menu_book";
import readerFilled from "m3:icons/menu_book?fill=1";
import smartIcon from "m3:icons/smart_toy";
import smartFilled from "m3:icons/smart_toy?fill=1";
import symbolsIcon from "m3:icons/interests";
import symbolsFilled from "m3:icons/interests?fill=1";
import terminalIcon from "m3:icons/terminal";
import terminalFilled from "m3:icons/terminal?fill=1";
import webIcon from "m3:icons/web";
import webFilled from "m3:icons/web?fill=1";
import widgetsIcon from "m3:icons/widgets";
import widgetsFilled from "m3:icons/widgets?fill=1";
import extensionIcon from "m3:icons/extension";
import extensionFilled from "m3:icons/extension?fill=1";

import type { PageId } from "../pages/index.ts";

export interface Destination {
  id: PageId;
  label: string;
  /** Outlined and filled (selected) Material Symbols SVG markup. */
  icon: string;
  iconFilled: string;
  /** What the page shows, one sentence. */
  summary: string;
  /** The workspace packages the page imports and exercises. */
  packages: readonly string[];
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "overview",
    label: "Overview",
    icon: homeIcon,
    iconFilled: homeFilled,
    summary: "Every package of the monorepo, served by this app's own API.",
    packages: ["@aphrody/m3", "@aphrody/m3-bun", "@aphrody/m3-config"],
  },
  {
    id: "theme",
    label: "Theme",
    icon: paletteIcon,
    iconFilled: paletteFilled,
    summary:
      "Material You roles from a seed: tokens, Tailwind preset, fonts, a scoped <m3-theme>.",
    packages: [
      "@aphrody/m3-theme",
      "@aphrody/m3-tokens",
      "@aphrody/m3-front",
      "@aphrody/m3-tailwind",
      "@aphrody/m3-fonts",
    ],
  },
  {
    id: "components",
    label: "Components",
    icon: widgetsIcon,
    iconFilled: widgetsFilled,
    summary: "The Material Web components through their React wrappers.",
    packages: ["@aphrody/m3-react"],
  },
  {
    id: "primitives",
    label: "Primitives",
    icon: extensionIcon,
    iconFilled: extensionFilled,
    summary: "Accessible parts on Base UI, styled with M3 tokens.",
    packages: ["@aphrody/m3-primitives", "@aphrody/m3-baseui"],
  },
  {
    id: "forms",
    label: "Forms",
    icon: editIcon,
    iconFilled: editFilled,
    summary:
      "react-hook-form fields with M3 inputs, validation and descriptions.",
    packages: ["@aphrody/m3-forms"],
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: folderIcon,
    iconFilled: folderFilled,
    summary: "A file explorer: list and grid views, thumbnails, tags, rename.",
    packages: ["@aphrody/m3-explorer"],
  },
  {
    id: "motion",
    label: "Motion",
    icon: motionIcon,
    iconFilled: motionFilled,
    summary:
      "Springs, easings, shared axis, container transform, list stagger.",
    packages: ["@aphrody/m3-motion", "@aphrody/m3-react"],
  },
  {
    id: "icons",
    label: "Icons & fonts",
    icon: symbolsIcon,
    iconFilled: symbolsFilled,
    summary:
      "Material Symbols from the forked catalogue, inlined at build time.",
    packages: [
      "@aphrody/m3-icons",
      "@aphrody/material-design-icons",
      "@aphrody/m3-fonts",
    ],
  },
  {
    id: "ai",
    label: "AI",
    icon: smartIcon,
    iconFilled: smartFilled,
    summary:
      "A chat transcript, tool calls, markdown and an AG-UI stream from the API.",
    packages: ["@aphrody/m3-ai", "@aphrody/ag-ui"],
  },
  {
    id: "reader",
    label: "Reader",
    icon: readerIcon,
    iconFilled: readerFilled,
    summary: "Manga and databook readers with paging, vertical scroll and RTL.",
    packages: ["@aphrody/m3-reader"],
  },
  {
    id: "design",
    label: "Design",
    icon: designIcon,
    iconFilled: designFilled,
    summary:
      "A design brief parsed and turned into an M3 theme by the design engine.",
    packages: ["@aphrody/m3-design"],
  },
  {
    id: "next",
    label: "Next",
    icon: webIcon,
    iconFilled: webFilled,
    summary:
      "Metadata, scheme CSS, robots, sitemap and JSON-LD from the Next integration.",
    packages: ["@aphrody/m3-next", "@aphrody/m3-next-migrate"],
  },
  {
    id: "system",
    label: "System",
    icon: terminalIcon,
    iconFilled: terminalFilled,
    summary:
      "OS themes, scaffolds, MCP tools, codemods and lint rules, computed by the API.",
    packages: [
      "@aphrody/m3-os-themes",
      "@aphrody/scaffold",
      "@aphrody/m3-mcp",
      "@aphrody/m3-codemods",
      "@aphrody/eslint-plugin-m3",
    ],
  },
  {
    id: "brands",
    label: "Brands",
    icon: badgeIcon,
    iconFilled: badgeFilled,
    summary:
      "Host-bound UI kits where they resolve, the identity set, canvas and assets.",
    packages: [
      "@aphrody/nie-ui",
      "@aphrody/identity",
      "@aphrody/canvas",
      "@aphrody/assets",
    ],
  },
  {
    id: "adaptive",
    label: "Adaptive",
    icon: devicesIcon,
    iconFilled: devicesFilled,
    summary: "Window size classes, layout modes and the TV D-pad lab.",
    packages: ["@aphrody/m3-tokens", "@aphrody/m3-front"],
  },
];

/** The destinations the mobile bottom bar shows; the rest sit behind "More". */
export const PRIMARY_IDS = [
  "overview",
  "theme",
  "components",
  "adaptive",
] as const;

export const MORE_ICON = appsIcon;
export const MORE_ICON_FILLED = appsFilled;

export const findDestination = (id: string): Destination =>
  DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0]!;
