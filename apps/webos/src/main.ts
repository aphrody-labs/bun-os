// SPDX-License-Identifier: Apache-2.0
import { activityApp } from "./apps/activity";
import { memberApp, memberKindLabel } from "./apps/member";
import { showcaseApp } from "./apps/showcase";
import { themeBuilderApp } from "./apps/themebuilder";
import { videoApp } from "./apps/video";
import {
  ROUTES,
  WORKSPACE_ROUTES,
  appForPath,
  ownHost,
  type WorkspaceRoute,
} from "./config";
import { appStore } from "./apps/appstore";
import { calculatorApp } from "./apps/calculator";
import { creativeApp } from "./apps/creative";
import { mediaApp } from "./apps/media";
import { storageApp } from "./apps/storage";
import { openWebApp, webApps, webAppsApp } from "./apps/webapps";
import { browserApp } from "./apps/browser";
import { editorApp } from "./apps/editor";
import { engineApp } from "./apps/engine";
import { filesApp } from "./apps/files";
import { docsApp } from "./apps/docs";
import { linuxApp } from "./apps/linux";
import { inspectorApp } from "./apps/inspector";
import { storeApp } from "./apps/store";
import { terminalApp } from "./apps/terminal";
import {
  attachCraftHost,
  craftHostForPackage,
  craftHostForPath,
  type CraftHost,
  type CraftHostId,
} from "./apps/craft-host";
import { h, icon } from "./dom";
import { catalog, HOME, webos, type CatalogApp } from "./os";
import {
  install,
  installed,
  reconcile,
  registerServiceWorker,
  registry,
  type RegistryEntry,
} from "./pkg";
import { hintOf, installKeys, shortcutsView } from "./keys";
import { initSounds, setSoundsEnabled, soundsEnabled } from "./sounds";
import { THEMES } from "./themes";
import { mountWallpaper } from "./wallpaper";
import { WindowManager, type Layout } from "./wm";
import { prefs, type BarItem, type WallpaperSpec } from "./prefs";
import {
  formatBytes,
  formatDate,
  formatTime,
  installAppearance,
  motionReduced,
  onThemeChange,
} from "./appearance";
import { announce, installNotifications } from "./notify";
import { chordCaps } from "./shortcuts";
import { isSection, settingsApp, type SectionId } from "./apps/settings";

// Preferences load from IndexedDB before the desktop is built; boot.ts already painted their snapshot.
await prefs.ready;
installAppearance();

interface Builtin {
  id: string;
  name: string;
  icon: string;
  desc: string;
  group: "core" | "advanced";
  /** Colour role family of the icon tile. */
  tone?: "primary" | "secondary" | "tertiary";
  width?: number;
  height?: number;
  /** Small tools float above tiled layouts. */
  float?: boolean;
  mount(root: HTMLElement): void;
}

const desk = h("main", { class: "desk" });
const wm = new WindowManager(desk, {
  defaultLayout: prefs.get("windows.tiling"),
  gap: prefs.get("windows.gap"),
  workspaces: prefs.get("workspaces.count"),
});
const craftHosts = new Map<string, CraftHost>();
const dock = h("nav", { class: "dock", "aria-label": "Dock" });
const bar = h("header", { class: "topbar" });

function loading(root: HTMLElement, task: Promise<unknown>) {
  const spin = h("div", { class: "empty" }, "Loading…");
  root.append(spin);
  task.then(
    () => spin.remove(),
    (error) => {
      spin.textContent = `This app could not start: ${String(error)}`;
    },
  );
}

function openEditor(path: string, text: string) {
  const content = h("div", { class: "fill" });
  void editorApp(content, path, text);
  wm.open({
    id: `edit:${path}`,
    title: path.split("/").pop() ?? path,
    icon: "doc",
    width: 640,
    height: 480,
    content,
  });
}

