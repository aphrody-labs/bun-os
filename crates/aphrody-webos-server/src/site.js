// SPDX-License-Identifier: Apache-2.0
// aphrody.com page services (served at /site.js by crates/aphrody-webos-server/src/site.rs):
// storage notice, service worker, install prompt, share dialogs, WebGPU probe, theme switcher,
// ambient soundscape player, and WebOS desktop mode launcher.

const KEY = "aphrody.storage"; // "functional" | "essential"
const choice = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return "essential";
  }
};

async function clearLocal() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  for (const name of await caches.keys().catch(() => [])) await caches.delete(name);
  for (const db of (await indexedDB.databases?.().catch(() => [])) ?? [])
    if (db.name) indexedDB.deleteDatabase(db.name);
  for (const reg of (await navigator.serviceWorker?.getRegistrations().catch(() => [])) ?? []) await reg.unregister();
}

function choose(value) {
  if (value === "essential") clearLocal();
  try {
    localStorage.setItem(KEY, value);
  } catch {}
  document.getElementById("storage-notice")?.remove();
  document.documentElement.style.setProperty("--site-notice-height", "0px");
  if (value === "functional") registerWorker();
}

function registerWorker() {
  if (!("serviceWorker" in navigator) || choice() !== "functional") return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", type: "classic", updateViaCache: "none" }).catch(() => {});
}

function notice() {
  if (choice() || location.pathname === "/privacy") return;
  const sheet = document.createElement("aside");
  sheet.id = "storage-notice";
  sheet.setAttribute("aria-label", "Privacy and storage");
  sheet.innerHTML =
    "<p>Zero advertising, zero tracking. aphrody.com only stores your ambiance preferences and an offline application cache on your device. " +
    '<a href="/privacy">Manage data</a></p>' +
    '<div class="row"><button type="button" data-storage="refuse">Essential only</button>' +
    '<button type="button" class="button button-primary" data-storage="accept">Accept</button></div>';
  document.body.append(sheet);
  new ResizeObserver(([entry]) =>
    document.documentElement.style.setProperty(
      "--site-notice-height",
      `${Math.ceil(entry.borderBoxSize[0].blockSize) + 16}px`,
    ),
  ).observe(sheet);
}

const format = bytes =>
  bytes == null
    ? "?"
    : bytes < 1024
      ? `${bytes} B`
      : bytes < 1048576
        ? `${(bytes / 1024).toFixed(1)} KB`
        : bytes < 1073741824
          ? `${(bytes / 1048576).toFixed(1)} MB`
          : `${(bytes / 1073741824).toFixed(1)} GB`;

async function report() {
  const table = document.getElementById("storage-report");
  if (!table) return;
  const rows = [];
  const cookies = document.cookie ? document.cookie.split(";").map(c => c.trim().split("=")[0]) : [];
  rows.push(["Session cookies", cookies.length ? cookies.join(", ") : "none (cookies are HttpOnly and secure)"]);
  try {
    const keys = Object.keys(localStorage);
    const size = keys.reduce((n, k) => n + k.length + (localStorage.getItem(k)?.length ?? 0), 0) * 2;
    rows.push(["Local storage", keys.length ? `${keys.join(", ")} (${format(size)})` : "empty"]);
    rows.push(["Session storage", `${sessionStorage.length} item(s)`]);
  } catch {
    rows.push(["Local storage", "blocked by browser"]);
  }
  const cacheNames = await caches.keys().catch(() => []);
  rows.push(["Cache Storage", cacheNames.length ? cacheNames.join(", ") : "empty"]);
  const dbs = (await indexedDB.databases?.().catch(() => [])) ?? [];
  rows.push(["IndexedDB", dbs.length ? dbs.map(d => d.name).join(", ") : "empty"]);
  const workers = (await navigator.serviceWorker?.getRegistrations().catch(() => [])) ?? [];
  rows.push(["Service Worker", workers.length ? "active (offline mode)" : "inactive"]);
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    rows.push(["Usage", `${format(usage)} of ${format(quota)}${persisted ? ", persistent" : ", temporary"}`]);
  }
  rows.push(["Your choice", choice() ?? "pending"]);
  const body = document.createElement("tbody");
  for (const [name, value] of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = name;
    tr.insertCell().textContent = value;
  }
  table.replaceChildren(body);
}

