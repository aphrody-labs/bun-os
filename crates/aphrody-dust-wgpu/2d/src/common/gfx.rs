use super::{BgObjPixel, ScanlineFlags};
use aphrody_dust_core::gpu::{SCREEN_HEIGHT, SCREEN_WIDTH, Scanline, engine_3d};
use aphrody_emu_utils::{resource_str, triple_buffer};
use parking_lot::RwLock;
use std::{
    num::NonZeroU64,
    slice,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering},
    },
    thread,
    // time::Duration,
};

pub enum Renderer3dRx {
    #[cfg(not(feature = "threaded"))]
    LocalAccel {
        rx: Box<dyn engine_3d::AccelRendererRx>,
        color_output_view: crate::wgpu::TextureView,
        new_color_output_view: Box<dyn Fn() -> crate::wgpu::TextureView>,
    },
    Soft(Box<dyn engine_3d::SoftRendererRx + Send + 'static>),
    Accel {
        rx: Box<dyn engine_3d::AccelRendererRx + Send + 'static>,
        color_output_view: crate::wgpu::TextureView,
        color_output_view_rx: crossbeam_channel::Receiver<crate::wgpu::TextureView>,
        last_submitted_frame: Arc<(AtomicU64, RwLock<Option<thread::Thread>>)>,
    },
}

enum Renderer3dRenderThreadData {
    #[cfg(not(feature = "threaded"))]
    LocalAccel(Box<dyn engine_3d::AccelRendererRx>),
    Soft(Box<dyn engine_3d::SoftRendererRx + Send + 'static>),
    Accel(Box<dyn engine_3d::AccelRendererRx + Send + 'static>),
}

enum Renderer3dUpdateGfxThreadData {
    #[cfg(not(feature = "threaded"))]
    LocalAccel {
        color_output_view: crate::wgpu::TextureView,
        new_color_output_view: Box<dyn Fn() -> crate::wgpu::TextureView>,
    },
    Soft,
    Accel {
        color_output_view: crate::wgpu::TextureView,
        color_output_view_rx: crossbeam_channel::Receiver<crate::wgpu::TextureView>,
        last_submitted_frame: Arc<(AtomicU64, RwLock<Option<thread::Thread>>)>,
    },
}

enum Renderer3dGfxThreadData {
    #[cfg(not(feature = "threaded"))]
    LocalAccel {
        new_color_output_view: Box<dyn Fn() -> crate::wgpu::TextureView>,
    },
    Soft {
        color_output_texture: crate::wgpu::Texture,
    },
    Accel {
        color_output_view_rx: crossbeam_channel::Receiver<crate::wgpu::TextureView>,
        last_submitted_frame: Arc<(AtomicU64, RwLock<Option<thread::Thread>>)>,
    },
}

impl Drop for Renderer3dGfxThreadData {
    fn drop(&mut self) {
        if !thread::panicking()
            && let Renderer3dGfxThreadData::Accel {
                last_submitted_frame,
                ..
            } = self
        {
            *last_submitted_frame.1.write() = None;
        }
    }
}

pub struct OutputAttachments {
    color_view: crate::wgpu::TextureView,
}

impl OutputAttachments {
    pub fn new(
        device: &crate::wgpu::Device,
        resolution_scale_shift: u8,
    ) -> (Self, crate::wgpu::TextureView) {
        let resolution_scale = 1 << resolution_scale_shift;

        let color = device.create_texture(&crate::wgpu::TextureDescriptor {
            label: Some("2D renderer color"),
            size: crate::wgpu::Extent3d {
                width: SCREEN_WIDTH as u32 * resolution_scale,
                height: (SCREEN_HEIGHT * 2) as u32 * resolution_scale,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: crate::wgpu::TextureDimension::D2,
            format: crate::wgpu::TextureFormat::Rgba8Unorm,
            usage: crate::wgpu::TextureUsages::RENDER_ATTACHMENT
                | crate::wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let color_view = color.create_view(&crate::wgpu::TextureViewDescriptor {
            label: Some("2D renderer color view"),
            ..crate::wgpu::TextureViewDescriptor::default()
        });

        let color_view_clone = color.create_view(&Default::default());

        (OutputAttachments { color_view }, color_view_clone)
    }
}

pub struct FrontendChannels {
    color_output_view_rx: crossbeam_channel::Receiver<crate::wgpu::TextureView>,
    renderer_3d_rx_tx: crossbeam_channel::Sender<Renderer3dRx>,
}

impl FrontendChannels {
    pub fn new(
        color_output_view_rx: crossbeam_channel::Receiver<crate::wgpu::TextureView>,
        renderer_3d_rx_tx: crossbeam_channel::Sender<Renderer3dRx>,
    ) -> Self {
        FrontendChannels {
            color_output_view_rx,
            renderer_3d_rx_tx,
        }
    }

    pub fn new_color_output_view(&self) -> Option<crate::wgpu::TextureView> {
        self.color_output_view_rx.try_iter().last()
    }

    pub fn set_renderer_3d_rx(&self, renderer_3d_rx: Renderer3dRx) {
        self.renderer_3d_rx_tx
            .send(renderer_3d_rx)
            .expect("couldn't send renderer 3D receiver to 2D rendering thread");
    }
}

pub struct SharedData {
    stopped: AtomicBool,
    resolution_scale_shift: AtomicU8,
    submitted_frames: AtomicU64,
}

impl SharedData {
    pub fn new(resolution_scale_shift: u8) -> Self {
        SharedData {
            stopped: AtomicBool::new(false),
            resolution_scale_shift: AtomicU8::new(resolution_scale_shift),
            submitted_frames: AtomicU64::new(0),
        }
    }

    pub fn set_resolution_scale_shift(&self, value: u8) {
        self.resolution_scale_shift.store(value, Ordering::Relaxed);
    }
    pub fn submitted_frames(&self) -> u64 {
        self.submitted_frames.load(Ordering::Acquire)
    }
}

struct RenderThreadChannels {
    renderer_3d_rx_rx: crossbeam_channel::Receiver<Renderer3dRx>,
}

impl RenderThreadChannels {
    fn new_renderer_3d_rx(&self) -> Option<Renderer3dRx> {
        self.renderer_3d_rx_rx.try_iter().last()
    }
}

struct GfxThreadChannels {
    color_output_view_tx: crossbeam_channel::Sender<crate::wgpu::TextureView>,
}

impl GfxThreadChannels {
    fn set_color_output_view(&self, color_output_view: crate::wgpu::TextureView) {
        self.color_output_view_tx
            .send(color_output_view)
            .expect("couldn't send new color output view");
    }
}

struct FrameData {
    output_3d: Box<[Scanline<u32>; SCREEN_HEIGHT]>,
    framebuffer: Box<[[Scanline<BgObjPixel>; SCREEN_HEIGHT]; 2]>,
    fb_scanline_flags: Box<[[ScanlineFlags; SCREEN_HEIGHT]; 2]>,
    engine_3d_enabled: bool,
    frame_index: u64,
}

impl Default for FrameData {
    fn default() -> Self {
        unsafe {
            FrameData {
                output_3d: Box::new_zeroed().assume_init(),
                framebuffer: Box::new_zeroed().assume_init(),
                fb_scanline_flags: Box::new_zeroed().assume_init(),
                engine_3d_enabled: false,
                frame_index: 0,
            }
        }
    }
}

pub struct GfxData {
    shared_data: Arc<SharedData>,
    channels: RenderThreadChannels,
    frame_data_tx: triple_buffer::Sender<FrameData>,
    renderer_3d_data: Renderer3dRenderThreadData,
    renderer_3d_data_tx: crossbeam_channel::Sender<Renderer3dUpdateGfxThreadData>,
    cur_frame_index: u64,
    #[cfg(feature = "threaded")]
    thread: Option<thread::JoinHandle<()>>,
    #[cfg(not(feature = "threaded"))]
    local_gfx: GfxThreadData,
}

impl GfxData {
    fn create_renderer_3d_update_data(
        renderer_3d_rx: Renderer3dRx,
    ) -> (Renderer3dRenderThreadData, Renderer3dUpdateGfxThreadData) {
        match renderer_3d_rx {
            #[cfg(not(feature = "threaded"))]
            Renderer3dRx::LocalAccel {
                rx,
                color_output_view,
                new_color_output_view,
            } => (
                Renderer3dRenderThreadData::LocalAccel(rx),
                Renderer3dUpdateGfxThreadData::LocalAccel {
                    color_output_view,
                    new_color_output_view,
                },
            ),
            Renderer3dRx::Soft(rx) => (
                Renderer3dRenderThreadData::Soft(rx),
                Renderer3dUpdateGfxThreadData::Soft,
            ),
            Renderer3dRx::Accel {
                rx,
                color_output_view,
                color_output_view_rx,
                last_submitted_frame,
            } => (
                Renderer3dRenderThreadData::Accel(rx),
                Renderer3dUpdateGfxThreadData::Accel {
                    color_output_view,
                    color_output_view_rx,
                    last_submitted_frame,
                },
            ),
        }
    }

    pub fn new(
        device: Arc<crate::wgpu::Device>,
        queue: Arc<crate::wgpu::Queue>,
        shared_data: Arc<SharedData>,
        color_output_view_tx: crossbeam_channel::Sender<crate::wgpu::TextureView>,
        renderer_3d_rx_rx: crossbeam_channel::Receiver<Renderer3dRx>,
        resolution_scale_shift: u8,
        renderer_3d_rx: Renderer3dRx,
    ) -> (Self, crate::wgpu::TextureView) {
        let (renderer_3d_render_data, renderer_3d_gfx_data) =
            Self::create_renderer_3d_update_data(renderer_3d_rx);

        let (frame_data_tx, frame_data_rx) = triple_buffer::init([
            FrameData::default(),
            FrameData::default(),
            FrameData::default(),
        ]);
        let (renderer_3d_data_tx, renderer_3d_data_rx) = crossbeam_channel::unbounded();

        let (thread_data, color_output_view) = GfxThreadData::new(
            device,
            queue,
            Arc::clone(&shared_data),
            GfxThreadChannels {
                color_output_view_tx,
            },
            resolution_scale_shift,
            frame_data_rx,
            renderer_3d_gfx_data,
            renderer_3d_data_rx,
        );

        (
            GfxData {
                shared_data,
                channels: RenderThreadChannels { renderer_3d_rx_rx },
                frame_data_tx,
                renderer_3d_data: renderer_3d_render_data,
                renderer_3d_data_tx,
                cur_frame_index: 0,
                #[cfg(not(feature = "threaded"))]
                local_gfx: thread_data,
                #[cfg(feature = "threaded")]
                thread: Some(
                    thread::Builder::new()
                        .name("2D rendering graphics".to_owned())
                        .spawn(move || thread_data.run())
                        .expect("couldn't spawn 2D rendering graphics thread"),
                ),
            },
            color_output_view,
        )
    }

    pub fn start_frame(
        &mut self,
        engine_3d_enabled_in_frame: bool,
        capture_enabled_in_frame: bool,
    ) {
        if let Some(renderer_3d_rx) = self.channels.new_renderer_3d_rx() {
            let (renderer_3d_render_data, renderer_3d_gfx_data) =
                Self::create_renderer_3d_update_data(renderer_3d_rx);

            self.renderer_3d_data = renderer_3d_render_data;
            self.renderer_3d_data_tx
                .send(renderer_3d_gfx_data)
                .expect("couldn't send new 3D renderer receiver");
        }

        if engine_3d_enabled_in_frame {
            match &mut self.renderer_3d_data {
                Renderer3dRenderThreadData::Soft(rx) => rx.start_frame(),
                Renderer3dRenderThreadData::Accel(rx) => {
                    rx.start_frame(capture_enabled_in_frame);
                }
                #[cfg(not(feature = "threaded"))]
                Renderer3dRenderThreadData::LocalAccel(rx) => {
                    rx.start_frame(capture_enabled_in_frame)
                }
            }
        }
    }

    pub fn skip_3d_scanline(&mut self) {
        if let Renderer3dRenderThreadData::Soft(rx) = &mut self.renderer_3d_data {
            rx.skip_scanline();
        }
    }

    pub fn process_3d_scanline(&mut self, cur_scanline: usize) {
        if let Renderer3dRenderThreadData::Soft(rx) = &mut self.renderer_3d_data {
            unsafe {
                self.frame_data_tx
                    .current()
                    .output_3d
                    .get_unchecked_mut(cur_scanline)
                    .0
                    .copy_from_slice(&rx.read_scanline().0);
            }
        }
    }

    pub fn capture_3d_scanline(&mut self, cur_scanline: usize) -> &Scanline<u32> {
        match &mut self.renderer_3d_data {
            Renderer3dRenderThreadData::Soft(_) => unsafe {
                self.frame_data_tx
                    .current()
                    .output_3d
                    .get_unchecked(cur_scanline)
            },
            Renderer3dRenderThreadData::Accel(rx) => rx.read_capture_scanline(),
            #[cfg(not(feature = "threaded"))]
            Renderer3dRenderThreadData::LocalAccel(rx) => rx.read_capture_scanline(),
        }
    }

    pub fn finish_frame(
        &mut self,
        framebuffer: &[[Scanline<BgObjPixel>; SCREEN_HEIGHT]; 2],
        fb_scanline_flags: &[[ScanlineFlags; SCREEN_HEIGHT]; 2],
        engine_3d_enabled_in_frame: bool,
    ) {
        let frame = self.frame_data_tx.current();
        frame.framebuffer.copy_from_slice(framebuffer);
        frame.fb_scanline_flags.copy_from_slice(fb_scanline_flags);
        frame.engine_3d_enabled = engine_3d_enabled_in_frame;
        frame.frame_index = self.cur_frame_index;
        self.cur_frame_index += 1;
        self.frame_data_tx.finish();
        #[cfg(feature = "threaded")]
        self.thread.as_ref().unwrap().thread().unpark();
        #[cfg(not(feature = "threaded"))]
        self.local_gfx.render_pending();
    }
}

impl Drop for GfxData {
    fn drop(&mut self) {
        #[cfg(feature = "threaded")]
        if let Some(thread) = self.thread.take() {
            self.shared_data.stopped.store(true, Ordering::Relaxed);
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

struct GfxThreadData {
    device: Arc<crate::wgpu::Device>,
    queue: Arc<crate::wgpu::Queue>,
    channels: GfxThreadChannels,
    shared_data: Arc<SharedData>,
    resolution_scale_shift: u8,
    frame_data_rx: triple_buffer::Receiver<FrameData>,

    output_attachments: OutputAttachments,

    fb_texture: crate::wgpu::Texture,
    fb_scanline_flags_buffer: crate::wgpu::Buffer,
    fb_data_bg_layout: crate::wgpu::BindGroupLayout,
    fb_data_bg: crate::wgpu::BindGroup,

    renderer_3d_data: Renderer3dGfxThreadData,
    renderer_3d_data_rx: crossbeam_channel::Receiver<Renderer3dUpdateGfxThreadData>,
    color_output_3d_view: crate::wgpu::TextureView,
    color_output_3d_bg_layout: crate::wgpu::BindGroupLayout,
    color_output_3d_bg: crate::wgpu::BindGroup,

    pipeline: crate::wgpu::RenderPipeline,
}

impl GfxThreadData {
    fn create_pipeline_and_output_3d_bg_layout(
        device: &crate::wgpu::Device,
        fb_data_bg_layout: &crate::wgpu::BindGroupLayout,
        accel: bool,
    ) -> (crate::wgpu::RenderPipeline, crate::wgpu::BindGroupLayout) {
        let color_output_3d_bg_layout =
            device.create_bind_group_layout(&crate::wgpu::BindGroupLayoutDescriptor {
                label: Some("2D renderer 3D output"),
                entries: &[crate::wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: crate::wgpu::ShaderStages::FRAGMENT,
                    ty: crate::wgpu::BindingType::Texture {
                        sample_type: if accel {
                            crate::wgpu::TextureSampleType::Float { filterable: true }
                        } else {
                            crate::wgpu::TextureSampleType::Uint
                        },
                        view_dimension: crate::wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                }],
            });

        let pipeline_layout =
            device.create_pipeline_layout(&crate::wgpu::PipelineLayoutDescriptor {
                label: Some("2D renderer"),
                bind_group_layouts: &[Some(fb_data_bg_layout), Some(&color_output_3d_bg_layout)],
                immediate_size: 0,
            });

        let shader_module = device.create_shader_module(crate::wgpu::ShaderModuleDescriptor {
            label: Some("2D renderer"),
            source: crate::wgpu::ShaderSource::Wgsl(
                if accel {
                    resource_str!("shaders/wgpu-2d-accel.wgsl", "shaders/wgpu-2d-accel.wgsl")
                } else {
                    resource_str!("shaders/wgpu-2d-soft.wgsl", "shaders/wgpu-2d-soft.wgsl")
                }
                .into(),
            ),
        });

        let pipeline = device.create_render_pipeline(&crate::wgpu::RenderPipelineDescriptor {
            label: Some("2D renderer"),
            layout: Some(&pipeline_layout),

            vertex: crate::wgpu::VertexState {
                module: &shader_module,
                entry_point: None,
                buffers: &[],
                compilation_options: Default::default(),
            },

            primitive: crate::wgpu::PrimitiveState {
                topology: crate::wgpu::PrimitiveTopology::TriangleStrip,
                strip_index_format: None,
                front_face: crate::wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: crate::wgpu::PolygonMode::Fill,
                conservative: false,
            },

            depth_stencil: None,

            multisample: crate::wgpu::MultisampleState::default(),

            fragment: Some(crate::wgpu::FragmentState {
                module: &shader_module,
                entry_point: None,
                targets: &[Some(crate::wgpu::ColorTargetState {
                    format: crate::wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: crate::wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),

            multiview_mask: None,
            cache: None,
        });

        (pipeline, color_output_3d_bg_layout)
    }

    fn create_renderer_3d_data_and_color_output_3d_view(
        device: &crate::wgpu::Device,
        update: Renderer3dUpdateGfxThreadData,
    ) -> (Renderer3dGfxThreadData, crate::wgpu::TextureView) {
        match update {
            #[cfg(not(feature = "threaded"))]
            Renderer3dUpdateGfxThreadData::LocalAccel {
                color_output_view,
                new_color_output_view,
            } => (
                Renderer3dGfxThreadData::LocalAccel {
                    new_color_output_view,
                },
                color_output_view,
            ),
            Renderer3dUpdateGfxThreadData::Soft => {
                let color_output_texture = device.create_texture(&crate::wgpu::TextureDescriptor {
                    label: Some("2D renderer 3D output"),
                    size: crate::wgpu::Extent3d {
                        width: SCREEN_WIDTH as u32,
                        height: SCREEN_HEIGHT as u32,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: crate::wgpu::TextureDimension::D2,
                    format: crate::wgpu::TextureFormat::R32Uint,
                    usage: crate::wgpu::TextureUsages::COPY_DST
                        | crate::wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                });
                let color_output_view = color_output_texture.create_view(&Default::default());
                (
                    Renderer3dGfxThreadData::Soft {
                        color_output_texture,
                    },
                    color_output_view,
                )
            }
            Renderer3dUpdateGfxThreadData::Accel {
                color_output_view,
                color_output_view_rx,
                last_submitted_frame,
            } => {
                *last_submitted_frame.1.write() = Some(thread::current());
                (
                    Renderer3dGfxThreadData::Accel {
                        color_output_view_rx,
                        last_submitted_frame,
                    },
                    color_output_view,
                )
            }
        }
    }

    fn create_output_3d_bg(
        device: &crate::wgpu::Device,
        color_output_3d_bg_layout: &crate::wgpu::BindGroupLayout,
        color_output_3d_view: &crate::wgpu::TextureView,
    ) -> crate::wgpu::BindGroup {
        device.create_bind_group(&crate::wgpu::BindGroupDescriptor {
            label: Some("2D renderer 3D output"),
            layout: color_output_3d_bg_layout,
            entries: &[crate::wgpu::BindGroupEntry {
                binding: 0,
                resource: crate::wgpu::BindingResource::TextureView(color_output_3d_view),
            }],
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn new(
        device: Arc<crate::wgpu::Device>,
        queue: Arc<crate::wgpu::Queue>,
        shared_data: Arc<SharedData>,
        channels: GfxThreadChannels,
        resolution_scale_shift: u8,
        frame_data_rx: triple_buffer::Receiver<FrameData>,
        renderer_3d_data: Renderer3dUpdateGfxThreadData,
        renderer_3d_data_rx: crossbeam_channel::Receiver<Renderer3dUpdateGfxThreadData>,
    ) -> (Self, crate::wgpu::TextureView) {
        let fb_texture = device.create_texture(&crate::wgpu::TextureDescriptor {
            label: Some("2D renderer framebuffer texture"),
            size: crate::wgpu::Extent3d {
                width: SCREEN_WIDTH as u32,
                height: (SCREEN_HEIGHT * 2) as u32,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: crate::wgpu::TextureDimension::D2,
            format: crate::wgpu::TextureFormat::Rg32Uint,
            usage: crate::wgpu::TextureUsages::COPY_DST
                | crate::wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let fb_texture_view = fb_texture.create_view(&Default::default());

        let fb_scanline_flags_buffer = device.create_buffer(&crate::wgpu::BufferDescriptor {
            label: Some("2D renderer framebuffer scanline flags"),
            size: (SCREEN_HEIGHT * 2 * 16) as u64,
            usage: crate::wgpu::BufferUsages::UNIFORM | crate::wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let fb_data_bg_layout =
            device.create_bind_group_layout(&crate::wgpu::BindGroupLayoutDescriptor {
                label: Some("2D renderer framebuffer texture"),
                entries: &[
                    crate::wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: crate::wgpu::ShaderStages::FRAGMENT,
                        ty: crate::wgpu::BindingType::Texture {
                            sample_type: crate::wgpu::TextureSampleType::Uint,
                            view_dimension: crate::wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    crate::wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: crate::wgpu::ShaderStages::FRAGMENT,
                        ty: crate::wgpu::BindingType::Buffer {
                            ty: crate::wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: NonZeroU64::new((SCREEN_HEIGHT * 2 * 16) as u64),
                        },
                        count: None,
                    },
                ],
            });
        let fb_data_bg = device.create_bind_group(&crate::wgpu::BindGroupDescriptor {
            label: Some("2D renderer framebuffer texture"),
            layout: &fb_data_bg_layout,
            entries: &[
                crate::wgpu::BindGroupEntry {
                    binding: 0,
                    resource: crate::wgpu::BindingResource::TextureView(&fb_texture_view),
                },
                crate::wgpu::BindGroupEntry {
                    binding: 1,
                    resource: crate::wgpu::BindingResource::Buffer(crate::wgpu::BufferBinding {
                        buffer: &fb_scanline_flags_buffer,
                        offset: 0,
                        size: NonZeroU64::new((SCREEN_HEIGHT * 2 * 16) as u64),
                    }),
                },
            ],
        });

        let (output_attachments, color_output_view) =
            OutputAttachments::new(&device, resolution_scale_shift);

        let (pipeline, color_output_3d_bg_layout) = Self::create_pipeline_and_output_3d_bg_layout(
            &device,
            &fb_data_bg_layout,
            !matches!(renderer_3d_data, Renderer3dUpdateGfxThreadData::Soft),
        );

        let (renderer_3d_data, color_output_3d_view) =
            Self::create_renderer_3d_data_and_color_output_3d_view(&device, renderer_3d_data);

        let color_output_3d_bg =
            Self::create_output_3d_bg(&device, &color_output_3d_bg_layout, &color_output_3d_view);

        (
            GfxThreadData {
                device,
                queue,
                channels,
                shared_data,
                resolution_scale_shift,
                frame_data_rx,

                output_attachments,

                fb_texture,
                fb_scanline_flags_buffer,
                fb_data_bg_layout,
                fb_data_bg,

                renderer_3d_data,
                renderer_3d_data_rx,
                color_output_3d_view,
                color_output_3d_bg_layout,
                color_output_3d_bg,

                pipeline,
            },
            color_output_view,
        )
    }

    #[cfg(feature = "threaded")]
    fn run(mut self) {
        loop {
            if self.shared_data.stopped.load(Ordering::Relaxed) {
                break;
            }
            if !self.render_pending() {
                thread::park();
            }
        }
    }

    fn render_pending(&mut self) -> bool {
        if let Ok(frame) = self.frame_data_rx.get() {
            let resolution_scale_shift = self
                .shared_data
                .resolution_scale_shift
                .load(Ordering::Relaxed);
            if resolution_scale_shift != self.resolution_scale_shift {
                self.resolution_scale_shift = resolution_scale_shift;
                let (output_attachments, color_output_view) =
                    OutputAttachments::new(&self.device, resolution_scale_shift);
                self.output_attachments = output_attachments;
                self.channels.set_color_output_view(color_output_view);
            }

            if let Some(renderer_3d_data) = self.renderer_3d_data_rx.try_iter().last() {
                (self.pipeline, self.color_output_3d_bg_layout) =
                    Self::create_pipeline_and_output_3d_bg_layout(
                        &self.device,
                        &self.fb_data_bg_layout,
                        !matches!(renderer_3d_data, Renderer3dUpdateGfxThreadData::Soft),
                    );

                (self.renderer_3d_data, self.color_output_3d_view) =
                    Self::create_renderer_3d_data_and_color_output_3d_view(
                        &self.device,
                        renderer_3d_data,
                    );

                self.color_output_3d_bg = Self::create_output_3d_bg(
                    &self.device,
                    &self.color_output_3d_bg_layout,
                    &self.color_output_3d_view,
                );
            }

            if frame.engine_3d_enabled {
                match &mut self.renderer_3d_data {
                    #[cfg(not(feature = "threaded"))]
                    Renderer3dGfxThreadData::LocalAccel {
                        new_color_output_view,
                    } => {
                        self.color_output_3d_view = new_color_output_view();
                        self.color_output_3d_bg = Self::create_output_3d_bg(
                            &self.device,
                            &self.color_output_3d_bg_layout,
                            &self.color_output_3d_view,
                        );
                    }
                    Renderer3dGfxThreadData::Soft { .. } => {}
                    Renderer3dGfxThreadData::Accel {
                        color_output_view_rx,
                        ..
                    } => {
                        if let Some(color_output_view_3d) = color_output_view_rx.try_iter().last() {
                            self.color_output_3d_view = color_output_view_3d;
                            self.color_output_3d_bg = Self::create_output_3d_bg(
                                &self.device,
                                &self.color_output_3d_bg_layout,
                                &self.color_output_3d_view,
                            );
                        }
                    }
                }
            }

            if let Renderer3dGfxThreadData::Soft {
                color_output_texture: output_texture,
            } = &self.renderer_3d_data
            {
                self.queue.write_texture(
                    output_texture.as_image_copy(),
                    unsafe {
                        slice::from_raw_parts(
                            frame.output_3d.as_ptr() as *const u8,
                            SCREEN_WIDTH * SCREEN_HEIGHT * 4,
                        )
                    },
                    crate::wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some((SCREEN_WIDTH * 4) as u32),
                        rows_per_image: None,
                    },
                    crate::wgpu::Extent3d {
                        width: SCREEN_WIDTH as u32,
                        height: SCREEN_HEIGHT as u32,
                        depth_or_array_layers: 1,
                    },
                );
            }

            self.queue.write_texture(
                self.fb_texture.as_image_copy(),
                unsafe {
                    slice::from_raw_parts(
                        frame.framebuffer.as_ptr() as *const u8,
                        SCREEN_WIDTH * SCREEN_HEIGHT * 2 * 8,
                    )
                },
                crate::wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some((SCREEN_WIDTH * 8) as u32),
                    rows_per_image: None,
                },
                crate::wgpu::Extent3d {
                    width: SCREEN_WIDTH as u32,
                    height: (SCREEN_HEIGHT * 2) as u32,
                    depth_or_array_layers: 1,
                },
            );
            self.queue
                .write_buffer(&self.fb_scanline_flags_buffer, 0, unsafe {
                    slice::from_raw_parts(
                        frame.fb_scanline_flags.as_ptr() as *const u8,
                        SCREEN_HEIGHT * 2 * 16,
                    )
                });

            let mut command_encoder =
                self.device
                    .create_command_encoder(&crate::wgpu::CommandEncoderDescriptor {
                        label: Some("2D renderer command encoder"),
                    });

            let mut render_pass =
                command_encoder.begin_render_pass(&crate::wgpu::RenderPassDescriptor {
                    label: Some("2D renderer render pass"),
                    color_attachments: &[Some(crate::wgpu::RenderPassColorAttachment {
                        view: &self.output_attachments.color_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: crate::wgpu::Operations {
                            load: crate::wgpu::LoadOp::Clear(crate::wgpu::Color::BLACK),
                            store: crate::wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });

            render_pass.set_bind_group(0, &self.fb_data_bg, &[]);
            render_pass.set_bind_group(1, &self.color_output_3d_bg, &[]);
            render_pass.set_pipeline(&self.pipeline);
            render_pass.draw(0..4, 0..1);

            drop(render_pass);

            // TODO: Proper synchronization
            // if let Renderer3dGfxThreadData::Accel {
            //     last_submitted_frame,
            //     ..
            // } = &self.renderer_3d_data
            // {
            //     while last_submitted_frame.0.load(Ordering::Relaxed) < frame.frame_index {
            //         if self.shared_data.stopped.load(Ordering::Relaxed) {
            //             return;
            //         }
            //         thread::park_timeout(Duration::from_millis(1));
            //     }
            // }

            self.queue.submit([command_encoder.finish()]);
            self.shared_data
                .submitted_frames
                .fetch_add(1, Ordering::Release);
            true
        } else {
            false
        }
    }
}
