//! Machines as Bevy plugins: the [`Machine`] lives in the world as the non-send [`MachineSlot`],
//! `run_frame` runs in a fixed-timestep system at `Machine::refresh_rate()`, `screens()` are
//! uploaded to one Bevy `Image` shown by a letterboxed sprite, input comes from [`EngineInput`] and
//! audio feeds a Bevy audio sink.
//!
//! The systems are registered once by [`MachineRuntimePlugin`] (added by `BunEnginePlugin`) and
//! run only while a machine is installed, so hosts can launch, suspend, resume and switch
//! machines at runtime: [`InsertMachine`] / [`RemoveMachine`] commands, or [`MachineWorldExt`]
//! from exclusive systems. Suspend is [`MachineStatus::paused`].

use std::{io::Write as _, path::PathBuf, sync::Mutex};

use crate::bevy::{
    app::{App, AppExit, FixedUpdate, Last, Plugin, Update},
    ecs::{prelude::*, schedule::ScheduleLabel, system::Command},
    time::{Fixed, Time},
};

use super::{EngineExit, EngineInput, EngineMode, EngineSystems};
use crate::machine::{Machine, Screen, Step};

#[cfg(feature = "nds-gpu")]
#[path = "machine_gpu.rs"]
mod gpu;

/// The running machine (non-send: cores own raw pointers and JIT state).
pub struct MachineSlot(pub Box<dyn Machine>);

/// Progress and control of the running machine; present exactly while a machine is installed.
#[derive(Resource, Clone, Debug)]
pub struct MachineStatus {
    pub name: &'static str,
    /// Frames completed (`Step::Frame`).
    pub frames: u64,
    pub last: Option<Step>,
    /// Simulation paused (menu, platform overlay, suspended game); presentation continues.
    pub paused: bool,
    /// Exit the app after this many frames (`--frames`).
    pub frame_limit: Option<u64>,
    /// Write the final screens here as `screen<i>.ppm` when the app exits (`--out`).
    pub out: Option<PathBuf>,
    /// Echo `Machine::console` output to stdout.
    pub echo_console: bool,
    /// Exit the app when the machine shuts down (CLI); hosts that switch games set `false`.
    pub exit_on_stop: bool,
    pub refresh_rate: f64,
    /// The machine shut down or failed; no more frames run.
    pub stopped: bool,
}

/// Write the machine state (`Machine::save_state`) to `path`.
#[derive(Message, Clone, Debug)]
pub struct SaveState {
    pub path: PathBuf,
}

/// Restore the machine state (`Machine::load_state`) from `path`.
#[derive(Message, Clone, Debug)]
pub struct LoadState {
    pub path: PathBuf,
}

/// Result of a [`SaveState`] or [`LoadState`].
#[derive(Message, Clone, Debug)]
pub enum MachineStateResult {
    Saved(Result<PathBuf, String>),
    Loaded(Result<PathBuf, String>),
}

