// Bun Engine frontend: a console-style home (last played hero, recents, systems), systems -> games,
// search with a pad keyboard, settings that read real host state, a quick menu over the running game,
// profiles and a power menu. Navigable with the keyboard and any standard-mapping gamepad (spatial
// focus, A/B/X/Y, LB/RB, Start or Guide for the quick menu).
import { jobsHtml, showBios, showInstaller, showSources } from "./admin";
import {
  type AppRow,
  ago,
  api,
  currentHints,
  focusable,
  focusFirst,
  formatSize,
  type Game,
  h,
  type Hint,
  type Job,
  type LaunchResult,
  markTab,
  motionReduced,
  OfflineError,
  overlayStack,
  renderHints,
  reveal,
  type Route,
  setHints,
  state,
  status,
  type SystemRow,
  type Tab,
  toast,
  view,
} from "./core";
import { padKindOf } from "./glyphs";
import { icon, isIcon } from "./icons";
import { configureSounds, play as sound, soundsOn } from "./sounds";

const enc = encodeURIComponent;

// The brand sheet scopes its generated roles to .dark and .light: follow the system scheme.
const lightScheme = matchMedia("(prefers-color-scheme: light)");
const applyScheme = () => {
  document.documentElement.classList.toggle("light", lightScheme.matches);
  document.documentElement.classList.toggle("dark", !lightScheme.matches);
};
applyScheme();
lightScheme.addEventListener("change", applyScheme);
const tintOf = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 17);
const nameOf = (game: Game) => game.title ?? game.name;
const profileLabel = (name: string) => (name === "default" ? "Default" : name);

/** Cover art of a game from our own captures, else a typographic placeholder in the system's tint. */
function art(game: Game): string {
  return `<span class="art" style="--tint:${tintOf(game.system)}">${
    game.cover
      ? `<img src="/api/games/${game.id}/cover" alt="" loading="lazy" decoding="async" />`
      : `<span class="ph" aria-hidden="true">${h(nameOf(game).slice(0, 1).toUpperCase())}</span>`
  }</span>`;
}

function routeChips(routes: Route[], defaultRoute: string | null): string {
  return routes
    .map(
      route =>
        `<span class="chip ${route.kind} ${route.available ? "on" : "off"}" title="${h(route.reason ?? "")}">${route.id === defaultRoute ? "Default · " : ""}${route.available ? "" : "Off · "}${h(route.label)}</span>`,
    )
    .join("");
}

// ---- navigation state -----------------------------------------------------------------------------

/** The newest navigation wins: a screen that finishes loading after the user left stays unrendered. */
let navigation = 0;
let retry: (() => Promise<void>) | undefined;

/** How to get back to the screens a game page was opened from (newest last). */
let trail: Array<() => void> = [];
let lastQuery = "";

function enter(tab: Tab): number {
  if (tab !== state.tab) state.from = state.tab === "games" ? "systems" : state.tab;
  if (tab !== "game") trail = [];
  state.tab = tab;
  markTab();
  return ++navigation;
}

const homeHints: Hint[] = [
  ["move", "Move"],
  ["select", "Select"],
  ["menu", "Quick menu"],
  ["tabs", "Pages"],
];

function showError(error: unknown, again: () => Promise<void>): void {
  const offline = error instanceof OfflineError;
  retry = again;
  view.innerHTML = `<section class="state" role="alert">
    ${icon(offline ? "wifi-off" : "triangle-alert", "icon big")}
    <h1>${offline ? "Service unreachable" : "Something went wrong"}</h1>
    <p>${offline ? "The Bun Engine service on this device does not answer. Check that it is running; this page keeps trying." : h(error instanceof Error ? error.message : String(error))}</p>
    <button data-nav class="primary" data-action="retry">${icon("rotate-cw")} Try again</button>
  </section>`;
  setHints([
    ["select", "Try again"],
    ["menu", "Quick menu"],
  ]);
  focusFirst("[data-action=retry]");
}

// ---- home -----------------------------------------------------------------------------------------

const skeletonHome = () => `<div class="skeleton-page" aria-busy="true" aria-label="Loading your library">
  <div class="hero sk"><div class="hero-body"><span class="sk-line w30"></span><span class="sk-line w60 tall"></span><span class="sk-line w40"></span><span class="sk-line w20 btn"></span></div></div>
  <h2 class="sk-line w10"></h2>
  <div class="shelf">${'<span class="tile sk"><span class="art"></span><span class="sk-line w80"></span><span class="sk-line w50"></span></span>'.repeat(6)}</div>
</div>`;

function systemTile(system: SystemRow, detail = false): string {
  const ready = system.routes.some(route => route.available);
  return `<button data-nav class="system ${system.games ? "" : "dim"}" data-system="${h(system.id)}" style="--tint:${tintOf(system.id)}">
    <span class="banner">${system.cover ? `<img src="/api/games/${system.cover}/cover" alt="" loading="lazy" decoding="async" />` : ""}</span>
    <span class="maker">${h(system.manufacturer)} · ${system.year}</span>
    <span class="name">${h(system.name)}</span>
    <span class="count">${system.games} ${system.games === 1 ? "game" : "games"}${detail ? "" : ` · ${ready ? "Ready" : "No emulator"}`}</span>
    ${detail ? `<span class="routes">${ready ? routeChips(system.routes.filter(route => route.available).slice(0, 3), system.defaultRoute) : '<span class="chip off">No emulator installed</span>'}</span>` : ""}
  </button>`;
}

let recent: Game[] = [];
let apps: AppRow[] = [];

function appTile(app: AppRow): string {
  const label = app.pid ? "Running" : app.available ? "App" : "Not installed";
  return `<button data-nav role="listitem" class="tile app ${app.available ? "" : "off"} ${app.pid ? "live" : ""}" data-app="${h(app.id)}" style="--tint:${tintOf(app.id)}" ${app.available ? "" : `aria-disabled="true" title="${h(app.reason ?? "")}"`}>
    <span class="art"><span class="app-icon" aria-hidden="true">${icon(isIcon(app.icon) ? app.icon : "app-window", "icon big")}</span></span>
    <span class="t">${h(app.title)}</span>
    <span class="s">${label}</span>
  </button>`;
}

const appsShelf = () =>
  apps.length
    ? `<h2>Apps</h2><div class="shelf" id="apps" role="list" aria-label="Apps">${apps.map(appTile).join("")}</div>`
    : "";

async function showHome(): Promise<void> {
  const mine = enter("home");
  view.innerHTML = skeletonHome();
  setHints(homeHints);
  let systems: SystemRow[];
  try {
    [recent, systems, apps] = await Promise.all([
      api<Game[]>(`/api/recent?profile=${enc(state.profile)}&limit=12`),
      api<SystemRow[]>("/api/systems"),
      api<AppRow[]>("/api/apps").catch(() => []),
    ]);
  } catch (error) {
    if (mine === navigation) showError(error, showHome);
    return;
  }
  if (mine !== navigation) return;
  state.systems = systems;
  const total = systems.reduce((sum, system) => sum + system.games, 0);
  const scanning = state.jobs.some(job => job.status === "running" && job.title === "Scan library");
  const [last, ...earlier] = recent;
  const hero = last
    ? `<section class="hero" aria-label="Continue playing" style="--tint:${tintOf(last.system)}">
        <div class="hero-art" aria-hidden="true">${last.cover ? `<img src="/api/games/${last.id}/cover" alt="" decoding="async" />` : ""}</div>
        <div class="hero-body">
          <p class="eyebrow">Continue playing · ${h(systems.find(system => system.id === last.system)?.name ?? last.system)}</p>
          <h1>${h(nameOf(last))}</h1>
          <p class="meta">Last played ${ago(last.lastPlayed)} · ${last.playCount} ${last.playCount === 1 ? "play" : "plays"}${state.profile === "default" ? "" : ` · ${h(profileLabel(state.profile))}`}</p>
          <div class="hero-actions">
            <button data-nav class="primary big" data-play="${last.id}">${icon("play", "icon fill")} Play</button>
            <button data-nav class="ghost big" data-details="${last.id}">Game page</button>
          </div>
        </div>
        <div class="hero-cover">${art(last)}</div>
      </section>`
    : total
      ? `<section class="hero empty"><div class="hero-body">
          <p class="eyebrow">${h(profileLabel(state.profile))}</p>
          <h1>Nothing played yet</h1>
          <p class="meta">${total} ${total === 1 ? "game is" : "games are"} ready. Pick a system and press play: your last game will wait for you here.</p>
          <div class="hero-actions"><button data-nav class="primary big" data-tab="systems">${icon("layout-grid")} Choose a system</button></div>
        </div></section>`
      : `<section class="hero empty"><div class="hero-body">
          <p class="eyebrow">${scanning ? "Scanning" : "Empty library"}</p>
          <h1>${scanning ? "Looking for games…" : "No games yet"}</h1>
          <p class="meta">${scanning ? "This takes a moment on a large folder." : "Add a folder that holds your games, or install free homebrew with bep."}</p>
          <div class="hero-actions"><button data-nav class="primary big" data-tab="sources">${icon("folder-down")} Add a folder</button><button data-nav class="ghost big" data-action="scan">${icon("refresh-cw")} Rescan</button></div>
        </div></section>`;
  const shelf = earlier.length
    ? `<div class="shelf" role="list" aria-label="Recent games">${earlier
        .map(
          game => `<button data-nav role="listitem" class="tile" data-play="${game.id}">
            ${art(game)}
            <span class="t">${h(nameOf(game))}</span>
            <span class="s">${h(systems.find(system => system.id === game.system)?.name ?? game.system)} · ${ago(game.lastPlayed)}</span>
          </button>`,
        )
        .join("")}</div>`
    : `<p class="shelf-empty">${last ? "Earlier games you play will line up here." : "Games you play will line up here."}</p>`;
  const ordered = [...systems].sort((a, b) => Number(b.games > 0) - Number(a.games > 0));
  view.innerHTML = `${hero}
    <h2>Recent</h2>${shelf}
    ${appsShelf()}
    <h2>Systems</h2>
    <div class="shelf" role="list" aria-label="Systems">${ordered.map(system => systemTile(system).replace("<button", '<button role="listitem"')).join("")}</div>`;
  setHints(homeHints);
  focusFirst("[data-play], .hero [data-nav], .system");
}

// ---- systems and games ----------------------------------------------------------------------------

