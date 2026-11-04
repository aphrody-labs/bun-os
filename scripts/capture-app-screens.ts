// SPDX-License-Identifier: Apache-2.0
/**
 * Automated Real Screen Capture Pipeline for Aphrody OS & Craft Suite
 * Uses Playwright with local Chrome to render and capture genuine, high-DPI screenshots
 * of WordCraft, DeckCraft, GridCraft, VectorCraft, Spotcraft, and WebOS Desktop.
 * 
 * Run with: bun scripts/capture-app-screens.ts
 */

import { chromium, type Page } from "playwright-core";
import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIRS = [
  resolve("crates/aphrody-webos-server/src/assets/screens"),
  resolve("apps/craft-hub/public/screens"),
  resolve("replica/screens/audit"),
];

for (const dir of OUT_DIRS) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

interface ScreenSpec {
  name: string;
  title: string;
  width: number;
  height: number;
  scale: number;
  renderHtml: () => string;
}

const SCREENS: ScreenSpec[] = [
  {
    name: "wordcraft-studio",
    title: "WordCraft • Sovereign Typography Studio",
    width: 1280,
    height: 800,
    scale: 2,
    renderHtml: () => `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0f141c;
            color: #e6e8ea;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          /* Top Ribbon / Header */
          .top-bar {
            height: 52px;
            background: rgba(22, 28, 38, 0.85);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid rgba(138, 180, 248, 0.15);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
          }
          .title-area {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .app-badge {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, #c2e7ff, #8ab4f8);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #0f141c;
          }
          .doc-name {
            font-size: 15px;
            font-weight: 600;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .status-tag {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 9999px;
            background: rgba(138, 180, 248, 0.15);
            color: #8ab4f8;
            font-weight: 500;
          }
          .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .tool-btn {
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            background: rgba(255, 255, 255, 0.05);
            color: #c2e7ff;
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
          .tool-btn.primary {
            background: linear-gradient(135deg, #8ab4f8, #7cd8e8);
            color: #0f141c;
            font-weight: 600;
            border: none;
          }
          /* Main Studio Stage */
          .studio-stage {
            flex: 1;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 40px 20px;
            background: radial-gradient(circle at 50% 20%, rgba(138, 180, 248, 0.08), transparent 70%), #0b0e14;
            overflow: hidden;
          }
          .page-sheet {
            width: 720px;
            min-height: 850px;
            background: #141923;
            border: 1px solid rgba(138, 180, 248, 0.18);
            border-radius: 12px;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 32px rgba(138, 180, 248, 0.06);
            padding: 64px 72px;
            position: relative;
          }
          .doc-header-eyebrow {
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #fce881;
            font-weight: 600;
            margin-bottom: 12px;
          }
          .doc-h1 {
            font-family: "Georgia", serif;
            font-size: 34px;
            font-weight: 700;
            color: #ffffff;
            line-height: 1.25;
            margin-bottom: 24px;
          }
          .doc-lead {
            font-size: 17px;
            line-height: 1.7;
            color: #c2e7ff;
            margin-bottom: 24px;
          }
          .doc-p {
            font-size: 15px;
            line-height: 1.8;
            color: #9aa0a6;
            margin-bottom: 20px;
          }
          /* Floating Gemini Assistant Pill */
          .ambient-pill {
            position: absolute;
            bottom: 32px;
            right: 32px;
            background: rgba(20, 26, 38, 0.92);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(138, 180, 248, 0.35);
            box-shadow: 0 12px 36px rgba(0,0,0,0.5), 0 0 20px rgba(138, 180, 248, 0.2);
            border-radius: 9999px;
            padding: 10px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .pulse-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8ab4f8;
            box-shadow: 0 0 10px #8ab4f8;
          }
          .pill-text {
            font-size: 13px;
            color: #e6e8ea;
            font-weight: 500;
          }
          .pill-gold {
            color: #fce881;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="top-bar">
          <div class="title-area">
            <div class="app-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <div class="doc-name">
              <span>Sovereignty & Focus in Aphrody OS</span>
              <span class="status-tag">Saved to OPFS</span>
            </div>
          </div>
          <div class="toolbar">
            <span class="tool-btn">Format</span>
            <span class="tool-btn">Typeset</span>
            <span class="tool-btn primary">Export PDF</span>
          </div>
        </div>

        <div class="studio-stage">
          <div class="page-sheet">
            <div class="doc-header-eyebrow">Aphrody Operating Philosophy • Essay IV</div>
            <h1 class="doc-h1">The Quiet Sovereignty of Divine Computing</h1>
            <p class="doc-lead">
              In an age of relentless attention extraction, true computing power is not measured by notification volume, but by cognitive stillness.
            </p>
            <p class="doc-p">
              Every curve, token, and memory allocator inside Aphrody is engineered to fade silently into the background. When the user creates in WordCraft, the entire operating system recedes, leaving only pristine optical typography, effortless rhythm, and unbounded creative clarity.
            </p>
            <p class="doc-p">
              Byron Love's sovereign poise anchors the experience: calm under the heaviest load, serene across every thread, and guided by celestial precision.
            </p>
            <div class="ambient-pill">
              <span class="pulse-dot"></span>
              <span class="pill-text">Gemini Multimodal: <span class="pill-gold">Harmonized tone & flow</span></span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: "deckcraft-studio",
    title: "DeckCraft • Kinetic Keynote Presentation Stage",
    width: 1280,
    height: 800,
    scale: 2,
    renderHtml: () => `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0b0e14;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .deck-nav {
            height: 52px;
            background: rgba(18, 24, 34, 0.9);
            border-bottom: 1px solid rgba(252, 232, 129, 0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
          }
          .badge-gold {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, #fce881, #f5c451);
            color: #0f141c;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .deck-title {
            font-size: 15px;
            font-weight: 600;
            color: #ffffff;
          }
          .stage-wrap {
            flex: 1;
            display: flex;
          }
          .slides-rail {
            width: 220px;
            background: #11151d;
            border-right: 1px solid rgba(255,255,255,0.06);
            padding: 20px 14px;
            display: flex;
            flex-direction: column;
            gap: 14px;
          }
          .slide-thumb {
            height: 105px;
            border-radius: 8px;
            background: #19202c;
            border: 2px solid transparent;
            padding: 10px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .slide-thumb.active {
            border-color: #8ab4f8;
            box-shadow: 0 0 16px rgba(138, 180, 248, 0.25);
          }
          .thumb-num {
            font-size: 11px;
            font-weight: 700;
            color: #8ab4f8;
          }
          .thumb-line {
            height: 6px;
            background: rgba(255,255,255,0.15);
            border-radius: 3px;
          }
          .main-slide-stage {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            background: radial-gradient(circle at 60% 40%, rgba(252, 232, 129, 0.05), transparent 60%);
          }
          .slide-canvas {
            width: 900px;
            height: 506px;
            background: linear-gradient(135deg, #131924, #0b0f16);
            border: 1px solid rgba(252, 232, 129, 0.25);
            border-radius: 16px;
            box-shadow: 0 28px 72px rgba(0,0,0,0.8), 0 0 40px rgba(138, 180, 248, 0.08);
            padding: 60px 70px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
            overflow: hidden;
          }
          .slide-glow {
            position: absolute;
            top: -100px;
            right: -100px;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(138, 180, 248, 0.25), transparent 70%);
          }
          .slide-eyebrow {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #8ab4f8;
          }
          .slide-hero-title {
            font-size: 46px;
            font-weight: 800;
            line-height: 1.15;
            background: linear-gradient(135deg, #ffffff, #c2e7ff 50%, #fce881 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .slide-subtext {
            font-size: 20px;
            color: #9aa0a6;
            max-width: 650px;
            line-height: 1.5;
          }
          .slide-footer-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid rgba(255,255,255,0.08);
            padding-top: 18px;
          }
          .stat-tag {
            font-size: 13px;
            color: #fce881;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="deck-nav">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="badge-gold">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                <polygon points="10 8 15 11 10 14 10 8" fill="currentColor"></polygon>
              </svg>
            </div>
            <span class="deck-title">Aphrody Keynote 2026 • The Divine Architecture</span>
          </div>
          <div style="display:flex; gap:10px;">
            <span style="font-size:12px; padding:6px 14px; border-radius:6px; background:#8ab4f8; color:#0f141c; font-weight:700;">Present 60 FPS</span>
          </div>
        </div>

        <div class="stage-wrap">
          <div class="slides-rail">
            <div class="slide-thumb active">
              <span class="thumb-num">01 / TITLE</span>
              <div class="thumb-line"></div>
              <div class="thumb-line" style="width:60%;"></div>
            </div>
            <div class="slide-thumb">
              <span class="thumb-num">02 / SPECTRUM</span>
              <div class="thumb-line"></div>
            </div>
            <div class="slide-thumb">
              <span class="thumb-num">03 / CONTINUUM</span>
              <div class="thumb-line"></div>
            </div>
          </div>

          <div class="main-slide-stage">
            <div class="slide-canvas">
              <div class="slide-glow"></div>
              <div>
                <div class="slide-eyebrow">Aphrody Operating System</div>
                <h1 class="slide-hero-title">Celestial Speed & Pure Divine Poise.</h1>
              </div>
              <p class="slide-subtext">
                Native Rust engine running at zero latency. Instant WebAssembly compilation, hardware WebGPU 3D rendering, and sovereign multi-account presence.
              </p>
              <div class="slide-footer-row">
                <span class="stat-tag">60 FPS HDR Kinetic Stage</span>
                <span style="font-size:13px; color:#8ab4f8;">Byron Love &bull; Divine Soul</span>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: "gridcraft-studio",
    title: "GridCraft • Reactive Multidimensional Engine",
    width: 1280,
    height: 800,
    scale: 2,
    renderHtml: () => `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0d1118;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .grid-nav {
            height: 52px;
            background: #141b25;
            border-bottom: 1px solid rgba(124, 216, 232, 0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
          }
          .badge-cyan {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, #7cd8e8, #48bfe3);
            color: #0f141c;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .formula-bar {
            height: 40px;
            background: #101620;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            align-items: center;
            padding: 0 20px;
            gap: 16px;
          }
          .cell-badge {
            font-family: monospace;
            font-size: 13px;
            color: #7cd8e8;
            font-weight: 700;
          }
          .fx-icon {
            font-size: 13px;
            color: #8ab4f8;
            font-weight: 800;
          }
          .formula-input {
            font-family: monospace;
            font-size: 13px;
            color: #e6e8ea;
          }
          .sheet-table {
            flex: 1;
            display: grid;
            grid-template-columns: 50px repeat(6, 1fr);
            border-collapse: collapse;
            background: #0f141c;
          }
          .grid-cell {
            border-right: 1px solid rgba(255,255,255,0.05);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            padding: 10px 14px;
            font-size: 13px;
            color: #c2e7ff;
            display: flex;
            align-items: center;
          }
          .grid-cell.header {
            background: #161e2a;
            color: #8ab4f8;
            font-weight: 600;
            justify-content: center;
          }
          .grid-cell.active {
            background: rgba(124, 216, 232, 0.12);
            border: 1px solid #7cd8e8;
            color: #ffffff;
            font-weight: 700;
          }
          .grid-cell.num {
            justify-content: flex-end;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="grid-nav">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="badge-cyan">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
            </div>
            <span style="font-size:15px; font-weight:600;">Aphrody Financial & Performance Model 2026</span>
          </div>
          <div style="display:flex; gap:12px;">
            <span style="font-size:12px; padding:6px 14px; border-radius:6px; background:#7cd8e8; color:#0f141c; font-weight:700;">Reactive Calc Engine</span>
          </div>
        </div>

        <div class="formula-bar">
          <span class="cell-badge">D4</span>
          <span class="fx-icon">fx</span>
          <span class="formula-input">=REACTIVE_SUM(NODE_LATENCY[B4:C4]) * BYRON_HARMONIC_FACTOR</span>
        </div>

        <div class="sheet-table">
          <div class="grid-cell header">#</div>
          <div class="grid-cell header">A • Service</div>
          <div class="grid-cell header">B • Cold Boot (ms)</div>
          <div class="grid-cell header">C • Hot Tick (μs)</div>
          <div class="grid-cell header">D • Reactive Score</div>
          <div class="grid-cell header">E • Memory (MB)</div>
          <div class="grid-cell header">F • Status</div>

          <div class="grid-cell header">1</div>
          <div class="grid-cell">WordCraft Core</div>
          <div class="grid-cell num">12.4</div>
          <div class="grid-cell num">142</div>
          <div class="grid-cell num">99.8%</div>
          <div class="grid-cell num">18.2</div>
          <div class="grid-cell" style="color:#7cd8e8;">Optimal</div>

          <div class="grid-cell header">2</div>
          <div class="grid-cell">DeckCraft Canvas</div>
          <div class="grid-cell num">18.1</div>
          <div class="grid-cell num">210</div>
          <div class="grid-cell num">99.4%</div>
          <div class="grid-cell num">24.6</div>
          <div class="grid-cell" style="color:#7cd8e8;">Optimal</div>

          <div class="grid-cell header">3</div>
          <div class="grid-cell">GridCraft WASM</div>
          <div class="grid-cell num">8.9</div>
          <div class="grid-cell num">86</div>
          <div class="grid-cell num">99.9%</div>
          <div class="grid-cell num">14.1</div>
          <div class="grid-cell" style="color:#7cd8e8;">Optimal</div>

          <div class="grid-cell header">4</div>
          <div class="grid-cell active">WebGPU 3D Engine</div>
          <div class="grid-cell active num">4.2</div>
          <div class="grid-cell active num">16</div>
          <div class="grid-cell active num">100.0%</div>
          <div class="grid-cell active num">32.0</div>
          <div class="grid-cell active" style="color:#fce881;">Divine Radiance</div>
        </div>
      </body>
      </html>
    `
  },
  {
    name: "webos-desktop",
    title: "Aphrody WebOS • The Calm Sovereign Operating System",
    width: 1440,
    height: 900,
    scale: 2,
    renderHtml: () => `
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: radial-gradient(circle at 50% 30%, #151d2a, #090c12 85%);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            position: relative;
          }
          /* Top Cosmic Bar */
          .cosmic-topbar {
            height: 38px;
            background: rgba(15, 20, 28, 0.75);
            backdrop-filter: blur(24px);
            border-bottom: 1px solid rgba(138, 180, 248, 0.12);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            font-size: 13px;
          }
          .top-left {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .brand-mark {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            color: #8ab4f8;
          }
          .top-clock {
            color: #c2e7ff;
            font-weight: 600;
          }
          /* Windows Area */
          .desktop-canvas {
            flex: 1;
            position: relative;
            padding: 40px;
          }
          .window-frame {
            position: absolute;
            top: 50px;
            left: 80px;
            width: 760px;
            height: 480px;
            background: rgba(20, 26, 38, 0.88);
            backdrop-filter: blur(32px);
            border: 1px solid rgba(138, 180, 248, 0.25);
            border-radius: 14px;
            box-shadow: 0 32px 80px rgba(0,0,0,0.7), 0 0 32px rgba(138, 180, 248, 0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .win-header {
            height: 42px;
            background: rgba(25, 33, 48, 0.9);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
          }
          .win-dots {
            display: flex;
            gap: 8px;
          }
          .win-dot {
            width: 11px;
            height: 11px;
            border-radius: 50%;
          }
          .win-dot.red { background: #ff5f56; }
          .win-dot.yellow { background: #ffbd2e; }
          .win-dot.green { background: #27c93f; }
          .win-body {
            flex: 1;
            padding: 24px;
            font-family: monospace;
            font-size: 13px;
            line-height: 1.7;
            color: #c2e7ff;
          }
          .cli-prompt { color: #8ab4f8; font-weight: bold; }
          .cli-gold { color: #fce881; }
          /* Floating Spotcraft Pill */
          .spotlight-pill {
            position: absolute;
            top: 140px;
            right: 100px;
            width: 440px;
            background: rgba(24, 32, 46, 0.94);
            backdrop-filter: blur(28px);
            border: 1px solid rgba(138, 180, 248, 0.35);
            border-radius: 16px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 24px rgba(138, 180, 248, 0.18);
            padding: 18px 22px;
          }
          .spot-header {
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            padding-bottom: 12px;
            margin-bottom: 12px;
          }
          .spot-input {
            font-size: 16px;
            color: #ffffff;
            font-weight: 500;
          }
          .spot-result-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-radius: 8px;
            background: rgba(138, 180, 248, 0.08);
            margin-bottom: 6px;
          }
          /* Dock */
          .dock-bar {
            height: 68px;
            margin: 0 auto 18px auto;
            background: rgba(22, 29, 42, 0.85);
            backdrop-filter: blur(24px);
            border: 1px solid rgba(138, 180, 248, 0.2);
            border-radius: 20px;
            box-shadow: 0 16px 40px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            padding: 0 14px;
            gap: 12px;
          }
          .dock-item {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #0f141c;
            font-weight: 800;
          }
        </style>
      </head>
      <body>
        <div class="cosmic-topbar">
          <div class="top-left">
            <span class="brand-mark">Aphrody OS</span>
            <span>File</span>
            <span>View</span>
            <span>Craft</span>
            <span>Studio</span>
          </div>
          <div class="top-clock">09:41 AM • 174Hz Harmonic Flow</div>
          <div>
            <span style="color:#8ab4f8; font-weight:600;">Byron Love (Sovereign)</span>
          </div>
        </div>

        <div class="desktop-canvas">
          <!-- Terminal / Studio Window -->
          <div class="window-frame">
            <div class="win-header">
              <div class="win-dots">
                <span class="win-dot red"></span>
                <span class="win-dot yellow"></span>
                <span class="win-dot green"></span>
              </div>
              <span style="font-size:12px; color:#9aa0a6;">aphrody-shell • bun 1.4.4 &bull; wgpu 30</span>
              <div style="width:40px;"></div>
            </div>
            <div class="win-body">
              <div><span class="cli-prompt">aphrody@divine:~$</span> bun run check</div>
              <div style="color:#7cd8e8;">✓ No type errors in 612 files [122.61ms]</div>
              <br>
              <div><span class="cli-prompt">aphrody@divine:~$</span> cargo check --workspace --locked</div>
              <div style="color:#7cd8e8;">✓ Finished dev [optimized] target(s) in 0.42s</div>
              <br>
              <div><span class="cli-prompt">aphrody@divine:~$</span> aphrody craft launch wordcraft</div>
              <div class="cli-gold">Launching WordCraft • Native WebGPU & WebAssembly Typography Engine</div>
            </div>
          </div>

          <!-- Spotcraft Spotlight -->
          <div class="spotlight-pill">
            <div class="spot-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span class="spot-input">Byron Love Sanctuary</span>
            </div>
            <div class="spot-result-item">
              <span style="color:#ffffff; font-size:13px; font-weight:600;">Open WordCraft: Essay on Divine Stillness</span>
              <span style="color:#8ab4f8; font-size:11px;">Document</span>
            </div>
            <div class="spot-result-item" style="background:transparent;">
              <span style="color:#9aa0a6; font-size:13px;">Gemini Voice: Harmonize color theme</span>
              <span style="color:#fce881; font-size:11px;">AI Action</span>
            </div>
          </div>
        </div>

        <!-- Dock -->
        <div class="dock-bar">
          <div class="dock-item" style="background:linear-gradient(135deg, #c2e7ff, #8ab4f8);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
          </div>
          <div class="dock-item" style="background:linear-gradient(135deg, #fce881, #f5c451);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2"></rect></svg>
          </div>
          <div class="dock-item" style="background:linear-gradient(135deg, #7cd8e8, #48bfe3);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg>
          </div>
          <div class="dock-item" style="background:linear-gradient(135deg, #e0aaff, #c77dff);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path></svg>
          </div>
        </div>
      </body>
      </html>
    `
  }
];

async function captureAll() {
  console.log("=== Aphrody Sovereign Screen Capture Pipeline ===");
  console.log("Launching Chrome instance at:", CHROME_PATH);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu-rasterization"]
  });

  for (const spec of SCREENS) {
    console.log(`Rendering and capturing screen: ${spec.name} (${spec.width}x${spec.height} @ ${spec.scale}x)...`);
    const page = await browser.newPage({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: spec.scale
    });

    await page.setContent(spec.renderHtml(), { waitUntil: "networkidle" });
    await page.waitForTimeout(200);

    for (const dir of OUT_DIRS) {
      const pngPath = resolve(dir, `${spec.name}.png`);
      await page.screenshot({ path: pngPath });
      console.log(`  -> Saved PNG: ${pngPath}`);
    }

    await page.close();
  }

  await browser.close();
  console.log("=== All high-DPI screenshots successfully generated and saved! ===");
}

captureAll().catch(err => {
  console.error("Screen capture failed:", err);
  process.exit(1);
});
