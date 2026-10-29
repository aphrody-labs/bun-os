//! Present machine-owned textures through the existing Bevy sprite and render device.
//! Only GPU handles cross extraction; the emulator output is never read back or uploaded.

use crate::bevy::{
    app::{App, PostUpdate},
    asset::{AssetEvent, Assets, Handle, RenderAssetUsages},
    ecs::prelude::*,
    image::{Image, ImageSampler, ImageSamplerDescriptor},
    math::UVec2,
    render::{
        Extract, ExtractSchedule, Render, RenderApp, RenderSystems,
        render_asset::RenderAssets,
        render_resource::{Extent3d, TextureDimension, TextureFormat},
        renderer::RenderDevice,
        texture::GpuImage,
    },
    sprite_render::SpriteAssetEvents,
};

use super::{MachineSlot, MachineStatus, view::MachineScreen};
use crate::{machine::{GpuFrame, Machine}, runtime::EngineSystems};

/// Sprite image metadata and the authoritative texture created by the machine on Bevy's device.
#[derive(Resource, Clone)]
pub(super) struct MachineGpuImage {
    image: Handle<Image>,
    gpu: GpuImage,
    /// Counts actual 2D and 3D renderer submissions, not sprite refreshes.
    pub submitted_frames: u64,
}

pub(super) fn register(app: &mut App) {
    app.add_systems(
        PostUpdate,
        present
            .in_set(EngineSystems::Present)
            .run_if(resource_exists::<MachineScreen>)
            .run_if(resource_exists::<MachineStatus>),
    );
    if let Some(render) = app.get_sub_app_mut(RenderApp) {
        render
            .add_systems(ExtractSchedule, extract)
            .add_systems(
                Render,
                prepare
                    .after(RenderSystems::PrepareAssets)
                    .before(RenderSystems::Queue),
            );
    }
}

fn gpu_image(frame: GpuFrame, image: &Image, device: &RenderDevice) -> GpuImage {
    GpuImage {
        texture: frame.texture.into(),
        texture_view: frame.view.into(),
        sampler: device.create_sampler(&ImageSamplerDescriptor::nearest().as_wgpu()),
        texture_descriptor: image.texture_descriptor.clone(),
        texture_view_descriptor: None,
        had_data: false,
    }
}

pub(super) fn install(world: &mut World, machine: &mut dyn Machine, spawn_view: bool) {
    let Some(frame) = machine.gpu_frame() else { return };
    let size = UVec2::new(frame.width, frame.height);
    let submitted_frames = frame.submitted_frames;
    // The asset supplies sprite dimensions only. MAIN_WORLD prevents Bevy's normal image
    // preparation from allocating a second texture; `prepare` installs the actual GPU asset.
    let mut image = Image::new_uninit(
        Extent3d { width: size.x, height: size.y, depth_or_array_layers: 1 },
        TextureDimension::D2,
        TextureFormat::Rgba8Unorm,
        RenderAssetUsages::MAIN_WORLD,
    );
    image.texture_descriptor.usage = frame.texture.usage();
    image.sampler = ImageSampler::nearest();
    let gpu = gpu_image(frame, &image, world.resource::<RenderDevice>());
    let handle = world.resource_mut::<Assets<Image>>().add(image);
    world.insert_resource(MachineGpuImage { image: handle.clone(), gpu, submitted_frames });
    world.insert_resource(MachineScreen {
        image: handle,
        size,
        first_height: size.y / 2,
        spawn_view,
        presented: u64::MAX,
    });
}

fn present(
    slot: Option<NonSendMut<MachineSlot>>,
    status: Res<MachineStatus>,
    mut screen: ResMut<MachineScreen>,
    gpu: Option<ResMut<MachineGpuImage>>,
) {
    let (Some(mut slot), Some(mut gpu)) = (slot, gpu) else { return };
    if screen.presented == status.frames || !slot.0.gpu_rendering() { return; }
    let Some(frame) = slot.0.gpu_frame() else { return };
    // The GPU constructor fixes resolution for a session. Never reinterpret a differently
    // sized/typed texture as the existing sprite asset.
    if frame.width != screen.size.x || frame.height != screen.size.y
        || frame.texture.format() != TextureFormat::Rgba8Unorm
    { return; }
    screen.presented = status.frames;
    gpu.submitted_frames = frame.submitted_frames;
    gpu.gpu.texture = frame.texture.into();
    gpu.gpu.texture_view = frame.view.into();
}

fn extract(
    mut commands: Commands,
    source: Extract<Option<Res<MachineGpuImage>>>,
) {
    match source.as_ref() {
        Some(source) => { commands.insert_resource((**source).clone()); }
        None => { commands.remove_resource::<MachineGpuImage>(); }
    }
}

fn prepare(
    source: Option<Res<MachineGpuImage>>,
    mut images: ResMut<RenderAssets<GpuImage>>,
    mut events: ResMut<SpriteAssetEvents>,
) {
    let Some(source) = source else { return };
    images.insert(source.image.id(), source.gpu.clone());
    // Dust may rotate output textures. Invalidate the sprite's cached bind group so it
    // samples the current view rather than a stale buffer from the previous frame.
    events.images.push(AssetEvent::Modified { id: source.image.id() });
}