const builtins: Builtin[] = [
  {
    id: "aphrody-workspace",
    tone: "primary",
    name: "Aphrody Workspace",
    icon: "app",
    desc: "Files, conversations, models and settings in your shared workspace",
    group: "core",
    width: 1100,
    height: 720,
    mount: (root) =>
      root.append(
        h("iframe", {
          class: "appframe",
          src: "/workspace/os",
          title: "Aphrody Workspace",
          allow:
            "clipboard-read; clipboard-write; fullscreen; cross-origin-isolated",
        }),
      ),
  },
  {
    id: "files",
    tone: "primary",
    name: "Files",
    icon: "folder",
    desc: "Your files, saved in this browser",
    group: "core",
    mount: (root) =>
      loading(
        root,
        filesApp(root, openEditor, {
          openCraft: openCraftFile,
          openWith: openFileWith,
        }),
      ),
  },
  {
    id: "browser",
    tone: "secondary",
    name: "Browser",
    icon: "globe",
    desc: "Browse the web in tabs",
    group: "core",
    width: 1000,
    height: 640,
    mount: (root) => browserApp(root, undefined, openOwnUrl),
  },
  {
    id: "apps",
    tone: "tertiary",
    name: "Apps",
    icon: "store",
    desc: "Install games and creative apps",
    group: "core",
    width: 860,
    height: 600,
    mount: (root) => loading(root, appStore(root, refreshApps, launchPackage)),
  },
  {
    id: "creative",
    tone: "tertiary",
    name: "Aphrody Creative",
    icon: "pen",
    desc: "Creative apps, projects and shared Drive files",
    group: "core",
    width: 980,
    height: 680,
    mount: (root) =>
      loading(
        root,
        creativeApp(
          root,
          refreshApps,
          launchPackage,
          () => openApp("drive"),
          openApp,
        ),
      ),
  },
  {
    id: "drive",
    tone: "primary",
    name: "Aphrody Drive",
    icon: "folder",
    desc: "Creative projects and assets in the shared WebOS workspace",
    group: "core",
    width: 1120,
    height: 740,
    // Keep browser Drive on the same Rust VFS as Files. Projects saved here
    // remain available in both windows across WebOS sessions.
    mount: (root) =>
      loading(
        root,
        filesApp(root, openEditor, {
          start: `${HOME}/Projects`,
          openCraft: openCraftFile,
          openWith: openFileWith,
        }),
      ),
  },
  {
    id: "settings",
    name: "Settings",
    icon: "gear",
    desc: "Appearance, wallpaper, desktop, keyboard, region and privacy",
    group: "core",
    width: 960,
    height: 680,
    float: true,
    mount: (root) => mountSettings(root),
  },
  {
    id: "linux",
    name: "Alpine Linux",
    icon: "cube",
    desc: "A real Linux machine in your browser",
    group: "core",
    width: 900,
    height: 620,
    mount: (root) => loading(root, linuxApp(root)),
  },
  {
    id: "docs",
    tone: "secondary",
    name: "Docs",
    icon: "doc",
    desc: "Bun, the Bun fork and Bun OS documentation, searchable",
    group: "core",
    width: 980,
    height: 640,
    mount: (root) => loading(root, docsApp(root)),
  },
  {
    id: "terminal",
    name: "Terminal",
    icon: "terminal",
    desc: "Command line (Rust shell in WebAssembly)",
    group: "advanced",
    width: 760,
    height: 460,
    mount: (root) => loading(root, terminalApp(root)),
  },
  {
    id: "inspector",
    name: "Inspector",
    icon: "cube",
    desc: "Analyse any file: format, sections, hashes",
    group: "advanced",
    width: 760,
    height: 560,
    mount: (root) => loading(root, inspectorApp(root)),
  },
  {
    id: "engine",
    name: "Bun Engine",
    icon: "bolt",
    desc: "Run JavaScript in an isolated worker",
    group: "advanced",
    width: 820,
    height: 560,
    mount: (root) => loading(root, engineApp(root)),
  },
  {
    id: "workspace",
    name: "Source catalog",
    icon: "code",
    desc: "Every Bun OS app, package and crate",
    group: "advanced",
    width: 920,
    height: 600,
    mount: (root) =>
      loading(
        root,
        storeApp(root, (kind, target) => {
          if (kind === "app") openApp(target);
          else void window.open(target, "_blank", "noopener");
        }),
      ),
  },
  {
    id: "media",
    tone: "tertiary",
    name: "Media",
    icon: "film",
    desc: "Play videos, music and pictures",
    group: "core",
    width: 820,
    height: 560,
    mount: (root) => loading(root, mediaApp(root)),
  },
  {
    id: "video",
    tone: "tertiary",
    name: "Video Studio",
    icon: "film",
    desc: "Compose clips, titles and music, export WebM",
    group: "core",
    width: 1100,
    height: 700,
    mount: (root) =>
      loading(root, videoApp(root, { openFilm: () => openApp("craft-film") })),
  },
  {
    id: "showcase",
    name: "Material 3 components",
    icon: "image",
    desc: "Every Material 3 web component, live with its code",
    group: "advanced",
    width: 1040,
    height: 700,
    mount: (root) => showcaseApp(root),
  },
  {
    id: "themebuilder",
    name: "Theme builder",
    icon: "pen",
    desc: "Material 3 scheme from one colour: contrast and exports",
    group: "advanced",
    width: 1040,
    height: 720,
    mount: (root) => themeBuilderApp(root),
  },
  {
    id: "webapps",
    tone: "secondary",
    name: "Web Apps",
    icon: "globe",
    desc: "Sites pinned as apps",
    group: "core",
    width: 760,
    height: 520,
    mount: (root) => webAppsApp(root, () => renderLauncher()),
  },
  {
    id: "calculator",
    name: "Calculator",
    icon: "table",
    desc: "Calculator",
    group: "core",
    width: 320,
    height: 480,
    float: true,
    mount: (root) => calculatorApp(root),
  },
  {
    id: "storage",
    tone: "primary",
    name: "Disk Usage",
    icon: "folder",
    desc: "What takes space in your files",
    group: "core",
    width: 760,
    height: 520,
    mount: (root) => loading(root, storageApp(root)),
  },
  {
    id: "activity",
    name: "Activity",
    icon: "bolt",
    desc: "Windows, memory and storage in use",
    group: "advanced",
    width: 640,
    height: 520,
    mount: (root) => activityApp(root, wm),
  },
  {
    id: "keys",
    name: "Keyboard",
    icon: "gear",
    desc: "Keyboard shortcuts and navigation",
    group: "core",
    width: 560,
    height: 560,
    float: true,
    mount: (root) => root.append(shortcutsView()),
  },
  {
    id: "about",
    name: "About",
    icon: "info",
    desc: "About this system",
    group: "core",
    width: 520,
    height: 420,
    float: true,
    mount: (root) => loading(root, aboutApp(root)),
  },
];

function launchBuiltin(b: Builtin) {
  const existing = wm.windows.get(b.id);
  if (existing) {
    wm.restore(existing);
    return;
  }
  const content = h("div", { class: "fill" });
  wm.open({
    id: b.id,
    title: b.name,
    icon: b.icon,
    width: b.width,
    height: b.height,
    float: b.float,
    content,
  });
  if (!content.hasChildNodes()) b.mount(content);
}

// Packages of the registry behave like any other app; opening one that is not installed yet installs it
// (every file sha256-verified, cached for offline use) and then starts it in the same window.
let registryEntries: RegistryEntry[] = [];
const installedEntries = () => registryEntries.filter((e) => installed()[e.id]);
interface PackageWindowOptions {
  id?: string;
  title?: string;
  documentPath?: string;
}
const megabytes = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
function launchPackage(
  e: RegistryEntry,
  options: PackageWindowOptions = {},
): CraftHost | undefined {
  const windowId = options.id ?? `pkg:${e.id}`;
  const title = options.title ?? e.name;
  const existing = wm.windows.get(windowId);
  if (existing) {
    wm.restore(existing);
    return craftHosts.get(windowId);
  }
  const content = h("div", { class: "fill" });
  let craftHost: CraftHost | undefined;
  wm.open({
    id: windowId,
    title,
    icon: e.category === "games" ? "game" : "app",
    width: 960,
    height: 640,
    content,
    onClose: () => {
      craftHost?.dispose();
      if (craftHosts.get(windowId) === craftHost) craftHosts.delete(windowId);
    },
  });
  if (content.hasChildNodes()) return craftHost;
  const mount = () => {
    const hostId = craftHostForPackage(e.id);
    const frame = h("iframe", {
      class: "appframe",
      src: `/apps/${e.id}/${hostId ? "?host=parent" : ""}`,
      title: e.name,
      allow:
        "fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; cross-origin-isolated",
    }) as HTMLIFrameElement;
    frame.title = title;
    if (hostId) {
      craftHost = attachCraftHost(frame, hostId, (name, bytes) =>
        saveCraftFile(hostId, name, bytes, options.documentPath),
      );
      craftHosts.set(windowId, craftHost);
    }
    content.append(frame);
  };
  if (installed()[e.id]) {
    mount();
    return craftHost;
  }
  const status = h("p", {}, `${megabytes(e.size)} to download and verify`);
  const bar = document.createElement("md-linear-progress") as HTMLElement & {
    value: number;
  };
  bar.value = 0;
  const box = h(
    "div",
    { class: "pkg-install", role: "status", "aria-live": "polite" },
    h("strong", {}, `Installing ${e.name}`),
    status,
    bar,
  );
  content.append(box);
  install(e, (done, total) => {
    bar.value = done / total;
    status.textContent = `${megabytes(done)} of ${megabytes(total)} verified`;
  }).then(
    () => {
      box.remove();
      mount();
      refreshApps();
    },
    (error: unknown) => {
      bar.remove();
      status.textContent = `${e.name} could not be installed: ${String((error as Error).message ?? error)}`;
    },
  );
  return undefined;
}