async function showSystems(): Promise<void> {
  const mine = enter("systems");
  view.innerHTML = '<div class="skeleton-page" aria-busy="true"><span class="sk-line w20 tall"></span></div>';
  let systems: SystemRow[];
  try {
    systems = await api<SystemRow[]>("/api/systems");
  } catch (error) {
    if (mine === navigation) showError(error, showSystems);
    return;
  }
  if (mine !== navigation) return;
  state.systems = systems;
  const total = systems.reduce((sum, system) => sum + system.games, 0);
  view.innerHTML = `
    <section class="systems-head">
      <h1>Systems</h1>
      <p>${total} games across ${systems.filter(s => s.games).length} systems · ${systems.length} systems defined</p>
      <button data-nav data-action="scan" class="ghost">${icon("refresh-cw")} Rescan library</button>
    </section>
    <section class="systems">${systems.map(system => systemTile(system, true)).join("")}</section>`;
  setHints([
    ["move", "Move"],
    ["select", "Open"],
    ["y", "Rescan", "R"],
    ["menu", "Quick menu"],
    ["tabs", "Pages"],
  ]);
  focusFirst(state.lastSystem ? `[data-system="${CSS.escape(state.lastSystem)}"]` : ".system");
}

async function showGames(systemId: string, focusGame?: number): Promise<void> {
  const mine = enter("games");
  state.lastSystem = systemId;
  if (focusGame) state.lastGame = focusGame;
  let systems: SystemRow[];
  let games: Game[];
  try {
    [systems, games] = await Promise.all([
      api<SystemRow[]>("/api/systems"),
      api<Game[]>(`/api/systems/${systemId}/games`),
    ]);
  } catch (error) {
    if (mine === navigation) showError(error, () => showGames(systemId, focusGame));
    return;
  }
  if (mine !== navigation) return;
  state.systems = systems;
  state.system = systems.find(system => system.id === systemId)!;
  state.games = games;
  const system = state.system;
  view.innerHTML = `
    <section class="games-head" style="--tint:${tintOf(system.id)}">
      <button data-nav data-action="back" class="ghost">${icon("arrow-left")} Back</button>
      <h1>${h(system.name)}</h1>
      <span class="sub">${games.length} games · ${h(system.extensions.map(ext => `.${ext}`).join(" "))}</span>
    </section>
    <section class="games">
      <div class="list" id="list" role="list" aria-label="${h(system.name)} games">
        ${
          games.length
            ? games.map(game => gameRow(game)).join("")
            : `<div class="empty">${icon("folder-down", "icon big")}<h2>No games for this system</h2><p>Add a folder under Sources, or install free ROMs with <code>bep roms</code>.</p></div>`
        }
      </div>
      <aside class="detail" id="detail" aria-label="Game details"></aside>
    </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Launch"],
    ["x", "Favorite"],
    ["y", "Check route", "C"],
    ["view", "Set default"],
    ["back", "Back"],
  ]);
  if (!games.length) {
    renderDetail(undefined);
    focusFirst("[data-action=back]");
    return;
  }
  focusFirst(
    state.lastGame && games.some(game => game.id === state.lastGame) ? `[data-game="${state.lastGame}"]` : ".game",
  );
}

function gameRow(game: Game, meta?: string): string {
  return `<button data-nav role="listitem" class="game" data-game="${game.id}">
    <span class="fav">${game.favorite ? `${icon("star", "icon fill")}<span class="sr">Favorite</span>` : ""}</span>
    <span class="title">${game.cover ? `<img class="thumb" src="/api/games/${game.id}/cover" alt="" loading="lazy" decoding="async" />` : '<span class="thumb ph" aria-hidden="true"></span>'}${h(nameOf(game))}</span>
    <span class="meta">${meta === undefined ? `${game.dat ? "DB" : ""}${game.playCount ? ` · ${game.playCount}×` : ""}` : h(meta)}</span>
  </button>`;
}

function renderDetail(game: Game | undefined): void {
  const detail = document.querySelector<HTMLElement>("#detail");
  const system = state.system;
  if (!detail || !system) return;
  state.game = game;
  const routes = system.routes;
  if (!game) {
    detail.innerHTML = `<h2>Launch routes</h2><div class="route-list">${routes.map(route => routeButton(route, system.defaultRoute, undefined)).join("")}</div>`;
    return;
  }
  const running = state.running.find(item => item.game === game.id);
  detail.innerHTML = `
    <h2>${h(nameOf(game))}</h2>
    ${game.cover ? `<img class="cover-large" src="/api/games/${game.id}/cover" alt="Cover of ${h(nameOf(game))}" />` : ""}
    <dl>
      ${game.title && game.title !== game.name ? `<dt>File name</dt><dd>${h(game.name)}</dd>` : ""}
      ${game.developer ? `<dt>Developer</dt><dd>${h(game.developer)}</dd>` : ""}
      ${game.year ? `<dt>Year</dt><dd>${h(game.year)}</dd>` : ""}
      ${game.region ? `<dt>Region</dt><dd>${h(game.region)}</dd>` : ""}
      <dt>Source</dt><dd>${h(game.source)}</dd>
      <dt>Path</dt><dd class="path">${h(game.file)}</dd>
      <dt>Size</dt><dd>${formatSize(game.size)}</dd>
      <dt>CRC32 / MD5</dt><dd class="mono">${h(game.crc ?? "–")} / ${h(game.md5 ?? "–")}</dd>
      <dt>Database</dt><dd>${
        game.dat
          ? h(
              game.dat
                .split("/")
                .slice(1)
                .join(" / ")
                .replace(/\.dat$/, ""),
            )
          : "no libretro-database match"
      }</dd>
      ${game.lastPlayed ? `<dt>Last played</dt><dd>${new Date(game.lastPlayed).toLocaleString()} (${game.playCount}×)</dd>` : ""}
    </dl>
    ${game.description ? `<p class="desc">${h(game.description)}</p>` : ""}
    <div class="actions">
      <button data-nav data-action="launch" class="primary">${icon("play", "icon fill")} Launch</button>
      <button data-nav data-details="${game.id}">Game page</button>
      <button data-nav data-action="check">Check route</button>
      <button data-nav data-action="favorite">${icon("star", game.favorite ? "icon fill" : "icon")} ${game.favorite ? "Unfavorite" : "Favorite"}</button>
      ${running ? `<button data-nav data-action="stop" data-pid="${running.pid}" class="danger">${icon("square", "icon fill")} Stop</button>` : ""}
    </div>
    <h3>Launch routes</h3>
    <div class="route-list">${routes.map(route => routeButton(route, system.defaultRoute, game)).join("")}</div>
    <pre class="log" id="log" hidden></pre>`;
}

function routeButton(route: Route, defaultRoute: string | null, game: Game | undefined): string {
  const ext = game?.path.split(".").pop()?.toLowerCase();
  const fits = !route.extensions || !ext || route.extensions.includes(ext);
  const usable = route.available && fits;
  const reason = !route.available
    ? route.reason
    : fits
      ? ""
      : `loads ${route.extensions!.map(e => `.${e}`).join(" ")} only`;
  return `<button data-nav class="route ${route.kind} ${usable ? "on" : "off"}" data-route="${h(route.id)}" aria-disabled="${!usable}">
    <span class="kind">${route.kind}</span>
    <span class="label">${route.id === defaultRoute ? "Default · " : ""}${h(route.label)}${game?.route === route.id ? " (game)" : ""}</span>
    <span class="why">${h(reason ?? "")}</span>
  </button>`;
}

// ---- game page ------------------------------------------------------------------------------------

interface GamePage {
  game: Game;
  routes: Route[];
  defaultRoute: string | null;
  sameSystem: Game[];
  recent: Game[];
  saves: { profile: string; states: number; screenshots: number; newest: string | null; shared: boolean };
  running: { pid: number } | null;
}

let pageGames: Game[] = [];
let pageData: GamePage | undefined;

function backToTrail(): void {
  const previous = trail.pop();
  if (previous) previous();
  else void showHome();
}

/** A function that reopens the screen the user is on, for the Back trail of a game page. */
function currentRestore(): () => void {
  if (state.tab === "games" && state.lastSystem) {
    const [system, game] = [state.lastSystem, state.lastGame];
    return () => void showGames(system, game);
  }
  if (state.tab === "search") return () => showSearch();
  if (state.tab === "game" && pageData) {
    const id = pageData.game.id;
    return () => void showGamePage(id, false);
  }
  return () => void showHome();
}

function relatedTile(game: Game, sub: string): string {
  return `<button data-nav role="listitem" class="tile" data-details="${game.id}">
    ${art(game)}
    <span class="t">${h(nameOf(game))}</span>
    <span class="s">${h(sub)}</span>
  </button>`;
}

const favoriteButton = (game: Game) =>
  `<button data-nav class="ghost big" data-action="fav-page" aria-pressed="${Boolean(game.favorite)}">${icon("star", game.favorite ? "icon fill" : "icon")}<span>${game.favorite ? "Favorite" : "Add to favorites"}</span></button>`;

/** The page of one game: cover hero, one Play, favourite, facts, then games from the same system and recent plays. */
async function showGamePage(id: number, push = true): Promise<void> {
  const restore = push ? currentRestore() : undefined;
  const mine = enter("game");
  if (restore) trail.push(restore);
  view.innerHTML = `<div class="skeleton-page" aria-busy="true" aria-label="Loading the game">
    <div class="hero sk"><div class="hero-body"><span class="sk-line w30"></span><span class="sk-line w60 tall"></span><span class="sk-line w40"></span><span class="sk-line w20 btn"></span></div></div></div>`;
  setHints([["back", "Back"]]);
  let data: GamePage;
  try {
    data = await api<GamePage>(`/api/games/${id}/page?profile=${enc(state.profile)}`);
  } catch (error) {
    if (mine === navigation) showError(error, () => showGamePage(id, false));
    return;
  }
  if (mine !== navigation) return;
  pageData = data;
  pageGames = [data.game, ...data.sameSystem, ...data.recent];
  state.game = data.game;
  const game = data.game;
  const system = state.systems.find(item => item.id === game.system);
  const systemName = system?.name ?? game.system;
  const plays = game.playCount;
  const route =
    data.routes.find(item => item.id === (game.route ?? data.defaultRoute)) ?? data.routes.find(item => item.available);
  const saves = data.saves;
  const saveText =
    saves.states || saves.screenshots
      ? `${saves.states} ${saves.states === 1 ? "save state" : "save states"} · ${saves.screenshots} ${saves.screenshots === 1 ? "screenshot" : "screenshots"}${saves.shared ? " (shared saves, copied in when this profile first plays)" : ""}`
      : "No save states or screenshots yet";
  view.innerHTML = `<section class="game-page" aria-label="${h(nameOf(game))}">
    <div class="page-head"><button data-nav data-action="back" class="ghost">${icon("arrow-left")} Back</button></div>
    <section class="hero game-hero" style="--tint:${tintOf(game.system)}">
      <div class="hero-art" aria-hidden="true">${game.cover ? `<img src="/api/games/${game.id}/cover" alt="" decoding="async" />` : ""}</div>
      <div class="hero-body">
        <p class="eyebrow">${h(systemName)}${game.year ? ` · ${h(game.year)}` : ""}${game.developer ? ` · ${h(game.developer)}` : ""}</p>
        <h1>${h(nameOf(game))}</h1>
        <p class="meta" id="plays">${plays ? `${plays} ${plays === 1 ? "play" : "plays"} · last played ${ago(game.lastPlayed)}` : "Not played yet"} · ${h(profileLabel(state.profile))}</p>
        <div class="hero-actions">
          <button data-nav class="primary big" data-play="${game.id}">${icon("play", "icon fill")} Play</button>
          ${favoriteButton(game)}
          <button data-nav class="ghost big" data-games="${game.id}">Routes and details</button>
          ${data.running ? `<button data-nav class="ghost big danger" data-action="stop" data-pid="${data.running.pid}">${icon("square", "icon fill")} Stop</button>` : ""}
        </div>
      </div>
      <div class="hero-cover">${art(game)}</div>
    </section>
    <dl class="facts">
      <div><dt>Runs with</dt><dd>${route ? `<span class="chip ${route.kind} ${route.available ? "on" : "off"}">${route.available ? "" : "Off · "}${h(route.label)}</span>` : "No route defined"}${route && !route.available ? ` <span class="muted">${h(route.reason ?? "")}</span>` : ""}</dd></div>
      <div><dt>Saves · ${h(profileLabel(state.profile))}</dt><dd>${h(saveText)}</dd></div>
      <div><dt>File</dt><dd>${formatSize(game.size)} · ${h(game.source)}</dd></div>
      ${game.region ? `<div><dt>Region</dt><dd>${h(game.region)}</dd></div>` : ""}
    </dl>
    ${game.description ? `<p class="desc">${h(game.description)}</p>` : ""}
    <h2>More on ${h(systemName)}</h2>
    ${
      data.sameSystem.length
        ? `<div class="shelf" role="list" aria-label="More on ${h(systemName)}">${data.sameSystem.map(other => relatedTile(other, other.developer ?? (other.favorite ? "Favorite" : systemName))).join("")}</div>`
        : `<p class="shelf-empty">No other ${h(systemName)} games in the library yet.</p>`
    }
    <h2>Recently played</h2>
    ${
      data.recent.length
        ? `<div class="shelf" role="list" aria-label="Recently played">${data.recent.map(other => relatedTile(other, `${systemLabel(other.system)} · ${ago(other.lastPlayed)}`)).join("")}</div>`
        : `<p class="shelf-empty">Other games ${h(profileLabel(state.profile))} plays will line up here.</p>`
    }
  </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Select"],
    ["x", "Favorite", "F"],
    ["back", "Back"],
  ]);
  focusFirst("[data-play]");
}