const status = text => {
  const out = document.getElementById("storage-status");
  if (out) out.textContent = text;
};

let installPrompt = null;
addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  for (const el of document.querySelectorAll("[data-action=install]")) el.hidden = false;
});
addEventListener("appinstalled", () => {
  installPrompt = null;
  for (const el of document.querySelectorAll("[data-action=install]")) el.hidden = true;
  navigator.storage?.persist?.();
});

const shareTargets = (url, text) => ({
  x: `https://x.com/intent/post?url=${url}&text=${text}`,
  bluesky: `https://bsky.app/intent/compose?text=${text}%20${url}`,
  linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
  facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
  reddit: `https://www.reddit.com/submit?url=${url}&title=${text}`,
  whatsapp: `https://wa.me/?text=${text}%20${url}`,
  telegram: `https://t.me/share/url?url=${url}&text=${text}`,
});

function shareLinks() {
  const url = encodeURIComponent(document.querySelector("link[rel=canonical]")?.href ?? location.href);
  const text = encodeURIComponent(document.title);
  const targets = shareTargets(url, text);
  for (const a of document.querySelectorAll("a[data-share]")) {
    const href = targets[a.dataset.share];
    if (href) {
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
}

// WebOS Desktop Mode toggles
function enterDesktopMode() {
  document.body.classList.add("desktop-mode");
  const topbar = document.getElementById("webos-topbar");
  if (topbar) topbar.hidden = false;
  const canvas = document.querySelector("body > canvas");
  if (canvas) canvas.style.display = "block";
  if (!window._aphrodyBooted) {
    window._aphrodyBooted = true;
    import("/boot.js").catch(e => console.log("WebOS client boot:", e));
  }
}

function exitDesktopMode() {
  document.body.classList.remove("desktop-mode");
  const topbar = document.getElementById("webos-topbar");
  if (topbar) topbar.hidden = true;
  const canvas = document.querySelector("body > canvas");
  if (canvas) canvas.style.display = "none";
}

// Interactive Laptop Viewport Switcher
function initLaptopTabs() {
  const tabs = document.querySelectorAll(".laptop-tabs .tab-btn");
  const screen = document.getElementById("laptop-screen");
  if (!tabs.length || !screen) return;
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const targetView = tab.dataset.tab;
      screen.dataset.view = targetView;
      const views = screen.querySelectorAll(".screen-view");
      views.forEach(v => {
        v.classList.toggle("active", v.classList.contains(`view-${targetView}`));
      });
    });
  });
}

// Theme Switcher (Inspired by Omarchy 22 Themes)
function initThemes() {
  const pills = document.querySelectorAll(".theme-picker-row .theme-pill");
  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => {
        p.classList.remove("active");
        p.setAttribute("aria-checked", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-checked", "true");
      const theme = pill.dataset.themeName;
      document.body.dataset.theme = theme;
      try {
        localStorage.setItem("aphrody.theme", theme);
      } catch {}
    });
  });
  try {
    const saved = localStorage.getItem("aphrody.theme");
    if (saved) {
      document.body.dataset.theme = saved;
      const target = document.querySelector(`.theme-picker-row [data-theme-name="${saved}"]`);
      if (target) {
        pills.forEach(p => {
          p.classList.remove("active");
          p.setAttribute("aria-checked", "false");
        });
        target.classList.add("active");
        target.setAttribute("aria-checked", "true");
      }
    }
  } catch {}
}