// App UI routes (apps/webos/apps.json) open the shared Workspace at that route.
function launchWorkspace(route: WorkspaceRoute) {
  const windowId = `ws:${route.id}`;
  const existing = wm.windows.get(windowId);
  if (existing) {
    wm.restore(existing);
    return;
  }
  const content = h("div", { class: "fill" });
  wm.open({
    id: windowId,
    title: route.name,
    icon: route.icon,
    width: 1100,
    height: 720,
    content,
  });
  if (!content.hasChildNodes())
    content.append(
      h("iframe", {
        class: "appframe",
        src: `/workspace/${route.route}`,
        title: route.name,
        allow:
          "clipboard-read; clipboard-write; fullscreen; cross-origin-isolated",
      }),
    );
}

// Members of apps/ come from the catalog (build.ts); native ones open their member window.
let members: CatalogApp[] = [];
const membersReady = catalog().then(
  (data) => {
    members = data.apps;
    refreshApps();
  },
  () => {},
);
const MEMBER_ICON: Record<CatalogApp["run"], string> = {
  web: "globe",
  native: "app",
  cli: "terminal",
  server: "globe",
  android: "android",
  library: "code",
  example: "code",
};
function launchMember(member: CatalogApp, missing?: string) {
  const windowId = `src:${member.id}`;
  const existing = wm.windows.get(windowId);
  if (existing) {
    wm.restore(existing);
    return;
  }
  const content = h("div", { class: "fill" });
  wm.open({
    id: windowId,
    title: member.id,
    icon: MEMBER_ICON[member.run],
    width: 860,
    height: 640,
    content,
  });
  if (!content.hasChildNodes())
    loading(
      content,
      memberApp(content, member, { open: openApp, label: appLabel, missing }),
    );
}

/** Display name of any app id: desktop app, App UI route, package or member. */
function appLabel(id: string): string {
  return (
    builtins.find((b) => b.id === id)?.name ??
    WORKSPACE_ROUTES.find((r) => r.id === id)?.name ??
    registryEntries.find((e) => e.id === id)?.name ??
    (id.startsWith("src:") ? id.slice(4) : id)
  );
}

/** Open any app by id; false when nothing of that id exists in this deployment. */
function openApp(id: string): boolean {
  const builtin = builtins.find((b) => b.id === id);
  if (builtin) {
    launchBuiltin(builtin);
    return true;
  }
  const route = WORKSPACE_ROUTES.find((r) => r.id === id);
  if (route) {
    launchWorkspace(route);
    return true;
  }
  if (id.startsWith("src:")) {
    const member = members.find((m) => m.id === id.slice(4));
    if (!member) return false;
    if (member.opens && openApp(member.opens)) return true;
    launchMember(
      member,
      member.opens
        ? `${appLabel(member.opens)} is not in the package registry of this deployment, so its browser build cannot open.`
        : undefined,
    );
    return true;
  }
  const entry = registryEntries.find((e) => e.id === id);
  if (entry) {
    launchPackage(entry);
    return true;
  }
  // A package this deployment did not build: its owning member says so and offers what exists.
  const owner =
    members.find((m) => m.opens === id) ??
    members.find((m) => m.related === id);
  if (owner) {
    launchMember(
      owner,
      `${id} is not in the package registry of this deployment, so its browser build cannot open.`,
    );
    return true;
  }
  return false;
}

/** An address of an Aphrody host that is an app of this desktop opens as a window (Browser, links). */
function openOwnUrl(url: URL): boolean {
  if (!ownHost(url.hostname)) return false;
  const routed = ROUTES.hosts[url.hostname]?.path;
  const id =
    url.searchParams.get("app") ??
    appForPath(
      url.hostname === new URL(ROUTES.origin).hostname
        ? url.pathname
        : (routed ?? ""),
    );
  return id ? openApp(id) : false;
}

/** Files opens a file with its default app (Settings, files.openWith); false falls back to Files itself. */
function openFileWith(
  appId: string,
  path: string,
  name: string,
  bytes: Uint8Array,
): boolean {
  if (appId === "media" || appId === "inspector") {
    const app = builtins.find((b) => b.id === appId)!;
    const windowId = `${appId}:${path}`;
    const existing = wm.windows.get(windowId);
    if (existing) {
      wm.restore(existing);
      return true;
    }
    const content = h("div", { class: "fill" });
    wm.open({
      id: windowId,
      title: `${name} · ${app.name}`,
      icon: app.icon,
      width: app.width,
      height: app.height,
      content,
    });
    if (!content.hasChildNodes())
      loading(
        content,
        appId === "media"
          ? mediaApp(content, path)
          : inspectorApp(content, path),
      );
    return true;
  }
  if (appId === "browser") {
    // The viewer of the real browser (PDF, pictures) shows the bytes in a tab.
    const type = name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "";
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }
  const packageId = appId.replace(/^pkg:/, "");
  const craft = craftHostForPath(path);
  if (craft && packageId === `craft-${craft}`) {
    openCraftFile(craft, path, name, bytes);
    return true;
  }
  // Any other app opens; apps without a file protocol start empty.
  return openApp(packageId) || openApp(appId);
}

function openCraftFile(
  id: CraftHostId,
  path: string,
  name: string,
  bytes: Uint8Array,
): boolean {
  const packageId = `craft-${id}`;
  const entry = installedEntries().find((item) => item.id === packageId);
  if (!entry) {
    // Not installed yet: its window installs it; the file opens from Files once it runs.
    openApp(packageId);
    return false;
  }
  const documentPath = path.replaceAll("\\", "/");
  const windowId = `craft-doc:${id}:${encodeURIComponent(documentPath)}`;
  const host = launchPackage(entry, {
    id: windowId,
    title: `${name} · ${entry.name}`,
    documentPath,
  });
  return host?.open(name, bytes) ?? false;
}

async function saveCraftFile(
  id: CraftHostId,
  name: string,
  bytes: Uint8Array,
  documentPath?: string,
) {
  const os = await webos();
  const root = `${HOME}/Projects/Craft`;
  const normalizedPath = documentPath?.replaceAll("\\", "/");
  const lastSlash = normalizedPath?.lastIndexOf("/") ?? -1;
  const originalName =
    lastSlash >= 0 ? normalizedPath!.slice(lastSlash + 1) : undefined;
  const directory =
    normalizedPath && lastSlash >= 0
      ? normalizedPath.slice(0, lastSlash) || "/"
      : `${root}/${id}`;
  const savePath =
    normalizedPath && name === originalName
      ? normalizedPath
      : `${directory}/${name}`;
  if (!normalizedPath) {
    try {
      os.fs.stat(root);
    } catch {
      os.fs.mkdir(root);
    }
  }
  try {
    os.fs.stat(directory);
  } catch {
    os.fs.mkdir(directory);
  }
  os.fs.write(savePath, bytes);
  await os.flush();
}
function refreshApps() {
  renderDock();
  renderHome();
  renderDeskIcons();
  settingsView?.refresh();
  if (launcher.open) renderLauncher();
}

