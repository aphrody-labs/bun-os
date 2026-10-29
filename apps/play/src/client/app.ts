// SPDX-License-Identifier: Apache-2.0
/**
 * Bun OS Play client (design-system/bun-os-play/DIRECTION.md over MASTER.md).
 *   /            home: the focused game's real art full-bleed, one rail of capsules
 *   /play/<md5>  in-browser emulation through published web cores
 *   /steam       Steam on the gaming host (signed in)
 *   /stream      gamestream client (signed in)
 *   /engine      Bun Engine systems, jobs and the nginx engine (signed in)
 * Strings come from messages.ts, colors from the per-game M3 scheme (theme.ts).
 */
import { observeWindowClass } from "@aphrody/m3-front/window-class";
import {
  installedSteamGame,
  steamAppId,
  steamStreamUrl,
} from "../steam-target";
import {
  coreFor,
  type CoreManifest,
  runCore,
  type RunningCore,
} from "./emulator";
import { icon, type IconName } from "./icons";
import { locale, type MessageId, t, th } from "./messages";
import { installSpatialNavigation } from "./spatial";
import {
  setThemeMode,
  type ThemeMode,
  themeMode,
  tintFromImage,
} from "./theme";

interface ArtImage {
  src: string;
  srcset: string;
  avifSrcset: string | null;
  width: number;
  height: number;
  pixelated: boolean;
}
interface CatalogSystem {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  native: string | null;
  games: number;
  icon: ArtImage | null;
}
interface CatalogGame {
  id: string;
  system: string;
  title: string;
  size: number;
  rom: string;
  source: string;
  kind: string;
  license: string | null;
  art: { capsule: ArtImage | null; hero: ArtImage | null };
}
interface Catalog {
  generatedAt: string;
  systems: CatalogSystem[];
  games: CatalogGame[];
}
interface SessionInfo {
  authenticated: boolean;
  user: string | null;
  via: string | null;
  host: string;
  methods: { mesh: string; steam: string | null };
}
interface SteamGame {
  appId: number;
  name: string;
  sizeOnDisk: number;
  stateFlags: number;
  buildId: string | null;
  kind: "game" | "tool";
}
/** One entry of the home rail: an emulated game or a Steam game. */
interface RailEntry {
  key: string;
  title: string;
  system: string;
  capsule: {
    src: string;
    srcset: string;
    avifSrcset: string | null;
    pixelated: boolean;
  } | null;
  hero: {
    src: string;
    srcset: string;
    avifSrcset: string | null;
    pixelated: boolean;
  } | null;
  game?: CatalogGame;
  steam?: SteamGame;
}

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const main = $<HTMLElement>("main");
const nav = $<HTMLElement>("nav");
const account = $<HTMLElement>("account");
const quickMenu = $<HTMLDialogElement>("quick-menu");
const menuButton = $<HTMLButtonElement>("menu-button");
const signin = $<HTMLDialogElement>("signin");
const toastEl = $<HTMLElement>("toast");

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function bytes(n: number | null | undefined): string {
  if (n == null) return "";
  const units = [
    "byte",
    "kilobyte",
    "megabyte",
    "gigabyte",
    "terabyte",
  ] as const;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value);
}
const dateFormat = new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
  timeStyle: "short",
});
const clockFormat = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw Object.assign(new Error(`HTTP ${response.status}`), {
      status: response.status,
    });
  return response.json() as Promise<T>;
}

let toastTimer = 0;
function toast(
  id: MessageId,
  args: Record<string, string | number> = {},
): void {
  toastEl.textContent = t(id, args);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4000);
}

// ------------------------------------------------------------------ state
let session: SessionInfo = {
  authenticated: false,
  user: null,
  via: null,
  host: "",
  methods: { mesh: "", steam: null },
};
let catalog: Catalog | null = null;
let cores: CoreManifest[] = [];
let steamGames: SteamGame[] = [];
let running: RunningCore | null = null;
let systemFilter = "all";
const listeners = new Map<string, Set<(data: unknown) => void>>();
const latest = new Map<string, unknown>();

function on(topic: string, listener: (data: unknown) => void): () => void {
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(listener);
  if (latest.has(topic)) listener(latest.get(topic));
  return () => set.delete(listener);
}
function emit(topic: string, data: unknown): void {
  latest.set(topic, data);
  for (const listener of listeners.get(topic) ?? []) listener(data);
}