const systemLabel = (id: string) => state.systems.find(item => item.id === id)?.name ?? id;

// ---- search ---------------------------------------------------------------------------------------

const keyboardRows = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm'."];

/** A pad-first on-screen keyboard that types into `target` (a CSS selector for an input). */
function keyboardHtml(target: string, shift = false): string {
  const key = (value: string, label = value, extra = "") =>
    `<button type="button" data-nav class="key ${extra}" data-key="${h(value)}" data-target="${h(target)}"${extra.includes("wide") ? ` aria-label="${h(label)}"` : ""}>${h(label)}</button>`;
  return `<div class="osk" role="group" aria-label="On-screen keyboard">
    ${keyboardRows.map(row => `<div class="osk-row">${[...row].map(char => key(char)).join("")}</div>`).join("")}
    <div class="osk-row">
      ${shift ? key("shift", "Shift", "wide") : ""}${key(" ", "Space", "wide space")}
      <button type="button" data-nav class="key wide" data-key="back" data-target="${h(target)}" aria-label="Delete the last character">${icon("delete")}</button>
      ${key("clear", "Clear", "wide")}
    </div>
  </div>`;
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;

function showSearch(): void {
  enter("search");
  view.innerHTML = `<section class="search">
    <div class="search-pane">
      <h1>Search</h1>
      <label class="field" for="q"><span class="label">Game title, developer or system</span>
        <input id="q" data-nav type="search" autocomplete="off" spellcheck="false" placeholder="Start typing" aria-describedby="q-status" />
      </label>
      ${keyboardHtml("#q")}
    </div>
    <div class="search-results">
      <p id="q-status" class="muted" role="status" aria-live="polite"></p>
      <div class="list" id="results" role="list" aria-label="Search results"></div>
    </div>
  </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Type"],
    ["x", "Delete", "Backspace"],
    ["y", "Space", "Space"],
    ["back", "Back"],
  ]);
  renderResults("");
  focusFirst('.key[data-key="g"]');
  const field = document.querySelector<HTMLInputElement>("#q");
  if (field && lastQuery) {
    field.value = lastQuery;
    runSearch();
  }
}

function renderResults(query: string, games: Game[] = [], failed?: string): void {
  const list = document.querySelector<HTMLElement>("#results");
  const note = document.querySelector<HTMLElement>("#q-status");
  if (!list || !note) return;
  if (failed) {
    note.textContent = "";
    list.innerHTML = `<div class="empty" role="alert">${icon("triangle-alert", "icon big")}<h2>Search failed</h2><p>${h(failed)}</p><button data-nav class="primary" data-action="search-again">Try again</button></div>`;
    return;
  }
  if (!query.trim()) {
    const total = state.systems.reduce((sum, system) => sum + system.games, 0);
    note.textContent = "";
    list.innerHTML = `<div class="empty">${icon("search", "icon big")}<h2>Find a game</h2><p>${total ? `Search ${total} ${total === 1 ? "game" : "games"} by title, developer or system.` : "Your library is empty: add a folder first."}</p></div>`;
    return;
  }
  state.games = games;
  note.textContent = `${games.length} ${games.length === 1 ? "result" : "results"} for “${query.trim()}”`;
  list.innerHTML = games.length
    ? games
        .map(game => gameRow(game, state.systems.find(system => system.id === game.system)?.name ?? game.system))
        .join("")
    : `<div class="empty">${icon("search", "icon big")}<h2>No games match</h2><p>Nothing in the library matches “${h(query.trim())}”. Check the spelling or try fewer words.</p></div>`;
}

function runSearch(): void {
  const input = document.querySelector<HTMLInputElement>("#q");
  if (!input) return;
  const query = input.value;
  lastQuery = query;
  clearTimeout(searchTimer);
  if (!query.trim()) return renderResults("");
  const mine = ++searchSeq;
  const note = document.querySelector<HTMLElement>("#q-status");
  if (note) note.textContent = "Searching…";
  searchTimer = setTimeout(async () => {
    try {
      const games = await api<Game[]>(`/api/search?q=${enc(query)}`);
      if (mine === searchSeq && state.tab === "search") renderResults(query, games);
    } catch (error) {
      if (mine === searchSeq && state.tab === "search")
        renderResults(query, [], error instanceof Error ? error.message : String(error));
    }
  }, 120);
}

function pressKey(button: HTMLElement): void {
  typeKey(button.dataset.key!, button.dataset.target ?? "#q", button);
}

function typeKey(value: string, selector: string, button?: HTMLElement): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) return;
  if (value === "back") input.value = input.value.slice(0, -1);
  else if (value === "clear") input.value = "";
  else if (value === "shift" && button) {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    for (const key of button.closest(".osk")!.querySelectorAll<HTMLElement>(".key:not(.wide)")) {
      key.dataset.key = on ? key.dataset.key!.toUpperCase() : key.dataset.key!.toLowerCase();
      key.textContent = key.dataset.key;
    }
    return;
  } else input.value += value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---- settings: real host state only ---------------------------------------------------------------

type HostSection<T> = ({ available: true; source: string } & T) | { available: false; reason: string };

interface HostData {
  display: HostSection<{
    outputs: Array<{
      name: string;
      model: string | null;
      width: number;
      height: number;
      refresh: number | null;
      scale: number | null;
      on: boolean | null;
    }>;
  }>;
  audio: HostSection<{
    sinks: Array<{ id: string; name: string; default: boolean; volume: number | null; muted: boolean | null }>;
  }>;
  network: HostSection<{
    interfaces: Array<{
      name: string;
      state: string;
      kind: string | null;
      connection: string | null;
      addresses: string[];
      gateway: boolean;
      virtual: boolean;
    }>;
    gateway: string | null;
  }>;
  storage: HostSection<{
    volumes: Array<{ labels: string[]; paths: string[]; totalBytes: number; freeBytes: number }>;
    saves: { path: string; bytes: number; files: number; profiles: Array<{ profile: string; bytes: number }> };
  }>;
  sleep: { available: boolean; mechanism?: string; reason?: string };
}

type Config = { hud: string; motion: string; sounds: string };

const notAvailable = (reason: string, title = "Not available") =>
  `<div class="na" role="note">${icon("ban", "icon")}<div><strong>${h(title)}</strong><p>${h(reason)}</p></div></div>`;

const infoCard = (title: string, body: string) =>
  `<div class="card info" data-nav data-info tabindex="0" role="group" aria-label="${h(title)}"><h2>${h(title)}</h2>${body}</div>`;

const unreadable = "The service could not read this from the host.";

function displayCard(host: HostData | undefined): string {
  const browser = `<dl><dt>This window</dt><dd>${innerWidth} × ${innerHeight} px at ${devicePixelRatio}× scale</dd>
    <dt>Screen</dt><dd>${screen.width} × ${screen.height} px, ${screen.colorDepth}-bit</dd>
    <dt>Refresh rate</dt><dd id="refresh-rate">measuring…</dd></dl>`;
  const section = host?.display;
  const outputs = section?.available
    ? `<h3>Host outputs</h3><dl>${section.outputs
        .map(
          output =>
            `<dt>${h(output.name)}</dt><dd>${h(output.model ?? "")} ${output.width} × ${output.height}${output.refresh ? ` at ${output.refresh} Hz` : ""}${output.scale ? ` · scale ${output.scale}` : ""}${output.on === false ? " · off" : ""}</dd>`,
        )
        .join("")}</dl><p class="note">From ${h(section.source)}.</p>`
    : notAvailable(section?.reason ?? unreadable);
  return infoCard("Display", browser + outputs);
}

function audioCard(host: HostData | undefined): string {
  const section = host?.audio;
  const level = Math.round(volume() * 100);
  const body = section?.available
    ? section.sinks.length
      ? `<dl>${section.sinks
          .map(
            sink =>
              `<dt>${h(sink.name)}</dt><dd>${sink.default ? '<span class="badge present">default</span> ' : ""}${sink.volume === null ? "volume unknown" : `${Math.round(sink.volume * 100)}%`}${sink.muted ? ' <span class="badge missing">muted</span>' : ""}</dd>`,
          )
          .join("")}</dl><p class="note">Output devices from ${h(section.source)}.</p>`
      : notAvailable("The sound server reports no output device.")
    : notAvailable(section?.reason ?? unreadable);
  return infoCard("Audio", `${body}<dl><dt>Game volume</dt><dd>${level}% (the quick menu changes it)</dd></dl>`);
}

function networkCard(host: HostData | undefined): string {
  const section = host?.network;
  let body: string;
  if (section?.available) {
    const real = section.interfaces.filter(item => !item.virtual);
    const hidden = section.interfaces.length - real.length;
    body = `<dl>${real
      .map(
        item =>
          `<dt>${h(item.name)}${item.kind ? ` (${h(item.kind)})` : ""}</dt><dd><span class="badge ${item.state === "up" ? "present" : "missing"}">${h(item.state)}</span>${item.connection ? ` ${h(item.connection)}` : ""}${item.gateway ? " · default route" : ""}${item.addresses.length ? `<br/><span class="mono small">${item.addresses.map(h).join("<br/>")}</span>` : ""}</dd>`,
      )
      .join(
        "",
      )}</dl>${real.length ? "" : '<p class="note">No hardware network interface.</p>'}<p class="note">${hidden ? `${hidden} virtual ${hidden === 1 ? "interface is" : "interfaces are"} hidden. ` : ""}From ${h(section.source)}.</p>`;
  } else body = notAvailable(section?.reason ?? unreadable);
  return infoCard(
    "Network",
    `${body}<dl><dt>This page</dt><dd>${navigator.onLine ? "online" : "offline"} according to the browser</dd></dl>`,
  );
}

function storageCard(host: HostData | undefined): string {
  const section = host?.storage;
  let body: string;
  if (section?.available) {
    body = section.volumes
      .map(volume => {
        const used = volume.totalBytes - volume.freeBytes;
        const percent = volume.totalBytes ? Math.round((used / volume.totalBytes) * 100) : 0;
        const name = volume.labels.join(" · ");
        return `<div class="vol-row"><div class="vol-line"><strong>${h(name)}</strong><span>${formatSize(volume.freeBytes)} free of ${formatSize(volume.totalBytes)}</span></div>
          <div class="mono small muted path">${volume.paths.slice(0, 2).map(h).join("<br/>")}</div>
          <div class="meter" role="meter" aria-label="${h(name)} used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent} percent used"><span style="--v:${percent / 100}"></span></div></div>`;
      })
      .join("");
    const saves = section.saves;
    body += `<dl><dt>Saves</dt><dd>${formatSize(saves.bytes)} in ${saves.files} ${saves.files === 1 ? "file" : "files"}</dd>${saves.profiles
      .map(profile => `<dt>${h(profile.profile)}</dt><dd>${formatSize(profile.bytes)}</dd>`)
      .join("")}</dl><p class="note">Measured with statfs on the library, game and save folders.</p>`;
  } else body = notAvailable(section?.reason ?? unreadable);
  return infoCard("Storage", body);
}

/** The pads the browser reports right now (Chrome lists one only after a button was pressed on it). */
function controllersCard(): string {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((pad): pad is Gamepad => Boolean(pad));
  return infoCard(
    "Controllers",
    pads.length
      ? `<dl>${pads
          .map(
            pad =>
              `<dt>Port ${pad.index + 1}</dt><dd>${h(pad.id)}<br/><span class="note">${pad.mapping ? `${h(pad.mapping)} mapping` : "no standard mapping"} · ${pad.buttons.length} buttons · ${pad.axes.length} axes</span></dd>`,
          )
          .join("")}</dl>`
      : notAvailable(
          "The browser lists a controller only after a button is pressed on it. Press any button.",
          "No controller reported",
        ),
  );
}

function appsCard(list: AppRow[]): string {
  return infoCard(
    "Apps",
    list.length
      ? `<dl>${list.map(app => `<dt>${h(app.title)}</dt><dd><span class="badge ${app.available ? "present" : "missing"}">${app.available ? "ready" : "not installed"}</span> <span class="mono small">${h(app.command.join(" "))}</span></dd>`).join("")}</dl>`
      : `<p class="note">No app is declared. Add one on the device with <code>bun-engine library apps add &lt;id&gt; &lt;title&gt; -- &lt;command&gt;</code>; it appears on the home page.</p>`,
  );
}

/** The browser's own refresh rate, measured with requestAnimationFrame for 40 frames. */
function measureRefresh(): void {
  const deltas: number[] = [];
  let last = 0;
  const step = (time: number) => {
    if (last) deltas.push(time - last);
    last = time;
    if (deltas.length < 40) return void requestAnimationFrame(step);
    deltas.sort((a, b) => a - b);
    const median = deltas[deltas.length >> 1]!;
    const cell = document.querySelector("#refresh-rate");
    if (cell)
      cell.textContent = `${Math.round(1000 / median)} Hz (median of ${deltas.length} frames, measured by this page)`;
  };
  requestAnimationFrame(step);
}

interface SettingsData {
  session: { gamescope: boolean; display: string | null; desktop: string | null; window: boolean; power: boolean };
  library: {
    project: string;
    database: string;
    games: number;
    sources: Array<{ id: number; kind: string; path: string; system: string | null }>;
  };
  systems: Array<{
    id: string;
    name: string;
    games: number;
    defaultRoute: string | null;
    routes: Array<{ id: string; kind: string; available: boolean; reason?: string }>;
  }>;
  cores: Array<{
    id: string;
    installed: boolean;
    systems: string[];
    bios: Array<{ file: string; status: string; optional: boolean }>;
  }>;
  native: Array<{ system: string; machine: string; status: string; required: boolean }>;
  config: { store: string; values: Config };
  versions: { engine: string | null; bun: string; platform: string; libretroarch: string | null };
}

const motionLabel: Record<string, string> = { system: "Follow the system", reduced: "Reduced", full: "Full" };
const nextMotion = (value: string) => (value === "system" ? "reduced" : value === "reduced" ? "full" : "system");
const soundLabel: Record<string, string> = { auto: "Automatic", on: "On", off: "Off" };
const nextSound = (value: string) => (value === "auto" ? "on" : value === "on" ? "off" : "auto");
const soundWhy = (value: string) =>
  value === "off"
    ? "Silent. Short blips on move, select and back are off."
    : value === "on"
      ? "Short blips on move, select and back, even with reduced motion."
      : soundsOn()
        ? "Short blips on move, select and back; silent when motion is reduced."
        : "Silent now because motion is reduced; turn it On to hear them.";

async function showSettings(): Promise<void> {
  const mine = enter("settings");
  view.innerHTML =
    '<div class="skeleton-page" aria-busy="true"><span class="sk-line w20 tall"></span><span class="sk-line w60"></span><span class="sk-line w60"></span></div>';
  setHints([
    ["move", "Move"],
    ["select", "Change"],
    ["back", "Back"],
    ["menu", "Quick menu"],
  ]);
  let data: SettingsData;
  let host: HostData | undefined;
  let declared: AppRow[] = [];
  try {
    [data, host, declared] = await Promise.all([
      api<SettingsData>("/api/settings"),
      api<HostData>("/api/host").catch(() => undefined),
      api<AppRow[]>("/api/apps").catch(() => []),
    ]);
  } catch (error) {
    if (mine === navigation) showError(error, showSettings);
    return;
  }
  if (mine !== navigation) return;
  const hud = data.config.values.hud === "1";
  const biosMissing = data.cores.flatMap(core =>
    core.bios.filter(bios => bios.status === "missing" && !bios.optional),
  ).length;
  view.innerHTML = `<section class="page settings">
    <h1>Settings</h1>
    <p class="lead">Everything here is read from this device when the page opens. Nothing is a placeholder.</p>
    <div class="cards">
      <div class="card"><h2>Preferences</h2>
        <button data-nav class="setting" role="switch" aria-checked="${hud}" data-setting="hud" data-value="${hud ? "0" : "1"}">
          <span><strong>Performance counter</strong><span class="why">Frames per second and frame time in the corner</span></span><span class="value">${hud ? "On" : "Off"}</span><span class="switch" aria-hidden="true"></span>
        </button>
        <button data-nav class="setting" data-setting="motion" data-value="${nextMotion(data.config.values.motion)}">
          <span><strong>Motion</strong><span class="why">Animations and smooth scrolling</span></span><span class="value">${motionLabel[data.config.values.motion] ?? data.config.values.motion}</span>
        </button>
        <button data-nav class="setting" data-setting="sounds" data-value="${nextSound(data.config.values.sounds)}">
          <span><strong>Interface sounds</strong><span class="why" id="sounds-why">${soundWhy(data.config.values.sounds)}</span></span><span class="value">${soundLabel[data.config.values.sounds] ?? data.config.values.sounds}</span>
        </button>
        <p class="note">All three are stored in <code>${h(data.config.store)}</code>, the file the console shell reads too.</p>
      </div>
      ${displayCard(host)}
      ${audioCard(host)}
      ${networkCard(host)}
      ${storageCard(host)}
      ${controllersCard()}
      ${appsCard(declared)}
      <div class="card"><h2>Session</h2>
        <dl><dt>Gamescope session</dt><dd>${data.session.gamescope ? "Yes" : "No"}</dd>
        <dt>Display</dt><dd>${h(data.session.display ?? "none reported")}</dd>
        <dt>Desktop</dt><dd>${h(data.session.desktop ?? "none reported")}</dd>
        <dt>App window</dt><dd>${data.session.window ? "Managed by this service" : "Not managed (open the page in any browser)"}</dd></dl>
        <button data-nav data-action="power">${icon("power")} Power menu</button>
      </div>
      <div class="card"><h2>Library</h2>
        <dl><dt>Games</dt><dd>${data.library.games}</dd>
        <dt>Project</dt><dd class="path">${h(data.library.project)}</dd>
        <dt>Database</dt><dd class="path">${h(data.library.database)}</dd>
        <dt>Scan folders</dt><dd>${data.library.sources.map(source => `<span class="chip">${h(source.kind)}</span> ${h(source.kind === "folder" ? source.path : source.kind === "bep" ? "bep project" : source.kind === "store" ? "ROM store" : "free ROM packs")}`).join("<br/>") || "none"}</dd></dl>
        <div class="row"><button data-nav data-tab="sources">Manage sources</button><button data-nav data-action="scan">${icon("refresh-cw")} Rescan</button></div>
      </div>
      <div class="card"><h2>Cores and BIOS</h2>
        <dl>${data.cores.map(core => `<dt>${h(core.id)}</dt><dd><span class="badge ${core.installed ? "present" : "missing"}">${core.installed ? "installed" : "not installed"}</span>${core.bios.length ? ` ${core.bios.filter(bios => bios.status === "present").length}/${core.bios.length} BIOS files` : ""}</dd>`).join("")}
        ${data.native.map(row => `<dt>${h(row.system.toUpperCase())} native</dt><dd><span class="badge ${row.status}">${h(row.status)}</span> ${h(row.machine)} BIOS</dd>`).join("")}</dl>
        <p class="note">${biosMissing ? `${biosMissing} required BIOS ${biosMissing === 1 ? "file is" : "files are"} missing.` : "No required BIOS file is missing."}</p>
        <div class="row"><button data-nav data-tab="bios">BIOS</button><button data-nav data-tab="installer">Installer</button></div>
      </div>
      <div class="card wide"><h2>Systems and routes</h2>
        <div class="route-table">${data.systems
          .map(system => {
            const ready = system.routes.filter(route => route.available);
            return `<button data-nav class="srow" data-system="${h(system.id)}"><span class="n">${h(system.name)}</span><span class="g">${system.games} ${system.games === 1 ? "game" : "games"}</span><span class="r">${ready.length ? `${ready.length} of ${system.routes.length} routes ready` : `No route ready: ${h(system.routes.find(route => route.reason)?.reason ?? "nothing installed")}`}</span><span class="d">${system.defaultRoute ? `Default ${h(system.defaultRoute)}` : "Automatic"}</span></button>`;
          })
          .join("")}</div>
      </div>
      <div class="card"><h2>About</h2>
        <dl><dt>Bun Engine</dt><dd>${h(data.versions.engine ?? "unknown")}</dd>
        <dt>Bun</dt><dd>${h(data.versions.bun)}</dd>
        <dt>Platform</dt><dd>${h(data.versions.platform)}</dd>
        <dt>In-process RetroArch</dt><dd class="path">${h(data.versions.libretroarch ?? "not built")}</dd></dl>
      </div>
    </div>
  </section>`;
  focusFirst("[data-setting]");
  measureRefresh();
}

// ---- overlays -------------------------------------------------------------------------------------

interface OverlayOptions {
  kind: string;
  label: string;
  html: string;
  initial?: string;
  /** Escape, B and the Menu key call this; it must close the overlay itself. */
  cancel?: () => void;
  /** Where focus goes when the overlay closes (defaults to the control that opened it). */
  returnTo?: HTMLElement | null;
}

const cancels = new WeakMap<HTMLElement, () => void>();
const returns = new WeakMap<HTMLElement, { to: HTMLElement | null; hints: Hint[] }>();
let pendingReturn: HTMLElement | null = null;

function backdrop(inert: boolean): void {
  for (const element of document.querySelectorAll<HTMLElement>("#top, #view, #hints")) element.inert = inert;
  if (player) player.frame.inert = inert;
}

function openOverlay(options: OverlayOptions): HTMLElement {
  const root = document.createElement("div");
  root.className = `overlay ${options.kind}`;
  root.dataset.kind = options.kind;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", options.label);
  root.innerHTML = `<div class="sheet">${options.html}</div>`;
  const active = document.activeElement;
  const opener =
    options.returnTo ?? pendingReturn ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  pendingReturn = null;
  const previous = overlayStack.at(-1);
  if (previous) {
    // the sheet underneath stays in the DOM (state and focus target) but is neither reachable nor shown
    previous.inert = true;
    previous.style.visibility = "hidden";
  } else backdrop(true);
  returns.set(root, { to: opener, hints: [...currentHints()] });
  cancels.set(root, options.cancel ?? (() => closeOverlay(root)));
  overlayStack.push(root);
  document.body.append(root);
  setHints([
    ["move", "Move"],
    ["select", "Choose"],
    ["back", "Close"],
  ]);
  focusFirst(options.initial ?? "[data-nav]");
  return root;
}

function closeOverlay(root: HTMLElement | undefined = overlayStack.at(-1), restoreFocus = true): void {
  if (!root) return;
  const at = overlayStack.indexOf(root);
  if (at < 0) return;
  overlayStack.splice(at, 1);
  root.remove();
  const info = returns.get(root);
  const below = overlayStack.at(-1);
  if (below) {
    below.inert = false;
    below.style.visibility = "";
  } else backdrop(false);
  if (info) setHints(info.hints);
  if (!restoreFocus) return;
  const to = info?.to;
  if (to?.isConnected) {
    to.focus({ preventScroll: true });
    if (to instanceof HTMLIFrameElement) to.contentWindow?.focus();
  } else if (!below) focusFirst(".hero [data-nav], .game, .system, main [data-nav]");
}

function toggleQuick(): void {
  if (overlayStack.at(-1)?.dataset.kind === "quick") cancelTop();
  else openQuick();
}

function cancelTop(): void {
  const top = overlayStack.at(-1);
  if (top) sound("back");
  if (top) cancels.get(top)?.();
}

function confirmDialog(options: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      closeOverlay(root);
      resolve(answer);
    };
    const root = openOverlay({
      kind: "confirm",
      label: options.title,
      html: `<h2>${h(options.title)}</h2><p>${h(options.body)}</p>
        <div class="row"><button data-nav class="ghost" data-confirm="no">Cancel</button><button data-nav class="${options.danger ? "danger solid" : "primary"}" data-confirm="yes">${h(options.confirm)}</button></div>`,
      initial: '[data-confirm="no"]',
      cancel: () => finish(false),
    });
    confirms.set(root, finish);
  });
}
const confirms = new WeakMap<HTMLElement, (answer: boolean) => void>();

// -- power -----------------------------------------------------------------------------------------

async function openPower(): Promise<void> {
  const session = await api<{
    window: boolean;
    power: boolean;
    sleep?: { available: boolean; mechanism?: string; reason?: string };
  }>("/api/session").catch(() => ({
    window: false,
    power: false,
    sleep: { available: false, mechanism: undefined, reason: "The service did not answer." },
  }));
  const sleepable = session.sleep?.available === true;
  const root = openOverlay({
    kind: "power",
    label: "Power",
    html: `<h2>Power</h2>
      <button data-nav class="qitem" data-power="sleep" aria-disabled="${!sleepable}">${icon("moon")}<span>Sleep display<small>${sleepable ? `Turns the screen off (${h(session.sleep?.mechanism ?? "")}); any button wakes it` : `Not available: ${h(session.sleep?.reason ?? "unknown reason")}`}</small></span></button>
      <button data-nav class="qitem danger" data-power="exit" aria-disabled="${!session.power}">${icon("log-out")}<span>Exit to desktop<small>${session.power ? "Stops running games and ends this session" : "Not available: no session window to close"}</small></span></button>
      <button data-nav class="qitem" data-power="restart">${icon("rotate-cw")}<span>Restart frontend<small>${session.window ? "Stops running games and reopens the window" : "Stops running games and reloads this page"}</small></span></button>
      <button data-nav class="qitem" data-power="close">${icon("x")}<span>Close</span></button>`,
    initial: sleepable ? "[data-power=sleep]" : "[data-power=close]",
  });
  void root;
}

// -- sleep: the display goes off through the host (Sway output power or X11 DPMS), the page keeps a black cover
//    and wakes on the first key, click or pad button. If the host cannot do it the menu says why: no fake sleep.

let sleeping:
  { returnTo: HTMLElement | null; watch: ReturnType<typeof setInterval>; held: boolean; waking: boolean } | undefined;

const anyPadPressed = () =>
  [...(navigator.getGamepads?.() ?? [])].some(pad => pad?.buttons.some(button => button.pressed));

async function sleepNow(unavailable: boolean, reason: string): Promise<void> {
  if (unavailable) {
    toast(`Sleep is not available: ${reason}`, "error");
    return;
  }
  let result: { ok: boolean; mechanism?: string };
  try {
    result = await api("/api/session/sleep", { method: "POST" });
  } catch (error) {
    toast(`Sleep failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    return;
  }
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeAllOverlays();
  const cover = document.createElement("div");
  cover.id = "sleep-cover";
  cover.className = "sleep-cover";
  cover.setAttribute("role", "alertdialog");
  cover.setAttribute("aria-label", "Display is off");
  cover.tabIndex = -1;
  cover.innerHTML = `<p>Display off (${h(result.mechanism ?? "host")}). Press any button to wake it.</p>`;
  document.body.append(cover);
  cover.focus();
  if (player) sendToGame({ action: "open" });
  // requestAnimationFrame stops with the display, so the pad is watched on a timer while asleep
  const watch = setInterval(() => {
    const pressed = anyPadPressed();
    if (pressed && sleeping && !sleeping.held) void wakeNow();
    if (sleeping) sleeping.held = pressed;
  }, 150);
  sleeping = { returnTo, watch, held: anyPadPressed(), waking: false };
}

