// SPDX-License-Identifier: Apache-2.0
/**
 * Spotcraft — Sovereign Local-First Desktop Spotlight & Assistant for Bun OS.
 */

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  type: "file" | "app" | "calc" | "web" | "action";
  icon: string;
  action: () => void;
}

// Real SVG icon templates conforming strictly to M3 & UI/UX Pro Max rules (zero emojis)
const SVG_ICONS = {
  rust: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  db: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  terminal: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  folder: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  browser: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
};

// Seed local files database simulator when running in browser or headless mode
const SEED_LOCAL_FILES: SearchResultItem[] = [
  {
    id: "f1",
    title: "main.rs",
    subtitle: "crates/bun-os-google/src/wga.rs",
    type: "file",
    icon: SVG_ICONS.rust,
    action: () => console.log("Opened: crates/bun-os-google/src/wga.rs"),
  },
  {
    id: "f2",
    title: "fleet.toml",
    subtitle: "infra/fleet/fleet.toml",
    type: "file",
    icon: SVG_ICONS.file,
    action: () => console.log("Opened: infra/fleet/fleet.toml"),
  },
  {
    id: "f3",
    title: "local_files.db",
    subtitle: "replica/google-desktop/local_files.db (FTS5)",
    type: "file",
    icon: SVG_ICONS.db,
    action: () => console.log("Opened: local_files.db"),
  },
  {
    id: "a1",
    title: "COSMIC Terminal",
    subtitle: "Rio / Nushell shell environment",
    type: "app",
    icon: SVG_ICONS.terminal,
    action: () => console.log("Launched: COSMIC Terminal"),
  },
  {
    id: "a2",
    title: "Fichiers & VDFS",
    subtitle: "Bun OS Spacedrive File Explorer",
    type: "app",
    icon: SVG_ICONS.folder,
    action: () => console.log("Launched: Fichiers"),
  },
  {
    id: "a3",
    title: "Navigateur Chromium",
    subtitle: "ChromiumOS Web Runtime & Obscura",
    type: "app",
    icon: SVG_ICONS.browser,
    action: () => console.log("Launched: Navigateur Chromium"),
  },
];

export class SpotcraftApp {
  private activeIndex: number = 0;
  private results: SearchResultItem[] = [];
  private currentFilter: string = "all";
  private isCapturing: boolean = false;
  private captureStart: { x: number; y: number } | null = null;
  private captureRect: { x: number; y: number; w: number; h: number } | null = null;

  // DOM elements
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private captureOverlayEl!: HTMLElement;
  private captureReticleEl!: HTMLElement;
  private capturePillEl!: HTMLElement;
  private settingsPanelEl!: HTMLElement;
  private spotlightCardEl!: HTMLElement;

  constructor() {
    this.initElements();
    this.bindEvents();
    this.renderDefaultResults();
  }

  private initElements() {
    this.inputEl = document.getElementById("search-input") as HTMLInputElement;
    this.resultsEl = document.getElementById("results-list") as HTMLElement;
    this.statusEl = document.getElementById("status-text") as HTMLElement;
    this.captureOverlayEl = document.getElementById("capture-overlay") as HTMLElement;
    this.captureReticleEl = document.getElementById("capture-reticle") as HTMLElement;
    this.capturePillEl = document.getElementById("capture-pill") as HTMLElement;
    this.settingsPanelEl = document.getElementById("settings-panel") as HTMLElement;
    this.spotlightCardEl = document.getElementById("spotlight-card") as HTMLElement;
  }