async function aboutApp(root: HTMLElement) {
  const data = await catalog();
  const health = await fetch("/api/health").then(
    (r) => r.json() as Promise<{ colo?: string }>,
    () => ({}) as { colo?: string },
  );
  root.append(
    h(
      "div",
      { class: "detail" },
      h("h2", {}, "Aphrody Bun OS"),
      h(
        "p",
        {},
        "A complete desktop that runs in your browser. Your files stay on your device.",
      ),
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, "Workspace"),
        h(
          "dd",
          {},
          `${data.counts.apps} apps · ${data.counts.packages} packages · ${data.counts.crates} crates`,
        ),
        h("dt", {}, "Installed apps"),
        h("dd", {}, String(Object.keys(installed()).length)),
        h("dt", {}, "Browser"),
        h(
          "dd",
          {},
          navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 80),
        ),
        h("dt", {}, "Cores"),
        h("dd", {}, String(navigator.hardwareConcurrency ?? "n/a")),
        h("dt", {}, "Language"),
        h("dd", {}, navigator.language),
        h("dt", {}, "Edge location"),
        h("dd", {}, health.colo ?? "n/a"),
        h("dt", {}, "Built"),
        h("dd", {}, data.generated.slice(0, 16).replace("T", " ")),
      ),
    ),
  );
}

// Appearance --------------------------------------------------------------------------------------
const narrow = matchMedia("(max-width: 599px)");

// Settings window: one instance, deep links /settings/<section> ---------------------------------------
let settingsView: ReturnType<typeof settingsApp> | undefined;
let settingsSection: SectionId = "appearance";
function mountSettings(root: HTMLElement) {
  settingsView = settingsApp(
    root,
    {
      apps: () =>
        launchItems().map((i) => ({ id: i.id, name: i.name, icon: i.icon })),
      appIcon,
      workspace: () => wm.workspace,
      onSection: (id) => {
        settingsSection = id;
        if (wm.windows.has("settings"))
          history.replaceState(null, "", `/settings/${id}`);
      },
      openShortcuts: () =>
        launchBuiltin(builtins.find((b) => b.id === "keys")!),
    },
    settingsSection,
  );
}
function openSettings(section?: SectionId) {
  if (section) settingsSection = section;
  launchBuiltin(builtins.find((b) => b.id === "settings")!);
  if (section) settingsView?.show(section);
}

/** Material Symbols ligature by glyph name. */
function sym(glyph: string) {
  const s = h("span", {
    class: "mi material-symbols-rounded",
    "aria-hidden": "true",
  });
  s.textContent = glyph;
  return s;
}

/** App icon tile, tinted by a role family so the grid reads by kind at a glance. */
function toneOf(id: string) {
  const own = builtins.find((b) => b.id === id)?.tone;
  if (own) return own;
  if (id.startsWith("pkg:") || id.startsWith("web:")) return "tertiary";
  if (id.startsWith("ws:")) return "secondary";
  return "neutral";
}
function appIcon(id: string, ic: string) {
  return h(
    "span",
    { class: `appicon tone-${toneOf(id)}`, "aria-hidden": "true" },
    icon(ic),
  );
}

function themeSwatch(
  theme: (typeof THEMES)[number],
  onPick: () => void,
  size = "",
) {
  const [bg, surface, a, b] = theme.preview;
  return h("button", {
    class: `theme-dot ${size}`.trim(),
    "aria-label": `${theme.name} theme`,
    "aria-pressed": String(prefs.get("theme.id") === theme.id),
    "data-tip": theme.name,
    style: `--a:${a};--b:${b};--bg:${bg};--s:${surface}`,
    onclick: onPick,
  });
}

// Launcher: search-first, fuzzy, keyboard driven ---------------------------------------------------
interface LaunchItem {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Other names that find it in search (member ids, package ids). */
  keys?: string[];
  section: string;
  run(): void;
}
const launcher = h("dialog", {
  class: "launcher",
  closedby: "any",
  "aria-label": "Applications",
}) as HTMLDialogElement;
let launcherOpener: HTMLElement | null = null;
const lsearch = h("input", {
  class: "lsearch",
  type: "search",
  placeholder: "Search apps, tools and the web",
  "aria-label": "Search apps",
  autocomplete: "off",
  spellcheck: "false",
});
const lgrid = h("div", { class: "lgrid" });
launcher.append(
  h(
    "div",
    { class: "lbox" },
    h(
      "label",
      { class: "lsearch-wrap" },
      sym("search"),
      lsearch,
      h("kbd", { class: "lkbd" }, "Esc"),
    ),
    lgrid,
  ),
);
// Light dismiss where closedby is not supported yet.
if (!("closedBy" in HTMLDialogElement.prototype))
  launcher.addEventListener("click", (e) => {
    if (e.target === launcher) launcher.close();
  });

const SECTION_OF: Record<RegistryEntry["category"], string> = {
  create: "Create",
  games: "Games",
  tools: "Tools",
};
const LAUNCH_ORDER = [
  "Apps",
  "Create",
  "Games",
  "Workspace",
  "Web apps",
  "Tools",
  "Desktop and command line",
];
function launchItems(): LaunchItem[] {
  // Members that are a desktop app or package (pdfcraft-web is PDF) find it by their own name too.
  const aliases = new Map<string, string[]>();
  for (const m of members)
    if (m.opens) aliases.set(m.opens, [...(aliases.get(m.opens) ?? []), m.id]);
  return [
    ...builtins.map((b) => ({
      id: b.id,
      name: b.name,
      icon: b.icon,
      desc: b.desc,
      keys: aliases.get(b.id),
      section: b.group === "core" ? "Apps" : "Tools",
      run: () => launchBuiltin(b),
    })),
    ...registryEntries.map((e) => ({
      id: `pkg:${e.id}`,
      name: e.name,
      icon: e.category === "games" ? "game" : "app",
      desc: `${e.description}${installed()[e.id] ? "" : " (installs on first open)"}`,
      keys: [e.id, ...(aliases.get(e.id) ?? [])],
      section: SECTION_OF[e.category],
      run: () => void launchPackage(e),
    })),
    ...WORKSPACE_ROUTES.map((r) => ({
      id: `ws:${r.id}`,
      name: r.name,
      icon: r.icon,
      desc: r.desc,
      keys: aliases.get(r.id),
      section: "Workspace",
      run: () => launchWorkspace(r),
    })),
    ...webApps().map((a) => ({
      id: `web:${a.url}`,
      name: a.name,
      icon: "globe",
      desc: new URL(a.url).hostname,
      section: "Web apps",
      run: () => openWebApp(a),
    })),
    ...members
      .filter((m) => !m.opens)
      .map((m) => ({
        id: `src:${m.id}`,
        name: m.id,
        icon: MEMBER_ICON[m.run],
        desc: `${memberKindLabel(m.run)}${m.d ? ` · ${m.d}` : ""}`,
        section: "Desktop and command line",
        run: () => launchMember(m),
      })),
  ];
}

