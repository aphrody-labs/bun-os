// SPDX-License-Identifier: Apache-2.0
/**
 * Craft Pro Hub Client Application
 * Orchestrates all 14 studios with Better Auth session presence, bilingual UI, and WebGPU parity.
 */

import type { Session, User, ApiResponse } from "../../../packages/auth/src/client";

export class AuthClient {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  async getSession(): Promise<Session | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/session`, {
        credentials: "include"
      });
      if (!res.ok) return null;
      const data: ApiResponse<Session> = await res.json();
      return data.data ?? null;
    } catch {
      return null;
    }
  }

  async getUser(): Promise<User | null> {
    const session = await this.getSession();
    return session?.user ?? null;
  }

  async signOut(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/signout`, {
        method: "POST",
        credentials: "include"
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export interface StudioInfo {
  id: string;
  name: string;
  description: string;
  category: "authoring" | "media" | "spatial" | "audio" | "engineering";
  url: string;
  icon: string;
  webgpuSupported: boolean;
}

export class CraftHubApp {
  private auth: AuthClient;
  private studios: StudioInfo[] = [];

  constructor() {
    this.auth = new AuthClient();
  }

  async init(): Promise<void> {
    console.log("Initializing Craft Hub Client...");
    await this.fetchStudios();
    await this.setupAuthPill();
    this.render();
  }

  async fetchStudios(): Promise<StudioInfo[]> {
    try {
      const res = await fetch("/api/studios");
      if (res.ok) {
        this.studios = await res.json();
      }
    } catch {
      // Fallback studio definitions
      this.studios = [
        {
          id: "wordcraft",
          name: "WordCraft",
          description: "Distraction-free optical typography & document publishing",
          category: "authoring",
          url: "https://craft.aphrody.app/wordcraft",
          icon: "document",
          webgpuSupported: true,
        },
        {
          id: "deckcraft",
          name: "DeckCraft",
          description: "Kinetic slide decks & cinematic spatial presentation stage",
          category: "authoring",
          url: "https://craft.aphrody.app/deckcraft",
          icon: "presentation",
          webgpuSupported: true,
        },
        {
          id: "gridcraft",
          name: "GridCraft",
          description: "Reactive multidimensional financial & mathematical grid",
          category: "engineering",
          url: "https://craft.aphrody.app/gridcraft",
          icon: "table",
          webgpuSupported: true,
        },
        {
          id: "vectorcraft",
          name: "VectorCraft",
          description: "Precision divine bezier curve illustration engine",
          category: "media",
          url: "https://craft.aphrody.app/vectorcraft",
          icon: "pen-tool",
          webgpuSupported: true,
        },
      ];
    }
    return this.studios;
  }

  async setupAuthPill(): Promise<void> {
    const session = await this.auth.getSession();
    const pill = document.getElementById("auth-pill");
    if (!pill) return;

    if (session) {
      pill.innerHTML = `
        <div class="user-badge">
          <span class="user-avatar">${session.user.avatarUrl ? `<img src="${session.user.avatarUrl}" width="20" height="20" alt="" />` : "A"}</span>
          <span class="user-name">${session.user.name}</span>
          <span class="user-role">${session.user.role}</span>
        </div>
      `;
    } else {
      pill.innerHTML = `
        <button type="button" class="sign-in-btn" id="btn-passkey-login">
          Passkey Sign In
        </button>
      `;
    }
  }

  render(): void {
    const container = document.getElementById("studios-grid");
    if (!container) return;

    container.innerHTML = this.studios.map(studio => `
      <div class="studio-card" data-studio="${studio.id}">
        <div class="studio-card-header">
          <h3 class="studio-title">${studio.name}</h3>
          <span class="studio-badge">${studio.category}</span>
        </div>
        <p class="studio-desc">${studio.description}</p>
        <div class="studio-actions">
          <a href="${studio.url}" class="button button-primary">Launch Studio</a>
          ${studio.webgpuSupported ? '<span class="webgpu-tag">WebGPU 30</span>' : ''}
        </div>
      </div>
    `).join("");
  }
}

// Auto-boot if running in browser DOM
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const app = new CraftHubApp();
    app.init().catch(console.error);
  });
}
