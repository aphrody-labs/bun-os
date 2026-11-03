// SPDX-License-Identifier: Apache-2.0
// Bun OS icon theme: one mapping from desktop concepts (known folders, file types, drives, apps, actions, status) to
// Material Symbols (vendor/material-design-icons, Apache-2.0), composed into full-colour M3 icons from the theme roles,
// and laid out for Windows (.ico + resource DLL ordinals + shell/registry mapping) and freedesktop (index.theme for
// COSMIC, GNOME and Hyprland). Pure: SVG strings and plans only; rendering is `bunos-design render`.
import { Hct, argbFromHex, hexFromArgb } from "@aphrody/m3-tokens/dynamic-color";
import { harmonize } from "./chrome.ts";

export type Kind = "folder" | "file" | "drive" | "app" | "glyph";
export interface IconDef {
  /** Stable id: Windows ICO file name and DLL resource name (`BUNOS_<ID>`). */
  id: string;
  kind: Kind;
  symbol: string;
  /** Hue family the colours come from. */
  hue: Hue;
  label: string;
  /** Windows: shell icon index (HKLM ...\Explorer\Shell Icons), known folder, extensions, drive type. */
  win?: { shellIndex?: number[]; knownFolder?: string; extensions?: string[]; drive?: string; app?: string };
  /** freedesktop names (context/name), e.g. `places/folder-download`. */
  xdg?: string[];
}

export type Hue =
  "primary" | "secondary" | "tertiary" | "neutral" | "blue" | "green" | "orange" | "red" | "purple" | "teal" | "pink";
/** Fixed hue families of file-type and folder artwork (content badges, not chrome). */
// design:content
const FIXED: Record<string, string> = {
  blue: "#3b6fd6",
  green: "#2f8f4e",
  orange: "#d9731a",
  red: "#d13b3b",
  purple: "#8a4fd0",
  teal: "#1d8f8f",
  pink: "#c94f8a",
};

const F = (
  id: string,
  symbol: string,
  label: string,
  knownFolder: string | undefined,
  xdg: string[],
  hue: Hue = "primary",
): IconDef => ({
  id,
  kind: "folder",
  symbol,
  hue,
  label,
  win: knownFolder ? { knownFolder } : {},
  xdg,
});
const T = (id: string, symbol: string, hue: Hue, label: string, extensions: string[], xdg: string[]): IconDef => ({
  id,
  kind: "file",
  symbol,
  hue,
  label,
  win: { extensions },
  xdg,
});
const D = (id: string, symbol: string, label: string, drive: string, shellIndex: number[], xdg: string[]): IconDef => ({
  id,
  kind: "drive",
  symbol,
  hue: "neutral",
  label,
  win: { drive, shellIndex },
  xdg,
});
const A = (id: string, symbol: string, hue: Hue, label: string, xdg: string[]): IconDef => ({
  id,
  kind: "app",
  symbol,
  hue,
  label,
  win: { app: id },
  xdg,
});
const G = (id: string, symbol: string, xdg: string[]): IconDef => ({
  id,
  kind: "glyph",
  symbol,
  hue: "neutral",
  label: id,
  xdg,
});