// Ambient Soundscape Player (Synthesized Relaxing Audio)
function initAmbientMusic() {
  const capsule = document.getElementById("music-capsule");
  const toggle = document.getElementById("music-toggle");
  if (!capsule || !toggle) return;
  let audioCtx = null;
  let isPlaying = false;
  let osc1 = null;
  let osc2 = null;
  let gain = null;

  toggle.addEventListener("click", () => {
    if (!isPlaying) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        osc1 = audioCtx.createOscillator();
        osc2 = audioCtx.createOscillator();
        gain = audioCtx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(174, audioCtx.currentTime); // Relaxing fundamental tone
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(261.63, audioCtx.currentTime); // C harmonic
        gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.035, audioCtx.currentTime + 1.5);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);
        osc1.start();
        osc2.start();
      } catch {}
      isPlaying = true;
      capsule.classList.add("playing");
      toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
      toggle.setAttribute("aria-label", "Pause ambient soundscape");
    } else {
      if (gain && audioCtx) {
        try {
          gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1);
          setTimeout(() => {
            try {
              osc1?.stop();
              osc2?.stop();
            } catch {}
          }, 1000);
        } catch {}
      }
      isPlaying = false;
      capsule.classList.remove("playing");
      toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      toggle.setAttribute("aria-label", "Listen to ambient soundscape");
    }
  });
}

// WebGPU probe
async function probeGpu() {
  const root = document.documentElement;
  const out = document.getElementById("gpu");
  if (!navigator.gpu) {
    root.dataset.gpu = "webgl2";
    if (out) out.textContent = "WebGL2 raster engine active";
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      root.dataset.gpu = "webgl2";
      if (out) out.textContent = "WebGL2 raster engine active";
      return;
    }
    root.dataset.gpu = "webgpu";
    globalThis.aphrodyGpu = {
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      features: [...adapter.features].sort(),
      wgslLanguageFeatures: [...(navigator.gpu.wgslLanguageFeatures ?? [])].sort(),
      preferredFormat: navigator.gpu.getPreferredCanvasFormat(),
    };
    if (out)
      out.textContent = `WebGPU compute engine active${adapter.info?.vendor ? ` (${adapter.info.vendor})` : ""}`;
  } catch {
    root.dataset.gpu = "webgl2";
    if (out) out.textContent = "Standard raster engine active";
  }
}

// Global click dispatcher
document.addEventListener("click", async event => {
  const el = event.target.closest("[data-storage],[data-action]");
  if (!el) return;
  switch (el.dataset.storage ?? el.dataset.action) {
    case "launch-webos":
      enterDesktopMode();
      break;
    case "accept":
      choose("functional");
      status("Functional storage enabled.");
      break;
    case "refuse":
      choose("essential");
      status("Essential only: local data cleared.");
      break;
    case "install":
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        el.hidden = true;
      }
      break;
    case "share":
      try {
        await navigator.share({
          title: document.title,
          text: document.querySelector("meta[name=description]")?.content,
          url: location.origin + "/",
        });
      } catch (error) {
        if (error?.name !== "AbortError") {
          await navigator.clipboard?.writeText(location.origin + "/");
          el.textContent = "Link copied";
          setTimeout(() => (el.textContent = "Share"), 3000);
        }
      }
      break;
  }
  report();
});

// Setup Desktop Mode Controls
document.getElementById("btn-exit-desktop")?.addEventListener("click", exitDesktopMode);
document.getElementById("btn-toggle-fs")?.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.classList.contains("desktop-mode")) {
    exitDesktopMode();
  }
});

function start() {
  notice();
  shareLinks();
  report();
  initLaptopTabs();
  initThemes();
  initAmbientMusic();
  probeGpu();
  if (location.hash === "#desktop" || location.search.includes("launch=1")) {
    enterDesktopMode();
  }
  addEventListener("load", registerWorker, { once: true });
  if (document.readyState === "complete") registerWorker();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