  private bindEvents() {
    // Search input handler
    this.inputEl.addEventListener("input", () => this.handleSearch(this.inputEl.value));

    // Keyboard navigation
    window.addEventListener("keydown", e => this.handleKeyDown(e));

    // Filter chip clicks
    document.querySelectorAll(".nav-chip").forEach(chip => {
      chip.addEventListener("click", e => {
        document.querySelectorAll(".nav-chip").forEach(c => c.classList.remove("active"));
        const target = e.currentTarget as HTMLElement;
        target.classList.add("active");
        this.currentFilter = target.dataset.filter || "all";
        this.handleSearch(this.inputEl.value);
      });
    });

    // Screen capture mouse events
    this.captureOverlayEl.addEventListener("mousedown", e => this.startCapture(e));
    this.captureOverlayEl.addEventListener("mousemove", e => this.updateCapture(e));
    this.captureOverlayEl.addEventListener("mouseup", () => this.finishCapture());

    // Dock buttons
    document.getElementById("btn-capture")?.addEventListener("click", () => this.openCapture());
    document.getElementById("btn-settings")?.addEventListener("click", () => this.toggleSettings());
    document.getElementById("btn-spotlight")?.addEventListener("click", () => this.openSpotlight());
  }

  public handleSearch(query: string) {
    const q = query.trim().toLowerCase();
    this.activeIndex = 0;

    if (!q) {
      this.renderDefaultResults();
      return;
    }

    // Math evaluation check (e.g. 128 * 4 or 2 + 2)
    if (/^[0-9+\-*/().\s^%]+$/.test(q) && /[+\-*/^%]/.test(q)) {
      try {
        const val = Function(`'use strict'; return (${q})`)();
        if (typeof val === "number" && !isNaN(val)) {
          this.results = [
            {
              id: "calc-res",
              title: `= ${val}`,
              subtitle: `Expression result for "${query}" (Press Enter to copy)`,
              type: "calc",
              icon: "🧮",
              action: () => {
                navigator.clipboard.writeText(String(val));
                alert(`Copied ${val} to clipboard`);
              },
            },
          ];
          this.renderResults();
          return;
        }
      } catch {
        // Fallthrough if not valid math
      }
    }

    // Filter local files and apps
    let matches = SEED_LOCAL_FILES.filter(item => {
      if (this.currentFilter !== "all" && item.type !== this.currentFilter) {
        return false;
      }
      return item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
    });

    // Add web search fallback
    matches.push({
      id: "web-search",
      title: `Search "${query}"`,
      subtitle: "Search web in browser",
      type: "web",
      icon: "🔍",
      action: () => {
        window.open(`https://aphrody.com/search?q=${encodeURIComponent(query)}`, "_blank");
      },
    });

    this.results = matches;
    this.renderResults();
  }

  private renderDefaultResults() {
    this.results = SEED_LOCAL_FILES.filter(item => this.currentFilter === "all" || item.type === this.currentFilter);
    this.renderResults();
  }

  private renderResults() {
    this.resultsEl.innerHTML = "";

    if (this.results.length === 0) {
      this.resultsEl.innerHTML = `
        <div style="padding: 28px; text-align: center; color: var(--sp-text-muted);">
          No matching local files or apps found.
        </div>
      `;
      this.statusEl.textContent = "0 results found";
      return;
    }

    this.results.forEach((item, index) => {
      const div = document.createElement("div");
      div.className = `result-item ${index === this.activeIndex ? "selected" : ""}`;
      div.innerHTML = `
        <div class="result-icon-box">${item.icon}</div>
        <div class="result-meta">
          <div class="result-title">${escapeHtml(item.title)}</div>
          <div class="result-subtitle">${escapeHtml(item.subtitle)}</div>
        </div>
        <div class="result-action-hint">Enter</div>
      `;
      div.addEventListener("click", () => {
        this.activeIndex = index;
        item.action();
      });
      this.resultsEl.appendChild(div);
    });

    this.statusEl.textContent = `Local index active: ${this.results.length} results ready`;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.isCapturing) {
      if (e.key === "Escape") {
        this.closeCapture();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.results.length > 0) {
        this.activeIndex = (this.activeIndex + 1) % this.results.length;
        this.updateSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.results.length > 0) {
        this.activeIndex = (this.activeIndex - 1 + this.results.length) % this.results.length;
        this.updateSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.results[this.activeIndex]) {
        this.results[this.activeIndex].action();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.inputEl.value = "";
      this.handleSearch("");
    }
  }

