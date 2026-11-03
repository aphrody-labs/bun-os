// SPDX-License-Identifier: MIT
// kit-viewer.js - the Bun OS kit page: upstream's proof harness (templates/kits/_harness/main.js, 3Dviz Pro Max,
// MIT) on Three.js WebGPURenderer. The renderer takes WebGPU when the browser offers an adapter and falls back to
// its WebGL2 backend otherwise (or when the page asks for backend=webgl2); the backend that drew is published in
// window.__kitInfo. Loading, framing, counting and the capture contract are the upstream harness modules, unchanged.
// Renderer lines follow the SKILL.md contract: sRGB output, ACESFilmic, exposure 1.0, pixel ratio capped at 2,
// soft shadows, one sun plus one hemisphere fill, neutral grey ground, no post-processing.
import * as THREE from 'three/webgpu';
import { installViewer } from '/kits/_harness/viewer-contract.js';
import { buildViews, loadBlueprint, triangles } from '/kits/_harness/blueprint-views.js';

const STEP_S = 1 / 60;   // motion advances in fixed steps, never by wall clock, while capturing

const meta = name => document.querySelector(`meta[name="${name}"]`)?.content ?? '';
const CAPTURING = meta('capture') === '1';
const canvas = document.querySelector('#world');
const hud = document.querySelector('#hud');

function fail(message, cause) {
  const box = document.querySelector('#error');
  box.hidden = false;
  box.textContent = message;
  if (cause) throw cause;
}

async function adapterInfo() {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const info = adapter.info ?? {};
    return { vendor: info.vendor ?? '', architecture: info.architecture ?? '', device: info.device ?? '',
             description: info.description ?? '', fallback: Boolean(adapter.isFallbackAdapter ?? info.isFallbackAdapter) };
  } catch {
    return null;
  }
}

const adapter = meta('backend') === 'webgl2' ? null : await adapterInfo();
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: adapter === null });
try {
  await renderer.init();
} catch (cause) {
  fail('This viewer needs WebGPU or WebGL2.', cause);
}
const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Scene colours (backdrop, light tints, ground) are part of the proof setup, not UI chrome.
const scene = new THREE.Scene();
scene.background = new THREE.Color('#6d7075');
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
const sun = new THREE.DirectionalLight('#fff4e2', 2.6);
sun.position.set(6, 9, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
scene.add(sun, new THREE.HemisphereLight('#cdd7e6', '#6a6257', 1.1));
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64),
                              new THREE.MeshStandardMaterial({ color: '#8a8a86', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const turntable = new THREE.Group();
scene.add(turntable);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

let spinning = true, viewer = null, angle = 0, last = performance.now(), built = null;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // The turntable proves the page is live for --motion-check; setView freezes it at angle 0, and a capturing page
  // never advances the blueprint's own animation here (window.__kitAdvance does, in fixed steps).
  if (spinning) {
    angle += dt * 0.25;
    turntable.rotation.y = angle;
    if (!CAPTURING) built?.animate?.(dt);
  }
  renderer.render(scene, camera);
  viewer?.markReady();
}

async function start() {
  const params = JSON.parse(meta('params') || '{}');
  const tier = meta('tier') || 'T1';
  const surface = JSON.parse(meta('surface') || '{}');
  built = await loadBlueprint(meta('module'), params, meta('factory'), { tier, surface });
  turntable.add(built.group);
  const box = new THREE.Box3().setFromObject(built.group);
  const sockets = built.sockets ?? [];
  const { views, fit, detail_socket } = buildViews(box, sockets, {
    detailSocket: meta('detail-socket'), maxClose: Number(meta('max-close-m')) || Infinity });
  const size = box.getSize(new THREE.Vector3());
  window.__kitInfo = {
    blueprint: meta('blueprint'), module: meta('module'), params,
    tier: built.info?.tier ?? 'T1',
    surface: built.info?.surface ? { ...built.info.surface, ao: built.info.ao } : null,
    triangles: triangles(built.group),
    bounds_m: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
    fit_distance_m: Number(fit.toFixed(4)),
    view_distances_m: Object.fromEntries(Object.entries(views).map(([name, view]) => [
      name, Number(new THREE.Vector3(...view.position)
        .distanceTo(new THREE.Vector3(...view.target)).toFixed(4))])),
    sockets: sockets.map(entry => entry.name),
    detail_socket,
    animated: typeof built.animate === 'function',
    colliders: (built.colliders ?? []).map(entry => entry.name),
    three: THREE.REVISION,
    backend,
    adapter
  };
  hud.textContent = `${meta('title') || meta('blueprint')} · ${window.__kitInfo.tier} · `
    + `${window.__kitInfo.triangles.toLocaleString('en')} tris · `
    + `${size.toArray().map(v => v.toFixed(2)).join(' × ')} m · ${backend}`;
  const controls = { target: new THREE.Vector3(), update() { camera.lookAt(this.target); } };
  viewer = installViewer({
    camera, controls, views,
    setView(name) {
      spinning = false;
      angle = 0;
      turntable.rotation.y = 0;
      camera.position.set(...views[name].position);
      controls.target.set(...views[name].target);
      controls.update();
    }
  });
  window.__kitAdvance = seconds => {
    let moved = false;
    for (let t = 0; t < seconds - 1e-9; t += STEP_S) {
      moved = Boolean(built.animate?.(Math.min(STEP_S, seconds - t))) || moved;
    }
    return moved;
  };
  resize();
  addEventListener('resize', resize);
  camera.position.set(...views.mid.position);
  controls.target.set(...views.mid.target);
  controls.update();
  renderer.setAnimationLoop(frame);
}

start().catch(error => fail(`Blueprint failed to load: ${error.message}`, error));
