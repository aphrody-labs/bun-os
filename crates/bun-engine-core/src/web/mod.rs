//! Browser facade over the Bevy runtime (`web` feature, wasm32-unknown-unknown).
//!
//! play.aphrody.app contract (see `packages/bun-engine/web-emulation/README.md`):
//!
//! ```js
//! const mod = await import("/emulation/<core>/bun_engine.js");
//! await mod.default({ module_or_path: "/emulation/<core>/bun_engine_bg.wasm" });
//! const handle = await mod.start(canvas, rom, { system: "nds", bios });
//! handle.set_input(keys); handle.set_touch(x, y, down); handle.stop(); handle.free();
//! ```
//!
//! `start` builds the same Bevy `App` as `bun-engine run`: Bevy's web window bound to the canvas
//! (WebGPU through wgpu 30), `bevy_input` keyboard and `bevy_gilrs` gamepads folded into the
//! engine's `EngineInput`, machine audio on `bevy_audio`, frames paced by Bevy's
//! `requestAnimationFrame` loop with the machine in `FixedUpdate` at its own refresh rate. The
//! page's `set_input` bits enter as an `ExternalPads` source and `set_touch` overrides the
//! mouse-driven touch point while it is held.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU32, Ordering},
};

use js_sys::{Reflect, Uint8Array};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::HtmlCanvasElement;

use crate::bevy::{
    DefaultPlugins,
    app::{App, AppExit, Last, PluginGroup, PreUpdate, RunFixedMainLoop, RunFixedMainLoopSystems},
    ecs::prelude::*,
    image::ImagePlugin,
    window::{Window, WindowPlugin},
};
use crate::firmware::{FirmwareError, FirmwareStream};
use crate::machine::{Machine, Screen};
use crate::runtime::{
    BunEnginePlugin, EngineInput, EngineSystems, ExternalPads, MachineAppExt, MachineSlot,
    MachineStatus,
};

/// Systems compiled into this module (bun-engine ids).
#[wasm_bindgen]
pub fn systems() -> Vec<String> {
    let mut out = Vec::new();
    #[cfg(feature = "nds")]
    out.push("nds".to_owned());
    #[cfg(feature = "ctr")]
    out.push("3ds".to_owned());
    #[cfg(feature = "nes")]
    out.push("nes".to_owned());
    #[cfg(feature = "gba")]
    out.push("gba".to_owned());
    #[cfg(feature = "psx")]
    out.push("psx".to_owned());
    out
}

/// The embedded open-source firmware registry (free-firmware.json).
#[wasm_bindgen]
pub fn firmware_registry() -> String {
    crate::firmware::REGISTRY_JSON.to_owned()
}

/// Streamed firmware verification for the browser loader: `push` fetch/OPFS chunks, `finish`
/// returns the decoded bytes or throws an error naming the component.
#[wasm_bindgen]
pub struct FirmwareVerifier(Option<FirmwareStream>);

#[wasm_bindgen]
impl FirmwareVerifier {
    /// `component`: a registry id, or `undefined` for a local user-supplied file.
    #[wasm_bindgen(constructor)]
    pub fn new(component: Option<String>, file_name: Option<String>) -> Result<Self, JsError> {
        let stream = match component {
            Some(id) => FirmwareStream::registered(&id).map_err(js_error)?,
            None => FirmwareStream::user(file_name.as_deref().unwrap_or("user file")),
        };
        Ok(Self(Some(stream)))
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), JsError> {
        self.0
            .as_mut()
            .ok_or_else(|| JsError::new("verifier finished"))?
            .push(chunk)
            .map_err(js_error)
    }

    /// Decoded, verified bytes.
    pub fn finish(&mut self) -> Result<Uint8Array, JsError> {
        let stream = self
            .0
            .take()
            .ok_or_else(|| JsError::new("verifier finished"))?;
        let firmware = stream.finish().map_err(js_error)?;
        Ok(Uint8Array::from(firmware.bytes.as_slice()))
    }
}

fn js_error(e: FirmwareError) -> JsError {
    JsError::new(&e.to_string())
}