async function wakeNow(): Promise<void> {
  const current = sleeping;
  if (!current || current.waking) return;
  current.waking = true;
  try {
    await api("/api/session/wake", { method: "POST" });
  } catch (error) {
    // still dark: stay asleep so the next key tries again
    current.waking = false;
    toast(`Wake failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    return;
  }
  clearInterval(current.watch);
  sleeping = undefined;
  document.querySelector("#sleep-cover")?.remove();
  if (player) {
    sendToGame({ action: "close" });
    player.frame.focus();
  } else if (current.returnTo?.isConnected) current.returnTo.focus({ preventScroll: true });
  else focusFirst(".hero [data-nav], .system, .game, [data-nav]");
}

// the first input while asleep only wakes: it must not also press a button on the page behind
for (const type of ["keydown", "mousedown", "pointerdown", "touchstart", "wheel"]) {
  document.addEventListener(
    type,
    event => {
      if (!sleeping) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void wakeNow();
    },
    { capture: true, passive: false },
  );
}

async function powerAction(action: "exit" | "restart", unavailable: boolean): Promise<void> {
  if (unavailable) {
    toast("Exit to desktop needs the app window of the session", "error");
    return;
  }
  const exit = action === "exit";
  const yes = await confirmDialog({
    title: exit ? "Exit to desktop?" : "Restart the frontend?",
    body: exit
      ? "Running games stop and this session ends. Unsaved game progress is lost."
      : "Running games stop and the window reopens. Unsaved game progress is lost.",
    confirm: exit ? "Exit to desktop" : "Restart",
    danger: true,
  });
  if (!yes) return;
  const result = await api<{ reload: boolean }>(`/api/session/${action}`, { method: "POST" });
  closeAllOverlays();
  if (result.reload) {
    location.reload();
    return;
  }
  view.innerHTML = `<section class="state" role="status">${icon(exit ? "log-out" : "rotate-cw", "icon big")}<h1>${exit ? "Session ended" : "Restarting"}</h1><p>${exit ? "You can close this window." : "The window reopens in a moment."}</p></section>`;
  setHints([]);
}

function closeAllOverlays(): void {
  while (overlayStack.length) closeOverlay(overlayStack.at(-1), false);
}

// -- profiles --------------------------------------------------------------------------------------

async function openProfiles(): Promise<void> {
  const players = await api<Array<{ name: string; plays: number }>>("/api/profiles");
  openOverlay({
    kind: "profiles",
    label: "Profiles",
    html: `<h2>Who is playing?</h2>
      <p class="sub">Recent games, play counts, save states and screenshots follow the profile. Earlier shared saves are copied in the first time a profile plays.</p>
      <div class="plist">${players
        .map(
          player => `<button data-nav class="qitem" data-profile="${h(player.name)}" aria-pressed="${player.name === state.profile}">
            <span class="avatar" aria-hidden="true">${h(profileLabel(player.name).slice(0, 1).toUpperCase())}</span>
            <span>${h(profileLabel(player.name))}<small>${player.plays} ${player.plays === 1 ? "play" : "plays"}${player.name === state.profile ? " · current" : ""}</small></span></button>`,
        )
        .join("")}</div>
      <div class="row"><button data-nav data-action="profile-add">${icon("plus")} Add a profile</button><button data-nav class="ghost" data-action="close-overlay">Close</button></div>`,
    initial: `[data-profile="${CSS.escape(state.profile)}"]`,
  });
}

function openAddProfile(): void {
  const root = openOverlay({
    kind: "profile-add",
    label: "Add a profile",
    html: `<h2>Add a profile</h2>
      <label class="field" for="pname"><span class="label">Name (up to 24 characters)</span><input id="pname" data-nav maxlength="24" autocomplete="off" spellcheck="false" /></label>
      ${keyboardHtml("#pname", true)}
      <div class="row"><button data-nav class="ghost" data-action="close-overlay">Cancel</button><button data-nav class="primary" data-action="profile-create">Create</button></div>
      <p id="pname-error" class="error" role="alert"></p>`,
    initial: '.key[data-key="a"]',
  });
  void root;
}

async function createProfile(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#pname");
  const error = document.querySelector<HTMLElement>("#pname-error");
  try {
    const player = await api<{ name: string }>("/api/profiles", { method: "POST", json: { name: input?.value ?? "" } });
    closeAllOverlays();
    selectProfile(player.name);
  } catch (failure) {
    if (error) error.textContent = failure instanceof Error ? failure.message : String(failure);
    input?.focus();
  }
}

function selectProfile(name: string): void {
  state.profile = name;
  localStorage.setItem("bunos.profile", name);
  renderProfileButton();
  toast(`Profile: ${profileLabel(name)}`, "ok");
  if (state.tab === "home") void showHome();
}

function renderProfileButton(): void {
  const button = document.querySelector<HTMLElement>("#profile-btn");
  if (!button) return;
  button.setAttribute("aria-label", `Profile: ${profileLabel(state.profile)}. Open the profile menu`);
  button.querySelector(".avatar")!.textContent = profileLabel(state.profile).slice(0, 1).toUpperCase();
}

// ---- running a game -------------------------------------------------------------------------------

async function launch(game: Game, check = false, route?: string): Promise<void> {
  state.game = game;
  toast(check ? `Checking ${route ?? "default route"}…` : `Launching ${nameOf(game)}…`);
  const result = await api<LaunchResult>(`/api/games/${game.id}/launch`, {
    method: "POST",
    json: { route, check, profile: state.profile },
  });
  const log = document.querySelector<HTMLElement>("#log");
  if (log) {
    log.hidden = false;
    log.textContent = [
      `${result.mode} ${result.route}: ${result.ok ? "ok" : "failed"} in ${result.ms} ms`,
      result.alive
        ? "GUI still running at the deadline (stopped)"
        : result.exitCode === undefined
          ? ""
          : `exit code ${result.exitCode}`,
      result.error ?? "",
      result.output ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  toast(
    result.error ??
      `${result.route}: ${result.ok ? (check ? "check passed" : `started (pid ${result.pid})`) : "failed"}`,
    result.ok ? "ok" : "error",
  );
  if (!check) await pollRunning();
  if (!check && result.ok && result.player) await openPlayer(result.player, game, result.pid);
}

/** The game with this id from what the page already holds (recents, lists, search results). */
function knownGame(id: number): Game | undefined {
  return [...recent, ...state.games, ...pageGames, ...(state.game ? [state.game] : [])].find(game => game.id === id);
}

// A game RetroArch runs in process plays in this window, so one kiosk window (gamescope) holds both.
let player: { frame: HTMLIFrameElement; pid?: number; returnTo: HTMLElement | null; game: Game } | undefined;

async function openPlayer(url: string, game: Game, pid?: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await fetch(url, { mode: "no-cors" }).then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "autoplay; gamepad";
  frame.className = "player";
  frame.title = `${nameOf(game)} (playing)`;
  document.body.append(frame);
  player = { frame, pid, returnTo, game };
  frame.addEventListener("load", () => {
    frame.focus();
    sendToGame({ action: "volume", value: volume() });
  });
}

async function closePlayer(): Promise<void> {
  if (!player) return;
  closeAllOverlays();
  const { frame, pid, returnTo } = player;
  player = undefined;
  frame.remove();
  // the focused iframe took the focus with it: give it back so A / Enter work without a direction first
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  else focusFirst(".hero [data-nav], .system, .game, [data-nav]");
  if (pid !== undefined) await api(`/api/running/${pid}`, { method: "DELETE" }).catch(() => undefined);
  await pollRunning();
  // the recents moved on while we played
  if (state.tab === "home") void showHome();
  else if (state.tab === "game" && pageData) void showGamePage(pageData.game.id, false);
}

function sendToGame(message: Record<string, unknown>): void {
  player?.frame.contentWindow?.postMessage({ bunos: true, ...message }, "*");
}

const volume = () => Number(localStorage.getItem("bunos.volume") ?? 100) / 100;

// -- quick menu --------------------------------------------------------------------------------------

function quickLog(text: string): void {
  const log = document.querySelector<HTMLElement>("#quick-log");
  if (log) log.textContent = text;
}

function openQuick(): void {
  if (overlayStack.length) return;
  if (!player) {
    openOverlay({
      kind: "quick",
      label: "Quick menu",
      html: `<h2>Quick menu</h2>
        <button data-nav class="qitem" data-q="profile"><span class="avatar" aria-hidden="true">${h(profileLabel(state.profile).slice(0, 1).toUpperCase())}</span><span>Profile<small>${h(profileLabel(state.profile))}</small></span></button>
        <button data-nav class="qitem" data-q="settings">${icon("settings")}<span>Settings</span></button>
        <button data-nav class="qitem" data-q="power">${icon("power")}<span>Power</span></button>
        <button data-nav class="qitem" data-q="close">${icon("x")}<span>Close</span></button>`,
      initial: "[data-q=profile]",
    });
    return;
  }
  const level = Math.round(volume() * 100);
  sendToGame({ action: "open" });
  openOverlay({
    kind: "quick",
    label: "Quick menu",
    returnTo: player.frame,
    cancel: resumeGame,
    html: `<h2>Quick menu</h2>
      <p class="sub">${h(nameOf(player.game))} · <span id="quick-state" role="status" aria-live="polite">Pausing…</span></p>
      <button data-nav class="qitem primary" data-q="resume">${icon("play", "icon fill")}<span>Resume</span></button>
      <button data-nav class="qitem" data-q="save">${icon("save")}<span>Save state</span></button>
      <button data-nav class="qitem" data-q="load">${icon("folder-down")}<span>Load state</span></button>
      <button data-nav class="qitem" data-q="screenshot">${icon("camera")}<span>Screenshot</span></button>
      <div data-nav class="qitem vol" tabindex="0" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${level}" aria-valuetext="${level} percent" data-adjust="volume">${icon("volume-2")}<span>Volume</span><span class="bar" aria-hidden="true"><span style="--v:${level / 100}"></span></span><span class="val">${level}%</span></div>
      <button data-nav class="qitem danger" data-q="stop">${icon("square", "icon fill")}<span>Stop game</span></button>
      <p id="quick-log" class="qlog" role="status" aria-live="polite"></p>`,
    initial: "[data-q=resume]",
  });
  setTimeout(() => {
    const label = document.querySelector("#quick-state");
    if (label && label.textContent === "Pausing…") label.textContent = "Could not confirm the pause";
  }, 1500);
}

function resumeGame(): void {
  sendToGame({ action: "close" });
  closeOverlay();
}

let quickRequest = 0;
async function quickAction(name: string): Promise<void> {
  if (name === "close") return closeOverlay();
  if (name === "profile" || name === "settings" || name === "power") {
    // hand over to the next screen: focus will return to what opened the quick menu
    const top = overlayStack.at(-1);
    const opener = top ? (returns.get(top)?.to ?? null) : null;
    closeOverlay(undefined, false);
    pendingReturn = opener;
    if (name === "profile") return openProfiles();
    if (name === "power") return openPower();
    pendingReturn = null;
    return void showSettings();
  }
  if (!player) return;
  if (name === "resume") return resumeGame();
  if (name === "stop") {
    const yes = await confirmDialog({
      title: "Stop this game?",
      body: "The game closes and progress since your last save state is lost.",
      confirm: "Stop game",
      danger: true,
    });
    if (yes) await closePlayer();
    return;
  }
  quickLog({ save: "Saving…", load: "Loading…", screenshot: "Taking a screenshot…" }[name] ?? "");
  sendToGame({ action: name, id: ++quickRequest });
}

/** Messages from the game page: menu requests, verified pause state, and what each action wrote. */
function onPlayerMessage(data: {
  type: string;
  paused?: boolean;
  ok?: boolean;
  text?: string;
  line?: string;
  value?: number;
}): void {
  if (data.type === "menu") {
    if (!overlayStack.length) openQuick();
  } else if (data.type === "paused") {
    const label = document.querySelector("#quick-state");
    if (label) label.textContent = data.paused ? "Paused" : "Running";
  } else if (data.type === "result") {
    const what =
      { SAVE_STATE: "Save state", LOAD_STATE: "Load state", SCREENSHOT: "Screenshot" }[data.line ?? ""] ?? "Action";
    const text = data.ok
      ? `${what}: ${data.line === "SAVE_STATE" ? "saved" : data.line === "LOAD_STATE" ? "loaded" : "saved as"} ${data.line === "SCREENSHOT" || data.line === "SAVE_STATE" ? (data.text ?? "") : ""}`.trim()
      : `${what} failed: ${data.text ?? "no answer"}`;
    quickLog(text);
    if (!overlayStack.length) toast(text, data.ok ? "ok" : "error");
  }
}

window.addEventListener("message", event => {
  if (event.data === "retroarch-exit") {
    if (player && event.source === player.frame.contentWindow) void closePlayer();
  } else if (event.data?.bunos && player && event.source === player.frame.contentWindow) onPlayerMessage(event.data);
});

// ---- actions --------------------------------------------------------------------------------------

function show(tab: Tab): Promise<void> | void {
  switch (tab) {
    case "home":
      return showHome();
    case "systems":
      return showSystems();
    case "search":
      return showSearch();
    case "settings":
      return showSettings();
    case "bios":
      enter("bios");
      return showBios();
    case "installer":
      enter("installer");
      return showInstaller();
    case "sources":
      enter("sources");
      return showSources();
    case "games":
      return showGames(state.lastSystem ?? "nes");
  }
}

async function runJob(action: string, id?: string): Promise<void> {
  const job = await api<Job>(`/api/installer/${action}`, {
    method: "POST",
    json: { id },
  });
  toast(`Started: ${job.title}`);
  await pollJobs();
}

async function scan(): Promise<void> {
  await api<Job>("/api/library/scan", { method: "POST" });
  toast("Scanning library…");
  await pollJobs();
}

async function activate(element: HTMLElement): Promise<void> {
  const data = element.dataset;
  // a card that only shows information takes focus so the pad can scroll to it; activating it does nothing
  if (data.info !== undefined) return;
  sound(data.confirm === "no" || data.action === "back" || data.power === "close" ? "back" : "select");
  if (data.confirm) return void confirms.get(element.closest<HTMLElement>(".overlay")!)?.(data.confirm === "yes");
  if (data.q) return quickAction(data.q);
  if (data.power) {
    if (data.power === "close") return closeOverlay();
    if (data.power === "sleep")
      return sleepNow(
        element.getAttribute("aria-disabled") === "true",
        element.querySelector("small")?.textContent?.replace(/^Not available: /, "") ?? "unknown reason",
      );
    return powerAction(data.power as "exit" | "restart", element.getAttribute("aria-disabled") === "true");
  }
  if (data.profile) {
    closeOverlay();
    if (data.profile !== state.profile) selectProfile(data.profile);
    return;
  }
  if (data.key) return pressKey(element);
  if (data.setting) {
    const config = await api<Config>(`/api/settings/${data.setting}`, {
      method: "PUT",
      json: { value: data.value },
    });
    applyConfig(config);
    // update the row in place: no reload, so focus and scroll stay where they are
    const label = element.querySelector(".value");
    if (data.setting === "hud") {
      const on = config.hud === "1";
      element.setAttribute("aria-checked", String(on));
      element.dataset.value = on ? "0" : "1";
      if (label) label.textContent = on ? "On" : "Off";
    } else if (data.setting === "motion") {
      element.dataset.value = nextMotion(config.motion);
      if (label) label.textContent = motionLabel[config.motion] ?? config.motion;
    } else if (data.setting === "sounds") {
      element.dataset.value = nextSound(config.sounds);
      if (label) label.textContent = soundLabel[config.sounds] ?? config.sounds;
      sound("select");
    }
    // sounds in Automatic follow the motion setting: keep its explanation current
    const why = document.querySelector("#sounds-why");
    if (why) why.textContent = soundWhy(config.sounds);
    return;
  }
  if (data.play) {
    const game = knownGame(Number(data.play));
    if (game) return launch(game);
    return;
  }
  if (data.app) return launchAppTile(data.app);
  if (data.details) return showGamePage(Number(data.details));
  if (data.games) {
    const game = knownGame(Number(data.games));
    if (game) return showGames(game.system, game.id);
    return;
  }
  if (data.action === "fav-page") return toggleFavorite();
  if (data.tab) return void show(data.tab as Tab);
  if (data.system) return showGames(data.system);
  if (data.action === "back") return back();
  if (data.action === "scan") return scan();
  if (data.action === "retry") return retry?.();
  if (data.action === "search-again") return runSearch();
  if (data.action === "power") return openPower();
  if (data.action === "profiles") return openProfiles();
  if (data.action === "profile-add") return openAddProfile();
  if (data.action === "profile-create") return createProfile();
  if (data.action === "close-overlay") return closeOverlay();
  if (data.action === "launch" && state.game) return launch(state.game);
  if (data.action === "check" && state.game) return launch(state.game, true);
  if (data.action === "favorite") return toggleFavorite();
  if (data.action === "stop") {
    await api(`/api/running/${data.pid}`, { method: "DELETE" });
    return pollRunning();
  }
  if (data.route) {
    if (element.getAttribute("aria-disabled") === "true") {
      toast(element.querySelector(".why")?.textContent || "route unavailable", "error");
      return;
    }
    if (state.game) return launch(state.game, false, data.route);
    return;
  }
  if (data.game) {
    const game = knownGame(Number(data.game));
    if (!game) return;
    state.game = game;
    if (state.tab === "games") renderDetail(game);
    return launch(game);
  }
  if (data.install) return runJob(data.install, data.id);
  if (data.removeSource) {
    await api(`/api/library/sources/${data.removeSource}`, {
      method: "DELETE",
    });
    return void showSources();
  }
  element.click();
}

async function toggleFavorite(): Promise<void> {
  const game = state.game;
  if (!game) return;
  await api(`/api/games/${game.id}/favorite`, {
    method: "POST",
    json: { favorite: !game.favorite },
  });
  game.favorite = game.favorite ? 0 : 1;
  const row = document.querySelector(`[data-game="${game.id}"] .fav`);
  if (row) row.innerHTML = game.favorite ? `${icon("star", "icon fill")}<span class="sr">Favorite</span>` : "";
  if (state.tab === "game") {
    // update the button in place so focus and scroll stay put
    const button = document.querySelector<HTMLElement>("[data-action=fav-page]");
    if (button) button.outerHTML = favoriteButton(game);
    focusFirst("[data-action=fav-page]");
    toast(game.favorite ? `${nameOf(game)} added to favorites` : `${nameOf(game)} removed from favorites`, "ok");
    return;
  }
  renderDetail(game);
  focusFirst("[data-action=favorite]");
}

async function setDefault(): Promise<void> {
  const route = (document.activeElement as HTMLElement | null)?.dataset.route;
  if (!route || !state.system) {
    toast("Focus a launch route to make it the system default");
    return;
  }
  await api(`/api/systems/${state.system.id}/default`, {
    method: "PUT",
    json: { route },
  });
  state.system.defaultRoute = route;
  toast(`${state.system.name}: default route ${route}`, "ok");
  renderDetail(state.game);
  focusFirst(`[data-route="${CSS.escape(route)}"]`);
}

/** Applies the shared shell settings: motion on the page, the performance counter in the corner. */
function applyConfig(config: Config): void {
  const root = document.documentElement;
  if (config.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = config.motion;
  configureSounds({ mode: config.sounds, reducedMotion: motionReduced });
  if (config.hud === "1" && !hudOn) {
    hudSince = performance.now();
    hudFrames = 0;
    hudWorst = 0;
    hudLast = 0;
    hudBox.textContent = "measuring…";
  }
  hudOn = config.hud === "1";
  hudBox.hidden = !hudOn;
}

// ---- polling --------------------------------------------------------------------------------------

let jobTimer: ReturnType<typeof setTimeout> | undefined;
async function pollJobs(): Promise<void> {
  clearTimeout(jobTimer);
  const before = new Map(state.jobs.map(job => [job.id, job.status]));
  state.jobs = await api<Job[]>("/api/jobs");
  for (const job of state.jobs) {
    const was = before.get(job.id);
    if (job.status !== "running" && was !== job.status && (was === "running" || was === undefined)) {
      toast(
        job.status === "done" ? `Done: ${job.title}` : `Failed: ${job.title}: ${job.error}`,
        job.status === "done" ? "ok" : "error",
      );
      if (
        job.title === "Scan library" &&
        ["home", "systems", "sources", "settings"].includes(state.tab) &&
        !overlayStack.length
      )
        void show(state.tab);
      if (state.tab === "bios" && job.status === "done") void showBios();
    }
  }
  const jobs = document.querySelector("#jobs");
  if (jobs) jobs.innerHTML = jobsHtml();
  renderStatus();
  if (state.jobs.some(job => job.status === "running")) jobTimer = setTimeout(pollJobs, 1500);
}

async function pollRunning(): Promise<void> {
  state.running = await api<typeof state.running>("/api/running").catch(() => state.running);
  renderStatus();
  if (apps.length && state.tab === "home") await refreshApps();
}

/** Re-reads the app tiles; the shelf is redrawn only when an app started or stopped, keeping focus and scroll. */
async function refreshApps(): Promise<void> {
  const next = await api<AppRow[]>("/api/apps").catch(() => apps);
  const changed = JSON.stringify(next.map(app => app.pid)) !== JSON.stringify(apps.map(app => app.pid));
  apps = next;
  const shelf = document.querySelector<HTMLElement>("#apps");
  if (!changed || !shelf || state.tab !== "home") return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.app : undefined;
  const scroll = shelf.scrollLeft;
  shelf.innerHTML = apps.map(appTile).join("");
  shelf.scrollLeft = scroll;
  if (focused) shelf.querySelector<HTMLElement>(`[data-app="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

async function launchAppTile(id: string): Promise<void> {
  const app = apps.find(item => item.id === id);
  if (!app) return;
  if (!app.available) {
    toast(app.reason ?? "This app is not installed", "error");
    return;
  }
  if (app.pid) {
    const yes = await confirmDialog({
      title: `Stop ${app.title}?`,
      body: "The app closes. Anything unsaved in it is lost.",
      confirm: "Stop",
      danger: true,
    });
    if (yes) {
      await api(`/api/running/${app.pid}`, { method: "DELETE" });
      await pollRunning();
      toast(`${app.title} stopped`, "ok");
    }
    return;
  }
  const result = await api<{ pid: number }>(`/api/apps/${enc(id)}/launch`, { method: "POST" });
  toast(`${app.title} started (pid ${result.pid})`, "ok");
  await pollRunning();
}

function renderStatus(): void {
  const running = state.jobs.filter(job => job.status === "running").length;
  status.innerHTML = [
    state.running.length
      ? `<span class="pill play">${icon("play", "icon fill")} ${state.running.length} running</span>`
      : "",
    running ? `<span class="pill busy">${icon("refresh-cw")} ${running} job${running > 1 ? "s" : ""}</span>` : "",
    `<span class="pill" id="pad" title="${state.pad === "none" ? "Keyboard" : "Controller connected"}">${icon(state.pad === "none" ? "keyboard" : "gamepad-2")} ${state.pad === "none" ? "Keyboard" : "Controller"}</span>`,
  ].join("");
}

// ---- spatial navigation ---------------------------------------------------------------------------

type Direction = "up" | "down" | "left" | "right";

function adjust(element: HTMLElement, step: number): void {
  if (element.dataset.adjust !== "volume") return;
  const next = Math.min(100, Math.max(0, Math.round(Number(element.getAttribute("aria-valuenow")) + step * 10)));
  localStorage.setItem("bunos.volume", String(next));
  element.setAttribute("aria-valuenow", String(next));
  element.setAttribute("aria-valuetext", `${next} percent`);
  element.querySelector<HTMLElement>(".bar span")!.style.setProperty("--v", String(next / 100));
  element.querySelector(".val")!.textContent = `${next}%`;
  sendToGame({ action: "volume", value: next / 100 });
}

function move(direction: Direction): void {
  const items = focusable();
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    focusFirst(".hero [data-nav], .system, .game, [data-nav]");
    return;
  }
  if (current.dataset.adjust && (direction === "left" || direction === "right")) {
    adjust(current, direction === "left" ? -1 : 1);
    return;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === current) continue;
    const to = item.getBoundingClientRect();
    const dx = to.left + to.width / 2 - cx;
    const dy = to.top + to.height / 2 - cy;
    const [main, cross] =
      direction === "left" ? [-dx, dy] : direction === "right" ? [dx, dy] : direction === "up" ? [-dy, dx] : [dy, dx];
    if (main <= 1) continue;
    const overlap =
      direction === "left" || direction === "right"
        ? Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top) > 0
        : Math.min(from.right, to.right) - Math.max(from.left, to.left) > 0;
    const score = main + Math.abs(cross) * (overlap ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (!best) return;
  best.focus({ preventScroll: true });
  reveal(best);
  sound("focus");
}

function back(): void {
  if (overlayStack.length) return cancelTop();
  if (state.tab === "home") return;
  if (state.tab === "game") {
    sound("back");
    return backToTrail();
  }
  sound("back");
  void show(state.from === state.tab ? "home" : state.from);
}

const pages: Tab[] = ["home", "systems", "search", "settings"];
function cyclePage(step: number): void {
  if (overlayStack.length) return;
  const base = state.tab === "game" ? state.from : state.tab;
  const current = base === "games" ? "systems" : ["bios", "installer", "sources"].includes(base) ? "settings" : base;
  const index = Math.max(0, pages.indexOf(current));
  void show(pages[(index + step + pages.length) % pages.length]!);
}

function guarded(action: () => Promise<void> | void): void {
  Promise.resolve()
    .then(action)
    .catch(error => toast(error instanceof Error ? error.message : String(error), "error"));
}

document.addEventListener("focusin", event => {
  const target = event.target as HTMLElement;
  if (target.dataset.game && state.tab === "games") {
    state.lastGame = Number(target.dataset.game);
    renderDetail(state.games.find(game => game.id === state.lastGame));
  }
});

document.addEventListener("click", event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]");
  if (!target || target.matches("input, select, button[type=submit]")) return;
  event.preventDefault();
  guarded(() => activate(target));
});

// pad and keyboard use hide the pointer (a TV has none); moving the mouse brings it back
const hidePointer = (hide: boolean) => document.body.classList.toggle("no-pointer", hide);
document.addEventListener("keydown", () => hidePointer(true), true);
document.addEventListener("mousemove", () => hidePointer(false));

document.addEventListener("input", event => {
  if ((event.target as HTMLElement).id === "q") runSearch();
});

document.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const values = Object.fromEntries(new FormData(form)) as {
    path: string;
    system: string;
  };
  guarded(async () => {
    await api("/api/library/sources", { method: "POST", json: values });
    toast(`Added ${values.path}`, "ok");
    await showSources();
    await scan();
  });
});

