//! libretro host: loads any libretro core (`*_libretro.so|.dll|.dylib`) with `libloading` and
//! drives it as a [`Machine`], headless and one deterministic frame at a time. This is the common
//! frontend contract for the mature C and C++ cores (mGBA, Snes9x, Genesis Plus GX, Mupen64Plus,
//! PPSSPP, Flycast, ...), next to the in-tree Rust cores.
//!
//! Software rendering only: a core that insists on a hardware context (`SET_HW_RENDER`) is refused
//! the context and must fall back to its software path or fail to load. The log interface is not
//! offered (its callback is variadic), so cores log to their own stderr. Cores keep process-wide
//! state, so only one `Libretro` machine is driven at a time.

use std::{
    ffi::{CStr, CString, c_char, c_uint, c_void},
    path::{Path, PathBuf},
    ptr,
    sync::atomic::{AtomicPtr, Ordering},
};

use libloading::{Library, Symbol};

use super::{Input, Machine, Screen, Step, keys};

const ENV_GET_OVERSCAN: c_uint = 2;
const ENV_GET_CAN_DUPE: c_uint = 3;
const ENV_GET_SYSTEM_DIRECTORY: c_uint = 9;
const ENV_SET_PIXEL_FORMAT: c_uint = 10;
const ENV_SET_INPUT_DESCRIPTORS: c_uint = 11;
const ENV_SET_KEYBOARD_CALLBACK: c_uint = 12;
const ENV_GET_VARIABLE: c_uint = 15;
const ENV_SET_VARIABLES: c_uint = 16;
const ENV_GET_VARIABLE_UPDATE: c_uint = 17;
const ENV_SET_SUPPORT_NO_GAME: c_uint = 18;
const ENV_GET_LIBRETRO_PATH: c_uint = 19;
const ENV_GET_INPUT_DEVICE_CAPABILITIES: c_uint = 24;
const ENV_GET_CORE_ASSETS_DIRECTORY: c_uint = 30;
const ENV_GET_SAVE_DIRECTORY: c_uint = 31;
const ENV_SET_SYSTEM_AV_INFO: c_uint = 32;
const ENV_SET_SUBSYSTEM_INFO: c_uint = 34;
const ENV_SET_CONTROLLER_INFO: c_uint = 35;
const ENV_SET_MEMORY_MAPS: c_uint = 36;
const ENV_SET_GEOMETRY: c_uint = 37;
const ENV_GET_LANGUAGE: c_uint = 39;
const ENV_SET_SERIALIZATION_QUIRKS: c_uint = 44;
const ENV_GET_AUDIO_VIDEO_ENABLE: c_uint = 47;
const ENV_GET_FASTFORWARDING: c_uint = 49;
const ENV_SET_CORE_OPTIONS_DISPLAY: c_uint = 55;
const ENV_SET_CONTENT_INFO_OVERRIDE: c_uint = 65;
const ENV_SET_MINIMUM_AUDIO_LATENCY: c_uint = 63;

const DEVICE_JOYPAD: c_uint = 1;

