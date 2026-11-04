// SPDX-License-Identifier: Apache-2.0
// aphrody.com page services (served at /site.js by crates/aphrody-webos-server/src/site.rs):
// storage notice, service worker, install prompt, share dialogs, WebGPU probe, theme switcher,
// ambient soundscape player, interactive celestial canvas, video showcase player, and WebOS launcher.

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

// Interactive Celestial Canvas with responsive particles, cursor attraction, and radiant light blue glow
function initCelestialCanvas() {
  const canvas = document.getElementById("celestial-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = (canvas.width = (canvas.parentElement?.offsetWidth || window.innerWidth) * dpr);
  let height = (canvas.height = (canvas.parentElement?.offsetHeight || 800) * dpr);

  const particles = [];
  const particleCount = Math.min(Math.floor((width * height) / (12000 * dpr)), 150);
  const mouse = { x: -1000, y: -1000, radius: 180 * dpr };

  // Palette: Gemini Light Blue, Sky Luster, Celestial Cyan, Byron Gold
  const colors = ["#8ab4f8", "#c2e7ff", "#7cd8e8", "#fce881"];

  class Particle {
    constructor() {
      this.reset(true);
    }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : height + 10;
      this.size = (Math.random() * 2.2 + 0.8) * dpr;
      this.color = colors[Math.floor(Math.random() * colors.length)];
      this.alpha = Math.random() * 0.65 + 0.2;
      this.vx = (Math.random() - 0.5) * 0.35 * dpr;
      this.vy = -(Math.random() * 0.45 + 0.15) * dpr;
      this.twinkleSpeed = Math.random() * 0.02 + 0.006;
      this.twinklePhase = Math.random() * Math.PI * 2;
    }
    update() {
      this.twinklePhase += this.twinkleSpeed;
      this.y += this.vy;
      this.x += this.vx;

      // Cursor attraction
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouse.radius && dist > 1) {
        const force = (mouse.radius - dist) / mouse.radius;
        const angle = Math.atan2(dy, dx);
        this.x += Math.cos(angle) * force * 1.6 * dpr;
        this.y += Math.sin(angle) * force * 1.6 * dpr;
      }

      if (this.y < -15 || this.x < -15 || this.x > width + 15) {
        this.reset();
      }
    }
    draw() {
      const currentAlpha = Math.max(0.1, this.alpha + Math.sin(this.twinklePhase) * 0.25);
      ctx.save();
      ctx.globalAlpha = currentAlpha;
      ctx.fillStyle = this.color;
      ctx.shadowBlur = this.size * 3;
      ctx.shadowColor = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  function resize() {
    width = canvas.width = (canvas.parentElement?.offsetWidth || window.innerWidth) * dpr;
    height = canvas.height = (canvas.parentElement?.offsetHeight || 800) * dpr;
  }
  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * dpr;
    mouse.y = (e.clientY - rect.top) * dpr;
  });

  window.addEventListener("mouseleave", () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });

  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Subtle celestial constellation lines
    const maxDist = 95 * dpr;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          ctx.save();
          ctx.globalAlpha = (1 - dist / maxDist) * 0.14;
          ctx.strokeStyle = "#8ab4f8";
          ctx.lineWidth = 0.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    particles.forEach(p => {
      p.update();
      p.draw();
    });

    requestAnimationFrame(animate);
  }

  animate();
}