document.addEventListener("keydown", event => {
  const target = event.target as HTMLElement;
  const typing = target.matches("input, select, textarea");
  if (event.key === "F1") {
    event.preventDefault();
    toggleQuick();
    return;
  }
  if (overlayStack.length) {
    const keys: Record<string, () => void> = {
      ArrowUp: () => move("up"),
      ArrowDown: () => move("down"),
      ArrowLeft: () => !typing && move("left"),
      ArrowRight: () => !typing && move("right"),
      Escape: cancelTop,
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    } else if (event.key === "Enter" && !typing && target.dataset.nav !== undefined) {
      event.preventDefault();
      guarded(() => activate(target));
    }
    return;
  }
  if (player) {
    if (event.key === "Escape") void closePlayer();
    return;
  }
  const onSearch = state.tab === "search";
  // on the search page a printable key goes to the field wherever the focus is
  if (onSearch && !typing && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    document.querySelector<HTMLInputElement>("#q")?.focus();
    return;
  }
  const keys: Record<string, () => void> = {
    ArrowUp: () => move("up"),
    ArrowDown: () => move("down"),
    ArrowLeft: () => !typing && move("left"),
    ArrowRight: () => !typing && move("right"),
    Escape: back,
    Backspace: () => !typing && back(),
    q: () => !typing && cyclePage(-1),
    e: () => !typing && cyclePage(1),
    PageUp: () => cyclePage(-1),
    PageDown: () => cyclePage(1),
    c: () =>
      !typing &&
      state.tab === "games" &&
      state.game &&
      guarded(() => launch(state.game!, true, (document.activeElement as HTMLElement)?.dataset.route)),
    f: () => !typing && (state.tab === "games" || state.tab === "game") && guarded(toggleFavorite),
    d: () => !typing && state.tab === "games" && guarded(setDefault),
    r: () => !typing && guarded(scan),
  };
  const handler = keys[event.key];
  if (handler) {
    event.preventDefault();
    handler();
  } else if (event.key === "Enter" && !typing && target.dataset.nav !== undefined) {
    event.preventDefault();
    guarded(() => activate(target));
  } else if (event.key === "Enter" && target.id === "q") {
    event.preventDefault();
    focusFirst("#results .game");
  }
});