// ------------------------------------------------------------------ realtime
let socket: WebSocket | null = null;
let retry = 0;
function connectRealtime(): void {
  if (!session.authenticated || socket) return;
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?topics=steam,downloads,lancache,stream,engine,nginx`,
  );
  socket = ws;
  ws.onopen = () => (retry = 0);
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      type: string;
      topic: string;
      data: unknown;
    };
    if (message.type === "event") emit(message.topic, message.data);
  };
  ws.onclose = () => {
    socket = null;
    if (session.authenticated)
      setTimeout(connectRealtime, Math.min(30_000, 1000 * 2 ** retry++));
  };
}
on("steam", (data) => {
  const status = data as { available: boolean; games?: SteamGame[] };
  if (status.available) steamGames = status.games ?? [];
});

// ------------------------------------------------------------------ shell
const ROUTES: {
  path: string;
  label: MessageId;
  icon: IconName;
  private?: boolean;
}[] = [
  { path: "/", label: "nav-library", icon: "home" },
  { path: "/steam", label: "nav-steam", icon: "cloud_download", private: true },
  { path: "/stream", label: "nav-stream", icon: "cast", private: true },
  { path: "/engine", label: "nav-engine", icon: "memory", private: true },
];

function renderShell(): void {
  const current = location.pathname.startsWith("/play/")
    ? "/"
    : location.pathname;
  nav.setAttribute("aria-label", t("nav-primary"));
  nav.innerHTML = ROUTES.map((route) => {
    const selected = current === route.path;
    const locked = route.private && !session.authenticated;
    const label = locked
      ? th("nav-requires-sign-in", { label: t(route.label) })
      : th(route.label);
    return `<a class="nav-item" href="${route.path}" data-link aria-label="${label}" ${selected ? 'aria-current="page"' : ""}>
      <span class="indicator">${icon(locked ? "lock" : route.icon, { filled: selected })}</span>
      <span aria-hidden="true">${th(route.label)}</span>
    </a>`;
  }).join("");
  menuButton.innerHTML = icon("menu");
  menuButton.setAttribute("aria-label", t("menu-open"));
  account.innerHTML = session.authenticated
    ? `<button class="btn text" id="logout" type="button">${icon("logout", { size: "sm" })}${th("account-sign-out")}</button>`
    : `<button class="btn tonal" id="login" type="button">${icon("login", { size: "sm" })}${th("account-sign-in")}</button>`;
  $("login")?.addEventListener("click", openSignin);
  $("logout")?.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    session = { ...session, authenticated: false, user: null, via: null };
    steamGames = [];
    socket?.close();
    void route();
  });
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    element.textContent = t(element.dataset.i18n as MessageId);
  document.title = t("app-name");
}

function openSignin(): void {
  signin.innerHTML = `<form method="dialog" class="modal-body">
    <h2 id="signin-title">${th("signin-title")}</h2>
    <p class="hint">${th("signin-body")}</p>
    <a class="btn filled" href="${esc(session.methods.mesh)}">${icon("lock", { size: "sm" })}${th("signin-mesh")}</a>
    ${session.methods.steam ? `<a class="btn outlined" href="${esc(session.methods.steam)}">${icon("login", { size: "sm" })}${th("signin-steam")}</a>` : ""}
    <p class="hint">${th("signin-mesh-hint")}</p>
    <button class="btn text" value="close">${th("menu-close")}</button>
  </form>`;
  signin.showModal();
}

function renderQuickMenu(): void {
  const systems = (catalog?.systems ?? []).filter((system) => system.games > 0);
  const mode = themeMode();
  const steamCount = steamGames.filter((game) => game.kind === "game").length;
  quickMenu.innerHTML = `<div class="sheet-body">
    <div class="sheet-head"><h2 id="quick-menu-title">${th("menu-title")}</h2>
      <button class="icon-button" type="button" id="menu-close" aria-label="${th("menu-close")}">${icon("close")}</button></div>
    <section class="sheet-section"><h3>${th("menu-systems")}</h3><div class="chips">
      <button class="chip" type="button" data-system="all" aria-pressed="${systemFilter === "all"}">${th("menu-all-systems")}</button>
      ${steamCount ? `<button class="chip" type="button" data-system="steam" aria-pressed="${systemFilter === "steam"}">${th("source-steam")}</button>` : ""}
      ${systems
        .map(
          (system) =>
            `<button class="chip" type="button" data-system="${esc(system.id)}" aria-pressed="${systemFilter === system.id}">${system.icon ? `<img src="${esc(system.icon.src)}" srcset="${esc(system.icon.srcset)}" sizes="24px" width="24" height="24" alt="" />` : ""}${esc(system.name)}</button>`,
        )
        .join("")}
    </div></section>
    <section class="sheet-section"><h3>${th("menu-theme")}</h3><div class="segmented" role="group" aria-label="${th("menu-theme")}">
      ${(["system", "light", "dark"] as ThemeMode[])
        .map(
          (value) =>
            `<button class="segment" type="button" data-theme="${value}" aria-pressed="${mode === value}">${icon(value === "system" ? "brightness_auto" : value === "light" ? "light_mode" : "dark_mode", { size: "sm" })}${th(`theme-${value}`)}</button>`,
        )
        .join("")}
    </div></section>
    ${session.authenticated ? `<section class="sheet-section"><p class="hint">${th("account-signed-in", { user: session.user ?? "" })}</p></section>` : ""}
    <section class="sheet-section"><h3>${th("menu-credits")}</h3>
      <p class="hint">${th("credits-icons")}</p><p class="hint">${th("credits-systems")}</p>
      <p class="hint">${th("credits-thumbnails")}</p><p class="hint">${th("credits-steam")}</p></section>
  </div>`;
  $("menu-close")?.addEventListener("click", () => quickMenu.close());
  for (const chip of quickMenu.querySelectorAll<HTMLButtonElement>(
    "[data-system]",
  ))
    chip.addEventListener("click", () => {
      systemFilter = chip.dataset.system!;
      quickMenu.close();
      if (location.pathname !== "/") navigate("/");
      else void route();
    });
  for (const segment of quickMenu.querySelectorAll<HTMLButtonElement>(
    "[data-theme]",
  ))
    segment.addEventListener("click", () => {
      setThemeMode(segment.dataset.theme as ThemeMode);
      renderQuickMenu();
      quickMenu
        .querySelector<HTMLElement>(`[data-theme="${segment.dataset.theme}"]`)
        ?.focus();
    });
}
menuButton.addEventListener("click", () => {
  renderQuickMenu();
  quickMenu.showModal();
  menuButton.setAttribute("aria-expanded", "true");
});
quickMenu.addEventListener("close", () =>
  menuButton.setAttribute("aria-expanded", "false"),
);
quickMenu.addEventListener(
  "click",
  (event) => event.target === quickMenu && quickMenu.close(),
);

function locked(page: MessageId): void {
  main.innerHTML = `<section class="empty">
    ${icon("lock", { size: "lg" })}
    <h1>${th("locked-title", { page: t(page) })}</h1>
    <p class="hint">${th("locked-body")}</p>
    <button class="btn filled" type="button" id="locked-signin">${icon("login", { size: "sm" })}${th("account-sign-in")}</button>
  </section>`;
  $("locked-signin")?.addEventListener("click", openSignin);
}

function loadError(what: string, error: unknown): string {
  return `<section class="empty">${icon("error", { size: "lg" })}<p>${th("error-load", { what, error: error instanceof Error ? error.message : String(error) })}</p></section>`;
}

// ------------------------------------------------------------------ home
const steamArt = (appId: number, kind: string, width: number) =>
  `/art/steam/${appId}/${kind}?w=${width}`;

function railEntries(): RailEntry[] {
  const systems = new Map(
    (catalog?.systems ?? []).map((system) => [system.id, system.name]),
  );
  const entries: RailEntry[] = [];
  if (systemFilter === "all" || systemFilter === "steam")
    for (const game of steamGames.filter((item) => item.kind === "game"))
      entries.push({
        key: `steam-${game.appId}`,
        title: game.name,
        system: t("source-steam"),
        capsule: {
          src: steamArt(game.appId, "capsule", 300),
          srcset: [200, 300, 600]
            .map((w) => `${steamArt(game.appId, "capsule", w)} ${w}w`)
            .join(", "),
          avifSrcset: null,
          pixelated: false,
        },
        hero: {
          src: steamArt(game.appId, "hero", 1920),
          srcset: [960, 1920]
            .map((w) => `${steamArt(game.appId, "hero", w)} ${w}w`)
            .join(", "),
          avifSrcset: null,
          pixelated: false,
        },
        steam: game,
      });
  if (systemFilter !== "steam")
    for (const game of catalog?.games ?? []) {
      if (
        game.kind !== "homebrew" ||
        (systemFilter !== "all" && game.system !== systemFilter)
      )
        continue;
      const { capsule, hero } = game.art;
      entries.push({
        key: game.id,
        title: game.title,
        system: systems.get(game.system) ?? game.system,
        capsule: capsule ?? null,
        hero: hero ?? null,
        game,
      });
    }
  return entries;
}

function picture(
  image: NonNullable<RailEntry["hero"]>,
  attributes: string,
): string {
  return `<picture>${image.avifSrcset ? `<source type="image/avif" srcset="${esc(image.avifSrcset)}" />` : ""}<img src="${esc(image.src)}" srcset="${esc(image.srcset)}" ${attributes} /></picture>`;
}

function tileHtml(entry: RailEntry, index: number): string {
  const body = entry.capsule
    ? `<img src="${esc(entry.capsule.src)}" srcset="${esc(entry.capsule.srcset)}" sizes="200px" width="200" height="300" alt="" loading="${index < 6 ? "eager" : "lazy"}" decoding="async" class="${entry.capsule.pixelated ? "pixelated" : ""}" data-art />`
    : "";
  return `<button class="tile state" type="button" role="option" id="tile-${esc(entry.key)}" data-key="${esc(entry.key)}" aria-selected="false" aria-label="${esc(entry.title)}, ${esc(entry.system)}">
    ${body}<span class="tile-type" ${entry.capsule ? "hidden" : ""}><strong>${esc(entry.title)}</strong><span>${esc(entry.system)}</span></span>
  </button>`;
}

let heroLayer = 0;
async function focusEntry(
  entry: RailEntry | undefined,
  first = false,
): Promise<void> {
  const copy = $("hero-copy");
  const art = $("hero-art");
  if (!copy || !art) return;
  for (const tile of document.querySelectorAll(".tile"))
    tile.setAttribute(
      "aria-selected",
      String(tile.id === `tile-${entry?.key}`),
    );
  if (!entry) {
    copy.innerHTML = `<h1 class="hero-title">${th("hero-empty-title")}</h1><p class="hero-note">${th("rail-empty")}</p>`;
    void tintFromImage(null);
    return;
  }
  const core = entry.game ? coreFor(cores, entry.game.system) : undefined;
  const host = session.host || "VPS";
  const actions: string[] = [];
  if (entry.game && core)
    actions.push(
      `<a class="btn filled" href="/play/${esc(entry.game.id)}" data-link>${icon("play_arrow", { filled: true })}${th("action-play")}</a>`,
    );
  if (session.authenticated)
    actions.push(
      `<a class="btn ${actions.length ? "tonal" : "filled"}" href="${entry.steam ? steamStreamUrl(entry.steam.appId) : "/stream"}" data-link data-toast="toast-streaming">${icon("cast")}${th("action-stream", { host })}</a>`,
    );
  if (entry.game)
    actions.push(
      `<a class="btn text" href="/play/${esc(entry.game.id)}" data-link>${th("action-details")}</a>`,
    );
  const note =
    entry.game && !core ? th("core-none", { system: entry.system, host }) : "";
  copy.innerHTML = `<p class="hero-system">${esc(entry.system)}</p>
    <h1 class="hero-title">${esc(entry.title)}</h1>
    <div class="hero-actions">${actions.join("")}</div>
    ${note ? `<p class="hero-note">${note}</p>` : ""}`;

  // Cross-fade the hero and re-tint the scheme together.
  const layers = art.querySelectorAll<HTMLElement>("picture");
  heroLayer = 1 - heroLayer;
  const target = layers[heroLayer]!;
  const other = layers[1 - heroLayer]!;
  const tile = document.querySelector<HTMLImageElement>(
    `#tile-${CSS.escape(entry.key)} img[data-art]`,
  );
  if (entry.hero) {
    target.outerHTML = picture(
      entry.hero,
      `alt="" sizes="100vw" class="${entry.hero.pixelated ? "pixelated" : ""}" ${first ? 'fetchpriority="high" loading="eager"' : 'loading="eager"'} decoding="async"`,
    );
    const fresh = art.querySelectorAll<HTMLElement>("picture")[heroLayer]!;
    const image = fresh.querySelector("img")!;
    image.onerror = () => image.classList.remove("shown");
    await image.decode().catch(() => undefined);
    image.classList.add("shown");
  } else target.querySelector("img")?.classList.remove("shown");
  other.querySelector("img")?.classList.remove("shown");
  if (tile) await tile.decode().catch(() => undefined);
  void tintFromImage(tile?.naturalWidth ? tile : null);
}