fn option<T: JsCast>(options: &JsValue, key: &str) -> Option<T> {
    Reflect::get(options, &key.into())
        .ok()
        .and_then(|v| v.dyn_into::<T>().ok())
}

/// Firmware for machines that need it: the caller's bytes (a verified free component or a
/// local user file), else an error naming the missing open-source component.
#[allow(dead_code)]
fn require_firmware(options: &JsValue, console: &str) -> Result<Vec<u8>, JsError> {
    if let Some(bios) = option::<Uint8Array>(options, "bios") {
        let mut stream = match option::<js_sys::JsString>(options, "firmware") {
            Some(id) => FirmwareStream::registered(&String::from(id)).map_err(js_error)?,
            None => FirmwareStream::user("bios"),
        };
        stream.push(&bios.to_vec()).map_err(js_error)?;
        return Ok(stream.finish().map_err(js_error)?.bytes);
    }
    Err(crate::firmware::for_console(console)
        .into_iter()
        .next()
        .map_or_else(
            || {
                JsError::new(&format!(
                    "{console} needs a BIOS and no open-source replacement is registered"
                ))
            },
            |c| {
                js_error(FirmwareError::Missing {
                    component: c.id,
                    console: c.console,
                    file: c.file,
                })
            },
        ))
}

#[allow(unused_variables)]
fn build_machine(system: &str, rom: &[u8], options: &JsValue) -> Result<Box<dyn Machine>, JsError> {
    let err = |e: String| JsError::new(&e);
    match system {
        #[cfg(feature = "nds")]
        "nds" | "nintendo-ds" => Ok(Box::new(
            crate::machine::handheld::HandheldMachine::from_image("rom", rom).map_err(err)?,
        )),
        #[cfg(feature = "ctr")]
        "3ds" | "ctr" | "nintendo-3ds" => Ok(Box::new(
            crate::machine::handheld::HandheldMachine::from_image("rom", rom).map_err(err)?,
        )),
        #[cfg(feature = "nes")]
        "nes" | "nintendo-nes" => Ok(Box::new(
            crate::machine::nes::Nes::from_rom("rom.nes", rom).map_err(err)?,
        )),
        #[cfg(feature = "gba")]
        "gba" | "nintendo-game-boy-advance" => {
            let bios = option::<Uint8Array>(options, "bios").map(|b| b.to_vec());
            Ok(Box::new(
                crate::machine::gba::Gba::from_rom(rom, bios.as_deref()).map_err(err)?,
            ))
        }
        #[cfg(feature = "psx")]
        "psx" | "sony-playstation" => {
            let bios = require_firmware(options, "sony-playstation")?;
            Ok(Box::new(
                crate::machine::psx::Psx::new(&bios, rom).map_err(err)?,
            ))
        }
        other => Err(JsError::new(&format!(
            "system `{other}` is not compiled into this module (available: {})",
            systems().join(", ")
        ))),
    }
}

