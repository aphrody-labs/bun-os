// SPDX-License-Identifier: Apache-2.0
// aphrody.com page services (served at /site.js by crates/aphrody-webos-server/src/site.rs): storage notice and
// manager, service worker, install prompt, Web Share with social links, WebGPU probe. The desktop is the wasm client.

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
  for (const db of (await indexedDB.databases?.().catch(() => [])) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  for (const reg of await navigator.serviceWorker?.getRegistrations().catch(() => []) ?? []) await reg.unregister();
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
  sheet.setAttribute("aria-label", "Storage on this device");
  sheet.innerHTML =
    "<p>No ads and no trackers. aphrody.com can keep an offline copy of the client and your preferences on this " +
    'device. <a href="/privacy">Manage storage</a></p>' +
    '<div class="row"><button type="button" data-storage="refuse">Essential only</button>' +
    '<button type="button" class="filled" data-storage="accept">Allow</button></div>';
  document.body.append(sheet);
  // The page reserves the sheet's height so it never covers the focused control (WCAG 2.4.11).
  new ResizeObserver(([entry]) =>
    document.documentElement.style.setProperty("--site-notice-height", `${Math.ceil(entry.borderBoxSize[0].blockSize) + 16}px`),
  ).observe(sheet);
}

const format = (bytes) =>
  bytes == null ? "?" : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;

async function report() {
  const table = document.getElementById("storage-report");
  if (!table) return;
  const rows = [];
  const cookies = document.cookie ? document.cookie.split(";").map((c) => c.trim().split("=")[0]) : [];
  rows.push(["Cookies readable by scripts", cookies.length ? cookies.join(", ") : "none (the session cookie is HttpOnly)"]);
  try {
    const keys = Object.keys(localStorage);
    const size = keys.reduce((n, k) => n + k.length + (localStorage.getItem(k)?.length ?? 0), 0) * 2;
    rows.push(["localStorage", keys.length ? `${keys.join(", ")} (${format(size)})` : "empty"]);
    rows.push(["sessionStorage", `${sessionStorage.length} item(s)`]);
  } catch {
    rows.push(["localStorage", "blocked by the browser"]);
  }
  const cacheNames = await caches.keys().catch(() => []);
  rows.push(["Cache Storage", cacheNames.length ? cacheNames.join(", ") : "empty"]);
  const dbs = (await indexedDB.databases?.().catch(() => [])) ?? [];
  rows.push(["IndexedDB", dbs.length ? dbs.map((d) => d.name).join(", ") : "empty"]);
  const workers = (await navigator.serviceWorker?.getRegistrations().catch(() => [])) ?? [];
  rows.push(["Service worker", workers.length ? "installed (offline page and client cache)" : "not installed"]);
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    rows.push(["Usage", `${format(usage)} of ${format(quota)}${persisted ? ", persistent" : ", best effort"}`]);
  }
  rows.push(["Your choice", choice() ?? "not made yet"]);
  const body = document.createElement("tbody");
  for (const [name, value] of rows) {
    const tr = body.insertRow();
    tr.insertCell().textContent = name;
    tr.insertCell().textContent = value;
  }
  table.replaceChildren(body);
}

const status = (text) => {
  const out = document.getElementById("storage-status");
  if (out) out.textContent = text;
};

let installPrompt = null;
addEventListener("beforeinstallprompt", (event) => {
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
  mastodon: `https://mastodonshare.com/?url=${url}&text=${text}`,
  email: `mailto:?subject=${text}&body=${url}`,
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

document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-storage],[data-action]");
  if (!el) return;
  switch (el.dataset.storage ?? el.dataset.action) {
    case "accept":
      choose("functional");
      status("Functional storage allowed.");
      break;
    case "refuse":
      choose("essential");
      status("Essential only: local data cleared.");
      break;
    case "persist":
      status((await navigator.storage?.persist?.()) ? "Data is kept on this device." : "The browser kept best-effort storage.");
      break;
    case "clear-local":
      await clearLocal();
      status("Local data cleared.");
      break;
    case "clear-all":
      // Two steps: the first press arms the button, the second clears.
      if (!el.hasAttribute("data-armed")) {
        el.setAttribute("data-armed", "");
        el.textContent = "Press again to clear everything";
        status("This deletes all aphrody.com data in this browser and signs you out.");
        setTimeout(() => {
          el.removeAttribute("data-armed");
          el.textContent = "Clear everything and sign out";
        }, 6000);
        return;
      }
      el.removeAttribute("data-armed");
      el.textContent = "Clear everything and sign out";
      await clearLocal();
      await fetch("/privacy/clear", { method: "POST", credentials: "same-origin" }).catch(() => {});
      status("Everything cleared and signed out.");
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
        await navigator.share({ title: document.title, text: document.querySelector("meta[name=description]")?.content, url: location.origin + "/" });
      } catch (error) {
        if (error?.name !== "AbortError") {
          await navigator.clipboard?.writeText(location.origin + "/");
          el.textContent = "Link copied";
          setTimeout(() => (el.textContent = "Copy link"), 3000);
        }
      }
      break;
    case "reload":
      location.reload();
      return;
  }
  report();
});

// WebGPU probe: the client renders through wgpu; the adapter and its features are exposed for diagnostics.
async function probeGpu() {
  const root = document.documentElement;
  if (!navigator.gpu) {
    root.dataset.gpu = "webgl2";
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      root.dataset.gpu = "webgl2";
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
    const out = document.getElementById("gpu");
    if (out) out.textContent = `Loading the desktop on WebGPU${adapter.info?.vendor ? ` (${adapter.info.vendor})` : ""}`;
  } catch {
    root.dataset.gpu = "webgl2";
  }
}

// The landing content stays for crawlers and first paint; the client's canvas replaces it once mounted.
function watchCanvas() {
  const landing = document.getElementById("landing");
  if (!landing) return;
  const hide = () => {
    if (document.querySelector("body > canvas")) {
      landing.hidden = true;
      return true;
    }
    return false;
  };
  if (!hide()) {
    const observer = new MutationObserver(() => hide() && observer.disconnect());
    observer.observe(document.body, { childList: true });
  }
}

function start() {
  notice();
  shareLinks();
  report();
  watchCanvas();
  probeGpu();
  if (!navigator.share) for (const el of document.querySelectorAll("[data-action=share]")) el.textContent = "Copy link";
  addEventListener("load", registerWorker, { once: true });
  if (document.readyState === "complete") registerWorker();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