async function renderHome(): Promise<() => void> {
  catalog ??= await api<Catalog>("/catalog.json");
  const entries = railEntries();
  document.body.classList.add("home-active");
  main.innerHTML = `<section class="home">
    <div class="hero-art" id="hero-art" aria-hidden="true"><picture><img alt="" /></picture><picture><img alt="" /></picture></div>
    <div class="hero-scrim"></div>
    <div class="hero-copy" id="hero-copy" aria-live="polite"></div>
    <div class="rail-zone">
      <div class="rail-head"><h2 id="rail-title">${th("rail-games")}</h2>
        <div class="status-corner"><span id="rail-system"></span><span class="clock" id="clock"></span>
          <span class="pad" id="pad" role="img"></span></div></div>
      ${entries.length ? `<div class="rail" id="rail" role="listbox" aria-labelledby="rail-title">${entries.map(tileHtml).join("")}</div>` : `<div class="empty"><p>${th("rail-empty")}</p><button class="btn tonal" type="button" id="empty-signin">${icon("login", { size: "sm" })}${th("account-sign-in")}</button></div>`}
    </div>
  </section>`;
  $("empty-signin")?.addEventListener(
    "click",
    session.authenticated ? () => menuButton.click() : openSignin,
  );
  const rail = $("rail");
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  for (const image of main.querySelectorAll<HTMLImageElement>("img[data-art]"))
    image.addEventListener("error", () => {
      // No art for this entry: the typographic tile of the real title stays.
      image.remove();
      image.parentElement
        ?.querySelector(".tile-type")
        ?.removeAttribute("hidden");
    });
  let current = "";
  const select = (key: string, first = false) => {
    if (key === current) return;
    current = key;
    const entry = byKey.get(key);
    $("rail-system").textContent = entry?.system ?? "";
    void focusEntry(entry, first);
  };
  rail?.addEventListener("focusin", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".tile");
    if (tile) select(tile.dataset.key!);
  });
  rail?.addEventListener("pointerover", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".tile");
    if (tile && matchMedia("(hover: hover)").matches) select(tile.dataset.key!);
  });
  rail?.addEventListener("click", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>(".tile");
    if (!tile) return;
    const entry = byKey.get(tile.dataset.key!);
    if (entry?.game) navigate(`/play/${entry.game.id}`);
    else if (entry?.steam) {
      toast("toast-streaming", { host: session.host });
      navigate(steamStreamUrl(entry.steam.appId));
    }
  });
  select(entries[0]?.key ?? "", true);
  // Console home: the selected tile holds focus, so the pad and arrow keys act at once.
  document.querySelector<HTMLElement>(".tile")?.focus({ preventScroll: true });
  if (!entries.length) void focusEntry(undefined);

  const clock = $("clock");
  const pad = $("pad");
  const tick = () => {
    clock.textContent = clockFormat.format(new Date());
    const connected = [...navigator.getGamepads()].some(Boolean);
    pad.dataset.connected = String(connected);
    pad.setAttribute(
      "aria-label",
      t(connected ? "status-gamepad" : "status-no-gamepad"),
    );
    pad.innerHTML = icon("sports_esports", { filled: connected });
  };
  tick();
  const timer = setInterval(tick, 15_000);
  addEventListener("gamepadconnected", tick);
  addEventListener("gamepaddisconnected", tick);
  // Steam games arrive with the realtime snapshot after sign-in: rebuild the rail once.
  const offSteam = on("steam", () => {
    if (rail === null || railEntries().length !== entries.length) void route();
  });
  return () => {
    clearInterval(timer);
    removeEventListener("gamepadconnected", tick);
    removeEventListener("gamepaddisconnected", tick);
    offSteam();
    document.body.classList.remove("home-active");
  };
}