/// FNV-1a 64 of the screens: a stable frame fingerprint for smoke tests.
fn fnv1a(screens: &[Screen]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for s in screens {
        for &b in &s.rgb {
            h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// State shared between the page handle and the running app.
#[derive(Default)]
struct Shared {
    keys: u32,
    touch: Option<(u16, u16)>,
    stop: bool,
    frames: u64,
    hash: u64,
    lit: bool,
    hashed_at: u64,
    started_at: f64,
    first_frame_ms: Option<f64>,
    stopped: Option<String>,
    system: &'static str,
    gpu_rendering: bool,
    gpu_submitted_frames: u64,
    gpu2d_submitted_frames: u64,
    gpu3d_submitted_frames: u64,
}

#[derive(Resource, Clone)]
struct Page(Arc<Mutex<Shared>>);

/// Keep renderer failures observable through the page handle instead of only console logs.
fn render_error(
    error: &crate::bevy::render::error_handler::RenderError,
    world: &mut World,
    _render_world: &mut World,
) -> crate::bevy::render::error_handler::RenderErrorPolicy {
    if let Some(page) = world.get_resource::<Page>() {
        page.0.lock().unwrap().stopped = Some(format!(
            "WebGPU {:?}: {}",
            error.ty, error.description,
        ));
    }
    world.write_message(AppExit::error());
    crate::bevy::render::error_handler::RenderErrorPolicy::StopRendering
}

/// Dust must be built after Bevy's asynchronous browser renderer has supplied its device.
#[cfg(feature = "nds-gpu")]
#[derive(Resource)]
struct PendingDs(Vec<u8>);

#[cfg(feature = "nds-gpu")]
fn boot_pending_ds(world: &mut World) {
    use crate::bevy::render::renderer::{RenderDevice, RenderQueue};
    use crate::runtime::{MachineOptions, MachineWorldExt};

    if !world.contains_resource::<PendingDs>() {
        return;
    }
    let (Some(device), Some(queue)) = (
        world.get_resource::<RenderDevice>(),
        world.get_resource::<RenderQueue>(),
    ) else {
        return;
    };
    let device = Arc::new(device.wgpu_device().clone());
    let queue = Arc::new((**queue).clone());
    let rom = world.remove_resource::<PendingDs>().unwrap().0;
    match crate::machine::handheld::HandheldMachine::from_nds_gpu(&rom, device, queue, 0) {
        Ok(machine) => {
            world.resource::<Page>().0.lock().unwrap().gpu_rendering = true;
            world.insert_machine_with(Box::new(machine), MachineOptions::default());
        }
        Err(error) => {
            world.resource::<Page>().0.lock().unwrap().stopped = Some(error);
            world.write_message(AppExit::error());
        }
    }
}

/// `PreUpdate`, before the engine folds its input sources: the page's buttons.
fn page_keys(page: Res<Page>, mut pads: ResMut<ExternalPads>) {
    let keys = page.0.lock().unwrap().keys;
    if pads.0.get("page").copied() != Some(keys) {
        pads.0.insert("page", keys);
    }
}

/// Between `PreUpdate` (mouse touch) and `FixedUpdate` (the machine): a held page touch wins.
fn page_touch(page: Res<Page>, mut input: ResMut<EngineInput>) {
    if let Some(touch) = page.0.lock().unwrap().touch {
        input.touch = Some(touch);
    }
}

/// `Last`: mirror progress for the page, fingerprint the screens, honour `stop()`.
fn page_status(
    page: Res<Page>,
    status: Res<MachineStatus>,
    mut slot: NonSendMut<MachineSlot>,
    mut exit: MessageWriter<AppExit>,
) {
    let mut shared = page.0.lock().unwrap();
    shared.frames = status.frames;
    #[cfg(feature = "nds-gpu")]
    {
        shared.gpu_rendering = slot.0.gpu_rendering();
        if let Some(frame) = slot.0.gpu_frame() {
            shared.gpu_submitted_frames = frame.submitted_frames;
            shared.gpu2d_submitted_frames = frame.gpu2d_submitted_frames;
            shared.gpu3d_submitted_frames = frame.gpu3d_submitted_frames;
        }
    }
    if status.frames > 0 && shared.first_frame_ms.is_none() {
        shared.first_frame_ms = Some(js_sys::Date::now() - shared.started_at);
    }
    // CPU reference images are authoritative only in software mode. GPU qualification uses
    // canvas pixels and the independent submission counter instead of stale CPU images.
    if !shared.gpu_rendering && status.frames != shared.hashed_at
        && (shared.hashed_at == 0 || status.frames - shared.hashed_at >= 15)
    {
        let screens = slot.0.screens();
        shared.hash = fnv1a(&screens);
        shared.lit = screens.iter().any(|s| s.rgb.iter().any(|&b| b > 16));
        shared.hashed_at = status.frames;
    }
    if status.stopped && shared.stopped.is_none() {
        shared.stopped = Some(
            slot.0
                .diagnostic()
                .unwrap_or_else(|| "the machine stopped".into()),
        );
    }
    if shared.stop {
        shared.stop = false;
        shared
            .stopped
            .get_or_insert_with(|| "stopped by the page".into());
        exit.write(AppExit::Success);
    }
}

static STARTED: AtomicBool = AtomicBool::new(false);
static CANVASES: AtomicU32 = AtomicU32::new(0);

/// A running machine. Returned by [`start`].
#[wasm_bindgen]
pub struct Emulator {
    shared: Arc<Mutex<Shared>>,
}

/// Boot `rom` for `options.system` in a Bevy app drawing into `canvas`.
///
/// `options`: `{ system, bios?: Uint8Array, firmware?: string, renderer?: "auto" | "gpu" | "software" }`.
/// Dust uses its GPU renderer when compiled with `nds-gpu`; `software` selects the CPU reference.
/// `firmware` names the registry
/// component `bios` must match (for example `openbios`); without it `bios` is a local user file.
/// One machine per module instance: winit cannot recreate its browser event loop, so switching
/// games means a page reload (or a fresh module instance).
#[wasm_bindgen]
pub fn start(
    canvas: HtmlCanvasElement,
    rom: Uint8Array,
    options: JsValue,
) -> Result<Emulator, JsError> {
    let started_at = js_sys::Date::now();
    let navigator = Reflect::get(&js_sys::global(), &"navigator".into())
        .unwrap_or(JsValue::UNDEFINED);
    let gpu = Reflect::get(&navigator, &"gpu".into()).unwrap_or(JsValue::UNDEFINED);
    if gpu.is_null() || gpu.is_undefined() {
        return Err(JsError::new(
            "WebGPU is unavailable: use a WebGPU-capable browser in a secure HTTPS or localhost context",
        ));
    }
    let system: String = option::<js_sys::JsString>(&options, "system")
        .map(String::from)
        .ok_or_else(|| JsError::new("options.system is required (nds, 3ds, nes, gba, psx)"))?;
    if STARTED.swap(true, Ordering::SeqCst) {
        return Err(JsError::new(
            "this module already runs a machine; Bevy's browser event loop cannot be recreated, reload the page",
        ));
    }
    let renderer = option::<js_sys::JsString>(&options, "renderer")
        .map(String::from).unwrap_or_else(|| "auto".into());
    if !matches!(renderer.as_str(), "auto" | "gpu" | "software") {
        STARTED.store(false, Ordering::SeqCst);
        return Err(JsError::new("options.renderer must be auto, gpu or software"));
    }
    let gpu_ds = cfg!(feature = "nds-gpu")
        && matches!(system.as_str(), "nds" | "nintendo-ds")
        && renderer != "software";
    if renderer == "gpu" && !gpu_ds {
        STARTED.store(false, Ordering::SeqCst);
        return Err(JsError::new("GPU emulation requires a Dust module compiled with nds-gpu"));
    }
    let bytes = rom.to_vec();
    let machine = if gpu_ds { None } else {
        match build_machine(&system, &bytes, &options) {
            Ok(machine) => Some(machine),
            Err(e) => {
                STARTED.store(false, Ordering::SeqCst);
                return Err(e);
            }
        }
    };
    if canvas.id().is_empty() {
        canvas.set_id(&format!(
            "bun-engine-canvas-{}",
            CANVASES.fetch_add(1, Ordering::Relaxed)
        ));
    }
    let shared = Arc::new(Mutex::new(Shared {
        started_at,
        system: machine.as_ref().map_or("nintendo-ds", |machine| machine.name()),
        ..Shared::default()
    }));

    let window = Window {
        title: "Bun Engine".into(),
        canvas: Some(format!("#{}", canvas.id())),
        fit_canvas_to_parent: true,
        prevent_default_event_handling: true,
        ..Default::default()
    };
    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(WindowPlugin {
                primary_window: Some(window),
                ..Default::default()
            })
            .set(ImagePlugin::default_nearest()),
    )
    .add_plugins(BunEnginePlugin {
        default_plugins: false,
        escape_exits: false,
        ..BunEnginePlugin::windowed("Bun Engine")
    })
    .insert_resource(Page(shared.clone()))
    .insert_resource(crate::bevy::render::error_handler::RenderErrorHandler(render_error))
    .add_systems(PreUpdate, page_keys.before(EngineSystems::Input))
    .add_systems(
        RunFixedMainLoop,
        page_touch.in_set(RunFixedMainLoopSystems::BeforeFixedMainLoop),
    )
    .add_systems(Last, page_status);
    if let Some(machine) = machine {
        app.insert_machine(machine);
    }
    #[cfg(feature = "nds-gpu")]
    if gpu_ds {
        app.insert_resource(PendingDs(bytes))
            .add_systems(crate::bevy::app::Update, boot_pending_ds);
    }
    // On the web the winit runner hands the app to requestAnimationFrame and returns.
    app.run();
    Ok(Emulator { shared })
}

#[wasm_bindgen]
impl Emulator {
    /// Held buttons as `machine::keys` bits (A=1, B=2, SELECT=4, START=8, RIGHT=16, LEFT=32,
    /// UP=64, DOWN=128, R=256, L=512, X=1024, Y=2048), OR-ed with keyboard and gamepads.
    pub fn set_input(&self, keys: u32) {
        self.shared.lock().unwrap().keys = keys;
    }

    /// Touch on the bottom screen in its own pixels (DS 256x192, 3DS 320x240).
    pub fn set_touch(&self, x: f64, y: f64, down: bool) {
        self.shared.lock().unwrap().touch =
            down.then(|| (x.clamp(0.0, 1023.0) as u16, y.clamp(0.0, 1023.0) as u16));
    }

    /// Ask the app to exit at the end of the current frame.
    pub fn stop(&self) {
        self.shared.lock().unwrap().stop = true;
    }

    /// Emulated frames since boot.
    #[wasm_bindgen(getter)]
    pub fn frames(&self) -> f64 {
        self.shared.lock().unwrap().frames as f64
    }

    /// Fingerprint (FNV-1a 64, hex) of the screens, refreshed every 15 frames.
    #[wasm_bindgen(getter)]
    pub fn frame_hash(&self) -> String {
        format!("{:016x}", self.shared.lock().unwrap().hash)
    }

    /// Whether the fingerprinted screens contain a non-black pixel.
    #[wasm_bindgen(getter)]
    pub fn lit(&self) -> bool {
        self.shared.lock().unwrap().lit
    }

    /// Milliseconds from `start()` to the first emulated frame.
    #[wasm_bindgen(getter)]
    pub fn first_frame_ms(&self) -> Option<f64> {
        self.shared.lock().unwrap().first_frame_ms
    }

    #[wasm_bindgen(getter)]
    pub fn renderer(&self) -> String {
        if self.shared.lock().unwrap().gpu_rendering { "wgpu30-dust" } else { "software" }.into()
    }

    /// Browser presentation is separate from the machine's emulation renderer.
    #[wasm_bindgen(getter)]
    pub fn presentation_renderer(&self) -> String {
        "webgpu".into()
    }

    /// Actual Dust 2D and 3D command submissions, independently from presentation frames.
    #[wasm_bindgen(getter)]
    pub fn gpu_submitted_frames(&self) -> f64 {
        self.shared.lock().unwrap().gpu_submitted_frames as f64
    }

    /// Actual Dust 2D queue submissions.
    #[wasm_bindgen(getter)]
    pub fn gpu2d_submitted_frames(&self) -> f64 {
        self.shared.lock().unwrap().gpu2d_submitted_frames as f64
    }

    /// Actual Dust 3D queue submissions; a purely 2D title can correctly report zero.
    #[wasm_bindgen(getter)]
    pub fn gpu3d_submitted_frames(&self) -> f64 {
        self.shared.lock().unwrap().gpu3d_submitted_frames as f64
    }

    #[wasm_bindgen(getter)]
    pub fn audio(&self) -> String {
        "bevy_audio".into()
    }

    #[wasm_bindgen(getter)]
    pub fn system(&self) -> String {
        self.shared.lock().unwrap().system.to_owned()
    }

    /// Why the machine stopped, if it did.
    #[wasm_bindgen(getter)]
    pub fn stopped(&self) -> Option<String> {
        self.shared.lock().unwrap().stopped.clone()
    }
}
