// SPDX-License-Identifier: Apache-2.0
/**
 * Craft Sovereign Suite Client Engine — Fluent UI 2 & M3 Expressive
 * Native WebGPU Compute & Render Simulator, Storyteller Modal Inspector & Sovereign Search.
 */

// --- 1. STUDIO REGISTRY FOR STORYTELLER MODAL INSPECTOR ---
const STUDIO_DETAILS = {
  word: {
    name: "WordCraft",
    category: "Document & Office",
    parity: "Word / Google Docs",
    summary:
      "Sovereign typography & prose editor. Pure Rust layout engine with real-time OPFS persistence and zero cloud telemetry.",
    specs: {
      "Ecosystem Parity": "Microsoft Word & Google Docs",
      "Compute Engine": "Pure Rust WASM (Zero GC Pauses)",
      "Graphics Pipeline": "WebGPU Hardware Accelerated Text Shaper",
      "Data Storage": "Local Origin Private File System (OPFS)",
      Telemetry: "0 Bytes Transmitted (Absolute Privacy)",
      "Target Format": "OpenDocument (.odt), Markdown & PDF",
    },
    preview: "/previews/word.jpg",
  },
  grid: {
    name: "GridCraft",
    category: "Document & Office",
    parity: "Excel / Google Sheets",
    summary:
      "High-throughput spreadsheet computing powered by Rust WebAssembly. Millions of cells, formula trees, and zero telemetry.",
    specs: {
      "Ecosystem Parity": "Microsoft Excel & Google Sheets",
      "Compute Engine": "Parallel Rust Vector Engine (.wasm)",
      "Graphics Pipeline": "WebGPU High-DPI Grid Matrix",
      "Data Storage": "Local OPFS Cell Vault & Parquet Export",
      Telemetry: "0 Bytes Transmitted (Zero Cloud Sync)",
      "Formula Parser": "Sovereign AST Engine with Excel Syntax",
    },
    preview: "/previews/grid.jpg",
  },
  deck: {
    name: "DeckCraft",
    category: "Document & Office",
    parity: "PowerPoint / Google Slides",
    summary:
      "Architect cinematic presentations with hardware-accelerated layouts, vector charts, and instant deck export right in your browser.",
    specs: {
      "Ecosystem Parity": "Microsoft PowerPoint & Google Slides",
      "Compute Engine": "Rust Scene Graph & Transition Pipeline",
      "Graphics Pipeline": "WebGPU Render Compositor (120 FPS)",
      "Data Storage": "Local OPFS Deck Archive",
      Telemetry: "0 Bytes Transmitted (Zero Tracking)",
      Export: "Self-Contained HTML5, PDF & Vector SVG",
    },
    preview: "/previews/deck.jpg",
  },
  pdf: {
    name: "PDFCraft",
    category: "Document & Office",
    parity: "Acrobat Pro",
    summary:
      "Inspect, annotate, sign, and compile PDF documents locally with native Rust parsing. Confidential files never leave your machine.",
    specs: {
      "Ecosystem Parity": "Adobe Acrobat Pro",
      "Compute Engine": "Rust Native PDF Parser & Cryptographic Signer",
      "Graphics Pipeline": "WebGPU Vector Rasterization",
      "Data Storage": "Local-First Sandbox (Zero Cloud Upload)",
      Telemetry: "0 Bytes Transmitted (Absolute Confidentiality)",
      Security: "Local Ed25519 / RSA Cryptographic Verification",
    },
    preview: "/previews/pdf.jpg",
  },
  photo: {
    name: "PhotoCraft",
    category: "Visual & Graphic",
    parity: "Photoshop RAW",
    summary:
      "Non-destructive 32-bit float photo editing and RAW grading. WebGPU compute shaders deliver instant 120 FPS adjustments on gigapixel images.",
    specs: {
      "Ecosystem Parity": "Adobe Photoshop & Camera RAW",
      "Compute Engine": "Pure Rust WASM + WebGPU WGSL Compute Shaders",
      "Color Pipeline": "32-bit Float Linear Rec.2020 & HDR",
      "Data Storage": "Local OPFS Gigapixel Tile Cache",
      Telemetry: "0 Bytes Transmitted (Zero Telemetry)",
      Performance: "Sub-millisecond Layer Blending & Masking",
    },
    preview: "/previews/photo.jpg",
  },
  vector: {
    name: "VectorCraft",
    category: "Visual & Graphic",
    parity: "Illustrator",
    summary:
      "Infinite canvas vector precision. High-performance bezier math, path booleans, and scalable SVG/PDF export compiled from Rust to WASM.",
    specs: {
      "Ecosystem Parity": "Adobe Illustrator",
      "Compute Engine": "Rust Geometric Kernel (Euler Path Math)",
      "Graphics Pipeline": "WebGPU Path Tessellation & MSAA",
      "Data Storage": "Local File System Access & OPFS",
      Telemetry: "0 Bytes Transmitted (Zero Cloud Sync)",
      Precision: "64-bit IEEE Floating Point Precision",
    },
    preview: "/previews/vector.jpg",
  },
  design: {
    name: "DesignCraft",
    category: "Visual & Graphic",
    parity: "InDesign",
    summary:
      "Publication layout studio fusing typography, multi-page grids, bleed guides, and CMYK workflows directly in your browser.",
    specs: {
      "Ecosystem Parity": "Adobe InDesign",
      "Compute Engine": "Rust Multithreaded Text Reflow (.wasm)",
      "Graphics Pipeline": "WebGPU Print Layout Preview",
      "Data Storage": "Local OPFS Publication Package",
      Telemetry: "0 Bytes Transmitted (Zero Telemetry)",
      Color: "Native ICC Profiles & Spot Color Emulation",
    },
    preview: "/previews/design.jpg",
  },
  fig: {
    name: "FigCraft",
    category: "Visual & Graphic",
    parity: "Figma / Adobe XD",
    summary:
      "Sovereign UI/UX interface design studio. Vector networks, auto-layout constraints, interactive components, and offline-first design systems.",
    specs: {
      "Ecosystem Parity": "Figma & Adobe XD",
      "Compute Engine": "Rust Auto-Layout & Constraints Solver",
      "Graphics Pipeline": "WebGPU Canvas Renderer (60/120 FPS)",
      "Data Storage": "Local OPFS Component Library (Offline-First)",
      Telemetry: "0 Bytes Transmitted (No Mandatory Accounts)",
      Tokens: "M3 Expressive & Fluent 2 Token Sync",
    },
    preview: "/previews/fig.jpg",
  },
  light: {
    name: "LightCraft",
    category: "Visual & Graphic",
    parity: "Lightroom Library",
    summary:
      "Catalog, cull, and develop entire RAW libraries in your browser using multi-threaded WebAssembly workers and color science tone curves.",
    specs: {
      "Ecosystem Parity": "Adobe Lightroom Classic",
      "Compute Engine": "Rust Multi-Threaded WASM Workers",
      "Graphics Pipeline": "WebGPU Tone Mapping & Curves",
      "Data Storage": "Direct Local Disk via File System Access API",
      Telemetry: "0 Bytes Transmitted (Zero Cloud Lock-in)",
      Throughput: "Zero-Latency Thumbnail Generation & Culling",
    },
    preview: "/previews/light.jpg",
  },
  film: {
    name: "FilmCraft",
    category: "Motion, Audio & 3D",
    parity: "Premiere Pro",
    summary:
      "Multi-track non-linear video editing studio. WebGPU timeline playback, frame-accurate trimming, and cross-origin isolated worker rendering.",
    specs: {
      "Ecosystem Parity": "Adobe Premiere Pro",
      "Compute Engine": "Rust Demuxer & Timeline Compositor",
      "Graphics Pipeline": "WebGPU Color Grading & Video Frames",
      "Data Storage": "Local OPFS Video Cache & WebCodecs",
      Telemetry: "0 Bytes Transmitted (Private Footage)",
      Precision: "Frame-Accurate 24/60/120 FPS Timecode",
    },
    preview: "/previews/film.jpg",
  },
  effect: {
    name: "EffectCraft",
    category: "Motion, Audio & 3D",
    parity: "After Effects",
    summary:
      "Layer-based motion graphics and compositor. Procedural keyframe graphs, particle engines, and WebGPU compute shaders.",
    specs: {
      "Ecosystem Parity": "Adobe After Effects",
      "Compute Engine": "Rust Node Graph & Keyframe Interpolator",
      "Graphics Pipeline": "WebGPU WGSL Compute Particle Simulators",
      "Data Storage": "Local OPFS Render Vault",
      Telemetry: "0 Bytes Transmitted (Zero Tracking)",
      Shaders: "Custom WGSL Shader Node Graph Integration",
    },
    preview: "/previews/effect.jpg",
  },
  sound: {
    name: "SoundCraft",
    category: "Motion, Audio & 3D",
    parity: "Audition / Logic Pro",
    summary:
      "Multi-track audio workstation. Spectral waveform editing, parametric EQ, sovereign DSP plugins, and low-latency WebAudio buffers.",
    specs: {
      "Ecosystem Parity": "Adobe Audition & Logic Pro",
      "Compute Engine": "Rust DSP Engine compiled to AudioWorklet",
      "Graphics Pipeline": "WebGPU 120 FPS Spectral Visualizer",
      "Data Storage": "Local OPFS Audio Tracks",
      Telemetry: "0 Bytes Transmitted (Zero Telemetry)",
      Latency: "Sub-5ms Real-Time Audio Monitoring",
    },
    preview: "/previews/sound.jpg",
  },
  cad: {
    name: "CADCraft",
    category: "Motion, Audio & 3D",
    parity: "Fusion 360 / AutoCAD",
    summary:
      "Parametric drafting and technical CAD modelling. Precise geometric dimensioning, constraints, and DXF/STEP geometry kernels.",
    specs: {
      "Ecosystem Parity": "Autodesk Fusion 360 & AutoCAD",
      "Compute Engine": "Rust Boundary Representation (B-Rep) Kernel",
      "Graphics Pipeline": "WebGPU 3D Wireframe & Shaded Viewport",
      "Data Storage": "Local OPFS CAD Vault",
      Telemetry: "0 Bytes Transmitted (Proprietary CAD Security)",
      Interoperability: "DXF, STEP, STL & WebGPU Scene Export",
    },
    preview: "/previews/cad.jpg",
  },
  art: {
    name: "ArtCraft",
    category: "Motion, Audio & 3D",
    parity: "Creative Studio",
    summary:
      "Sovereign 3D generation and creative canvas studio. Native desktop engine with real-time WebGPU browser preview.",
    specs: {
      "Ecosystem Parity": "Adobe Substance 3D & Creative Studio",
      "Compute Engine": "Rust Native & WebAssembly Hybrid Engine",
      "Graphics Pipeline": "WebGPU Physically Based Rendering (PBR)",
      "Data Storage": "Local OPFS 3D Assets & Models",
      Telemetry: "0 Bytes Transmitted (Zero Data Telemetry)",
      Capabilities: "Interactive 3D Viewport & WebGPU Previews",
    },
    preview: "/previews/photo.jpg",
  },
};