/** Fuzzy score: prefix beats word start beats substring beats an in-order subsequence; -1 is no match. */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 120 - t.length * 0.1;
  const at = t.indexOf(q);
  if (at >= 0) return (/[\s\-_.]/.test(t[at - 1] ?? "") ? 90 : 70) - at * 0.1;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const pos = t.indexOf(ch, from);
    if (pos < 0) return -1;
    score += pos === last + 1 ? 4 : 1;
    if (pos === 0 || /[\s\-_.]/.test(t[pos - 1]!)) score += 3;
    last = pos;
    from = pos + 1;
  }
  return score;
}

function launchTile(item: LaunchItem) {
  return h(
    "button",
    {
      class: "ltile",
      title: item.desc,
      onclick: () => {
        launcher.close();
        item.run();
      },
    },
    appIcon(item.id, item.icon),
    h("span", { class: "lname" }, item.name),
  );
}

function renderLauncher() {
  const raw = lsearch.value.trim();
  const items = launchItems();
  const section = (title: string, tiles: HTMLElement[]) =>
    tiles.length
      ? [
          h("h3", { class: "lhead" }, title),
          h("div", { class: "lsection" }, ...tiles),
        ]
      : [];
  if (!raw) {
    lgrid.replaceChildren(
      ...LAUNCH_ORDER.flatMap((name) =>
        section(name, items.filter((i) => i.section === name).map(launchTile)),
      ),
    );
    return;
  }
  const ranked = items
    .map((item) => ({
      item,
      score: Math.max(
        fuzzy(raw, item.name),
        ...(item.keys ?? []).map((key) => fuzzy(raw, key) - 10),
        item.desc.toLowerCase().includes(raw.toLowerCase()) ? 30 : -1,
      ),
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => launchTile(r.item));
  const web = h(
    "button",
    {
      class: "lweb",
      onclick: () => {
        launcher.close();
        const content = h("div", { class: "fill" });
        wm.open({
          title: "Browser",
          icon: "globe",
          width: 1000,
          height: 640,
          content,
        });
        browserApp(content, raw, openOwnUrl);
      },
    },
    sym("travel_explore"),
    h("span", {}, "Search the web for ", h("strong", {}, raw)),
  );
  lgrid.replaceChildren(
    ...(ranked.length
      ? section("Best matches", ranked)
      : [h("p", { class: "lempty" }, `No app is called “${raw}”.`)]),
    h("div", { class: "lwebrow" }, web),
  );
  ranked[0]?.classList.add("first");
}
function openLauncher(query = "") {
  if (!launcher.open) {
    launcherOpener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    launcher.showModal();
  }
  lsearch.value = query;
  renderLauncher();
  lsearch.focus();
}
function closeLauncher() {
  if (launcher.open) launcher.close();
}
function toggleLauncher() {
  if (launcher.open) closeLauncher();
  else openLauncher();
}
launcher.addEventListener("close", () => {
  if (launcherOpener?.isConnected) launcherOpener.focus();
  launcherOpener = null;
});
lsearch.addEventListener("input", renderLauncher);

/** Spatial arrow-key movement across the tiles of the launcher grid. */
function moveInGrid(from: HTMLElement, key: string) {
  const tiles = [...lgrid.querySelectorAll<HTMLElement>(".ltile, .lweb")];
  const i = tiles.indexOf(from);
  if (key === "ArrowRight") return tiles[i + 1]?.focus();
  if (key === "ArrowLeft")
    return i === 0 ? lsearch.focus() : tiles[i - 1]?.focus();
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const t of tiles) {
    if (t === from) continue;
    const b = t.getBoundingClientRect();
    const dy = key === "ArrowDown" ? b.top - r.bottom : r.top - b.bottom;
    if (dy < -2) continue;
    const score = dy * 4 + Math.abs(b.left + b.width / 2 - cx);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best) best.focus();
  else if (key === "ArrowUp") lsearch.focus();
}
launcher.addEventListener("keydown", (e) => {
  const active = document.activeElement as HTMLElement | null;
  if (active === lsearch) {
    if (e.key === "Enter") {
      e.preventDefault();
      lgrid.querySelector<HTMLElement>(".ltile, .lweb")?.click();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      lgrid.querySelector<HTMLElement>(".ltile, .lweb")?.focus();
    }
    return;
  }
  if (active && lgrid.contains(active)) {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveInGrid(active, e.key);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing anywhere in the grid keeps searching.
      lsearch.focus();
    }
  }
});

// Dock ---------------------------------------------------------------------------------------------
function dockButton(
  id: string,
  label: string,
  ic: string,
  onclick: () => void,
) {
  const w = wm.windows.get(id);
  const state = w
    ? wm.activeId() === id
      ? " running current"
      : " running"
    : "";
  return h(
    "button",
    {
      class: `dbtn${state}`,
      "aria-label": w ? `${label}, open` : label,
      "data-tip": label,
      onclick,
    },
    appIcon(id, ic),
  );
}
function renderDock() {
  const toggle = (id: string) => {
    const w = wm.windows.get(id)!;
    if (w.minimized || wm.activeId() !== id) wm.restore(w);
    else wm.minimize(w);
  };
  const items: HTMLElement[] = [
    h(
      "button",
      {
        class: "dbtn launch",
        "aria-label": "Show all apps",
        "data-tip": "All apps",
        onclick: () => toggleLauncher(),
      },
      h("span", { class: "appicon" }, icon("grid")),
    ),
    h("span", { class: "dsep", "aria-hidden": "true" }),
  ];
  const seen = new Set<string>();
  const catalogItems = new Map(launchItems().map((i) => [i.id, i]));
  for (const id of prefs.get("dock.pinned")) {
    const item = catalogItems.get(id);
    if (!item) continue;
    seen.add(id);
    items.push(
      dockButton(id, item.name, item.icon, () =>
        wm.windows.get(id) ? toggle(id) : item.run(),
      ),
    );
  }
  const extra: HTMLElement[] = [];
  for (const e of installedEntries()) {
    const id = `pkg:${e.id}`;
    if (!wm.windows.get(id)) continue;
    seen.add(id);
    extra.push(
      dockButton(id, e.name, e.category === "games" ? "game" : "app", () =>
        toggle(id),
      ),
    );
  }
  for (const [id, w] of wm.windows) {
    if (seen.has(id)) continue;
    extra.push(dockButton(id, w.title, w.iconName, () => toggle(id)));
  }
  if (extra.length)
    items.push(h("span", { class: "dsep", "aria-hidden": "true" }), ...extra);
  dock.replaceChildren(...items);
}
wm.onChange(renderDock);

