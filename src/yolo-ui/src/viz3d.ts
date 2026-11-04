// SPDX-License-Identifier: Apache-2.0
/**
 * YOLO UI 3D Visualization & Composition Engine
 * Procedural 3D scene generation, WebGPU render graph, and GLTF/GLB asset composition.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MaterialDef {
  name: string;
  baseColorHex: string;
  roughness: number;
  metallic: number;
  emissive?: string;
  wireframe?: boolean;
}

export interface MeshDef {
  id: string;
  type: "box" | "sphere" | "cylinder" | "plane" | "torus" | "custom";
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  material: string;
}

export interface LightDef {
  id: string;
  type: "directional" | "point" | "ambient";
  colorHex: string;
  intensity: number;
  position?: Vec3;
}

export interface Scene3D {
  name: string;
  version: string;
  camera: {
    fov: number;
    position: Vec3;
    target: Vec3;
  };
  materials: MaterialDef[];
  meshes: MeshDef[];
  lights: LightDef[];
}

/**
 * Compose a high-performance 3D scene blueprint.
 */
export function compose3dScene(
  name: string,
  blueprint: {
    primaryColor: string;
    accentColor: string;
    meshCount?: number;
    style?: "product_showcase" | "abstract_art" | "hardware_rig";
  }
): Scene3D {
  const materials: MaterialDef[] = [
    {
      name: "mat_primary",
      baseColorHex: blueprint.primaryColor,
      roughness: 0.25,
      metallic: 0.8,
    },
    {
      name: "mat_accent",
      baseColorHex: blueprint.accentColor,
      roughness: 0.1,
      metallic: 0.95,
      emissive: blueprint.accentColor,
    },
    {
      name: "mat_ground",
      baseColorHex: "#11141d",
      roughness: 0.9,
      metallic: 0.05,
    },
  ];

  const meshes: MeshDef[] = [
    {
      id: "hero_mesh",
      type: "torus",
      position: { x: 0, y: 1.2, z: 0 },
      rotation: { x: 0.4, y: 0.8, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      material: "mat_primary",
    },
    {
      id: "accent_core",
      type: "sphere",
      position: { x: 0, y: 1.2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.45, y: 0.45, z: 0.45 },
      material: "mat_accent",
    },
    {
      id: "pedestal",
      type: "cylinder",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.2, z: 2 },
      material: "mat_ground",
    },
  ];

  const lights: LightDef[] = [
    {
      id: "key_light",
      type: "directional",
      colorHex: "#ffffff",
      intensity: 1.5,
      position: { x: 5, y: 10, z: 7 },
    },
    {
      id: "fill_light",
      type: "point",
      colorHex: blueprint.accentColor,
      intensity: 2.0,
      position: { x: -4, y: 2, z: -3 },
    },
    {
      id: "ambient",
      type: "ambient",
      colorHex: "#334155",
      intensity: 0.4,
    },
  ];

  return {
    name,
    version: "1.0.0",
    camera: {
      fov: 45,
      position: { x: 0, y: 2.5, z: 6 },
      target: { x: 0, y: 1.0, z: 0 },
    },
    materials,
    meshes,
    lights,
  };
}

/**
 * Convert 3D scene to standard JSON descriptor for Obscura/WebGPU or Three.js runtime.
 */
export function exportSceneJson(scene: Scene3D): string {
  return JSON.stringify(scene, null, 2);
}