#[repr(C)]
struct SystemInfo {
    library_name: *const c_char,
    library_version: *const c_char,
    valid_extensions: *const c_char,
    need_fullpath: bool,
    block_extract: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct GameGeometry {
    base_width: c_uint,
    base_height: c_uint,
    max_width: c_uint,
    max_height: c_uint,
    aspect_ratio: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SystemTiming {
    fps: f64,
    sample_rate: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SystemAvInfo {
    geometry: GameGeometry,
    timing: SystemTiming,
}

#[repr(C)]
struct GameInfo {
    path: *const c_char,
    data: *const c_void,
    size: usize,
    meta: *const c_char,
}

type EnvironmentFn = unsafe extern "C" fn(c_uint, *mut c_void) -> bool;
type VideoRefreshFn = unsafe extern "C" fn(*const c_void, c_uint, c_uint, usize);
type AudioSampleFn = unsafe extern "C" fn(i16, i16);
type AudioBatchFn = unsafe extern "C" fn(*const i16, usize) -> usize;
type InputPollFn = unsafe extern "C" fn();
type InputStateFn = unsafe extern "C" fn(c_uint, c_uint, c_uint, c_uint) -> i16;

/// Process-wide callback target: libretro callbacks carry no user data. Set for the duration of a
/// call into the core and cleared when the machine is dropped.
static HOST: AtomicPtr<Shared> = AtomicPtr::new(ptr::null_mut());

#[derive(Clone, Copy, PartialEq, Eq)]
enum PixelFormat {
    Xrgb1555,
    Xrgb8888,
    Rgb565,
}

struct Shared {
    format: PixelFormat,
    screen: Screen,
    audio: Vec<f32>,
    keys: u32,
    system_dir: CString,
    save_dir: CString,
    core_path: CString,
    geometry: GameGeometry,
}

unsafe fn shared<'a>() -> Option<&'a mut Shared> {
    // SAFETY: HOST is either null or points at the boxed `Shared` of the live machine.
    unsafe { HOST.load(Ordering::Acquire).as_mut() }
}

unsafe extern "C" fn environment(cmd: c_uint, data: *mut c_void) -> bool {
    // SAFETY: see `shared`.
    let Some(host) = (unsafe { shared() }) else {
        return false;
    };
    let cmd = cmd & 0xffff; // drop the EXPERIMENTAL (0x10000) and PRIVATE (0x20000) flags
    // SAFETY: each arm writes the type libretro.h documents for that command.
    unsafe {
        match cmd {
            ENV_GET_OVERSCAN => {
                *data.cast::<bool>() = false;
                true
            }
            ENV_GET_CAN_DUPE => {
                *data.cast::<bool>() = true;
                true
            }
            ENV_SET_PIXEL_FORMAT => {
                host.format = match *data.cast::<c_uint>() {
                    0 => PixelFormat::Xrgb1555,
                    1 => PixelFormat::Xrgb8888,
                    2 => PixelFormat::Rgb565,
                    _ => return false,
                };
                true
            }
            ENV_GET_SYSTEM_DIRECTORY | ENV_GET_CORE_ASSETS_DIRECTORY => {
                *data.cast::<*const c_char>() = host.system_dir.as_ptr();
                true
            }
            ENV_GET_SAVE_DIRECTORY => {
                *data.cast::<*const c_char>() = host.save_dir.as_ptr();
                true
            }
            ENV_GET_LIBRETRO_PATH => {
                *data.cast::<*const c_char>() = host.core_path.as_ptr();
                true
            }
            ENV_GET_VARIABLE => {
                // Every core option keeps its default.
                let var = data.cast::<[*const c_char; 2]>();
                (*var)[1] = ptr::null();
                false
            }
            ENV_GET_VARIABLE_UPDATE => {
                *data.cast::<bool>() = false;
                true
            }
            ENV_GET_INPUT_DEVICE_CAPABILITIES => {
                *data.cast::<u64>() = 1 << DEVICE_JOYPAD;
                true
            }
            ENV_GET_LANGUAGE => {
                *data.cast::<c_uint>() = 0; // English
                true
            }
            ENV_GET_AUDIO_VIDEO_ENABLE => {
                *data.cast::<c_uint>() = 3; // video and audio
                true
            }
            ENV_GET_FASTFORWARDING => {
                *data.cast::<bool>() = false;
                true
            }
            ENV_SET_GEOMETRY => {
                host.geometry = *data.cast::<GameGeometry>();
                true
            }
            ENV_SET_SYSTEM_AV_INFO => {
                host.geometry = (*data.cast::<SystemAvInfo>()).geometry;
                true
            }
            ENV_SET_VARIABLES
            | ENV_SET_INPUT_DESCRIPTORS
            | ENV_SET_KEYBOARD_CALLBACK
            | ENV_SET_SUPPORT_NO_GAME
            | ENV_SET_SUBSYSTEM_INFO
            | ENV_SET_CONTROLLER_INFO
            | ENV_SET_MEMORY_MAPS
            | ENV_SET_SERIALIZATION_QUIRKS
            | ENV_SET_CORE_OPTIONS_DISPLAY
            | ENV_SET_CONTENT_INFO_OVERRIDE
            | ENV_SET_MINIMUM_AUDIO_LATENCY => true,
            // Hardware rendering, the log interface, options v1/v2 and everything else: not offered.
            _ => false,
        }
    }
}

unsafe extern "C" fn video_refresh(
    data: *const c_void,
    width: c_uint,
    height: c_uint,
    pitch: usize,
) {
    // SAFETY: see `shared`; `data` holds `height` rows of `pitch` bytes in the negotiated format.
    let Some(host) = (unsafe { shared() }) else {
        return;
    };
    if data.is_null() || width == 0 || height == 0 {
        return; // frame duplicated: keep the previous picture
    }
    let (w, h) = (width as usize, height as usize);
    let mut rgb = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        // SAFETY: row `y` lies inside the core's frame buffer.
        let row = unsafe { std::slice::from_raw_parts(data.cast::<u8>().add(y * pitch), pitch) };
        match host.format {
            PixelFormat::Xrgb8888 => {
                for px in row[..w * 4].chunks_exact(4) {
                    rgb.extend_from_slice(&[px[2], px[1], px[0]]);
                }
            }
            PixelFormat::Rgb565 => {
                for px in row[..w * 2].chunks_exact(2) {
                    let v = u16::from_le_bytes([px[0], px[1]]);
                    let (r, g, b) = (
                        ((v >> 11) & 31) as u8,
                        ((v >> 5) & 63) as u8,
                        (v & 31) as u8,
                    );
                    rgb.extend_from_slice(&[r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2]);
                }
            }
            PixelFormat::Xrgb1555 => {
                for px in row[..w * 2].chunks_exact(2) {
                    let v = u16::from_le_bytes([px[0], px[1]]);
                    let (r, g, b) = (
                        ((v >> 10) & 31) as u8,
                        ((v >> 5) & 31) as u8,
                        (v & 31) as u8,
                    );
                    rgb.extend_from_slice(&[r << 3 | r >> 2, g << 3 | g >> 2, b << 3 | b >> 2]);
                }
            }
        }
    }
    host.screen = Screen {
        width: w,
        height: h,
        rgb,
    };
}

unsafe extern "C" fn audio_sample(left: i16, right: i16) {
    // SAFETY: see `shared`.
    if let Some(host) = unsafe { shared() } {
        host.audio.push(f32::from(left) / 32768.0);
        host.audio.push(f32::from(right) / 32768.0);
    }
}

unsafe extern "C" fn audio_batch(data: *const i16, frames: usize) -> usize {
    // SAFETY: see `shared`; `data` holds `frames` interleaved stereo pairs.
    if let Some(host) = unsafe { shared() } {
        let samples = unsafe { std::slice::from_raw_parts(data, frames * 2) };
        host.audio
            .extend(samples.iter().map(|s| f32::from(*s) / 32768.0));
    }
    frames
}

unsafe extern "C" fn input_poll() {}

unsafe extern "C" fn input_state(port: c_uint, device: c_uint, _index: c_uint, id: c_uint) -> i16 {
    // SAFETY: see `shared`.
    let Some(host) = (unsafe { shared() }) else {
        return 0;
    };
    if port != 0 || device != DEVICE_JOYPAD {
        return 0;
    }
    // RETRO_DEVICE_ID_JOYPAD_*: B Y SELECT START UP DOWN LEFT RIGHT A X L R.
    let bit = match id {
        0 => keys::B,
        1 => keys::Y,
        2 => keys::SELECT,
        3 => keys::START,
        4 => keys::UP,
        5 => keys::DOWN,
        6 => keys::LEFT,
        7 => keys::RIGHT,
        8 => keys::A,
        9 => keys::X,
        10 => keys::L,
        11 => keys::R,
        _ => return 0,
    };
    i16::from(host.keys & bit != 0)
}

/// A loaded libretro core with one running game.
pub struct Libretro {
    // Dropped last: the function pointers below point into it.
    lib: Library,
    shared: Box<Shared>,
    name: String,
    fps: f64,
    sample_rate: f64,
    started: bool,
}

fn sym<'l, T>(lib: &'l Library, name: &str) -> Result<Symbol<'l, T>, String> {
    // SAFETY: the symbol types are the libretro.h signatures.
    unsafe { lib.get(name.as_bytes()) }.map_err(|e| format!("libretro core lacks {name}: {e}"))
}