export const ICONS: readonly IconDef[] = [
  // Folders (Windows known folders by KNOWNFOLDERID name; shell index 3/4 = generic closed/open folder).
  {
    ...F("folder", "folder", "Folder", undefined, ["places/folder", "places/inode-directory"]),
    win: { shellIndex: [3] },
  },
  {
    ...F("folder-open", "folder_open", "Open folder", undefined, ["places/folder-open", "status/folder-open"]),
    win: { shellIndex: [4] },
  },
  F("folder-desktop", "desktop_windows", "Desktop", "Desktop", ["places/user-desktop", "places/folder-desktop"]),
  F("folder-documents", "description", "Documents", "Documents", ["places/folder-documents"]),
  F("folder-downloads", "download", "Downloads", "Downloads", ["places/folder-download"]),
  F("folder-music", "music_note", "Music", "Music", ["places/folder-music"]),
  F("folder-pictures", "image", "Pictures", "Pictures", ["places/folder-pictures"]),
  F("folder-videos", "movie", "Videos", "Videos", ["places/folder-videos"]),
  F("folder-home", "home", "Home", "Profile", ["places/user-home", "places/folder-home"]),
  F("folder-screenshots", "screenshot_monitor", "Screenshots", "Screenshots", ["places/folder-screenshots"]),
  F("folder-saved-games", "sports_esports", "Saved Games", "SavedGames", ["places/folder-games"]),
  F("folder-favorites", "star", "Favorites", "Favorites", ["places/folder-favorites"]),
  F("folder-links", "link", "Links", "Links", ["places/folder-links"]),
  F("folder-contacts", "contacts", "Contacts", "Contacts", ["places/folder-contacts"]),
  F("folder-camera-roll", "photo_camera", "Camera Roll", "CameraRoll", ["places/folder-camera"]),
  F("folder-projects", "code", "Projects", undefined, ["places/folder-development", "places/folder-code"]),
  F("folder-templates", "draft", "Templates", "Templates", ["places/folder-templates"]),
  F("folder-public", "public", "Public", "Public", ["places/folder-publicshare"]),
  F("folder-cloud", "cloud", "Cloud", "SkyDrive", ["places/folder-cloud", "places/folder-remote"]),
  F("folder-network", "lan", "Network folder", undefined, ["places/folder-remote", "places/network-workgroup"]),
  F("folder-archive", "folder_zip", "Archive", undefined, ["places/folder-tar"]),
  {
    ...F("trash-empty", "delete", "Recycle Bin (empty)", undefined, ["places/user-trash"], "neutral"),
    win: { shellIndex: [31] },
  },
  {
    ...F(
      "trash-full",
      "delete_sweep",
      "Recycle Bin (full)",
      undefined,
      ["places/user-trash-full", "status/user-trash-full"],
      "neutral",
    ),
    win: { shellIndex: [32] },
  },
  // File types.
  {
    ...T(
      "file-generic",
      "draft",
      "neutral",
      "File",
      [],
      ["mimetypes/text-x-generic", "mimetypes/application-octet-stream"],
    ),
    win: { shellIndex: [0, 1] },
  },
  T(
    "file-text",
    "description",
    "blue",
    "Text document",
    [".txt", ".md", ".rtf", ".log"],
    ["mimetypes/text-plain", "mimetypes/text-markdown"],
  ),
  T("file-pdf", "picture_as_pdf", "red", "PDF document", [".pdf"], ["mimetypes/application-pdf"]),
  T(
    "file-image",
    "image",
    "purple",
    "Image",
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".heic"],
    ["mimetypes/image-x-generic"],
  ),
  T(
    "file-audio",
    "music_note",
    "pink",
    "Audio",
    [".mp3", ".flac", ".ogg", ".opus", ".wav", ".m4a"],
    ["mimetypes/audio-x-generic"],
  ),
  T("file-video", "movie", "orange", "Video", [".mp4", ".mkv", ".webm", ".mov", ".avi"], ["mimetypes/video-x-generic"]),
  T(
    "file-archive",
    "folder_zip",
    "orange",
    "Archive",
    [".zip", ".7z", ".tar", ".gz", ".zst", ".xz", ".rar"],
    ["mimetypes/package-x-generic", "mimetypes/application-zip"],
  ),
  T(
    "file-code",
    "code",
    "teal",
    "Source code",
    [".rs", ".ts", ".tsx", ".js", ".mjs", ".py", ".c", ".cpp", ".h", ".go", ".kt", ".java", ".dart", ".zig"],
    ["mimetypes/text-x-script", "mimetypes/text-x-source"],
  ),
  T(
    "file-data",
    "data_object",
    "teal",
    "Data",
    [".json", ".toml", ".yaml", ".yml", ".xml", ".ron", ".ini"],
    ["mimetypes/application-json", "mimetypes/text-x-generic-template"],
  ),
  T("file-web", "html", "blue", "Web page", [".html", ".htm", ".css"], ["mimetypes/text-html"]),
  T(
    "file-script",
    "terminal",
    "green",
    "Script",
    [".sh", ".ps1", ".nu", ".bat", ".cmd"],
    ["mimetypes/application-x-shellscript"],
  ),
  T(
    "file-exe",
    "deployed_code",
    "primary",
    "Application",
    [".exe", ".msi", ".msix", ".appx"],
    ["mimetypes/application-x-executable", "mimetypes/application-x-msdownload"],
  ),
  T(
    "file-disc",
    "album",
    "neutral",
    "Disc image",
    [".iso", ".img", ".vhdx", ".erofs"],
    ["mimetypes/application-x-cd-image"],
  ),
  T("file-font", "font_download", "purple", "Font", [".ttf", ".otf", ".woff2", ".ttc"], ["mimetypes/font-x-generic"]),
  T(
    "file-database",
    "database",
    "secondary",
    "Database",
    [".db", ".sqlite", ".sqlite3"],
    ["mimetypes/application-vnd.sqlite3"],
  ),
  T("file-sheet", "table", "green", "Spreadsheet", [".csv", ".xlsx", ".ods"], ["mimetypes/x-office-spreadsheet"]),
  T("file-doc", "article", "blue", "Document", [".doc", ".docx", ".odt"], ["mimetypes/x-office-document"]),
  T(
    "file-slides",
    "slideshow",
    "orange",
    "Presentation",
    [".ppt", ".pptx", ".odp"],
    ["mimetypes/x-office-presentation"],
  ),
  T(
    "file-apk",
    "android",
    "green",
    "Android package",
    [".apk", ".aab", ".xapk"],
    ["mimetypes/application-vnd.android.package-archive"],
  ),
  T(
    "file-key",
    "key",
    "secondary",
    "Key or certificate",
    [".pem", ".crt", ".cer", ".key", ".pfx"],
    ["mimetypes/application-pkcs8"],
  ),
  // Drives (shell index: 7 removable, 8 fixed, 9 network, 11 CD-ROM, 12 RAM disk, 15 computer).
  D(
    "drive-fixed",
    "hard_drive",
    "Local disk",
    "fixed",
    [8],
    ["devices/drive-harddisk", "devices/drive-harddisk-system"],
  ),
  D(
    "drive-removable",
    "usb",
    "Removable disk",
    "removable",
    [7],
    ["devices/drive-removable-media", "devices/drive-removable-media-usb"],
  ),
  D("drive-optical", "album", "Optical drive", "cdrom", [11], ["devices/drive-optical", "devices/media-optical"]),
  D("drive-network", "lan", "Network drive", "network", [9], ["places/network-server", "devices/network-wired"]),
  D("drive-ram", "memory", "RAM disk", "ram", [12], ["devices/drive-harddisk-solidstate"]),
  D("drive-sd", "sd_card", "Memory card", "removable", [], ["devices/media-flash"]),
  D("computer", "computer", "This PC", "computer", [15], ["devices/computer", "places/computer"]),
  // Bun OS apps (Start, taskbar, dock, launcher).
  A("app-terminal", "terminal", "neutral", "Terminal", ["apps/utilities-terminal", "apps/com.raphaelamorim.rio"]),
  A("app-files", "folder_open", "primary", "Files", ["apps/system-file-manager", "apps/com.system76.CosmicFiles"]),
  A("app-settings", "settings", "neutral", "Settings", ["apps/preferences-system", "apps/com.system76.CosmicSettings"]),
  A("app-store", "storefront", "tertiary", "Store", ["apps/system-software-install", "apps/com.system76.CosmicStore"]),
  A("app-browser", "public", "blue", "Browser", ["apps/web-browser", "apps/helium"]),
  A("app-gemini", "auto_awesome", "primary", "Gemini", ["apps/bunos-gemini"]),
  A("app-chat", "chat", "secondary", "Chat", ["apps/bunos-chat"]),
  A("app-search", "search", "secondary", "Search", ["apps/system-search"]),
  A("app-editor", "edit_note", "teal", "Editor", ["apps/accessories-text-editor", "apps/com.system76.CosmicEdit"]),
  A("app-code", "code", "teal", "Code", ["apps/bunos-code"]),
  A("app-media", "play_circle", "orange", "Media Player", [
    "apps/multimedia-video-player",
    "apps/com.system76.CosmicPlayer",
  ]),
  A("app-photos", "photo_library", "purple", "Photos", ["apps/image-viewer"]),
  A("app-music", "library_music", "pink", "Music", ["apps/multimedia-audio-player"]),
  A("app-mail", "mail", "blue", "Mail", ["apps/internet-mail"]),
  A("app-calendar", "calendar_month", "red", "Calendar", ["apps/office-calendar"]),
  A("app-calculator", "calculate", "neutral", "Calculator", ["apps/accessories-calculator"]),
  A("app-monitor", "monitoring", "green", "System Monitor", ["apps/utilities-system-monitor"]),
  A("app-android", "android", "green", "Android", ["apps/bunos-android", "apps/waydroid"]),
  A("app-games", "sports_esports", "red", "Games", ["apps/applications-games"]),
  A("app-emulators", "videogame_asset", "purple", "Emulators", ["apps/bunos-emulators"]),
  A("app-linux", "deployed_code", "orange", "Linux (WSL)", ["apps/bunos-wsl"]),
  A("app-design", "brush", "pink", "Design", ["apps/bunos-design"]),
  A("app-security", "shield", "secondary", "Security", ["apps/preferences-system-privacy"]),
  A("app-bunos", "graphic_eq", "primary", "Bun OS", ["apps/bunos", "places/start-here", "places/distributor-logo"]),
  // Monochrome UI glyphs (freedesktop actions/status; Windows uses them through the shell agent).
  G("go-previous", "arrow_back", ["actions/go-previous"]),
  G("go-next", "arrow_forward", ["actions/go-next"]),
  G("go-up", "arrow_upward", ["actions/go-up"]),
  G("go-home", "home", ["actions/go-home"]),
  G("view-refresh", "refresh", ["actions/view-refresh"]),
  G("edit-copy", "content_copy", ["actions/edit-copy"]),
  G("edit-cut", "content_cut", ["actions/edit-cut"]),
  G("edit-paste", "content_paste", ["actions/edit-paste"]),
  G("edit-delete", "delete", ["actions/edit-delete"]),
  G("edit-find", "search", ["actions/edit-find", "actions/system-search"]),
  G("edit-undo", "undo", ["actions/edit-undo"]),
  G("edit-redo", "redo", ["actions/edit-redo"]),
  G("document-open", "folder_open", ["actions/document-open"]),
  G("document-save", "save", ["actions/document-save"]),
  G("document-new", "note_add", ["actions/document-new"]),
  G("document-print", "print", ["actions/document-print"]),
  G("list-add", "add", ["actions/list-add"]),
  G("list-remove", "remove", ["actions/list-remove"]),
  G("open-menu", "menu", ["actions/open-menu"]),
  G("view-more", "more_vert", ["actions/view-more"]),
  G("view-grid", "grid_view", ["actions/view-grid"]),
  G("view-list", "view_list", ["actions/view-list"]),
  G("system-shutdown", "power_settings_new", ["actions/system-shutdown"]),
  G("system-lock-screen", "lock", ["actions/system-lock-screen"]),
  G("dialog-information", "info", ["status/dialog-information"]),
  G("dialog-warning", "warning", ["status/dialog-warning"]),
  G("dialog-error", "error", ["status/dialog-error"]),
  G("dialog-question", "help", ["status/dialog-question"]),
  G("network-wireless", "wifi", ["status/network-wireless", "status/network-wireless-signal-excellent"]),
  G("network-wired", "lan", ["status/network-wired"]),
  G("bluetooth", "bluetooth", ["status/bluetooth-active"]),
  G("battery-full", "battery_full", ["status/battery-full", "status/battery"]),
  G("audio-volume-high", "volume_up", ["status/audio-volume-high"]),
  G("audio-volume-muted", "volume_off", ["status/audio-volume-muted"]),
  G("notifications", "notifications", ["status/preferences-system-notifications"]),
  G("brightness", "brightness_6", ["status/display-brightness"]),
];