/// Machine lifecycle reported to hosts.
#[derive(Message, Clone, Debug)]
pub enum MachineEvent {
    Inserted(&'static str),
    /// An [`InsertMachine`] factory failed.
    Failed(String),
    Removed(&'static str),
    /// `run_frame` returned `Step::Shutdown`.
    Shutdown(&'static str),
}

/// How a machine is installed.
#[derive(Clone, Copy, Debug)]
pub struct MachineOptions {
    /// Spawn the letterboxed sprite showing `MachineScreen` on the engine camera.
    pub spawn_view: bool,
    /// See [`MachineStatus::exit_on_stop`].
    pub exit_on_stop: bool,
    /// Start paused (resume by clearing [`MachineStatus::paused`]).
    pub paused: bool,
}

impl Default for MachineOptions {
    fn default() -> Self {
        Self {
            spawn_view: true,
            exit_on_stop: true,
            paused: false,
        }
    }
}

/// Registers the machine systems once; they run while a machine is installed.
pub struct MachineRuntimePlugin;

impl Plugin for MachineRuntimePlugin {
    fn build(&self, app: &mut App) {
        let mode = app
            .world()
            .get_resource::<EngineMode>()
            .copied()
            .unwrap_or(EngineMode::Windowed);
        app.init_resource::<EngineInput>()
            .init_resource::<EngineExit>()
            .add_message::<SaveState>()
            .add_message::<LoadState>()
            .add_message::<MachineStateResult>()
            .add_message::<MachineEvent>()
            .add_systems(Update, save_load.run_if(resource_exists::<MachineStatus>))
            .add_systems(
                Last,
                write_out_on_exit.run_if(resource_exists::<MachineStatus>),
            );
        let schedule = match mode {
            EngineMode::Windowed => FixedUpdate.intern(),
            EngineMode::Headless => Update.intern(),
        };
        app.configure_sets(schedule, EngineSystems::Machine)
            .add_systems(
                schedule,
                run_machine
                    .in_set(EngineSystems::Machine)
                    .run_if(resource_exists::<MachineStatus>),
            );
        #[cfg(feature = "render")]
        if mode == EngineMode::Windowed {
            view::register(app);
        }
        #[cfg(feature = "audio")]
        if mode == EngineMode::Windowed {
            super::audio::register(app);
        }
    }
}

type Factory = Box<dyn FnOnce() -> Result<Box<dyn Machine>, String> + Send>;

/// Runs one machine in the app. Build it from a factory ([`MachinePlugin::new`]), from a named
/// machine plugin (`NesPlugin`, ...) or insert a built machine with [`MachineAppExt`].
pub struct MachinePlugin {
    factory: Mutex<Option<Factory>>,
    pub options: MachineOptions,
}

impl MachinePlugin {
    pub fn new(
        factory: impl FnOnce() -> Result<Box<dyn Machine>, String> + Send + 'static,
    ) -> Self {
        Self {
            factory: Mutex::new(Some(Box::new(factory))),
            options: MachineOptions::default(),
        }
    }

    pub fn without_view(mut self) -> Self {
        self.options.spawn_view = false;
        self
    }
}

impl Plugin for MachinePlugin {
    fn build(&self, app: &mut App) {
        let Some(factory) = self.factory.lock().unwrap().take() else {
            return;
        };
        match factory() {
            Ok(machine) => {
                ensure_runtime(app);
                app.world_mut().insert_machine_with(machine, self.options);
            }
            Err(e) => {
                app.init_resource::<EngineExit>();
                app.world_mut().resource_mut::<EngineExit>().fail(e);
                app.add_systems(
                    crate::bevy::app::Startup,
                    |mut exit: MessageWriter<AppExit>| {
                        exit.write(AppExit::error());
                    },
                );
            }
        }
    }
}

fn ensure_runtime(app: &mut App) {
    if !app.is_plugin_added::<MachineRuntimePlugin>() {
        app.add_plugins(MachineRuntimePlugin);
    }
}

/// Insert an already-built machine at app build time.
pub trait MachineAppExt {
    fn insert_machine(&mut self, machine: Box<dyn Machine>) -> &mut Self;
    /// Same, without the sprite (hosts that show `MachineScreen` in their own UI).
    fn insert_machine_without_view(&mut self, machine: Box<dyn Machine>) -> &mut Self;
}

impl MachineAppExt for App {
    fn insert_machine(&mut self, machine: Box<dyn Machine>) -> &mut Self {
        ensure_runtime(self);
        self.world_mut()
            .insert_machine_with(machine, MachineOptions::default());
        self
    }

    fn insert_machine_without_view(&mut self, machine: Box<dyn Machine>) -> &mut Self {
        ensure_runtime(self);
        self.world_mut().insert_machine_with(
            machine,
            MachineOptions {
                spawn_view: false,
                ..Default::default()
            },
        );
        self
    }
}

/// Install or remove the machine from an exclusive system or a command (main thread).
pub trait MachineWorldExt {
    /// Replace the running machine (if any) with `machine`.
    fn insert_machine_with(&mut self, machine: Box<dyn Machine>, options: MachineOptions);
    /// Remove the running machine with its picture and audio sink; returns it.
    fn remove_machine(&mut self) -> Option<Box<dyn Machine>>;
}

impl MachineWorldExt for World {
    fn insert_machine_with(&mut self, mut machine: Box<dyn Machine>, options: MachineOptions) {
        self.remove_machine();
        let mode = self
            .get_resource::<EngineMode>()
            .copied()
            .unwrap_or(EngineMode::Windowed);
        let refresh = machine.refresh_rate().clamp(1.0, 1000.0);
        let name = machine.name();
        if mode == EngineMode::Windowed {
            match self.get_resource_mut::<Time<Fixed>>() {
                Some(mut time) => time.set_timestep_hz(refresh),
                None => self.insert_resource(Time::<Fixed>::from_hz(refresh)),
            }
        }
        #[cfg(feature = "render")]
        if mode == EngineMode::Windowed {
            view::install(self, &mut *machine, options.spawn_view);
        }
        #[cfg(feature = "audio")]
        if mode == EngineMode::Windowed && machine.sample_rate() > 0 {
            super::audio::install(self, machine.sample_rate());
        }
        self.insert_resource(MachineStatus {
            name,
            frames: 0,
            last: None,
            paused: options.paused,
            frame_limit: None,
            out: None,
            echo_console: true,
            exit_on_stop: options.exit_on_stop,
            refresh_rate: refresh,
            stopped: false,
        });
        self.insert_non_send(MachineSlot(machine));
        self.write_message(MachineEvent::Inserted(name));
    }

    fn remove_machine(&mut self) -> Option<Box<dyn Machine>> {
        let slot = self.remove_non_send::<MachineSlot>()?;
        self.remove_resource::<MachineStatus>();
        #[cfg(feature = "render")]
        view::uninstall(self);
        #[cfg(feature = "audio")]
        super::audio::uninstall(self);
        self.write_message(MachineEvent::Removed(slot.0.name()));
        Some(slot.0)
    }
}

/// Command: build a machine from a `Send` factory on the main thread and install it, replacing
/// the running one. Failures are reported as [`MachineEvent::Failed`].
pub struct InsertMachine {
    factory: Factory,
    pub options: MachineOptions,
}

impl InsertMachine {
    /// Defaults for hosts: the app keeps running when the machine shuts down.
    pub fn new(
        factory: impl FnOnce() -> Result<Box<dyn Machine>, String> + Send + 'static,
    ) -> Self {
        Self {
            factory: Box::new(factory),
            options: MachineOptions {
                exit_on_stop: false,
                ..Default::default()
            },
        }
    }

    pub fn with_options(mut self, options: MachineOptions) -> Self {
        self.options = options;
        self
    }
}

impl Command for InsertMachine {
    type Out = ();

    fn apply(self, world: &mut World) {
        match (self.factory)() {
            Ok(machine) => world.insert_machine_with(machine, self.options),
            Err(e) => {
                world.write_message(MachineEvent::Failed(e));
            }
        }
    }
}

/// Command: remove the running machine.
pub struct RemoveMachine;

impl Command for RemoveMachine {
    type Out = ();

    fn apply(self, world: &mut World) {
        world.remove_machine();
    }
}

fn flush_console(machine: &mut dyn Machine) {
    let out = machine.console();
    if !out.is_empty() {
        let _ = std::io::stdout().write_all(&out);
    }
}

/// `FixedUpdate` (or `Update` headless): one `Machine::run_frame`.
fn run_machine(
    slot: Option<NonSendMut<MachineSlot>>,
    input: Res<EngineInput>,
    mut status: ResMut<MachineStatus>,
    mut exit: MessageWriter<AppExit>,
    mut events: MessageWriter<MachineEvent>,
    #[cfg(feature = "audio")] audio: Option<Res<super::audio::MachineAudioQueue>>,
) {
    let Some(mut slot) = slot else { return };
    if status.stopped {
        return;
    }
    let machine = &mut *slot.0;
    machine.set_input(input.machine());
    if status.paused {
        return;
    }
    let step = machine.run_frame();
    status.last = Some(step);
    match step {
        Step::Frame => status.frames += 1,
        Step::Shutdown => {
            status.stopped = true;
            events.write(MachineEvent::Shutdown(status.name));
            if status.exit_on_stop {
                exit.write(AppExit::Success);
            }
        }
        Step::Stopped => {}
    }
    if status.echo_console {
        flush_console(machine);
    }
    #[cfg(feature = "audio")]
    if let Some(audio) = audio {
        audio.drain_from(machine);
    }
    if status
        .frame_limit
        .is_some_and(|limit| status.frames >= limit)
    {
        status.stopped = true;
        exit.write(AppExit::Success);
    }
}

fn save_load(
    slot: Option<NonSendMut<MachineSlot>>,
    mut saves: MessageReader<SaveState>,
    mut loads: MessageReader<LoadState>,
    mut results: MessageWriter<MachineStateResult>,
) {
    let Some(mut slot) = slot else { return };
    for SaveState { path } in saves.read() {
        let result = slot
            .0
            .save_state()
            .ok_or_else(|| format!("{} has no save states", slot.0.name()))
            .and_then(|state| {
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                std::fs::write(path, state).map_err(|e| format!("{}: {e}", path.display()))
            })
            .map(|()| path.clone());
        results.write(MachineStateResult::Saved(result));
    }
    for LoadState { path } in loads.read() {
        let result = std::fs::read(path)
            .map_err(|e| format!("{}: {e}", path.display()))
            .and_then(|state| slot.0.load_state(&state))
            .map(|()| path.clone());
        results.write(MachineStateResult::Loaded(result));
    }
}

/// `Last`: on exit, flush and write the final screens (`--out`).
pub(crate) fn write_out_on_exit(
    mut exits: MessageReader<AppExit>,
    slot: Option<NonSendMut<MachineSlot>>,
    status: Res<MachineStatus>,
    mut engine_exit: ResMut<EngineExit>,
    mut done: Local<bool>,
) {
    if *done || exits.read().next().is_none() {
        return;
    }
    *done = true;
    let Some(mut slot) = slot else { return };
    flush_console(&mut *slot.0);
    if let Some(dir) = status.out.as_ref()
        && let Err(e) = crate::machine::write_screens(dir, &slot.0.screens())
    {
        engine_exit.fail(format!("{}: {e}", dir.display()));
    }
}

/// Stack every screen vertically into one RGBA8 picture of `size`.
pub fn compose_rgba(screens: &[Screen], size: (u32, u32), out: &mut Vec<u8>) {
    out.clear();
    out.resize((size.0 * size.1 * 4) as usize, 255);
    let mut y0 = 0usize;
    for s in screens {
        for y in 0..s.height.min((size.1 as usize).saturating_sub(y0)) {
            let row = &s.rgb[y * s.width * 3..(y + 1) * s.width * 3];
            let dst = ((y0 + y) * size.0 as usize) * 4;
            for (x, px) in row.chunks_exact(3).take(size.0 as usize).enumerate() {
                out[dst + x * 4..dst + x * 4 + 3].copy_from_slice(px);
            }
        }
        y0 += s.height;
    }
}

/// Stacked size of `screens` and the height of the first one.
pub fn stacked_size(screens: &[Screen]) -> ((u32, u32), u32) {
    let width = screens.iter().map(|s| s.width).max().unwrap_or(256) as u32;
    let height = screens.iter().map(|s| s.height).sum::<usize>().max(1) as u32;
    (
        (width.max(1), height),
        screens.first().map_or(0, |s| s.height as u32),
    )
}

#[cfg(feature = "render")]
pub mod view {
    //! The machine picture: one `Image` asset, a letterboxed sprite and the DS touch point.

    use crate::bevy::{
        app::{App, PostUpdate, PreUpdate, Update},
        asset::{Assets, Handle, RenderAssetUsages},
        camera::{Camera, OrthographicProjection, Projection, ScalingMode},
        ecs::prelude::*,
        image::{Image, ImageSampler},
        input::{ButtonInput, mouse::MouseButton},
        math::{UVec2, Vec2},
        render::render_resource::{Extent3d, TextureDimension, TextureFormat},
        sprite::Sprite,
        transform::components::GlobalTransform,
        window::{PrimaryWindow, Window},
    };

    use super::{MachineSlot, MachineStatus, compose_rgba, stacked_size};
    use crate::runtime::{EngineCamera, EngineInput, EngineSystems};

    /// The machine picture: every screen stacked vertically, RGBA8 sRGB, nearest sampling.
    #[derive(Resource, Clone, Debug)]
    pub struct MachineScreen {
        pub image: Handle<Image>,
        pub size: UVec2,
        /// Height of the first screen; touches below it land on the second screen.
        pub first_height: u32,
        /// The engine shows it with a sprite (`MachineOptions::spawn_view`).
        pub spawn_view: bool,
        pub(super) presented: u64,
    }

    /// Marker of the sprite showing [`MachineScreen`].
    #[derive(Component, Clone, Copy, Debug, Default)]
    pub struct MachineView;

    pub(super) fn register(app: &mut App) {
        #[cfg(feature = "nds-gpu")]
        super::gpu::register(app);
        app.configure_sets(PostUpdate, EngineSystems::Present)
            .add_systems(Update, spawn.run_if(resource_added::<MachineScreen>))
            .add_systems(
                PostUpdate,
                present
                    .in_set(EngineSystems::Present)
                    .run_if(resource_exists::<MachineScreen>)
                    .run_if(resource_exists::<MachineStatus>),
            )
            .add_systems(
                PreUpdate,
                touch
                    .after(EngineSystems::Input)
                    .run_if(resource_exists::<MachineScreen>),
            );
    }

    pub(super) fn install(world: &mut World, machine: &mut dyn crate::machine::Machine, spawn_view: bool) {
        #[cfg(feature = "nds-gpu")]
        if machine.gpu_rendering() {
            super::gpu::install(world, machine, spawn_view);
            return;
        }
        let first = machine.screens();
        let Some(mut images) = world.get_resource_mut::<Assets<Image>>() else {
            return;
        };
        let ((w, h), first_height) = stacked_size(&first);
        let mut image = Image::new_fill(
            Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            TextureDimension::D2,
            &[0, 0, 0, 255],
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
        );
        image.sampler = ImageSampler::nearest();
        let handle = images.add(image);
        world.insert_resource(MachineScreen {
            image: handle,
            size: UVec2::new(w, h),
            first_height,
            spawn_view,
            presented: u64::MAX,
        });
    }

    pub(super) fn uninstall(world: &mut World) {
        #[cfg(feature = "nds-gpu")]
        world.remove_resource::<super::gpu::MachineGpuImage>();
        if let Some(screen) = world.remove_resource::<MachineScreen>()
            && let Some(mut images) = world.get_resource_mut::<Assets<Image>>()
        {
            images.remove(&screen.image);
        }
        let views: Vec<Entity> = world
            .query_filtered::<Entity, With<MachineView>>()
            .iter(world)
            .collect();
        for entity in views {
            world.despawn(entity);
        }
    }

    fn spawn(
        mut commands: Commands,
        screen: Res<MachineScreen>,
        mut cameras: Query<&mut Projection, With<EngineCamera>>,
        mut windows: Query<&mut Window, With<PrimaryWindow>>,
        window_size: Option<Res<crate::runtime::EngineWindowSize>>,
        mut sized: Local<bool>,
    ) {
        if !screen.spawn_view {
            return;
        }
        let size = screen.size.as_vec2();
        for mut projection in &mut cameras {
            *projection = Projection::Orthographic(OrthographicProjection {
                scaling_mode: ScalingMode::AutoMin {
                    min_width: size.x,
                    min_height: size.y,
                },
                ..OrthographicProjection::default_2d()
            });
        }
        // Twice the native size for the first machine, unless the host chose a size.
        if !*sized {
            *sized = true;
            if window_size.is_some_and(|s| !s.explicit) {
                for mut window in &mut windows {
                    window.resolution.set(size.x * 2.0, size.y * 2.0);
                }
            }
        }
        commands.spawn((
            Sprite {
                image: screen.image.clone(),
                custom_size: Some(size),
                ..Default::default()
            },
            MachineView,
        ));
    }

    /// `PostUpdate`: upload the screens when a new frame completed.
    fn present(
        slot: Option<NonSend<MachineSlot>>,
        status: Res<MachineStatus>,
        mut screen: ResMut<MachineScreen>,
        mut images: ResMut<Assets<Image>>,
        mut scratch: Local<Vec<u8>>,
    ) {
        let Some(slot) = slot else { return };
        #[cfg(feature = "nds-gpu")]
        if slot.0.gpu_rendering() {
            return;
        }
        if screen.presented == status.frames {
            return;
        }
        screen.presented = status.frames;
        let size = (screen.size.x, screen.size.y);
        compose_rgba(&slot.0.screens(), size, &mut scratch);
        if let Some(mut image) = images.get_mut(&screen.image) {
            match image.data.as_mut() {
                Some(data) if data.len() == scratch.len() => data.copy_from_slice(&scratch),
                _ => image.data = Some(scratch.clone()),
            }
        }
    }

    /// `PreUpdate`: the left mouse button on the second screen is the DS touch point.
    fn touch(
        screen: Res<MachineScreen>,
        mut input: ResMut<EngineInput>,
        buttons: Option<Res<ButtonInput<MouseButton>>>,
        windows: Query<&Window, With<PrimaryWindow>>,
        cameras: Query<(&Camera, &GlobalTransform), With<EngineCamera>>,
    ) {
        let touch = (|| {
            if !screen.spawn_view || !buttons?.pressed(MouseButton::Left) {
                return None;
            }
            let cursor = windows.single().ok()?.cursor_position()?;
            let (camera, transform) = cameras.single().ok()?;
            let world = camera.viewport_to_world_2d(transform, cursor).ok()?;
            let size = screen.size.as_vec2();
            let p = Vec2::new(world.x + size.x / 2.0, size.y / 2.0 - world.y);
            if p.x < 0.0 || p.y < screen.first_height as f32 || p.x >= size.x || p.y >= size.y {
                return None;
            }
            Some((p.x as u16, (p.y as u32 - screen.first_height) as u16))
        })();
        if input.touch != touch {
            input.touch = touch;
        }
    }

    /// The current picture as RGB8 (Steam screenshots).
    pub fn capture_rgb(slot: &MachineSlot, screen: &MachineScreen) -> (u32, u32, Vec<u8>) {
        let mut rgba = Vec::new();
        compose_rgba(&slot.0.screens(), (screen.size.x, screen.size.y), &mut rgba);
        (
            screen.size.x,
            screen.size.y,
            rgba.chunks_exact(4)
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect(),
        )
    }
}

#[cfg(feature = "render")]
pub use view::{MachineScreen, MachineView};

macro_rules! machine_plugin {
    ($(#[$meta:meta])* $name:ident ($($field:ident : $ty:ty),*) => |$($arg:ident),*| $build:expr) => {
        $(#[$meta])*
        pub struct $name {
            $(pub $field: $ty,)*
            pub spawn_view: bool,
        }

        impl $name {
            pub fn new($($field: impl Into<$ty>),*) -> Self {
                Self { $($field: $field.into(),)* spawn_view: true }
            }

            fn factory(&self) -> impl FnOnce() -> Result<Box<dyn Machine>, String> + Send + 'static {
                $(let $arg = self.$arg.clone();)*
                move || $build.map(|m| Box::new(m) as Box<dyn Machine>)
            }

            /// The [`MachinePlugin`] building this machine when the app is built.
            pub fn machine_plugin(&self) -> MachinePlugin {
                let plugin = MachinePlugin::new(self.factory());
                if self.spawn_view { plugin } else { plugin.without_view() }
            }

            /// The command launching this machine at runtime (`commands.queue(...)`), replacing
            /// the running one.
            pub fn command(&self) -> InsertMachine {
                let command = InsertMachine::new(self.factory());
                let options = MachineOptions { spawn_view: self.spawn_view, ..command.options };
                command.with_options(options)
            }
        }

        impl Plugin for $name {
            fn build(&self, app: &mut App) {
                self.machine_plugin().build(app);
            }
        }
    };
}

#[cfg(feature = "nes")]
machine_plugin!(
    /// NES on TetaNES.
    NesPlugin(name: String, rom: Vec<u8>) => |name, rom| crate::machine::nes::Nes::from_rom(&name, &rom)
);
#[cfg(feature = "gba")]
machine_plugin!(
    /// Game Boy Advance on RustBoyAdvance-NG; `bios` empty selects the free BIOS.
    GbaPlugin(rom: Vec<u8>, bios: Vec<u8>) => |rom, bios| crate::machine::gba::Gba::from_rom(&rom, (!bios.is_empty()).then_some(&bios[..]))
);
#[cfg(feature = "nds")]
machine_plugin!(
    /// Nintendo DS on Dust.
    NdsPlugin(rom: Vec<u8>) => |rom| crate::machine::handheld::HandheldMachine::from_image("rom", &rom)
);
#[cfg(feature = "psx")]
machine_plugin!(
    /// PlayStation on StarPSX.
    PsxPlugin(bios: Vec<u8>, disc: Vec<u8>) => |bios, disc| crate::machine::psx::Psx::new(&bios, &disc)
);
#[cfg(feature = "wii")]
machine_plugin!(
    /// Wii DOL on the Broadway interpreter.
    WiiPlugin(dol: Vec<u8>) => |dol| crate::machine::wii::WiiMachine::wii_dol(&dol)
);
#[cfg(feature = "wii")]
machine_plugin!(
    /// GameCube DOL on the Gekko interpreter.
    GameCubePlugin(dol: Vec<u8>) => |dol| crate::machine::wii::WiiMachine::gamecube_dol(&dol)
);
#[cfg(feature = "arm")]
machine_plugin!(
    /// AArch64 firmware on the rdynarmic JIT (128 MiB RAM).
    ArmPlugin(image: Vec<u8>) => |image| crate::machine::arm::ArmFirmware::from_image(&image, 128)
);
#[cfg(feature = "ctr")]
machine_plugin!(
    /// Nintendo 3DS on Zakuro.
    CtrPlugin(path: PathBuf, image: Vec<u8>) => |path, image| crate::machine::handheld::HandheldMachine::from_image(path.file_stem().and_then(|s| s.to_str()).unwrap_or("title"), &image)
);
#[cfg(feature = "switch")]
machine_plugin!(
    /// Nintendo Switch on Ruzu.
    SwitchPlugin(path: String) => |path| crate::machine::switch::Switch::from_path(&path)
);
#[cfg(all(windows, feature = "x86"))]
machine_plugin!(
    /// x86 image on the Windows Hypervisor Platform (128 MiB RAM).
    X86Plugin(image: Vec<u8>) => |image| crate::machine::x86::X86::from_image(&image, 128)
);
#[cfg(all(windows, feature = "x86"))]
machine_plugin!(
    /// Linux kernel on the Windows Hypervisor Platform (256 MiB RAM).
    LinuxPlugin(kernel: Vec<u8>, cmdline: String) => |kernel, cmdline| crate::machine::x86::X86::from_linux(&kernel, &cmdline, 256)
);