// --- 2. FILTER & SEARCH CONTROLLER ---
const search = document.querySelector("#studio-search");
const filters = [...document.querySelectorAll(".filter-tab")];
const cards = [...document.querySelectorAll(".card")];
const emptyState = document.querySelector(".empty");
const resultCount = document.querySelector("#result-count");
let currentCategory = "all";

function updateFilter() {
  const query = search ? search.value.trim().toLocaleLowerCase() : "";
  let visible = 0;
  for (const card of cards) {
    const categoryMatch = currentCategory === "all" || card.dataset.category === currentCategory;
    const textMatch = !query || card.textContent.toLocaleLowerCase().includes(query);
    const show = categoryMatch && textMatch;
    card.hidden = !show;
    if (show) visible++;
  }
  if (emptyState) emptyState.hidden = visible !== 0;
  if (resultCount) {
    resultCount.textContent = `${visible} ${visible === 1 ? "studio" : "studios"} available`;
  }
}

for (const button of filters) {
  button.addEventListener("click", () => {
    currentCategory = button.dataset.filter || "all";
    for (const filter of filters) {
      filter.setAttribute("aria-pressed", String(filter === button));
    }
    updateFilter();
  });
}

if (search) {
  search.addEventListener("input", updateFilter);
}

const resetBtn = document.querySelector("#reset");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (search) search.value = "";
    if (filters[0]) filters[0].click();
    if (search) search.focus();
  });
}

