// SPDX-License-Identifier: Apache-2.0
//! Unified native rendering contract for Aphrody OS.
//!
//! The crate centralizes renderer selection and frame/layout contracts for
//! both lanes: the retained M3 2D scene ([`scene`], [`raster`], `gpu`) and
//! the M3 3D scene graph ([`scene3d`], [`raster3d`], `gpu3d`, grouped behind
//! [`pipeline3d::Pipeline3d`]). GPU backends are feature-gated (`gpu`); the
//! contract remains usable by the kernel, Tauri/CEF and WASM without forcing
//! a graphics runtime into headless processes, and every GPU path has a
//! deterministic CPU reference it is tested against pixel for pixel.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![allow(
    clippy::chunks_exact_to_as_chunks,
    clippy::manual_is_multiple_of,
    clippy::should_implement_trait,
    clippy::needless_range_loop,
    clippy::collapsible_if
)]

/// The retained M3 scene model: nodes, paints, corners and elevation.
pub mod scene;

/// Shared analytic geometry: rounded-rect SDF, shadow falloff, SVG path
/// flattening and rasterization.
pub mod geometry;

/// Deterministic text rasterization shared by every backend.
pub mod text;

/// The deterministic CPU rasterizer: the pixel-perfect reference backend.
pub mod raster;

/// Bounded rendering of untrusted canvas scenes (the `aphrody canvas` entry point).
pub mod canvas;

mod canvas_cli;
pub use canvas_cli::cli_main;

/// Headless `wgpu` offscreen backend (feature `gpu`).
#[cfg(feature = "gpu")]
pub mod gpu;

/// The `wgpu` this crate renders with, so hosts (Tauri native layers) create
/// surfaces with the exact same version.
#[cfg(feature = "gpu")]
pub use wgpu;

/// Dependency-free 3D linear algebra (three.js conventions, wgpu depth).
pub mod math3d;

/// Procedural geometry tessellation and the shared mesh cache.
pub mod mesh3d;

/// The retained M3 3D scene graph and its backend-independent preparation.
pub mod scene3d;

/// Deterministic CPU 3D rasterizer (4x MSAA reference backend).
pub mod raster3d;

/// Persistent, instanced `wgpu` 3D backend (feature `gpu`).
#[cfg(feature = "gpu")]
pub mod gpu3d;

/// Policy-driven 3D entry point with lazy GPU and CPU fallback.
pub mod pipeline3d;

/// OBJ and glTF 2.0 (`.gltf`/`.glb`) model import into the 3D scene graph.
pub mod model;

/// 3D authoring backend: editable meshes, modeling operators, sculpting,
/// rigging, skinning, keyframe animation, PBR materials and an undoable
/// JSON command document that evaluates to [`scene3d::Scene3d`].
pub mod author3d;

/// Deterministic benchmark and test scenes.
pub mod fixtures;

/// Supported rendering backends, ordered from native GPU to portable fallback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    /// Direct3D 12 on Windows.
    Dx12,
    /// Vulkan on Windows/Linux/Android.
    Vulkan,
    /// Metal on Apple platforms.
    Metal,
    /// WebGPU in browser/WASM hosts.
    WebGpu,
    /// WebGL fallback for browser compatibility.
    WebGl,
    /// CPU raster fallback for headless/tests/accessibility.
    Cpu,
}

/// Rendering policy used by Aphrody OS surfaces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderPolicy {
    /// Prefer the best native GPU backend and fall back to CPU.
    Auto,
    /// Require a GPU backend; initialization must fail if unavailable.
    GpuRequired,
    /// Force deterministic CPU rendering.
    CpuOnly,
}

/// Surface class used to choose the least costly renderer that preserves the
/// required interaction and accessibility semantics.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceKind {
    /// Forms, settings, documentation and agent conversations.
    InteractiveWeb,
    /// Terminal grids, image/video canvases and high-frequency animations.
    NativeCanvas,
    /// Native 3D scenes and WebGPU/WebGL canvases.
    NativeScene3d,
    /// Headless screenshots, tests and deterministic exports.
    Headless,
}

/// Renderer lane selected by the unified policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceRenderer {
    /// Static M3 HTML/CSS in the CEF webview hosted by Tauri.
    WebView,
    /// Native `wgpu`/Vello lane when a GPU is available.
    NativeGpu,
    /// Deterministic CPU lane.
    Cpu,
}