// ------------------------------------------------------------------ emulator page
async function renderPlay(id: string): Promise<void> {
  catalog ??= await api<Catalog>("/catalog.json");
  const game = catalog.games.find((item) => item.id === id);
  if (!game) {
    main.innerHTML = `<section class="empty"><p>${th("not-found")}</p><a class="btn tonal" href="/" data-link>${th("action-back")}</a></section>`;
    return;
  }
  const core = coreFor(cores, game.system);
  const system = catalog.systems.find((item) => item.id === game.system);
  const host = session.host || "VPS";
  if (game.art.hero) {
    const probe = new Image();
    probe.src = game.art.capsule?.src ?? game.art.hero.src;
    void probe.decode().then(
      () => tintFromImage(probe),
      () => undefined,
    );
  }
  main.innerHTML = `<div class="page-head">
      <a class="btn text" href="/" data-link>${icon("arrow_back")}${th("action-back")}</a>
      <h1>${esc(game.title)}</h1>
    </div>
    ${core ? `<div class="screen" id="screen"><canvas id="canvas" width="256" height="240" tabindex="0" aria-label="${esc(game.title)}"></canvas></div>` : `<section class="empty">${game.art.hero ? picture(game.art.hero, `alt="" width="${game.art.hero.width}" height="${game.art.hero.height}" class="preview ${game.art.hero.pixelated ? "pixelated" : ""}"`) : ""}<p>${th("core-none", { system: system?.name ?? game.system, host })}</p>${session.authenticated ? `<a class="btn filled" href="/stream" data-link>${icon("cast")}${th("action-stream", { host })}</a>` : ""}</section>`}
    <div class="panels" style="margin-top:var(--space-4)">
      <div class="panel"><h3>${icon("deployed_code", { size: "sm" })}${th("label-core")}</h3><dl class="kv">
        <dt>${th("label-system")}</dt><dd>${esc(system?.name ?? game.system)}</dd>
        ${core ? `<dt>${th("label-core")}</dt><dd>${esc(`${core.name} ${core.version ?? ""}`)}</dd>` : ""}
        <dt>${th("core-webgpu")}</dt><dd>${"gpu" in navigator ? icon("check", { size: "sm" }) : th("core-webgpu-missing")}</dd>
        <dt>${th("core-isolation")}</dt><dd>${crossOriginIsolated ? icon("check", { size: "sm" }) : th("core-not-isolated")}</dd>
        ${core ? `<dt>${th("label-status")}</dt><dd id="core-status"></dd>` : ""}
        ${game.license ? `<dt>${th("label-license")}</dt><dd>${esc(game.license)}</dd>` : ""}
      </dl></div>
      <div class="panel"><h3>${icon("sports_esports", { size: "sm" })}${th("controls-title")}</h3><p class="hint">${th("controls-keys")}</p>
        ${core ? `<button class="btn tonal" type="button" id="fullscreen">${icon("fullscreen", { size: "sm" })}${th("action-fullscreen")}</button>` : ""}</div>
    </div>`;
  if (!core) return;
  const canvas = $<HTMLCanvasElement>("canvas");
  const status = $("core-status");
  $("fullscreen")?.addEventListener(
    "click",
    () => void $("screen")?.requestFullscreen(),
  );
  if (game.system === "nds")
    $("screen")?.style.setProperty("--aspect", String(256 / 384));
  try {
    const rom = new Uint8Array(await (await fetch(game.rom)).arrayBuffer());
    running = await runCore(core, canvas, rom, game.system, (state, detail) => {
      status.textContent =
        state === "loading"
          ? t("core-loading", { core: core.name })
          : state === "running"
            ? t("core-running", { core: core.name })
            : t("core-failed", { core: core.name, error: detail ?? "" });
    });
    canvas.focus();
  } catch (error) {
    status.textContent = t("core-failed", {
      core: core.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ------------------------------------------------------------------ steam
type SteamStatus = {
  available: boolean;
  root?: string;
  libraries?: { path: string; apps: number; freeBytes: number | null }[];
  games?: SteamGame[];
  compatTools?: {
    internalName: string;
    displayName: string;
    kind: string;
    version: string | null;
  }[];
  remotePlay?: {
    clients: {
      id: string;
      hostname: string | null;
      lastResult: string | null;
    }[];
    connections: string[];
  };
};
type Downloads = {
  rateMbps: number | null;
  rateAt: string | null;
  apps: {
    appId: number;
    name: string | null;
    state: string;
    update: string;
    updatedAt: string;
    finished: boolean;
  }[];
};
type Lancache = {
  totals: {
    requests: number;
    bytes: number;
    hitBytes: number;
    missBytes: number;
    errors: number;
    hitRatio: number;
  };
  throughput: { missMBps: number | null };
  depots: { depot: number; chunks: number; bytes: number }[];
};
const rateFormat = new Intl.NumberFormat(locale, {
  style: "unit",
  unit: "megabit-per-second",
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat(locale, { style: "percent" });

function renderSteam(): () => void {
  if (!session.authenticated) {
    locked("nav-steam");
    return () => {};
  }
  const host = session.host;
  main.innerHTML = `
    <div class="page-head"><h1>${th("steam-title", { host })}</h1><span class="hint end" id="steam-state"></span></div>
    <div class="panels">
      <div class="panel" id="downloads"><h3>${icon("cloud_download", { size: "sm" })}${th("steam-downloads")}</h3><p class="hint">${th("steam-no-updates")}</p></div>
      <div class="panel" id="lancache"><h3>${icon("storage", { size: "sm" })}${th("steam-lancache")}</h3><p class="hint">${th("steam-lancache-wait")}</p></div>
    </div>
    <div class="page-head"><h2>${th("steam-installed")}</h2></div>
    <div class="panel table-wrap" id="steam-games"></div>
    <div class="page-head"><h2>${th("steam-libraries")}</h2></div>
    <div class="panels">
      <div class="panel table-wrap" id="steam-libraries"></div>
      <div class="panel table-wrap" id="steam-tools"></div>
      <div class="panel" id="steam-remote"></div>
    </div>
    <div class="page-head"><h2>${th("steam-audit")}</h2><button class="btn tonal end" type="button" id="audit">${icon("refresh", { size: "sm" })}${th("action-audit")}</button></div>
    <div class="panel" id="audit-result"><p class="hint">${th("steam-audit-none")}</p></div>`;

  const offSteam = on("steam", (data) => {
    const steam = data as SteamStatus;
    const state = $("steam-state");
    if (!state) return;
    state.textContent = steam.available
      ? t("steam-client", { root: steam.root ?? "" })
      : t("steam-missing");
    if (!steam.available) return;
    const games = (steam.games ?? []).filter((game) => game.kind === "game");
    $("steam-games").innerHTML = games.length
      ? `<table class="table"><thead><tr><th></th><th>${th("col-game")}</th><th class="num">${th("col-size")}</th><th>${th("col-build")}</th></tr></thead><tbody>${games
          .map(
            (game) =>
              `<tr><td><img class="thumb" src="${steamArt(game.appId, "header", 230)}" srcset="${steamArt(game.appId, "header", 230)} 230w, ${steamArt(game.appId, "header", 460)} 460w" sizes="115px" width="115" height="54" alt="" loading="lazy" /></td><td>${esc(game.name)}</td><td class="num">${bytes(game.sizeOnDisk)}</td><td>${esc(game.buildId ?? "")}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : `<p class="hint">${th("steam-none-installed", { host })}</p>`;
    $("steam-libraries").innerHTML =
      `<h3>${icon("storage", { size: "sm" })}${th("steam-libraries")}</h3><table class="table"><tbody>${(steam.libraries ?? []).map((library) => `<tr><td>${esc(library.path)}</td><td class="num">${th("steam-apps", { count: library.apps })}</td><td class="num">${th("steam-free", { bytes: bytes(library.freeBytes) })}</td></tr>`).join("")}</tbody></table>`;
    $("steam-tools").innerHTML =
      `<h3>${icon("deployed_code", { size: "sm" })}${th("steam-tools")}</h3><table class="table"><tbody>${(steam.compatTools ?? []).map((tool) => `<tr><td>${esc(tool.displayName)}</td><td>${esc(tool.version ?? "")}</td></tr>`).join("")}</tbody></table>`;
    const remote = steam.remotePlay ?? { clients: [], connections: [] };
    $("steam-remote").innerHTML =
      `<h3>${icon("cast", { size: "sm" })}${th("steam-remote-play")}</h3>${remote.clients.length ? `<dl class="kv">${remote.clients.map((client) => `<dt>${esc(client.hostname ?? client.id)}</dt><dd>${esc(client.lastResult ?? "")}</dd>`).join("")}</dl>` : `<p class="hint">${th("steam-no-peers")}</p>`}${remote.connections.length ? `<pre class="log">${esc(remote.connections.join("\n"))}</pre>` : ""}`;
  });
  const offDownloads = on("downloads", (data) => {
    const downloads = data as Downloads;
    const panel = $("downloads");
    if (!panel) return;
    panel.innerHTML = `<h3>${icon("cloud_download", { size: "sm" })}${th("steam-downloads")}</h3>
      <dl class="kv"><dt>${th("steam-rate")}</dt><dd>${downloads.rateMbps == null ? "" : rateFormat.format(downloads.rateMbps)}</dd></dl>
      ${
        downloads.apps.length
          ? `<table class="table"><thead><tr><th>${th("col-game")}</th><th>${th("col-state")}</th><th>${th("col-update")}</th></tr></thead><tbody>${downloads.apps
              .slice(0, 8)
              .map(
                (app) =>
                  `<tr><td>${esc(app.name ?? app.appId)}</td><td>${esc(app.state)}</td><td>${app.finished ? `<span class="status ok">${icon("check", { size: "sm" })}${th("steam-done")}</span>` : esc(app.update)}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="hint">${th("steam-no-updates")}</p>`
      }`;
  });
  const offLancache = on("lancache", (data) => {
    const cache = data as Lancache;
    const panel = $("lancache");
    if (!panel || !cache?.totals) return;
    const ratio = cache.totals.hitRatio;
    panel.innerHTML = `<h3>${icon("storage", { size: "sm" })}${th("steam-lancache")}</h3>
      <dl class="kv"><dt>${th("steam-served")}</dt><dd>${th("steam-served-value", { bytes: bytes(cache.totals.bytes), requests: cache.totals.requests })}</dd>
      <dt>${th("steam-hit-ratio")}</dt><dd>${percentFormat.format(ratio)}</dd>
      <dt>${th("steam-miss-rate")}</dt><dd>${cache.throughput.missMBps == null ? "" : rateFormat.format(cache.throughput.missMBps * 8)}</dd>
      <dt>${th("steam-errors")}</dt><dd>${cache.totals.errors}</dd></dl>
      <div class="meter" role="meter" aria-label="${th("steam-hit-ratio")}" aria-valuenow="${Math.round(ratio * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${ratio * 100}%"></span></div>
      <table class="table"><thead><tr><th>${th("col-depot")}</th><th class="num">${th("col-chunks")}</th><th class="num">${th("col-bytes")}</th></tr></thead><tbody>${cache.depots
        .slice(0, 6)
        .map(
          (depot) =>
            `<tr><td>${depot.depot}</td><td class="num">${depot.chunks}</td><td class="num">${bytes(depot.bytes)}</td></tr>`,
        )
        .join("")}</tbody></table>`;
  });
  type Audit = {
    running: boolean;
    last: {
      at: string;
      report: { findings?: { severity: string; message: string }[] };
    } | null;
  };
  const showAudit = (result: Audit) => {
    const panel = $("audit-result");
    if (!panel) return;
    panel.innerHTML = result.last
      ? `<p class="hint">${th("steam-audit-last", { at: dateFormat.format(new Date(result.last.at)) })}</p><table class="table"><tbody>${(result.last.report.findings ?? []).map((finding) => `<tr><td>${esc(finding.severity)}</td><td>${esc(finding.message)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="hint">${th(result.running ? "steam-audit-running" : "steam-audit-none")}</p>`;
  };
  void api<Audit>("/api/steam/audit").then(showAudit, () => undefined);
  let poll = 0;
  $("audit")?.addEventListener("click", async () => {
    showAudit(await api<Audit>("/api/steam/audit", { method: "POST" }));
    toast("toast-audit");
    clearInterval(poll);
    poll = window.setInterval(async () => {
      const result = await api<Audit>("/api/steam/audit");
      showAudit(result);
      if (!result.running) clearInterval(poll);
    }, 5000);
  });
  return () => {
    offSteam();
    offDownloads();
    offLancache();
    clearInterval(poll);
  };
}

// ------------------------------------------------------------------ stream
function renderStream(): () => void {
  const requested = new URLSearchParams(location.search).get("appId");
  const appId = steamAppId(requested);
  if (!session.authenticated) {
    if (appId !== null) {
      try {
        sessionStorage.setItem("play-steam-target", String(appId));
      } catch {
        /* storage may be disabled */
      }
    }
    locked("nav-stream");
    return () => {};
  }
  if (requested !== null) {
    const game =
      appId === null ? undefined : installedSteamGame(steamGames, appId);
    main.innerHTML = `<section class="panel"><h1>${esc(game?.name ?? t("stream-title", { host: session.host }))}</h1><p id="launch-status" role="status">${th(game ? "stream-launch-note" : "stream-game-unavailable")}</p>${game ? `<button class="btn filled" id="steam-launch" type="button">${icon("play_arrow")}${th("action-play")}</button>` : ""}</section>`;
    let disposed = false;
    let closeStream = () => {};
    $("steam-launch")?.addEventListener("click", async () => {
      const button = $<HTMLButtonElement>("steam-launch");
      button.disabled = true;
      try {
        await api(`/api/steam/${appId}/launch`, { method: "POST" });
        if (disposed) return;
        $("launch-status").textContent = t("stream-launch-requested");
        // The stream remains the actual sender's picture, never a claim that this game started.
        const screen = document.createElement("div");
        screen.className = "screen";
        const frame = document.createElement("iframe");
        frame.title = t("stream-frame");
        frame.allow = "gamepad; fullscreen; autoplay";
        frame.src = "/stream-client/index.html";
        screen.append(frame);
        main.append(screen);
        document.body.dataset.gamepadCapture = "stream";
        closeStream = () => {
          delete document.body.dataset.gamepadCapture;
        };
      } catch {
        if (!disposed) {
          $("launch-status").textContent = t("stream-launch-failed");
          button.disabled = false;
        }
      }
    });
    return () => {
      disposed = true;
      closeStream();
    };
  }
  main.innerHTML = `<div class="screen"><iframe id="stream-frame" title="${th("stream-frame")}" allow="gamepad; fullscreen; autoplay"></iframe></div>`;
  document.body.classList.add("gamescope");
  const frame = $<HTMLIFrameElement>("stream-frame");
  frame.src = "/stream-client/index.html";
  document.body.dataset.gamepadCapture = "stream";
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "F11") {
      event.preventDefault();
      void (document.fullscreenElement
        ? document.exitFullscreen()
        : frame.requestFullscreen());
    } else if (event.key === "Escape" && !document.fullscreenElement)
      navigate("/");
  };
  addEventListener("keydown", onKey);
  frame.addEventListener("load", () => frame.focus());
  return () => {
    removeEventListener("keydown", onKey);
    document.body.classList.remove("gamescope");
    delete document.body.dataset.gamepadCapture;
  };
}

// ------------------------------------------------------------------ engine
function renderEngine(): () => void {
  if (!session.authenticated) {
    locked("nav-engine");
    return () => {};
  }
  main.innerHTML = `
    <div class="page-head"><h1>${th("engine-title")}</h1><button class="btn tonal end" type="button" id="reload">${icon("refresh", { size: "sm" })}${th("action-reload-engine")}</button></div>
    <div class="panel" id="nginx"></div>
    <div class="page-head"><h2>${th("engine-machines")}</h2></div>
    <div class="panel" id="running"></div>
    <div class="page-head"><h2>${th("engine-systems")}</h2><button class="btn text end" type="button" id="scan">${icon("refresh", { size: "sm" })}${th("action-scan")}</button></div>
    <div class="panel table-wrap" id="engine-systems"></div>
    <div class="page-head"><h2>${th("engine-jobs")}</h2></div>
    <div class="panel table-wrap" id="jobs"></div>`;
  const offNginx = on("nginx", (data) => {
    const engine = data as {
      running: boolean;
      pid: number | null;
      version: string | null;
      capabilities: Record<string, boolean> | null;
      module: Record<string, string | number> | null;
      lastReload: string | null;
      error: string | null;
    };
    const panel = $("nginx");
    if (!panel) return;
    panel.innerHTML = `<dl class="kv">
      <dt>${th("engine-state")}</dt><dd class="status ${engine.running ? "ok" : "warn"}">${engine.running ? th("engine-running", { pid: engine.pid ?? "" }) : th("engine-stopped")}</dd>
      <dt>${th("engine-version")}</dt><dd>${esc(engine.version ?? "")}</dd>
      <dt>${th("engine-capabilities")}</dt><dd>${esc(
        new Intl.ListFormat(locale).format(
          Object.entries(engine.capabilities ?? {})
            .filter(([, value]) => value === true)
            .map(([key]) => key),
        ),
      )}</dd>
      <dt>${th("engine-module")}</dt><dd>${engine.module ? esc(`${engine.module.module}, NGINX ${engine.module.nginxVersion}, worker ${engine.module.workerPID}`) : ""}</dd>
      <dt>${th("engine-sources")}</dt><dd>${engine.module ? esc(`nginx ${String(engine.module.nginxSourceRevision).slice(0, 12)}, ngx-rust ${String(engine.module.ngxRustRevision).slice(0, 12)}`) : ""}</dd>
      <dt>${th("engine-last-reload")}</dt><dd>${engine.lastReload ? esc(dateFormat.format(new Date(engine.lastReload))) : ""}</dd>
      ${engine.error ? `<dt>${th("engine-error")}</dt><dd>${esc(engine.error)}</dd>` : ""}</dl>`;
  });
  const offRunning = on("engine", (data) => {
    const panel = $("running");
    const items = (
      data as {
        running: {
          pid: number;
          title?: string;
          system?: string;
          route?: string;
        }[];
      }
    ).running;
    if (panel)
      panel.innerHTML = items.length
        ? `<table class="table"><tbody>${items.map((item) => `<tr><td>${esc(item.title ?? "")}</td><td>${esc(item.system ?? "")}</td><td>${esc(item.route ?? "")}</td><td class="num">${item.pid}</td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">${th("engine-no-machines")}</p>`;
  });
  let icons = new Map<string, CatalogSystem>();
  void (async () => {
    catalog ??= await api<Catalog>("/catalog.json");
    icons = new Map(catalog.systems.map((system) => [system.id, system]));
  })()
    .catch(() => undefined)
    .then(() =>
      api<
        {
          id: string;
          name: string;
          manufacturer: string;
          year: number;
          games: number;
          routes: { id: string; available: boolean }[];
          defaultRoute: string | null;
        }[]
      >("/api/engine/systems"),
    )
    .then(
      (systems) => {
        const tests = (catalog?.games ?? []).filter(
          (game) => game.kind === "test",
        ).length;
        $("engine-systems").innerHTML =
          `<table class="table"><thead><tr><th>${th("col-system")}</th><th>${th("col-maker")}</th><th class="num">${th("col-year")}</th><th>${th("col-routes")}</th><th>${th("col-default")}</th></tr></thead><tbody>${systems
            .map((system) => {
              const image = icons.get(system.id)?.icon;
              return `<tr><td><span class="cell-system">${image ? `<img class="system-icon" src="${esc(image.src)}" srcset="${esc(image.srcset)}" sizes="40px" width="40" height="40" alt="" loading="lazy" />` : ""}${esc(system.name)}</span></td><td>${esc(system.manufacturer)}</td><td class="num">${system.year}</td><td>${esc(new Intl.ListFormat(locale, { style: "narrow" }).format(system.routes.map((route) => route.id)))}</td><td>${esc(system.defaultRoute ?? "")}</td></tr>`;
            })
            .join(
              "",
            )}</tbody></table>${tests ? `<p class="hint">${th("engine-test-roms", { count: tests })}</p>` : ""}`;
      },
      (error) =>
        ($("engine-systems").innerHTML = loadError(t("engine-systems"), error)),
    );
  const jobs = async () => {
    const list = await api<
      {
        id: number;
        title: string;
        status: string;
        startedAt: string;
        error?: string;
      }[]
    >("/api/engine/jobs").catch(() => []);
    const panel = $("jobs");
    if (panel)
      panel.innerHTML = list.length
        ? `<table class="table"><tbody>${list.map((job) => `<tr><td>${esc(job.title)}</td><td class="status ${job.status === "done" ? "ok" : job.status === "failed" ? "warn" : ""}">${esc(job.status)}</td><td>${esc(job.error ?? dateFormat.format(new Date(job.startedAt)))}</td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">${th("engine-no-jobs")}</p>`;
  };
  void jobs();
  const timer = setInterval(jobs, 4000);
  $("scan")?.addEventListener("click", async () => {
    await api("/api/engine/library/scan", { method: "POST" });
    toast("toast-scan");
    void jobs();
  });
  $("reload")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      emit("nginx", await api("/api/nginx/reload", { method: "POST" }));
      toast("toast-reloaded");
    } finally {
      button.disabled = false;
    }
  });
  return () => {
    offNginx();
    offRunning();
    clearInterval(timer);
  };
}

// ------------------------------------------------------------------ router
let cleanup: () => void = () => {};
function navigate(path: string): void {
  history.pushState(null, "", path);
  void route();
}

async function route(): Promise<void> {
  cleanup();
  cleanup = () => {};
  running?.stop();
  running = null;
  renderShell();
  const path = location.pathname;
  try {
    if (path === "/") cleanup = await renderHome();
    else {
      document.body.classList.remove("home-active");
      if (path.startsWith("/play/"))
        await renderPlay(decodeURIComponent(path.slice(6)));
      else if (path === "/steam") cleanup = renderSteam();
      else if (path === "/stream") cleanup = renderStream();
      else if (path === "/engine") cleanup = renderEngine();
      else
        main.innerHTML = `<section class="empty"><p>${th("not-found")}</p><a class="btn tonal" href="/" data-link>${th("action-back")}</a></section>`;
      if (!path.startsWith("/play/")) void tintFromImage(null);
    }
  } catch (error) {
    main.innerHTML = loadError(path, error);
  }
  if (path !== "/") main.focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    "a[data-link]",
  );
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  if (link.dataset.toast)
    toast(link.dataset.toast as MessageId, { host: session.host });
  navigate(link.getAttribute("href")!);
});
addEventListener("popstate", () => void route());

observeWindowClass();
installSpatialNavigation();
document.documentElement.lang = locale;
[session, cores] = await Promise.all([
  api<SessionInfo>("/api/session").catch(() => session),
  api<CoreManifest[]>("/api/emulation").catch(() => []),
]);
if (session.authenticated)
  steamGames = await api<SteamStatus>("/api/steam")
    .then((status) => status.games ?? [])
    .catch(() => []);
if (session.authenticated && location.pathname === "/") {
  try {
    const target = steamAppId(sessionStorage.getItem("play-steam-target"));
    sessionStorage.removeItem("play-steam-target");
    if (target !== null) history.replaceState(null, "", steamStreamUrl(target));
  } catch {
    /* storage may be disabled */
  }
}
connectRealtime();
await route();
const authResult = new URLSearchParams(location.search).get("auth");
if (authResult === "denied" || authResult === "expired") {
  toast(authResult === "denied" ? "signin-denied" : "signin-expired");
  history.replaceState(null, "", location.pathname);
}
