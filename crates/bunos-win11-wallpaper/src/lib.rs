// SPDX-License-Identifier: Apache-2.0
//! Bun OS Windows wallpaper engine: a wgpu-rendered animated layer in the desktop `WorkerW` window. Pure Rust on
//! the shared Bun OS wgpu stack. See [`worker_w`] for how the layer is acquired and [`Engine`] for rendering.
//!
//! Running it draws behind the desktop icons and is fully reversible (closing the engine restores the normal
//! wallpaper); it is not a shell and registers nothing.

#[cfg(windows)]
pub mod worker_w;

#[cfg(windows)]
mod engine;

#[cfg(windows)]
pub use engine::Engine;

/// The uniform block the shader consumes (std140-compatible: 4 f32s).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Uniforms {
    pub time: f32,
    pub width: f32,
    pub height: f32,
    pub _pad: f32,
}

#[cfg(not(windows))]
pub struct Engine;

#[cfg(not(windows))]
impl Engine {
    /// Off Windows the engine cannot run; this reports so without panicking, keeping the crate portable.
    pub fn acquire() -> Result<Self, String> {
        Err("the wallpaper engine is Windows-only (WorkerW + wgpu)".into())
    }
}