// Mobile home: on narrow screens the launcher grid is the desktop --------------------------------
const home = h("section", { class: "home", "aria-label": "Home" });
function renderHome() {
  const now = new Date();
  home.replaceChildren(
    h(
      "div",
      { class: "home-head" },
      h("div", { class: "home-time" }, formatTime(now, false)),
      h("div", { class: "home-date" }, formatDate(now, "long")),
    ),
    h(
      "button",
      { class: "home-search", onclick: () => openLauncher() },
      sym("search"),
      "Search apps and the web",
    ),
    h(
      "div",
      { class: "home-grid" },
      ...launchItems()
        .filter(
          (i) =>
            i.section !== "Tools" &&
            i.section !== "Desktop and command line" &&
            i.id !== "about",
        )
        .map((item) =>
          h(
            "button",
            { class: "ltile", onclick: () => item.run() },
            appIcon(item.id, item.icon),
            h("span", { class: "lname" }, item.name),
          ),
        ),
    ),
  );
}
desk.append(home);

// Welcome card: first visit only, centred, dismissible ----------------------------------------------
function showWelcome() {
  if (prefs.get("shell.welcomed") || narrow.matches) return;
  const card = h("section", {
    class: "welcome",
    role: "dialog",
    "aria-labelledby": "welcome-title",
    tabindex: -1,
  });
  const dismiss = () => {
    prefs.set("shell.welcomed", true);
    card.classList.add("leaving");
    const done = () => card.remove();
    if (motionReduced()) done();
    else card.addEventListener("animationend", done, { once: true });
  };
  const catalogItems = new Map(launchItems().map((i) => [i.id, i]));
  const quick = prefs
    .get("dock.pinned")
    .flatMap((id) => catalogItems.get(id) ?? []);
  const swatches = h("div", { class: "welcome-themes" });
  const paintSwatches = () =>
    swatches.replaceChildren(
      ...THEMES.map((t) => themeSwatch(t, () => prefs.set("theme.id", t.id))),
    );
  const offTheme = prefs.subscribe("theme.id", () => {
    if (card.isConnected) paintSwatches();
    else offTheme();
  });
  paintSwatches();
  const kbd = (action: string, label: string) => {
    const chord = hintOf(action);
    return chord
      ? h(
          "span",
          { class: "hint" },
          ...chordCaps(chord).map((k) => h("kbd", {}, k)),
          h("span", {}, label),
        )
      : null;
  };
  card.append(
    h(
      "div",
      { class: "welcome-top" },
      h("img", {
        src: "/brand/64.png",
        alt: "",
        width: 44,
        height: 44,
        class: "welcome-logo",
      }),
      h(
        "button",
        {
          class: "tbtn",
          "aria-label": "Close welcome",
          onclick: dismiss,
        },
        icon("close"),
      ),
    ),
    h("h1", { id: "welcome-title" }, "Welcome to Bun OS"),
    h(
      "p",
      { class: "welcome-lede" },
      "A tiling desktop in your browser. Apps open side by side, and your files stay on this device.",
    ),
    h(
      "button",
      {
        class: "welcome-search",
        onclick: () => {
          dismiss();
          openLauncher();
        },
      },
      sym("search"),
      h("span", {}, "Search apps and the web"),
      ...(hintOf("launcher") ? chordCaps(hintOf("launcher")!) : []).map((k) =>
        h("kbd", {}, k),
      ),
    ),
    h(
      "div",
      { class: "welcome-apps" },
      ...quick.map((item) =>
        h(
          "button",
          {
            class: "ltile",
            onclick: () => {
              dismiss();
              item.run();
            },
          },
          appIcon(item.id, item.icon),
          h("span", { class: "lname" }, item.name),
        ),
      ),
    ),
    h(
      "div",
      { class: "welcome-row" },
      h("span", { class: "welcome-label" }, "Pick a look"),
      swatches,
    ),
    h(
      "div",
      { class: "welcome-foot" },
      h(
        "div",
        { class: "hints" },
        kbd("launch.terminal", "Terminal"),
        kbd("workspace.go", "Workspaces"),
        kbd("help", "All shortcuts"),
      ),
      h("button", { class: "btn", onclick: dismiss }, "Start"),
    ),
  );
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismiss();
  });
  desk.append(card);
  queueMicrotask(() => card.focus({ preventScroll: true }));
}

// Top bar: workspaces left, clock centre, status right (waybar layout) ------------------------------
const wsBar = h("nav", { class: "wsbar", "aria-label": "Workspaces" });
const activeApp = h("span", { class: "active-app", "aria-live": "polite" });
const timeEl = h("time", { class: "bar-time" });
const dateEl = h("span", { class: "bar-date" });
const LAYOUT_GLYPH: Record<Layout, string> = {
  dwindle: "dashboard",
  master: "vertical_split",
  scrolling: "view_column",
  floating: "filter_none",
};
const LAYOUT_NAME: Record<Layout, string> = {
  dwindle: "Tiled",
  master: "Master and stack",
  scrolling: "Scrolling columns",
  floating: "Floating",
};
const layoutBtn = h("button", {
  class: "tbtn",
  onclick: () => wm.cycleLayout(),
});
const netIcon = sym("wifi");
const volIcon = sym("volume_up");
const batIcon = sym("battery_full");
batIcon.hidden = true;
const statusBtn = h(
  "button",
  {
    class: "status",
    popovertarget: "quick",
    "aria-label": "Quick settings",
    "data-tip": "Quick settings",
  },
  netIcon,
  volIcon,
  batIcon,
);
const quick = h("div", {
  id: "quick",
  class: "quick",
  popover: "auto",
  role: "dialog",
  "aria-label": "Quick settings",
});

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}
let battery: BatteryLike | undefined;
const batteryGlyph = (b: BatteryLike) =>
  b.charging
    ? "battery_charging_full"
    : b.level > 0.9
      ? "battery_full"
      : b.level > 0.6
        ? "battery_5_bar"
        : b.level > 0.3
          ? "battery_3_bar"
          : "battery_1_bar";

function renderStatus() {
  netIcon.textContent = navigator.onLine ? "wifi" : "wifi_off";
  volIcon.textContent = soundsEnabled() ? "volume_up" : "volume_off";
  if (battery) {
    batIcon.hidden = false;
    batIcon.textContent = batteryGlyph(battery);
  }
  statusBtn.setAttribute(
    "aria-label",
    `Quick settings. ${navigator.onLine ? "Online" : "Offline"}, sounds ${soundsEnabled() ? "on" : "off"}${battery ? `, battery ${Math.round(battery.level * 100)}%` : ""}`,
  );
}
addEventListener("online", renderStatus);
addEventListener("offline", renderStatus);
(navigator as Navigator & { getBattery?: () => Promise<BatteryLike> })
  .getBattery?.()
  .then((b) => {
    battery = b;
    b.addEventListener("levelchange", renderStatus);
    b.addEventListener("chargingchange", renderStatus);
    renderStatus();
  })
  .catch(() => {});