impl Libretro {
    /// Library file name of a core: `mgba` becomes `mgba_libretro.so` (`.dll`, `.dylib`).
    pub fn core_file(name: &str) -> String {
        let stem = if name.ends_with("_libretro") {
            name.to_string()
        } else {
            format!("{name}_libretro")
        };
        format!("{stem}{}", std::env::consts::DLL_SUFFIX)
    }

    /// Load `core`, boot `content` (a ROM or disc image path) and return the running machine.
    /// `system_dir` is where BIOS files are looked up (the user supplies them); saves go to
    /// `<system_dir>/saves`.
    pub fn open(core: &Path, content: &Path, system_dir: &Path) -> Result<Self, String> {
        if !HOST.load(Ordering::Acquire).is_null() {
            return Err("a libretro core is already running in this process".into());
        }
        let cstr =
            |p: &Path| CString::new(p.to_string_lossy().into_owned()).map_err(|e| e.to_string());
        let save_dir: PathBuf = system_dir.join("saves");
        std::fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;
        let mut shared = Box::new(Shared {
            format: PixelFormat::Xrgb1555,
            screen: Screen {
                width: 0,
                height: 0,
                rgb: Vec::new(),
            },
            audio: Vec::new(),
            keys: 0,
            system_dir: cstr(system_dir)?,
            save_dir: cstr(&save_dir)?,
            core_path: cstr(core)?,
            geometry: GameGeometry::default(),
        });
        // SAFETY: loading a native core runs its initializers; the caller chose the file.
        let lib = unsafe { Library::new(core) }.map_err(|e| format!("{}: {e}", core.display()))?;
        let api: Symbol<unsafe extern "C" fn() -> c_uint> = sym(&lib, "retro_api_version")?;
        // SAFETY: plain call.
        let version = unsafe { api() };
        if version != 1 {
            return Err(format!("libretro API version {version}, expected 1"));
        }
        let mut info = SystemInfo {
            library_name: ptr::null(),
            library_version: ptr::null(),
            valid_extensions: ptr::null(),
            need_fullpath: false,
            block_extract: false,
        };
        let get_info: Symbol<unsafe extern "C" fn(*mut SystemInfo)> =
            sym(&lib, "retro_get_system_info")?;
        // SAFETY: `info` is a valid out-parameter.
        unsafe { get_info(&mut info) };
        // SAFETY: strings are static in the core.
        let name = unsafe {
            if info.library_name.is_null() {
                "libretro".to_string()
            } else {
                CStr::from_ptr(info.library_name)
                    .to_string_lossy()
                    .into_owned()
            }
        };
        HOST.store(&mut *shared, Ordering::Release);
        let boot = || -> Result<(f64, f64), String> {
            // SAFETY: callback registration then init, in the order libretro.h requires.
            unsafe {
                sym::<unsafe extern "C" fn(EnvironmentFn)>(&lib, "retro_set_environment")?(
                    environment,
                );
                sym::<unsafe extern "C" fn()>(&lib, "retro_init")?();
                sym::<unsafe extern "C" fn(VideoRefreshFn)>(&lib, "retro_set_video_refresh")?(
                    video_refresh,
                );
                sym::<unsafe extern "C" fn(AudioSampleFn)>(&lib, "retro_set_audio_sample")?(
                    audio_sample,
                );
                sym::<unsafe extern "C" fn(AudioBatchFn)>(&lib, "retro_set_audio_sample_batch")?(
                    audio_batch,
                );
                sym::<unsafe extern "C" fn(InputPollFn)>(&lib, "retro_set_input_poll")?(input_poll);
                sym::<unsafe extern "C" fn(InputStateFn)>(&lib, "retro_set_input_state")?(
                    input_state,
                );
            }
            let path = cstr(content)?;
            let data = if info.need_fullpath {
                Vec::new()
            } else {
                std::fs::read(content).map_err(|e| format!("{}: {e}", content.display()))?
            };
            let game = GameInfo {
                path: path.as_ptr(),
                data: if info.need_fullpath {
                    ptr::null()
                } else {
                    data.as_ptr().cast()
                },
                size: data.len(),
                meta: ptr::null(),
            };
            // SAFETY: `game` outlives the call; the core copies what it keeps.
            let loaded = unsafe {
                sym::<unsafe extern "C" fn(*const GameInfo) -> bool>(&lib, "retro_load_game")?(
                    &game,
                )
            };
            if !loaded {
                return Err(format!("{name} refused {}", content.display()));
            }
            let mut av = SystemAvInfo::default();
            // SAFETY: valid out-parameter.
            unsafe {
                sym::<unsafe extern "C" fn(*mut SystemAvInfo)>(&lib, "retro_get_system_av_info")?(
                    &mut av,
                );
                sym::<unsafe extern "C" fn(c_uint, c_uint)>(
                    &lib,
                    "retro_set_controller_port_device",
                )?(0, DEVICE_JOYPAD);
            }
            Ok((av.timing.fps, av.timing.sample_rate))
        };
        match boot() {
            Ok((fps, sample_rate)) => Ok(Self {
                lib,
                shared,
                name,
                fps,
                sample_rate,
                started: true,
            }),
            Err(e) => {
                HOST.store(ptr::null_mut(), Ordering::Release);
                Err(e)
            }
        }
    }
}