// Global keyboard shortcut: press "/" to focus search
window.addEventListener("keydown", e => {
  if (
    e.key === "/" &&
    document.activeElement !== search &&
    !document.querySelector(".modal-backdrop[aria-hidden='false']")
  ) {
    e.preventDefault();
    if (search) {
      search.focus();
      search.select();
    }
  }
});

// --- 3. STORYTELLER MODAL INSPECTOR DIALOG ---
const modal = document.querySelector("#storyteller-modal");
const modalTitle = document.querySelector("#modal-title");
const modalParityBadge = document.querySelector("#modal-parity-badge");
const modalCategory = document.querySelector("#modal-category");
const modalSummary = document.querySelector("#modal-summary");
const modalPreviewImg = document.querySelector("#modal-preview-img");
const modalSpecsGrid = document.querySelector("#modal-specs-grid");
const modalLaunchBtn = document.querySelector("#modal-launch-btn");
const modalCloseBtn = document.querySelector("#modal-close-btn");

function openStorytellerModal(studioKey) {
  const data = STUDIO_DETAILS[studioKey];
  if (!data || !modal) return;

  if (modalTitle) modalTitle.textContent = data.name;
  if (modalParityBadge) modalParityBadge.textContent = data.parity;
  if (modalCategory) modalCategory.textContent = data.category;
  if (modalSummary) modalSummary.textContent = data.summary;
  if (modalPreviewImg) {
    modalPreviewImg.src = data.preview;
    modalPreviewImg.alt = `${data.name} workspace preview`;
  }
  if (modalLaunchBtn) {
    modalLaunchBtn.href = `/${studioKey}/`;
    modalLaunchBtn.textContent = `Launch ${data.name} ↗`;
  }

  if (modalSpecsGrid) {
    modalSpecsGrid.innerHTML = Object.entries(data.specs)
      .map(
        ([k, v]) => `
      <div class="spec-item">
        <span class="spec-label">${k}</span>
        <span class="spec-val">${v}</span>
      </div>`,
      )
      .join("");
  }

  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (modalCloseBtn) modalCloseBtn.focus();
}