// Interactive Video Showcase Player & Feature Switcher
function initShowcasePlayer() {
  const showcase = document.getElementById("showcase");
  if (!showcase) return;

  const motionCanvas = document.getElementById("showcase-motion-canvas");
  const ctx = motionCanvas?.getContext("2d");
  const tabs = document.querySelectorAll(".showcase-tabs .tab-btn");
  const overlays = document.querySelectorAll(".video-scene-overlay");
  const playBtn = document.getElementById("btn-showcase-play");
  const iconPlay = playBtn?.querySelector(".icon-play");
  const iconPause = playBtn?.querySelector(".icon-pause");
  const progressBar = document.getElementById("showcase-progress");
  const timeDisplay = document.getElementById("showcase-time");
  const timelineTrack = document.getElementById("showcase-timeline");
  const fsBtn = document.getElementById("btn-showcase-fs");

  const badgeEl = document.getElementById("detail-badge");
  const titleEl = document.getElementById("detail-title");
  const textEl = document.getElementById("detail-text");
  const tagsEl = document.getElementById("detail-tags");

  const featureData = {
    android: {
      badge: "Pillar 1 • Native Mobility",
      title: "Android 17 In-Browser — Waydroid Multi-Window",
      text: "Run Android 17 applications natively inside your browser tab without emulated slow-downs. Powered by Waydroid containerization with full Google Play, F-Droid, APK side-loading, and seamless clipboard sharing alongside desktop windows.",
      tags: ["Android 17 Container", "Waydroid Multi-Window", "Play Store & F-Droid", "Zero-Latency Input"],
    },
    emulators: {
      badge: "Pillar 2 • Universal Emulation",
      title: "Consoles & Retro Emulators — Pure WASM & WebGPU",
      text: "Play classic and modern video game consoles right in your browser. Real vendor cores running at 60 FPS: Dust Nintendo DS (WebGPU), StarPSX (PlayStation 1), Zakuro (Nintendo Switch), RustBoyAdvance (GBA), TetaNES (NES), PCSX2, and RPCS3.",
      tags: ["Nintendo Switch (Zakuro)", "PlayStation (StarPSX)", "Nintendo DS (Dust WebGPU)", "GBA & Retro"],
    },
    cosmic: {
      badge: "Pillar 3 • Modern Desktop",
      title: "COSMIC Desktop & Rust Base — 60 FPS WebGPU Streaming",
      text: "The full Pop!_OS COSMIC desktop environment streamed over WebGPU in HDR. Featuring Helium browser, Spacedrive sovereign file manager, and Rio GPU-accelerated terminal on top of memory-safe Rust system components.",
      tags: ["COSMIC Desktop Shell", "Helium Web Browser", "Rio Terminal", "Spacedrive Files"],
    },
    craft: {
      badge: "Pillar 4 • Creative Canvas",
      title: "Craft Pro Studio Suite — High-Performance Creative Tools",
      text: "WordCraft typography studio, DeckCraft kinetic keynote stage, GridCraft reactive multidimensional spreadsheets, and VectorCraft precision curves. Built with WebAssembly and WebGPU for distraction-free creation.",
      tags: ["WordCraft Prose", "DeckCraft Keynotes", "GridCraft Reactive", "VectorCraft Curves"],
    },
    gemini: {
      badge: "Pillar 5 • Ambient Intelligence",
      title: "Gemini Multimodal Core — Ambient System Intelligence",
      text: "Gemini is at the center of Bun OS: embedded into the launcher, terminal, and file manager with real-time whispered voice reasoning, spatial screen comprehension, and zero latency system actions.",
      tags: ["Gemini Voice Reasoning", "Launcher Integration", "Spatial Understanding", "System Actions"],
    },
  };

  const featureKeys = ["android", "emulators", "cosmic", "craft", "gemini"];
  let activeFeature = "android";
  let isPlaying = true;
  let progress = 12; // in seconds (0 to 45)
  const totalDuration = 45;

  function switchFeature(featureKey) {
    if (!featureData[featureKey]) return;
    activeFeature = featureKey;

    tabs.forEach(t => {
      const isMatch = t.dataset.feature === featureKey;
      t.classList.toggle("active", isMatch);
      t.setAttribute("aria-selected", isMatch ? "true" : "false");
    });

    overlays.forEach(ov => {
      ov.classList.toggle("active", ov.dataset.scene === featureKey);
    });

    const info = featureData[featureKey];
    if (badgeEl) badgeEl.textContent = info.badge;
    if (titleEl) titleEl.textContent = info.title;
    if (textEl) textEl.textContent = info.text;
    if (tagsEl) {
      tagsEl.innerHTML = info.tags.map(tag => `<span class="d-tag">${tag}</span>`).join("");
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      switchFeature(tab.dataset.feature);
    });
  });

  // Play / Pause toggle
  playBtn?.addEventListener("click", () => {
    isPlaying = !isPlaying;
    if (iconPlay && iconPause) {
      iconPlay.hidden = isPlaying;
      iconPause.hidden = !isPlaying;
    }
  });

  // Timeline click scrubber
  timelineTrack?.addEventListener("click", e => {
    const rect = timelineTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    progress = ratio * totalDuration;
  });

  // Fullscreen toggle
  fsBtn?.addEventListener("click", () => {
    const frame = showcase.querySelector(".video-player-frame");
    if (!document.fullscreenElement) {
      frame?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Generative Motion Canvas Renderer for Simulated High-FPS Video
  let frameCount = 0;
  function renderMotionFrame() {
    if (ctx && motionCanvas) {
      const w = motionCanvas.width;
      const h = motionCanvas.height;
      frameCount++;

      ctx.fillStyle = "#0c1119";
      ctx.fillRect(0, 0, w, h);

      const t = frameCount * 0.02;

      if (activeFeature === "calm") {
        // Celestial Calm: breathing light-blue radial nebula
        const grad = ctx.createRadialGradient(
          w * 0.5,
          h * 0.5,
          20,
          w * 0.5,
          h * 0.5,
          Math.sin(t) * 80 + 340,
        );
        grad.addColorStop(0, "rgba(138, 180, 248, 0.28)");
        grad.addColorStop(0.5, "rgba(194, 231, 255, 0.12)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Gentle floating particles
        ctx.fillStyle = "#c2e7ff";
        for (let i = 0; i < 24; i++) {
          const px = (Math.sin(t + i) * 0.4 + 0.5) * w;
          const py = (Math.cos(t * 0.8 + i * 1.5) * 0.4 + 0.5) * h;
          ctx.beginPath();
          ctx.arc(px, py, (Math.sin(t + i) * 1.5 + 2.5), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (activeFeature === "canvas") {
        // Fluid Creative Canvas: animated geometric grid & curve paths
        ctx.strokeStyle = "rgba(138, 180, 248, 0.15)";
        ctx.lineWidth = 1.5;
        const gridSize = 48;
        for (let x = 0; x < w; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Elegant flowing curve
        ctx.strokeStyle = "#8ab4f8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(100, h * 0.5);
        ctx.bezierCurveTo(
          w * 0.3,
          h * 0.5 + Math.sin(t) * 120,
          w * 0.7,
          h * 0.5 - Math.sin(t) * 120,
          w - 100,
          h * 0.5,
        );
        ctx.stroke();
      } else if (activeFeature === "intelligence") {
        // Ambient Intelligence: Gemini neural frequency orbits
        ctx.save();
        ctx.translate(w * 0.5, h * 0.5);
        ctx.rotate(t * 0.3);
        ctx.strokeStyle = "rgba(138, 180, 248, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 220, 110, t * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(w * 0.5, h * 0.5);
        ctx.rotate(-t * 0.2);
        ctx.strokeStyle = "rgba(124, 216, 232, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 180, 90, -t * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (activeFeature === "continuum") {
        // Continuum: glowing data streams between mobile & desktop
        const grad = ctx.createLinearGradient(w * 0.2, h * 0.5, w * 0.8, h * 0.5);
        grad.addColorStop(0, "#8ab4f8");
        grad.addColorStop(0.5, "#c2e7ff");
        grad.addColorStop(1, "#7cd8e8");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(w * 0.25, h * 0.5);
        ctx.lineTo(w * 0.75, h * 0.5);
        ctx.stroke();

        const packetX = w * 0.25 + ((Math.sin(t * 2) + 1) * 0.5) * (w * 0.5);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#8ab4f8";
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(packetX, h * 0.5, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (activeFeature === "byron") {
        // Byron Love: Golden rays and divine radiance
        const grad = ctx.createRadialGradient(
          w * 0.5,
          h * 0.45,
          10,
          w * 0.5,
          h * 0.45,
          300,
        );
        grad.addColorStop(0, "rgba(252, 232, 129, 0.35)");
        grad.addColorStop(0.5, "rgba(245, 196, 81, 0.12)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Golden feather sparks
        ctx.fillStyle = "#fce881";
        for (let i = 0; i < 30; i++) {
          const fx = (Math.sin(t * 0.7 + i * 0.8) * 0.35 + 0.5) * w;
          const fy = (Math.cos(t * 0.9 + i * 0.6) * 0.35 + 0.45) * h;
          ctx.beginPath();
          ctx.arc(fx, fy, Math.sin(t + i) * 1.5 + 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Advance timeline simulation
    if (isPlaying) {
      progress += 0.016; // approx 60fps delta
      if (progress >= totalDuration) {
        progress = 0;
        // Cycle to next feature
        const nextIndex = (featureKeys.indexOf(activeFeature) + 1) % featureKeys.length;
        switchFeature(featureKeys[nextIndex]);
      }
      const pct = (progress / totalDuration) * 100;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (timeDisplay) {
        const curSec = Math.floor(progress);
        const curMin = Math.floor(curSec / 60);
        const remSec = curSec % 60;
        timeDisplay.textContent = `${String(curMin).padStart(2, "0")}:${String(remSec).padStart(2, "0")} / 00:45`;
      }
    }

    requestAnimationFrame(renderMotionFrame);
  }

  renderMotionFrame();
}

// Theme Switcher & Dynamic Runtime Engine (Gemini Light Blue Sovereign + Byron Love Gold)
const APHRODY_THEMES = {
  "gemini-lightblue": {
    name: "Gemini Light Blue",
    surface: "#0f141c",
    surfaceContainerLow: "#141a24",
    surfaceContainer: "#1a222f",
    surfaceContainerHigh: "#222c3c",
    surfaceContainerHighest: "#2c384c",
    onSurface: "#f1f5fd",
    onSurfaceVariant: "#c2d1e8",
    accent1: "#8ab4f8",
    accent2: "#c2e7ff",
    accent3: "#7cd8e8",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(138, 180, 248, 0.26) 0%, rgba(124, 216, 232, 0.14) 40%, transparent 70%)",
  },
  "obsidian-gold": {
    name: "Obsidian Gold",
    surface: "#13100a",
    surfaceContainerLow: "#1a160e",
    surfaceContainer: "#221d13",
    surfaceContainerHigh: "#2c2518",
    surfaceContainerHighest: "#3a3220",
    onSurface: "#fbf5eb",
    onSurfaceVariant: "#d5c8b5",
    accent1: "#f5c451",
    accent2: "#e0a938",
    accent3: "#fcd888",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(245, 196, 81, 0.2) 0%, rgba(224, 169, 56, 0.12) 40%, transparent 70%)",
  },
  solitude: {
    name: "Solitude",
    surface: "#101422",
    surfaceContainerLow: "#151a2d",
    surfaceContainer: "#1c223a",
    surfaceContainerHigh: "#242c4b",
    surfaceContainerHighest: "#2f3960",
    onSurface: "#f0f3ff",
    onSurfaceVariant: "#b9c3e6",
    accent1: "#7aa2f7",
    accent2: "#bb9af7",
    accent3: "#89ddff",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(122, 162, 247, 0.22) 0%, rgba(187, 154, 247, 0.14) 40%, transparent 70%)",
  },
  "nordic-fog": {
    name: "Nordic Fog",
    surface: "#1e222a",
    surfaceContainerLow: "#242933",
    surfaceContainer: "#2e3440",
    surfaceContainerHigh: "#3b4252",
    surfaceContainerHighest: "#434c5e",
    onSurface: "#eceff4",
    onSurfaceVariant: "#d8dee9",
    accent1: "#88c0d0",
    accent2: "#81a1c1",
    accent3: "#5e81ac",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(136, 192, 208, 0.18) 0%, rgba(129, 161, 193, 0.12) 40%, transparent 70%)",
  },
  "tokyo-dusk": {
    name: "Tokyo Dusk",
    surface: "#16161e",
    surfaceContainerLow: "#1f2335",
    surfaceContainer: "#24283b",
    surfaceContainerHigh: "#2f354f",
    surfaceContainerHighest: "#3b4263",
    onSurface: "#c0caf5",
    onSurfaceVariant: "#9aa5ce",
    accent1: "#bb9af7",
    accent2: "#f7768e",
    accent3: "#7aa2f7",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(187, 154, 247, 0.2) 0%, rgba(247, 118, 142, 0.14) 40%, transparent 70%)",
  },
  sakura: {
    name: "Sakura",
    surface: "#1c151b",
    surfaceContainerLow: "#231c24",
    surfaceContainer: "#2b222d",
    surfaceContainerHigh: "#372b3a",
    surfaceContainerHighest: "#47384a",
    onSurface: "#f9eef6",
    onSurfaceVariant: "#d8c2d5",
    accent1: "#f6c177",
    accent2: "#eb6f92",
    accent3: "#ea9a97",
    byronGold: "#fce881",
    byronGoldRadiance: "#f5c451",
    brandGlow: "radial-gradient(circle, rgba(246, 193, 119, 0.2) 0%, rgba(235, 111, 146, 0.14) 40%, transparent 70%)",
  },
};

function applyTheme(themeName) {
  const theme = APHRODY_THEMES[themeName] || APHRODY_THEMES["gemini-lightblue"];
  const resolvedName = APHRODY_THEMES[themeName] ? themeName : "gemini-lightblue";

  // Swap data-theme attributes without reload
  document.body.dataset.theme = resolvedName;
  document.documentElement.dataset.theme = resolvedName;

  // Emit synced CSS variables directly onto root style for instantaneous sync
  const root = document.documentElement;
  root.style.setProperty("--md-sys-color-surface", theme.surface);
  root.style.setProperty("--md-sys-color-surface-container-low", theme.surfaceContainerLow);
  root.style.setProperty("--md-sys-color-surface-container", theme.surfaceContainer);
  root.style.setProperty("--md-sys-color-surface-container-high", theme.surfaceContainerHigh);
  root.style.setProperty("--md-sys-color-surface-container-highest", theme.surfaceContainerHighest);
  root.style.setProperty("--md-sys-color-on-surface", theme.onSurface);
  root.style.setProperty("--md-sys-color-on-surface-variant", theme.onSurfaceVariant);
  root.style.setProperty("--accent-color-1", theme.accent1);
  root.style.setProperty("--accent-color-2", theme.accent2);
  root.style.setProperty("--accent-color-3", theme.accent3);
  root.style.setProperty("--byron-gold", theme.byronGold);
  root.style.setProperty("--byron-gold-radiance", theme.byronGoldRadiance);
  root.style.setProperty("--brand-glow", theme.brandGlow);

  // Sync meta theme-color tag
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", theme.surface);

  // Sync UI pills
  const pills = document.querySelectorAll(".theme-picker-row .theme-pill");
  pills.forEach(p => {
    const isActive = p.dataset.themeName === resolvedName;
    p.classList.toggle("active", isActive);
    p.setAttribute("aria-checked", isActive ? "true" : "false");
  });

  try {
    localStorage.setItem("aphrody.theme", resolvedName);
  } catch {}

  // Broadcast event for all components, canvases, and iframes
  window.dispatchEvent(
    new CustomEvent("bunos:themechange", {
      detail: { theme: resolvedName, tokens: theme },
    }),
  );
}

// Global theme switcher hook for Bun OS surfaces
window.AphrodyTheme = {
  apply: applyTheme,
  get: () => document.documentElement.dataset.theme || "gemini-lightblue",
  themes: APHRODY_THEMES,
};

function initThemes() {
  const pills = document.querySelectorAll(".theme-picker-row .theme-pill");
  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      const theme = pill.dataset.themeName;
      applyTheme(theme);
    });
  });

  try {
    const saved = localStorage.getItem("aphrody.theme") || "gemini-lightblue";
    applyTheme(saved);
  } catch {
    applyTheme("gemini-lightblue");
  }
}

// Ambient Soundscape Player (Synthesized 174Hz Relaxing Audio)
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
      toggle.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
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
      toggle.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
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
      out.textContent = `WebGPU celestial compute active${adapter.info?.vendor ? ` (${adapter.info.vendor})` : ""}`;
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
  initCelestialCanvas();
  initShowcasePlayer();
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