/// Select the renderer lane for a surface.
///
/// Native GPU is returned only when the `gpu` backend is compiled in; the
/// runtime adapter probe and CPU fallback live in [`pipeline3d::Pipeline3d`].
/// Headless surfaces always use the deterministic CPU lane.
#[must_use]
pub const fn renderer_for_surface(kind: SurfaceKind, policy: RenderPolicy) -> SurfaceRenderer {
    let gpu = cfg!(feature = "gpu");
    match (kind, policy) {
        (SurfaceKind::InteractiveWeb, RenderPolicy::CpuOnly) => SurfaceRenderer::Cpu,
        (SurfaceKind::InteractiveWeb, _) => SurfaceRenderer::WebView,
        (SurfaceKind::NativeCanvas | SurfaceKind::NativeScene3d, RenderPolicy::CpuOnly) => {
            SurfaceRenderer::Cpu
        }
        (SurfaceKind::NativeCanvas | SurfaceKind::NativeScene3d, _) if gpu => {
            SurfaceRenderer::NativeGpu
        }
        (SurfaceKind::NativeCanvas | SurfaceKind::NativeScene3d, _) => SurfaceRenderer::Cpu,
        (SurfaceKind::Headless, _) => SurfaceRenderer::Cpu,
    }
}

/// Immutable renderer configuration shared by Tauri, native shell and WASM.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RenderConfig {
    /// Desired rendering policy.
    pub policy: RenderPolicy,
    /// Preferred backend, if available on the target.
    pub preferred: Option<Backend>,
    /// Enable M3 motion/elevation effects.
    pub effects: bool,
    /// Device pixel ratio used to map dp to physical pixels.
    pub scale_factor_milli: u32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            policy: RenderPolicy::Auto,
            preferred: None,
            effects: true,
            scale_factor_milli: 1000,
        }
    }
}

/// A backend-independent frame target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Frame<'a> {
    /// Logical width in dp.
    pub width_dp: u32,
    /// Logical height in dp.
    pub height_dp: u32,
    /// Optional opaque label used by diagnostics.
    pub label: Option<&'a str>,
}

/// Return the exact RGBA8 buffer size for a non-empty surface.
///
/// Dimensions and byte-size multiplication are checked before allocation so
/// callers can reject malformed or hostile surface descriptions safely.
#[must_use]
pub const fn rgba8_len(width: u32, height: u32) -> Option<usize> {
    if width == 0 || height == 0 {
        return None;
    }
    let pixels = match (width as usize).checked_mul(height as usize) {
        Some(pixels) => pixels,
        None => return None,
    };
    pixels.checked_mul(4)
}

/// Fill an exact RGBA8 surface using contiguous rows.
///
/// Returns `false` without modifying the buffer when dimensions are empty,
/// overflow, or do not match the supplied storage.
pub fn fill_rgba8_rows(buffer: &mut [u8], width: u32, height: u32, rgba: [u8; 4]) -> bool {
    let Some(total_bytes) = rgba8_len(width, height) else {
        return false;
    };
    let Some(row_bytes) = (width as usize).checked_mul(4) else {
        return false;
    };
    if buffer.len() != total_bytes {
        return false;
    }
    debug_assert_eq!(buffer.len(), row_bytes * height as usize);
    for pixel in buffer.chunks_exact_mut(4) {
        pixel.copy_from_slice(&rgba);
    }
    true
}

/// Backend-independent render surface shared by 2D and 3D clients.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RenderSurface {
    /// Surface class used by backend selection.
    pub kind: SurfaceKind,
    /// Logical width in density-independent pixels.
    pub width_dp: u32,
    /// Logical height in density-independent pixels.
    pub height_dp: u32,
    /// Physical pixels per logical pixel, expressed in thousandths.
    pub scale_factor_milli: u32,
    /// M3 adaptive layout resolved for the logical width.
    pub layout: aphrody_m3_tokens::facade::platform::LayoutContract,
}