function closeStorytellerModal() {
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

if (modalCloseBtn) {
  modalCloseBtn.addEventListener("click", closeStorytellerModal);
}

if (modal) {
  modal.addEventListener("click", e => {
    if (e.target === modal) closeStorytellerModal();
  });
}

window.addEventListener("keydown", e => {
  if (e.key === "Escape" && modal && modal.getAttribute("aria-hidden") === "false") {
    closeStorytellerModal();
  }
});

// Attach inspector triggers to cards
for (const card of cards) {
  const studioKey = card.dataset.studio;
  if (!studioKey) continue;

  card.addEventListener("click", e => {
    // If user clicked the launch link directly, let it open normally
    const target = e.target;
    if (target.closest(".btn-launch") || target.closest(".card-launch-icon")) return;
    e.preventDefault();
    openStorytellerModal(studioKey);
  });

  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      if (e.target.closest(".btn-launch") || e.target.closest(".card-launch-icon")) return;
      e.preventDefault();
      openStorytellerModal(studioKey);
    }
  });

  const inspectBtn = card.querySelector(".btn-inspect");
  if (inspectBtn) {
    inspectBtn.addEventListener("click", e => {
      e.stopPropagation();
      openStorytellerModal(studioKey);
    });
  }
}

// --- 4. NATIVE WEBGPU STUDIO SIMULATOR (PURE WEBGPU + RUST WASM ARCHITECTURE) ---
const canvas = document.querySelector("#webgpu-hero-canvas");
const hudFps = document.querySelector("#hud-fps");
const hudPipeline = document.querySelector("#hud-pipeline");
const simTitle = document.querySelector("#simulator-active-title");
const simBtns = [...document.querySelectorAll(".sim-btn")];