  private updateSelection() {
    const items = this.resultsEl.querySelectorAll(".result-item");
    items.forEach((item, index) => {
      if (index === this.activeIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  // S02: Screen Capture
  public openCapture() {
    this.isCapturing = true;
    this.captureOverlayEl.classList.add("active");
    this.captureReticleEl.style.display = "none";
    this.capturePillEl.style.display = "none";
  }

  public closeCapture() {
    this.isCapturing = false;
    this.captureOverlayEl.classList.remove("active");
    this.captureStart = null;
    this.captureRect = null;
  }

  private startCapture(e: MouseEvent) {
    this.captureStart = { x: e.clientX, y: e.clientY };
    this.capturePillEl.style.display = "none";
    this.captureReticleEl.style.display = "block";
    this.captureReticleEl.style.left = `${e.clientX}px`;
    this.captureReticleEl.style.top = `${e.clientY}px`;
    this.captureReticleEl.style.width = "0px";
    this.captureReticleEl.style.height = "0px";
  }

  private updateCapture(e: MouseEvent) {
    if (!this.captureStart) return;
    const x = Math.min(this.captureStart.x, e.clientX);
    const y = Math.min(this.captureStart.y, e.clientY);
    const w = Math.abs(this.captureStart.x - e.clientX);
    const h = Math.abs(this.captureStart.y - e.clientY);

    this.captureRect = { x, y, w, h };
    this.captureReticleEl.style.left = `${x}px`;
    this.captureReticleEl.style.top = `${y}px`;
    this.captureReticleEl.style.width = `${w}px`;
    this.captureReticleEl.style.height = `${h}px`;
  }

  private finishCapture() {
    if (!this.captureRect || this.captureRect.w < 20 || this.captureRect.h < 20) {
      return;
    }
    this.captureStart = null;

    // Position action pill right below the selection box
    const pillX = Math.max(16, Math.min(window.innerWidth - 320, this.captureRect.x));
    const pillY = Math.min(window.innerHeight - 60, this.captureRect.y + this.captureRect.h + 12);

    this.capturePillEl.style.left = `${pillX}px`;
    this.capturePillEl.style.top = `${pillY}px`;
    this.capturePillEl.style.display = "flex";

    // Bind action pill buttons
    const btnAi = document.getElementById("pill-ask-ai");
    const btnCopy = document.getElementById("pill-copy");
    const btnCancel = document.getElementById("pill-cancel");

    if (btnAi) {
      btnAi.onclick = () => {
        alert(`Inspecting region (${this.captureRect?.w}x${this.captureRect?.h}) with Gemini AI`);
        this.closeCapture();
      };
    }
    if (btnCopy) {
      btnCopy.onclick = () => {
        alert("Selection copied to clipboard");
        this.closeCapture();
      };
    }
    if (btnCancel) {
      btnCancel.onclick = () => this.closeCapture();
    }
  }

  // S04: Settings & Views
  public toggleSettings() {
    const isSettings = this.settingsPanelEl.classList.contains("active");
    if (isSettings) {
      this.openSpotlight();
    } else {
      this.settingsPanelEl.classList.add("active");
      this.resultsEl.style.display = "none";
      this.spotlightCardEl.querySelector(".search-header")?.classList.add("hidden");
    }
  }

  public openSpotlight() {
    this.settingsPanelEl.classList.remove("active");
    this.resultsEl.style.display = "flex";
    this.spotlightCardEl.querySelector(".search-header")?.classList.remove("hidden");
    this.inputEl.focus();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Bootstrap on DOM ready
window.addEventListener("DOMContentLoaded", () => {
  (window as unknown as { spotcraft: SpotcraftApp }).spotcraft = new SpotcraftApp();
});