function renderQuick() {
  const mode = prefs.get("theme.mode");
  const tile = (
    glyph: string,
    title: string,
    sub: string,
    on: boolean,
    onclick?: () => void,
  ) =>
    h(
      onclick ? "button" : "div",
      {
        class: `qtile${on ? " on" : ""}`,
        ...(onclick
          ? { onclick, role: "switch", "aria-checked": String(on) }
          : {}),
      },
      sym(glyph),
      h("span", {}, h("strong", {}, title), h("span", { class: "qsub" }, sub)),
    );
  const storage = h("div", { class: "qstorage" });
  void navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
    if (!quota) return;
    const mb = formatBytes;
    storage.replaceChildren(
      h(
        "div",
        { class: "qstorage-label" },
        sym("hard_drive"),
        h("span", {}, `${mb(usage)} of ${mb(quota)} used on this device`),
      ),
      h("progress", { max: quota, value: usage, "aria-label": "Storage used" }),
    );
  });
  quick.replaceChildren(
    h(
      "div",
      { class: "qhead" },
      h(
        "div",
        {},
        h("strong", {}, formatDate(new Date(), "long")),
        battery
          ? h(
              "span",
              { class: "qsub" },
              `Battery ${Math.round(battery.level * 100)}%${battery.charging ? ", charging" : ""}`,
            )
          : null,
      ),
      h(
        "button",
        {
          class: "tbtn",
          "aria-label": "All settings",
          "data-tip": "All settings",
          onclick: () => {
            quick.hidePopover();
            openSettings();
          },
        },
        icon("gear"),
      ),
    ),
    h(
      "div",
      { class: "qgrid" },
      tile(
        navigator.onLine ? "wifi" : "wifi_off",
        "Network",
        navigator.onLine ? "Online" : "Offline, apps keep working",
        navigator.onLine,
      ),
      tile(
        soundsEnabled() ? "volume_up" : "volume_off",
        "Sounds",
        soundsEnabled() ? "On" : "Off",
        soundsEnabled(),
        () => setSoundsEnabled(!soundsEnabled()),
      ),
      tile(
        mode === "dark"
          ? "dark_mode"
          : mode === "light"
            ? "light_mode"
            : "brightness_auto",
        "Appearance",
        mode === "auto" ? "Automatic" : mode === "dark" ? "Dark" : "Light",
        mode !== "light",
        () => {
          prefs.set(
            "theme.mode",
            mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto",
          );
        },
      ),
      tile(
        LAYOUT_GLYPH[wm.layout()],
        "Tiling",
        LAYOUT_NAME[wm.layout()],
        wm.layout() !== "floating",
        () => wm.toggleTiled(),
      ),
    ),
    h(
      "div",
      { class: "qthemes" },
      ...THEMES.map((t) =>
        themeSwatch(t, () => prefs.set("theme.id", t.id), "lg"),
      ),
    ),
    storage,
  );
}
quick.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState === "open") renderQuick();
});
prefs.subscribe("*", () => {
  if (quick.matches(":popover-open")) renderQuick();
});
wm.onChange(() => {
  if (quick.matches(":popover-open")) renderQuick();
});

function tick() {
  const d = new Date();
  timeEl.textContent = formatTime(d);
  timeEl.dateTime = d.toISOString();
  const dateStyle = prefs.get("clock.date");
  dateEl.hidden = dateStyle === "none";
  dateEl.textContent = dateStyle === "none" ? "" : formatDate(d, dateStyle);
  if (narrow.matches) renderHome();
}
let clockTimer: ReturnType<typeof setInterval> | undefined;
/** Tick each second when the clock shows seconds, else on the minute. */
function startClock() {
  clearInterval(clockTimer);
  tick();
  clockTimer = setInterval(tick, prefs.get("clock.seconds") ? 1000 : 15_000);
}

function renderBar() {
  const active = wm.active();
  activeApp.replaceChildren(
    ...(active
      ? [icon(active.iconName), h("span", {}, active.title)]
      : [h("span", {}, "Desktop")]),
  );
  activeApp.classList.toggle("idle", !active);
  const occupied = wm.occupied();
  const shown = wm.workspaceCount;
  wsBar.replaceChildren(
    ...Array.from({ length: shown }, (_, i) => {
      const n = i + 1;
      const label = String(n === 10 ? 0 : n);
      return h(
        "button",
        {
          class: `ws${wm.workspace === n ? " cur" : ""}${occupied.has(n) ? " occ" : ""}`,
          "aria-label": `Workspace ${label}${occupied.has(n) ? ", has windows" : ""}`,
          "aria-current": wm.workspace === n ? "true" : undefined,
          "data-tip": `Workspace ${label}`,
          onclick: () => wm.goTo(n),
        },
        h("span", { class: "ws-mark" }, wm.workspace === n ? label : ""),
      );
    }),
  );
  const layout = wm.layout();
  layoutBtn.replaceChildren(sym(LAYOUT_GLYPH[layout]));
  layoutBtn.setAttribute(
    "aria-label",
    `Layout: ${LAYOUT_NAME[layout]}. Change layout`,
  );
  const layoutHint = hintOf("layout.next");
  layoutBtn.dataset.tip = layoutHint
    ? `${LAYOUT_NAME[layout]} (${chordCaps(layoutHint).join("+")})`
    : LAYOUT_NAME[layout];
}
wm.onChange(renderBar);

const barLeft = h("div", { class: "bar-left" });
const barCenter = h("div", { class: "bar-center" });
const barRight = h("div", { class: "bar-right" });
bar.append(barLeft, barCenter, barRight);
const BAR_PARTS: Record<BarItem, HTMLElement> = {
  launcher: h(
    "button",
    {
      class: "brand",
      onclick: () => toggleLauncher(),
      "aria-label": "Show all apps",
      "data-tip": "All apps",
    },
    h("img", { src: "/brand/64.png", alt: "", width: 22, height: 22 }),
  ),
  workspaces: wsBar,
  active: activeApp,
  clock: h(
    "button",
    {
      class: "bar-clock",
      popovertarget: "quick",
      title: "Date and quick settings",
    },
    timeEl,
    dateEl,
  ),
  layout: layoutBtn,
  search: h(
    "button",
    {
      class: "tbtn",
      "aria-label": "Search",
      "data-tip": "Search",
      onclick: () => openLauncher(),
    },
    icon("search"),
  ),
  status: statusBtn,
  settings: h(
    "button",
    {
      class: "tbtn",
      "aria-label": "Open settings",
      "data-tip": "Settings",
      onclick: () => openSettings(),
    },
    icon("gear"),
  ),
};
/** Place the bar items in their zones (Settings, Desktop, Top bar). */
function layoutBar() {
  const zones = prefs.get("bar.items");
  const order = Object.keys(BAR_PARTS) as BarItem[];
  for (const [zone, el] of [
    ["left", barLeft],
    ["center", barCenter],
    ["right", barRight],
  ] as const)
    el.replaceChildren(
      ...order.filter((i) => zones[i] === zone).map((i) => BAR_PARTS[i]),
    );
  const launcherHint = hintOf("launcher");
  BAR_PARTS.launcher.dataset.tip = launcherHint
    ? `All apps (${chordCaps(launcherHint).join("+")})`
    : "All apps";
}
prefs.subscribe("bar.items", layoutBar);
prefs.subscribe("keys.bindings", () => {
  layoutBar();
  renderBar();
});
layoutBar();