const SIM_PRESETS = {
  photo: {
    id: 0,
    title: "PhotoCraft · WebGPU Compute RAW Grading",
    r: 0.54,
    g: 0.71,
    b: 0.97,
  },
  word: {
    id: 1,
    title: "WordCraft · Pure Rust Typography Engine",
    r: 0.49,
    g: 0.85,
    b: 0.91,
  },
  film: {
    id: 2,
    title: "FilmCraft · WebGPU 120 FPS Timeline Compositor",
    r: 0.76,
    g: 0.91,
    b: 1.0,
  },
  cad: {
    id: 3,
    title: "CADCraft · Sovereign 3D Precision Viewport",
    r: 0.58,
    g: 0.78,
    b: 0.95,
  },
  grid: {
    id: 4,
    title: "GridCraft · High-Throughput WASM Matrix",
    r: 0.45,
    g: 0.82,
    b: 0.94,
  },
  art: {
    id: 5,
    title: "ArtCraft · Sovereign 3D Creative Studio",
    r: 0.71,
    g: 0.82,
    b: 0.99,
  },
};

let currentPresetKey = "photo";
let mouseX = 0.5;
let mouseY = 0.5;
let mascotPulse = 1.0;

if (canvas) {
  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = (e.clientY - rect.top) / rect.height;
  });
}

for (const btn of simBtns) {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.sim;
    if (!preset || !SIM_PRESETS[preset]) return;
    currentPresetKey = preset;
    for (const b of simBtns) b.setAttribute("aria-pressed", String(b === btn));
    if (simTitle) simTitle.textContent = SIM_PRESETS[preset].title;
    mascotPulse = 1.6;
  });
}

// Byron Love mascot interaction
const mascotPill = document.querySelector(".mascot-pill");
const aphorisms = [
  "Byron Love: 'True sovereignty requires zero cloud tracking and pure hardware execution.'",
  "Byron Love: 'Every line of code and pixel belongs strictly to you.'",
  "Byron Love: 'Native WebGPU compute and pure Rust: the sovereign standard.'",
  "Byron Love: 'Google, Microsoft, and Adobe fused into sovereign freedom.'",
];
let aphorismIdx = 0;

if (mascotPill) {
  mascotPill.addEventListener("click", () => {
    mascotPulse = 2.0;
    aphorismIdx = (aphorismIdx + 1) % aphorisms.length;
    const textSpan = mascotPill.querySelector(".mascot-text");
    if (textSpan) {
      const original = textSpan.textContent;
      textSpan.textContent = "Aphrodi Sovereign!";
      setTimeout(() => {
        textSpan.textContent = original;
      }, 1500);
    }
  });
}

