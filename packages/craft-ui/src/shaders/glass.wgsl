// Aphrody WebGPU Glass Transmission & Chromatic Aberration Shader
// Computes real-time dynamic light refraction, dispersion, and specular bounce.

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  roughness: f32,
  dispersion: f32,
  refractionIndex: f32,
  ambientIntensity: f32,
  _padding: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;
  // Full-screen triangle coordinates
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let p = pos[in_vertex_index];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}

// Pseudo simplex micro-noise for frosted glass roughness
fn hash(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i + vec2<f32>(0.0, 0.0)), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let aspect = u.resolution.x / u.resolution.y;

  // Center-weighted normal distortion
  let center = vec2<f32>(0.5, 0.5);
  let dist = distance(uv, center);
  let n = noise(uv * 12.0 + u.time * 0.1) * u.roughness;

  let offset = (uv - center) * (dist * 0.05 + n * 0.02) * u.refractionIndex;

  // Chromatic dispersion (RGB wavelength split)
  let disp = u.dispersion * 0.02;
  let uvR = uv + offset + vec2<f32>(disp, 0.0);
  let uvG = uv + offset;
  let uvB = uv + offset - vec2<f32>(disp, 0.0);

  // Deep luxury dark gradient base
  let colR = 0.08 + 0.15 * sin(uvR.x * 2.0 + u.time * 0.2);
  let colG = 0.10 + 0.18 * sin(uvG.y * 2.5 + u.time * 0.25);
  let colB = 0.16 + 0.24 * cos(uvB.x * 1.8 + u.time * 0.15);

  // Directional Specular highlight on top edge
  let specular = pow(max(1.0 - uv.y, 0.0), 32.0) * 0.45;
  let rim = pow(dist * 1.2, 4.0) * 0.15;

  let finalColor = vec3<f32>(colR, colG, colB) * u.ambientIntensity + vec3<f32>(specular + rim);

  return vec4<f32>(finalColor, 0.88);
}
