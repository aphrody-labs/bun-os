// post-stack-webgpu.js - the Bun OS WebGPU twin of post-stack.js (3Dviz Pro Max, MIT): bloom and vignette as TSL
// nodes on three's RenderPipeline, so the same code runs on the WebGPU backend and on its WebGL2 fallback.
// Change the bloom threshold first: it must sit above every diffuse surface and below the emissives.
//
// TONE MAPPING - the pipeline owns it the right way round: the scene pass renders linear HDR, bloom adds in linear
// light, and RenderPipeline applies renderer.toneMapping, exposure and the sRGB output transform once, at the end
// (outputColorTransform). Nothing here touches renderer.toneMapping, so there is nothing to restore.
// pmndrs `postprocessing` is WebGL-only; keep rigs/post-stack.js for the Vite/WebGL scaffold.
import { RenderPipeline } from 'three/webgpu';
import { float, pass, screenUV, smoothstep, vec4 } from 'three/tsl';
import { bloom as bloomNode } from 'three/addons/tsl/display/BloomNode.js';

/**
 * @param {object} options
 * @param {THREE.WebGPURenderer} options.renderer
 * @param {THREE.Scene} options.scene
 * @param {THREE.Camera} options.camera
 * @param {{threshold: number, strength: number, radius: number}} [options.bloom]
 * @param {number} [options.vignette] - darkness 0..1; 0 disables the effect.
 * @returns {{pipeline, render(dt), setSize(w, h), dispose()}}
 */
export function createPostStack({ renderer, scene, camera, bloom, vignette = 0 }) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  let out = color;
  if (bloom) out = out.add(bloomNode(color, bloom.strength, bloom.radius, bloom.threshold));
  if (vignette > 0) {
    // Darken toward the corners: 0 at the centre ring, `vignette` at the frame edge.
    const falloff = float(1).sub(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(vignette));
    out = vec4(out.rgb.mul(falloff), out.a);
  }
  pipeline.outputNode = out;
  return {
    pipeline,
    /** Call instead of renderer.render. */
    render() { pipeline.render(); },
    /** The pipeline follows the renderer's size; kept for parity with post-stack.js. */
    setSize() {},
    dispose() { pipeline.dispose(); scenePass.dispose?.(); }
  };
}