impl RenderSurface {
    /// Create a surface using the canonical M3 layout contract.
    #[must_use]
    pub fn new(kind: SurfaceKind, width_dp: u32, height_dp: u32, scale_factor_milli: u32) -> Self {
        Self {
            kind,
            width_dp,
            height_dp,
            scale_factor_milli: scale_factor_milli.max(1),
            layout: layout_for_frame(width_dp, height_dp),
        }
    }

    /// Return physical pixel dimensions after scale-factor application.
    #[must_use]
    pub const fn physical_size(self) -> (u32, u32) {
        (
            self.width_dp.saturating_mul(self.scale_factor_milli) / 1000,
            self.height_dp.saturating_mul(self.scale_factor_milli) / 1000,
        )
    }

    /// Return physical dimensions or reject scale arithmetic overflow.
    #[must_use]
    pub const fn checked_physical_size(self) -> Option<(u32, u32)> {
        let width = match self.width_dp.checked_mul(self.scale_factor_milli) {
            Some(value) => value / 1000,
            None => return None,
        };
        let height = match self.height_dp.checked_mul(self.scale_factor_milli) {
            Some(value) => value / 1000,
            None => return None,
        };
        Some((width, height))
    }
}

/// The canonical order of backends compiled for this target, native GPU
/// first and the CPU reference last.
///
/// GPU entries appear only with the `gpu` feature (a real `wgpu` device
/// path); the adapter `wgpu` actually opens is reported at runtime.
#[must_use]
pub const fn backend_order() -> &'static [Backend] {
    if !cfg!(feature = "gpu") {
        &[Backend::Cpu]
    } else if cfg!(target_arch = "wasm32") {
        &[Backend::WebGpu, Backend::WebGl, Backend::Cpu]
    } else if cfg!(target_vendor = "apple") {
        &[Backend::Metal, Backend::Cpu]
    } else if cfg!(windows) {
        &[Backend::Dx12, Backend::Vulkan, Backend::Cpu]
    } else {
        &[Backend::Vulkan, Backend::Cpu]
    }
}

/// Resolve a configuration against the backends that are actually available.
///
/// `GpuRequired` returns the first compiled GPU backend, or `None` without
/// the `gpu` feature. It never silently degrades to CPU and never reports a
/// backend that is not compiled.
#[must_use]
pub const fn select_backend(config: &RenderConfig) -> Option<Backend> {
    match config.policy {
        RenderPolicy::GpuRequired => {
            if let Some(preferred) = config.preferred {
                if !matches!(preferred, Backend::Cpu) && backend_compiled(preferred) {
                    return Some(preferred);
                }
            }
            match backend_order() {
                [Backend::Cpu] | [] => None,
                [first, ..] => Some(*first),
            }
        }
        RenderPolicy::CpuOnly => {
            if backend_compiled(Backend::Cpu) {
                Some(Backend::Cpu)
            } else {
                None
            }
        }
        RenderPolicy::Auto => {
            if let Some(preferred) = config.preferred {
                if backend_compiled(preferred) {
                    return Some(preferred);
                }
            }
            let order = backend_order();
            let mut index = 0;
            while index < order.len() {
                let backend = order[index];
                if backend_compiled(backend) {
                    return Some(backend);
                }
                index += 1;
            }
            None
        }
    }
}

/// Resolve the M3 layout contract used by a frame.
#[must_use]
pub fn layout_for_frame(
    width_dp: u32,
    _height_dp: u32,
) -> aphrody_m3_tokens::facade::platform::LayoutContract {
    aphrody_m3_tokens::facade::platform::LayoutContract::from_width_dp(width_dp)
}