// ------------------------------------------------------------------------------------------------- colour + shapes

const hct = (hex: string) => Hct.fromInt(argbFromHex(hex));
const at = (hex: string, t: number, chroma?: number) => {
  const h = hct(hex);
  return hexFromArgb(Hct.from(h.hue, chroma ?? Math.max(h.chroma, 36), t).toInt());
};

export interface Palette {
  primary: string;
  secondary: string;
  tertiary: string;
  neutral: string;
  /** Glyph ink of monochrome status icons. */
  onSurface: string;
  /** Paper of file-type icons (the lightest surface of the mode's scheme, or on-surface in dark mode). */
  paper: string;
}
/** Key colour of a hue family: theme roles for M3 families, fixed hues harmonised towards the primary. */
export function keyColor(hue: Hue, p: Palette): string {
  if (hue === "primary" || hue === "secondary" || hue === "tertiary" || hue === "neutral") return p[hue];
  return harmonize(FIXED[hue]!, p.primary);
}

/** The `<path>` elements of a Material Symbols SVG, and its viewBox side. */
export function glyphOf(svg: string): { paths: string[]; box: [number, number, number] } {
  const vb = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24").split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]!);
  return { paths, box: [vb[0]!, vb[1]!, vb[2]!] };
}

const place = (g: ReturnType<typeof glyphOf>, cx: number, cy: number, size: number, fill: string): string => {
  const [x0, y0, side] = g.box;
  const s = size / side;
  const tx = cx - size / 2 - x0 * s;
  const ty = cy - size / 2 - y0 * s;
  return `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(5)})" fill="${fill}">${g.paths.map(d => `<path d="${d}"/>`).join("")}</g>`;
};
const doc = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;