impl Machine for Libretro {
    fn name(&self) -> &'static str {
        // The trait wants a static name; the core's own name is in `core_name`.
        "libretro"
    }

    fn run_frame(&mut self) -> Step {
        let Ok(run) = sym::<unsafe extern "C" fn()>(&self.lib, "retro_run") else {
            return Step::Shutdown;
        };
        // SAFETY: the core was initialised and has a game loaded.
        unsafe { run() };
        Step::Frame
    }

    fn screens(&self) -> Vec<Screen> {
        vec![Screen {
            width: self.shared.screen.width,
            height: self.shared.screen.height,
            rgb: self.shared.screen.rgb.clone(),
        }]
    }

    fn set_input(&mut self, input: Input) {
        self.shared.keys = input.keys;
    }

    fn refresh_rate(&self) -> f64 {
        if self.fps > 0.0 { self.fps } else { 60.0 }
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate as u32
    }

    fn audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.shared.audio);
    }

    fn save_state(&mut self) -> Option<Vec<u8>> {
        let size =
            sym::<unsafe extern "C" fn() -> usize>(&self.lib, "retro_serialize_size").ok()?;
        let ser =
            sym::<unsafe extern "C" fn(*mut c_void, usize) -> bool>(&self.lib, "retro_serialize")
                .ok()?;
        // SAFETY: the buffer is `size()` bytes as the core asked.
        unsafe {
            let n = size();
            if n == 0 {
                return None;
            }
            let mut buf = vec![0u8; n];
            ser(buf.as_mut_ptr().cast(), n).then_some(buf)
        }
    }

    fn load_state(&mut self, state: &[u8]) -> Result<(), String> {
        let de = sym::<unsafe extern "C" fn(*const c_void, usize) -> bool>(
            &self.lib,
            "retro_unserialize",
        )?;
        // SAFETY: `state` is a buffer produced by `retro_serialize` of the same core and content.
        if unsafe { de(state.as_ptr().cast(), state.len()) } {
            Ok(())
        } else {
            Err("retro_unserialize refused the state".into())
        }
    }
}

impl Libretro {
    /// The core's own name (`library_name`), for reports.
    pub fn core_name(&self) -> &str {
        &self.name
    }
}

impl Drop for Libretro {
    fn drop(&mut self) {
        if self.started {
            // SAFETY: unload in the order libretro.h requires, while the callbacks still resolve.
            unsafe {
                if let Ok(f) = sym::<unsafe extern "C" fn()>(&self.lib, "retro_unload_game") {
                    f();
                }
                if let Ok(f) = sym::<unsafe extern "C" fn()>(&self.lib, "retro_deinit") {
                    f();
                }
            }
        }
        HOST.store(ptr::null_mut(), Ordering::Release);
    }
}
