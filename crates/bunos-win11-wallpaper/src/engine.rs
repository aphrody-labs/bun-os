// SPDX-License-Identifier: Apache-2.0
//! The wgpu render engine bound to the `WorkerW` child window, built on the shared Bun OS GPU backend
//! (`aphrody-gpu-backend`) so it uses the one owner of adapter/device/surface policy.

use aphrody_gpu_backend::{
    request_adapter, request_device, surface_configuration, wgpu, DeviceLimits, DeviceRequest, SurfaceFormat,
    SurfaceRequest,
};
use raw_window_handle::{
    DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, RawWindowHandle, Win32WindowHandle, WindowHandle,
};
use std::num::NonZeroIsize;

use crate::worker_w::{spawn_worker_w, WallpaperWindow};
use crate::Uniforms;

/// A raw-window-handle shim over the HWND we own, so wgpu can build a surface for it.
struct DesktopSurface {
    hwnd: isize,
}

impl HasWindowHandle for DesktopSurface {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let hwnd = NonZeroIsize::new(self.hwnd).ok_or(HandleError::Unavailable)?;
        let handle = Win32WindowHandle::new(hwnd);
        // SAFETY: the HWND outlives this borrow (owned by the Engine) and is a valid child window.
        Ok(unsafe { WindowHandle::borrow_raw(RawWindowHandle::Win32(handle)) })
    }
}

impl HasDisplayHandle for DesktopSurface {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        Ok(DisplayHandle::windows())
    }
}

/// The wallpaper render engine: owns the surface, device and pipeline and paints animated frames.
pub struct Engine {
    _window: WallpaperWindow,
    _surface_owner: Box<DesktopSurface>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
}

impl Engine {
    /// Acquire the WorkerW layer, create the render child and bring up wgpu.
    pub fn acquire() -> Result<Self, String> {
        let worker = spawn_worker_w()?;
        let window = WallpaperWindow::create(worker)?;
        let (width, height) = (window.width, window.height);

        let surface_owner = Box::new(DesktopSurface { hwnd: window.hwnd });
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        // Win32 needs no display connection, so pass the window handle with an explicit Windows display handle
        // rather than `from_window` (which demands a display handle on the instance). The boxed owner is kept for
        // the Engine's lifetime, so the surface's 'static lifetime is sound.
        let raw_window_handle = surface_owner.window_handle().map_err(|e| e.to_string())?.as_raw();
        let target = wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_display_handle: Some(raw_window_handle::RawDisplayHandle::Windows(
                raw_window_handle::WindowsDisplayHandle::new(),
            )),
            raw_window_handle,
        };
        let surface = unsafe { instance.create_surface_unsafe(target).map_err(|e| e.to_string())? };

        let adapter = pollster::block_on(request_adapter(
            &instance,
            &wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            },
        ))
        .map_err(|e| e.to_string())?;

        let gpu = pollster::block_on(request_device(
            &adapter,
            DeviceRequest::new(Some("bunos-wallpaper"), DeviceLimits::DownlevelWithAdapterResolution),
        ))
        .map_err(|e| e.to_string())?;
        let (device, queue) = (gpu.device, gpu.queue);

        let caps = surface.get_capabilities(&adapter);
        let config = surface_configuration(
            &caps,
            SurfaceRequest {
                width: width.max(1),
                height: height.max(1),
                format: SurfaceFormat::Preferred,
                present_mode: Some(wgpu::PresentMode::AutoVsync),
                alpha_mode: None,
                desired_maximum_frame_latency: 2,
            },
        )
        .ok_or("surface has no compatible configuration")?;
        let format = config.format;
        surface.configure(&device, &config);

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size: std::mem::size_of::<Uniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniform-layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniform-bind"),
            layout: &bind_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("aurora"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("wallpaper-layout"),
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("wallpaper"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        Ok(Self {
            _window: window,
            _surface_owner: surface_owner,
            surface,
            device,
            queue,
            config,
            pipeline,
            uniform_buffer,
            bind_group,
            width,
            height,
        })
    }

    /// Render one frame at `time` seconds.
    pub fn render(&mut self, time: f32) -> Result<(), String> {
        let uniforms = Uniforms { time, width: self.width as f32, height: self.height as f32, _pad: 0.0 };
        // SAFETY: `Uniforms` is `#[repr(C)]` with four `f32` fields and no trailing padding.
        let bytes =
            unsafe { std::slice::from_raw_parts((&raw const uniforms).cast::<u8>(), std::mem::size_of::<Uniforms>()) };
        self.queue.write_buffer(&self.uniform_buffer, 0, bytes);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("aurora-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
        Ok(())
    }
}