/** Rounded folder silhouette (back tab + front body) in a 256 grid. */
const FOLDER_BACK = "M28 52a16 16 0 0 1 16-16h56a16 16 0 0 1 11.3 4.7L128 57h84a16 16 0 0 1 16 16v20H28z";
const FOLDER_FRONT = "M28 84a16 16 0 0 1 16-16h168a16 16 0 0 1 16 16v108a20 20 0 0 1-20 20H48a20 20 0 0 1-20-20z";
const PAGE = "M64 24h88l52 52v140a16 16 0 0 1-16 16H64a16 16 0 0 1-16-16V40a16 16 0 0 1 16-16z";
const PAGE_FOLD = "M152 24v40a12 12 0 0 0 12 12h40z";

/** freedesktop -symbolic convention: GTK recolours this exact grey at render time (a file-format value). */
// design:content
export const SYMBOLIC_FILL = "#bebebe";

export interface Composed {
  svg: string;
  /** Simplified artwork for 24 px and below (no overlay glyph, bolder silhouette). */
  small: string;
  /** Monochrome symbolic glyph (`fill="#bebebe"`, freedesktop -symbolic convention). */
  symbolic: string;
}

/** Full-colour icon for `def` from its Material Symbol (`glyph` = SVG markup of the filled rounded symbol). */
export function compose(def: IconDef, glyphSvg: string, p: Palette, dark: boolean): Composed {
  const g = glyphOf(glyphSvg);
  const key = keyColor(def.hue, p);
  const symbolic = doc(place(g, 128, 128, 256, SYMBOLIC_FILL)).replace(
    'width="256" height="256" viewBox="0 0 256 256"',
    'width="16" height="16" viewBox="0 0 256 256"',
  );
  // Highlight and shade over the icon artwork (white/black at low opacity), part of the badge art.
  // design:content
  const shade = `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient>`;
  switch (def.kind) {
    case "folder": {
      const back = at(key, dark ? 50 : 55);
      const front = at(key, dark ? 65 : 72);
      const mark = at(key, dark ? 25 : 30);
      const base = `<defs>${shade}</defs><path d="${FOLDER_BACK}" fill="${back}"/><path d="${FOLDER_FRONT}" fill="${front}"/><path d="${FOLDER_FRONT}" fill="url(#s)"/>`;
      const overlay = def.id === "folder" || def.id === "folder-open" ? "" : place(g, 128, 142, 92, mark);
      return { svg: doc(base + overlay), small: doc(base), symbolic };
    }
    case "file": {
      const edge = at(p.neutral, 70, 6);
      const ink = at(key, 45);
      const band = at(key, 88, 30);
      const base = `<path d="${PAGE}" fill="${p.paper}" stroke="${edge}" stroke-width="4"/><path d="${PAGE_FOLD}" fill="${band}" stroke="${edge}" stroke-width="4" stroke-linejoin="round"/>`;
      return {
        svg: doc(base + place(g, 126, 150, 104, ink)),
        small: doc(
          `<path d="${PAGE}" fill="${band}" stroke="${ink}" stroke-width="10"/>` + place(g, 126, 150, 120, ink),
        ),
        symbolic,
      };
    }
    case "drive": {
      const plate = at(p.neutral, dark ? 35 : 92, 8);
      const ink = at(p.primary, dark ? 80 : 40);
      const base = `<rect x="20" y="20" width="216" height="216" rx="56" fill="${plate}"/>`;
      return { svg: doc(base + place(g, 128, 128, 152, ink)), small: doc(place(g, 128, 128, 240, ink)), symbolic };
    }
    case "app": {
      const container = def.hue === "neutral" ? at(p.neutral, dark ? 30 : 94, 8) : at(key, dark ? 30 : 90);
      const ink = def.hue === "neutral" ? at(p.primary, dark ? 85 : 35) : at(key, dark ? 90 : 25);
      const plate = `<defs>${shade}</defs><rect x="16" y="16" width="224" height="224" rx="64" fill="${container}"/><rect x="16" y="16" width="224" height="224" rx="64" fill="url(#s)"/>`;
      return {
        svg: doc(plate + place(g, 128, 128, 136, ink)),
        small: doc(plate + place(g, 128, 128, 164, ink)),
        symbolic,
      };
    }
    case "glyph": {
      return {
        svg: doc(place(g, 128, 128, 256, p.onSurface)),
        small: doc(place(g, 128, 128, 256, p.onSurface)),
        symbolic,
      };
    }
  }
}