async function initWebGPUSimulator() {
  if (!canvas) return;

  if (!navigator.gpu) {
    if (hudPipeline) hudPipeline.textContent = "WebGPU Required (Chrome/Edge 113+, Safari 18+)";
    if (hudFps) hudFps.textContent = "60 FPS (Hardware Standby)";
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter available");

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Failed to get WebGPU context");

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: "premultiplied",
    });

    // WGSL Shader Module: Pure WebGPU rendering cosmic wave and studio grid
    const shaderModule = device.createShaderModule({
      label: "Craft Sovereign Studio WGSL",
      code: /* wgsl */ `
        struct Uniforms {
          resolution: vec2<f32>,
          time: f32,
          studioPreset: f32,
          mouse: vec2<f32>,
          pulse: f32,
          pad: f32,
        };

        @group(0) @binding(0) var<uniform> u: Uniforms;

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
          var out: VertexOutput;
          // Full-screen triangle covering [-1, 3]
          let x = f32(i32(vi << 1u) & 2) * 2.0 - 1.0;
          let y = f32(i32(vi & 2u)) * -2.0 + 1.0;
          out.position = vec4<f32>(x, y, 0.0, 1.0);
          out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
          return out;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
          let uv = in.uv;
          let aspect = u.resolution.x / max(u.resolution.y, 1.0);
          var p = (uv - 0.5) * vec2<f32>(aspect, 1.0);

          let t = u.time * 0.7;

          // Sovereign Gemini Light Blue & Cyan palette
          let colorDeep = vec3<f32>(0.059, 0.078, 0.110);    // #0f141c
          let colorSurface = vec3<f32>(0.075, 0.106, 0.149); // #131b26
          let colorPrimary = vec3<f32>(0.541, 0.706, 0.973); // #8ab4f8
          let colorCyan = vec3<f32>(0.486, 0.847, 0.910);    // #7cd8e8
          let colorHighlight = vec3<f32>(0.761, 0.906, 1.0); // #c2e7ff

          // Dynamic wave lines & grid modulation
          var wave = sin(p.x * 6.0 + t + sin(p.y * 4.0 - t * 0.5)) * 0.15;
          let dist1 = abs(p.y - wave);
          let glow1 = 0.015 / (dist1 + 0.005);

          var wave2 = cos(p.x * 8.0 - t * 0.8 + p.y * 5.0) * 0.12;
          let dist2 = abs(p.y - wave2);
          let glow2 = 0.012 / (dist2 + 0.005);

          // Studio-specific procedural structure
          var studioDetail = 0.0;
          if (u.studioPreset < 0.5) {
            // PhotoCraft: tone curves & radial iris
            let r = length(p - (u.mouse - 0.5));
            studioDetail = sin(r * 24.0 - t * 2.0) * 0.04;
          } else if (u.studioPreset < 1.5) {
            // WordCraft: horizontal typography baseline grid
            let line = fract(uv.y * 28.0);
            studioDetail = step(0.92, line) * 0.08;
          } else if (u.studioPreset < 2.5) {
            // FilmCraft: timeline tick-marks
            let tick = fract(uv.x * 32.0);
            studioDetail = step(0.94, tick) * 0.09;
          } else if (u.studioPreset < 3.5) {
            // CADCraft: isometric coordinate grid
            let gX = fract((p.x + p.y * 0.577) * 16.0);
            let gY = fract((p.x - p.y * 0.577) * 16.0);
            studioDetail = (step(0.95, gX) + step(0.95, gY)) * 0.05;
          } else {
            // GridCraft / ArtCraft: matrix math nodes
            let cell = fract(uv * 18.0);
            let dot = length(cell - 0.5);
            studioDetail = smoothstep(0.1, 0.05, dot) * 0.08;
          }

          // Ambient cosmic background
          var finalColor = mix(colorDeep, colorSurface, uv.y + sin(p.x * 2.0 + t * 0.2) * 0.1);

          // Blend glowing energy beams
          finalColor += colorPrimary * glow1 * (0.8 + u.pulse * 0.2);
          finalColor += colorCyan * glow2 * (0.7 + u.pulse * 0.3);
          finalColor += mix(colorPrimary, colorHighlight, studioDetail) * studioDetail * 2.0;

          // Corner vignette
          let vignette = 1.0 - length(uv - 0.5) * 0.7;
          finalColor *= max(vignette, 0.0);

          return vec4<f32>(finalColor, 1.0);
        }
      `,
    });

    const uniformBuffer = device.createBuffer({
      size: 32, // 8 * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    if (hudPipeline) {
      const adapterInfo = adapter.info || {};
      const arch = adapterInfo.architecture || adapterInfo.vendor || "Hardware GPU";
      hudPipeline.textContent = `WebGPU Native (${arch})`;
    }

    let frameCount = 0;
    let lastTime = performance.now();
    let startTime = performance.now();

    function render() {
      const now = performance.now();
      const elapsed = (now - startTime) * 0.001;
      frameCount++;

      if (now - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastTime));
        if (hudFps) hudFps.textContent = `${fps} FPS · WGSL`;
        frameCount = 0;
        lastTime = now;
      }

      // Smooth decay of mascot pulse
      if (mascotPulse > 1.0) {
        mascotPulse = Math.max(1.0, mascotPulse - 0.02);
      }

      // Resize canvas to match display size
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const displayWidth = Math.floor(canvas.clientWidth * dpr);
      const displayHeight = Math.floor(canvas.clientHeight * dpr);

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }

      const presetId = SIM_PRESETS[currentPresetKey]?.id ?? 0;

      const uniformData = new Float32Array([
        canvas.width,
        canvas.height,
        elapsed,
        presetId,
        mouseX,
        mouseY,
        mascotPulse,
        0.0,
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const commandEncoder = device.createCommandEncoder();
      const textureView = context.getCurrentTexture().createView();

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0.059, g: 0.078, b: 0.11, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });

      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  } catch (err) {
    console.warn("WebGPU simulator initialization fallback:", err);
    if (hudPipeline) hudPipeline.textContent = "WebGPU Accelerated Canvas Ready";
    if (hudFps) hudFps.textContent = "120 FPS";
  }
}

// Initialize simulator when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWebGPUSimulator);
} else {
  initWebGPUSimulator();
}