// Desktop icons -------------------------------------------------------------------------------------
const deskIcons = h("nav", { class: "deskicons", "aria-label": "Desktop" });
function renderDeskIcons() {
  deskIcons.hidden = !prefs.get("desktop.icons");
  if (deskIcons.hidden) return deskIcons.replaceChildren();
  const catalogItems = new Map(launchItems().map((i) => [i.id, i]));
  deskIcons.replaceChildren(
    ...prefs.get("desktop.apps").flatMap((id) => {
      const item = catalogItems.get(id);
      return item
        ? [
            h(
              "button",
              {
                class: "deskicon",
                title: item.desc,
                ondblclick: () => item.run(),
                onkeydown: (e: KeyboardEvent) => {
                  if (e.key === "Enter") item.run();
                },
              },
              appIcon(item.id, item.icon),
              h("span", { class: "lname" }, item.name),
            ),
          ]
        : [];
    }),
  );
}
desk.append(deskIcons);

// Window manager and wallpaper follow the preferences -------------------------------------------
/** Space the dock takes on its edge, so tiles and maximized windows stay clear of it. */
function dockReserve() {
  const size =
    prefs.get("dock.size") + (prefs.get("a11y.largeTargets") ? 12 : 10);
  const band = prefs.get("dock.autohide") || narrow.matches ? 0 : size + 30;
  const edge = prefs.get("dock.position");
  return {
    top: 0,
    bottom: edge === "bottom" ? band : 0,
    left: edge === "left" ? band : 0,
    right: edge === "right" ? band : 0,
  };
}
function configureWm() {
  const reserve = dockReserve();
  for (const [k, v] of Object.entries(reserve))
    document.documentElement.style.setProperty(`--reserve-${k}`, `${v}px`);
  wm.configure({
    gap: prefs.get("windows.gap"),
    defaultLayout: prefs.get("windows.tiling"),
    workspaces: prefs.get("workspaces.count"),
    reserve,
  });
}
for (const key of [
  "windows.gap",
  "windows.tiling",
  "workspaces.count",
  "dock.size",
  "dock.position",
  "dock.autohide",
  "a11y.largeTargets",
] as const)
  prefs.subscribe(key, configureWm);
narrow.addEventListener("change", configureWm);
prefs.subscribe("dock.pinned", () => {
  renderDock();
  renderDeskIcons();
});
prefs.subscribe("desktop.icons", renderDeskIcons);
prefs.subscribe("desktop.apps", renderDeskIcons);
for (const key of [
  "clock.seconds",
  "clock.hourCycle",
  "clock.date",
  "region.locale",
  "region.timeZone",
  "region.dateStyle",
] as const)
  prefs.subscribe(key, startClock);
prefs.subscribe("sound.enabled", renderStatus);

const wallpaperFor = (ws: number): WallpaperSpec =>
  prefs.get("wallpaper.workspaces")[ws] ?? prefs.get("wallpaper.default");

// Dock autohide: the dock slides in when the pointer reaches its edge or a dock button gets focus.
const dockEdge = h("div", { class: "dock-edge", "aria-hidden": "true" });
let dockHideTimer: ReturnType<typeof setTimeout> | undefined;
const peekDock = (on: boolean) => {
  clearTimeout(dockHideTimer);
  if (on) dock.classList.add("peek");
  else dockHideTimer = setTimeout(() => dock.classList.remove("peek"), 600);
};
dockEdge.addEventListener("pointerenter", () => peekDock(true));
dock.addEventListener("pointerenter", () => peekDock(true));
dock.addEventListener("pointerleave", () => peekDock(false));
dock.addEventListener("focusin", () => peekDock(true));
dock.addEventListener("focusout", () => peekDock(false));

// Boot ---------------------------------------------------------------------------------------------
desk.id = "desk";
desk.tabIndex = -1;
document.body.append(
  h("a", { class: "skip", href: "#desk" }, "Skip to desktop"),
  bar,
  desk,
  dock,
  dockEdge,
  launcher,
  quick,
);
const wallpaper = mountWallpaper(wallpaperFor(wm.workspace));
onThemeChange(() => wallpaper.repaint());
const showWallpaper = () => wallpaper.show(wallpaperFor(wm.workspace));
prefs.subscribe("wallpaper.default", showWallpaper);
prefs.subscribe("wallpaper.workspaces", showWallpaper);
let announcedWs = wm.workspace;
wm.onChange(() => {
  showWallpaper();
  // Closing Settings leaves its /settings/<section> address.
  if (settingsView && !wm.windows.has("settings")) {
    settingsView.dispose();
    settingsView = undefined;
    if (location.pathname.startsWith("/settings"))
      history.replaceState(null, "", "/");
  }
  if (wm.workspace !== announcedWs) {
    announcedWs = wm.workspace;
    announce(`Workspace ${wm.workspace}`);
  }
});
configureWm();
startClock();
refreshApps();
renderBar();
renderStatus();
initSounds();
installNotifications();
installKeys(wm, {
  launcher: toggleLauncher,
  launch: (id) => {
    if (id === "settings") return openSettings();
    const b = builtins.find((entry) => entry.id === id);
    if (b) launchBuiltin(b);
  },
  help: () => launchBuiltin(builtins.find((b) => b.id === "keys")!),
  webHotkey: (code) => {
    const app = webApps().find((a) => a.key === code);
    if (app) openWebApp(app);
    return !!app;
  },
});

void registerServiceWorker();
// /?app=<id> (legacy) or a catalog path (/pdf, /templates, /source/<member>) selects the app to open
// (infra/config/routes.catalog.json).
const wanted =
  new URLSearchParams(location.search).get("app") ??
  appForPath(location.pathname) ??
  null;
const registryReady = reconcile()
  .then(registry)
  .then((entries) => {
    registryEntries = entries;
    refreshApps();
  })
  .catch(() => {});

// A requested app opens directly; a plain visit lands on a calm desktop (welcome card on the first one).
const settingsPath = /^\/settings(?:\/([a-z]+))?\/?$/.exec(location.pathname);
if (settingsPath)
  openSettings(isSection(settingsPath[1]) ? settingsPath[1] : "appearance");
else if (wanted) {
  // Packages and members are known once the registry and the catalog have loaded.
  if (!openApp(wanted))
    void Promise.all([registryReady, membersReady]).then(() => {
      if (!openApp(wanted)) showWelcome();
    });
} else showWelcome();