// ---- gamepad (standard mapping) -------------------------------------------------------------------

const held = new Map<number, number>();
let axisAt = 0;
let hudOn = false;
let guideHeld = false;
let hudFrames = 0;
let hudSince = 0;
let hudWorst = 0;
let hudLast = 0;
const hudBox = document.querySelector<HTMLElement>("#hud")!;

function pollGamepad(time: number): void {
  const pad = navigator.getGamepads?.().find(Boolean);
  const kind = padKindOf(pad?.id);
  if (kind !== state.pad) {
    state.pad = kind;
    if (kind !== "none") hidePointer(true);
    renderHints();
    renderStatus();
  }
  if (sleeping) {
    requestAnimationFrame(pollGamepad);
    return;
  }
  if (hudOn) {
    hudFrames++;
    hudWorst = Math.max(hudWorst, hudLast ? time - hudLast : 0);
    hudLast = time;
    if (time - hudSince >= 500) {
      hudBox.textContent = `${Math.round((hudFrames * 1000) / (time - hudSince || 1))} fps · worst frame ${hudWorst.toFixed(1)} ms`;
      hudFrames = 0;
      hudSince = time;
      hudWorst = 0;
    }
  }
  const press = (index: number, action: () => void) => {
    const pressed = pad?.buttons[index]?.pressed ?? false;
    const since = held.get(index);
    if (!pressed) held.delete(index);
    else if (since === undefined) {
      held.set(index, time);
      action();
    } else if (index >= 12 && time - since > 350) {
      held.set(index, time - 260);
      action();
    }
  };
  if (pad) {
    // Guide or Select + R3 opens the quick menu and closes it again (the game page asks too; the first one wins)
    const guide = Boolean(pad.buttons[16]?.pressed || (pad.buttons[8]?.pressed && pad.buttons[11]?.pressed));
    if (guide && !guideHeld) toggleQuick();
    guideHeld = guide;
    if (player && !overlayStack.length) {
      // the game owns the pad; only the exit chord and the quick menu are ours
      if (pad.buttons[8]?.pressed && pad.buttons[9]?.pressed) {
        // the chord is consumed: Start still being held must not open the menu on the page behind
        held.set(8, time);
        held.set(9, time);
        void closePlayer();
      }
    } else {
      press(12, () => move("up"));
      press(13, () => move("down"));
      press(14, () => move("left"));
      press(15, () => move("right"));
      press(0, () => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.dataset.nav !== undefined) guarded(() => activate(active));
      });
      press(1, back);
      if (!overlayStack.length) {
        press(2, () =>
          state.tab === "games" || state.tab === "game"
            ? guarded(toggleFavorite)
            : state.tab === "search"
              ? typeKey("back", "#q")
              : undefined,
        );
        press(3, () =>
          state.tab === "games" && state.game
            ? guarded(() => launch(state.game!, true, (document.activeElement as HTMLElement)?.dataset.route))
            : state.tab === "search"
              ? typeKey(" ", "#q")
              : guarded(scan),
        );
        press(4, () => cyclePage(-1));
        press(5, () => cyclePage(1));
        press(8, () => state.tab === "games" && guarded(setDefault));
        press(9, openQuick);
      }
      const [x = 0, y = 0] = pad.axes;
      if (time - axisAt > 180 && Math.max(Math.abs(x), Math.abs(y)) > 0.6) {
        axisAt = time;
        move(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up");
      }
    }
  }
  requestAnimationFrame(pollGamepad);
}

window.addEventListener("gamepadconnected", () => {
  renderStatus();
  toast("Controller connected", "ok");
});
window.addEventListener("gamepaddisconnected", renderStatus);
requestAnimationFrame(pollGamepad);

// ---- boot -----------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  document.querySelector("#offline")?.addEventListener("click", () => location.reload());
  renderProfileButton();
  renderStatus();
  renderHints();
  try {
    const session = await api<{ config: Config; asleep: boolean }>("/api/session");
    applyConfig(session.config);
    // a display left off by an earlier page (it crashed or was reloaded while asleep) must not stay dark
    if (session.asleep) await api("/api/session/wake", { method: "POST" }).catch(() => undefined);
    state.jobs = await api<Job[]>("/api/jobs");
    await pollRunning();
    const systems = await api<SystemRow[]>("/api/systems");
    state.systems = systems;
    if (!systems.some(system => system.games)) await scan();
  } catch (error) {
    showError(error, async () => location.reload());
    document.body.dataset.ready = "1";
    return;
  }
  await showHome();
  document.body.dataset.ready = "1";
  setInterval(() => void pollRunning(), 4000);
}

guarded(boot);
void motionReduced;