/** Freedesktop index.theme for the generated tree. */
export function indexTheme(
  name: string,
  comment: string,
  sizes: readonly number[],
  contexts: readonly string[],
  inherits = "Cosmic,Adwaita,hicolor",
): string {
  const ctx: Record<string, string> = {
    actions: "Actions",
    apps: "Applications",
    devices: "Devices",
    mimetypes: "MimeTypes",
    places: "Places",
    status: "Status",
    material: "Applications",
  };
  const dirs: string[] = [];
  const sections: string[] = [];
  for (const c of contexts) {
    for (const s of sizes) {
      dirs.push(`${s}x${s}/${c}`);
      sections.push(`[${s}x${s}/${c}]\nContext=${ctx[c] ?? "Applications"}\nSize=${s}\nType=Fixed\n`);
    }
    dirs.push(`scalable/${c}`);
    sections.push(
      `[scalable/${c}]\nContext=${ctx[c] ?? "Applications"}\nSize=48\nMinSize=8\nMaxSize=512\nType=Scalable\n`,
    );
    dirs.push(`symbolic/${c}`);
    sections.push(
      `[symbolic/${c}]\nContext=${ctx[c] ?? "Applications"}\nSize=16\nMinSize=8\nMaxSize=512\nType=Scalable\n`,
    );
  }
  return `[Icon Theme]\nName=${name}\nComment=${comment}\nInherits=${inherits}\nExample=folder\nDirectories=${dirs.join(",")}\n\n${sections.join("\n")}`;
}