/// Report whether a backend is compiled into this target.
#[must_use]
pub const fn backend_compiled(backend: Backend) -> bool {
    match backend {
        Backend::Cpu => cfg!(feature = "cpu"),
        // A GPU backend is compiled only with the real `wgpu` path (`gpu`)
        // and only for the platforms that API exists on.
        Backend::Dx12 => cfg!(all(feature = "gpu", windows)),
        Backend::Vulkan => {
            cfg!(all(
                feature = "gpu",
                not(target_arch = "wasm32"),
                not(target_vendor = "apple")
            ))
        }
        Backend::Metal => cfg!(all(feature = "gpu", target_vendor = "apple")),
        Backend::WebGpu | Backend::WebGl => cfg!(all(feature = "gpu", target_arch = "wasm32")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(feature = "gpu"))]
    #[test]
    fn default_policy_is_safe_and_portable() {
        let config = RenderConfig::default();
        assert_eq!(config.policy, RenderPolicy::Auto);
        assert!(backend_compiled(Backend::Cpu));
        assert_eq!(select_backend(&config), Some(Backend::Cpu));
        assert_eq!(backend_order(), &[Backend::Cpu]);
    }

    #[cfg(feature = "gpu")]
    #[test]
    fn gpu_feature_orders_native_gpu_before_cpu() {
        let order = backend_order();
        assert_eq!(order.last(), Some(&Backend::Cpu));
        assert!(order.len() >= 2 && order.iter().all(|b| backend_compiled(*b)));
        let required = RenderConfig {
            policy: RenderPolicy::GpuRequired,
            ..RenderConfig::default()
        };
        assert_eq!(select_backend(&required), Some(order[0]));
        assert_eq!(
            renderer_for_surface(SurfaceKind::NativeScene3d, RenderPolicy::Auto),
            SurfaceRenderer::NativeGpu
        );
        assert_eq!(
            renderer_for_surface(SurfaceKind::Headless, RenderPolicy::GpuRequired),
            SurfaceRenderer::Cpu
        );
    }

    #[cfg(not(feature = "gpu"))]
    #[test]
    fn gpu_policy_does_not_fabricate_a_backend() {
        let config = RenderConfig {
            policy: RenderPolicy::GpuRequired,
            ..RenderConfig::default()
        };
        assert_eq!(select_backend(&config), None);
        assert!(!backend_compiled(Backend::Vulkan));
    }

    #[test]
    fn frame_uses_the_shared_m3_contract() {
        assert_eq!(layout_for_frame(1280, 800).panes, 2);
        assert_eq!(layout_for_frame(1800, 1000).panes, 3);
    }

    #[test]
    fn rgba8_storage_rejects_empty_and_overflowing_surfaces() {
        assert_eq!(rgba8_len(0, 10), None);
        assert_eq!(rgba8_len(10, 0), None);
        assert_eq!(rgba8_len(u32::MAX, u32::MAX), None);
    }

    #[test]
    fn rgba8_background_fill_is_row_contiguous_and_transactional() {
        let mut pixels = vec![0; rgba8_len(3, 2).expect("valid size")];
        assert!(fill_rgba8_rows(&mut pixels, 3, 2, [1, 2, 3, 4]));
        assert!(pixels.chunks_exact(4).all(|pixel| pixel == [1, 2, 3, 4]));

        let mut invalid = vec![9; 3];
        assert!(!fill_rgba8_rows(&mut invalid, 1, 2, [1, 2, 3, 4]));
        assert_eq!(invalid, vec![9; 3]);
    }

    #[cfg(not(feature = "gpu"))]
    #[test]
    fn surface_policy_keeps_webview_and_native_lanes_distinct() {
        assert_eq!(
            renderer_for_surface(SurfaceKind::InteractiveWeb, RenderPolicy::Auto),
            SurfaceRenderer::WebView
        );
        assert_eq!(
            renderer_for_surface(SurfaceKind::NativeCanvas, RenderPolicy::Auto),
            SurfaceRenderer::Cpu
        );
        assert_eq!(
            renderer_for_surface(SurfaceKind::NativeScene3d, RenderPolicy::Auto),
            SurfaceRenderer::Cpu
        );
        assert_eq!(
            renderer_for_surface(SurfaceKind::Headless, RenderPolicy::GpuRequired),
            SurfaceRenderer::Cpu
        );
    }

    #[test]
    fn two_d_and_three_d_surfaces_share_m3_geometry_and_scaling() {
        let canvas = RenderSurface::new(SurfaceKind::NativeCanvas, 840, 600, 1500);
        let scene = RenderSurface::new(SurfaceKind::NativeScene3d, 840, 600, 1500);
        assert_eq!(canvas.layout, scene.layout);
        assert_eq!(canvas.physical_size(), (1260, 900));
        assert_eq!(canvas.checked_physical_size(), Some((1260, 900)));
        assert_eq!(
            RenderSurface::new(SurfaceKind::NativeCanvas, u32::MAX, 1, u32::MAX)
                .checked_physical_size(),
            None
        );
    }
}
