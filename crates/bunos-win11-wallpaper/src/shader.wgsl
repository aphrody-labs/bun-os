// SPDX-License-Identifier: Apache-2.0
// Fullscreen animated gradient: a Bun OS aurora behind the desktop icons. No vertex buffer — the triangle is
// generated from the vertex index; the fragment colour animates with time.

struct Uniforms {
    time: f32,
    width: f32,
    height: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    // One oversized triangle covering the clip space.
    var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
    return vec4<f32>(p[vi], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = vec2<f32>(frag.x / max(u.width, 1.0), frag.y / max(u.height, 1.0));
    let t = u.time;
    let a = 0.5 + 0.5 * sin(t * 0.2 + uv.x * 3.0);
    let b = 0.5 + 0.5 * sin(t * 0.17 + uv.y * 4.0 + 2.0);
    let c = 0.5 + 0.5 * sin(t * 0.13 + (uv.x + uv.y) * 2.0 + 4.0);
    // Deep graphite base with a slow aurora tint.
    let base = vec3<f32>(0.07, 0.07, 0.09);
    let aurora = vec3<f32>(0.10 * a, 0.22 * b, 0.35 * c);
    return vec4<f32>(base + aurora, 1.0);
}
