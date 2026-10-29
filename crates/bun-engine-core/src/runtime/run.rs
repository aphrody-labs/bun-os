//! Ready-made apps for the CLI: a machine windowed or headless.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::bevy::{
    app::{App, AppExit, Last},
    ecs::prelude::*,
};

use super::{BunEnginePlugin, EngineExit, MachineAppExt, MachineSlot, MachineStatus};
use crate::machine::Machine;

/// Options of `bun-engine run`.
#[derive(Clone, Debug, Default)]
pub struct RunOptions {
    pub title: String,
    pub headless: bool,
    /// Stop after this many frames.
    pub frames: Option<u64>,
    /// Write the final screens here.
    pub out: Option<PathBuf>,
    /// Upscale with FSR1 instead of nearest-neighbour sprites.
    pub fsr: bool,
    pub sharpness_stops: f32,
    /// Display filter name (`display-filter`): off, plain, scanlines, crt, lcd, sharp.
    pub filter: Option<String>,
    /// Integer scaling for the filtered view.
    pub integer_scale: bool,
    /// Kiosk: borderless fullscreen (gamescope, console session).
    pub fullscreen: bool,
    /// Kiosk: hide the mouse cursor over the window.
    pub hide_cursor: bool,
    /// Serve BRP on 127.0.0.1:<port> (feature `remote`).
    pub remote: Option<u16>,
    /// Saved states and screenshots go here (default `saves`).
    pub state_dir: Option<PathBuf>,
    /// Initial logical window size.
    pub size: Option<(u32, u32)>,
    /// Home library: a `library.db` path or `mock`, `mock:empty`, `mock:error`, `mock:loading`.
    pub library: Option<String>,
}

/// What the app reported when it exited.
#[derive(Clone, Debug, Default)]
pub struct RunReport {
    pub machine: &'static str,
    pub frames: u64,
    pub diagnostic: Option<String>,
    pub failure: Option<String>,
}

#[derive(Resource, Clone)]
struct ReportSink(Arc<Mutex<RunReport>>);

/// The app running `machine`; call `.run()` and then read the report.
pub fn machine_app(
    machine: Box<dyn Machine>,
    options: &RunOptions,
) -> (App, Arc<Mutex<RunReport>>) {
    let mut app = App::new();
    let engine = if options.headless {
        BunEnginePlugin::headless()
    } else {
        let mut engine = BunEnginePlugin::windowed(options.title.clone());
        engine.fullscreen = options.fullscreen;
        engine.hide_cursor = options.hide_cursor;
        engine.size = options.size;
        engine
    };
    app.add_plugins(engine);
    configure_shell(&mut app, options);
    app.insert_machine(machine);
    {
        let mut status = app.world_mut().resource_mut::<MachineStatus>();
        status.frame_limit = options.frames;
        status.out = options.out.clone();
    }
    #[cfg(feature = "render")]
    if options.fsr && !options.headless {
        let image = app.world().resource::<super::MachineScreen>().image.clone();
        app.insert_resource(super::fsr1::Fsr1Upscale {
            image,
            sharpness_stops: options.sharpness_stops,
            target: None,
        });
    }
    #[cfg(feature = "display-filter")]
    if !options.headless {
        let mut filter = app.world_mut().resource_mut::<super::display_filter::DisplayFilter>();
        if let Some(kind) = options
            .filter
            .as_deref()
            .and_then(super::display_filter::FilterKind::parse)
        {
            filter.kind = kind;
        }
        filter.integer_scale = options.integer_scale;
    }
    let report = Arc::new(Mutex::new(RunReport::default()));
    app.insert_resource(ReportSink(report.clone()))
        .add_systems(Last, collect.after(super::machine::write_out_on_exit));
    (app, report)
}

/// Shell settings shared by the machine app and the home app: state directory, home library and
/// BRP.
fn configure_shell(app: &mut App, options: &RunOptions) {
    if options.headless {
        return;
    }
    #[cfg(feature = "shell")]
    if let Some(dir) = &options.state_dir {
        app.world_mut().resource_mut::<super::shell::ShellConfig>().state_dir = dir.clone();
    }
    #[cfg(feature = "home")]
    if let Some(spec) = &options.library {
        app.insert_resource(super::home::HomeLibrary(super::home::source_from_spec(spec)));
    }
    #[cfg(all(feature = "remote", not(target_arch = "wasm32")))]
    if let Some(port) = options.remote {
        app.add_plugins(super::remote::RemoteControlPlugin { port });
    }
    let _ = (app, options);
}

/// The home alone: no machine, the library and the shell in a window (`bun-engine home`).
pub fn home_app(options: &RunOptions) -> App {
    let mut app = App::new();
    let mut engine = BunEnginePlugin::windowed(options.title.clone());
    engine.fullscreen = options.fullscreen;
    engine.hide_cursor = options.hide_cursor;
    engine.size = options.size;
    app.add_plugins(engine);
    configure_shell(&mut app, options);
    app
}

/// Run `machine` until it shuts down, reaches `--frames` or the window closes.
pub fn run_machine(machine: Box<dyn Machine>, options: &RunOptions) -> Result<RunReport, String> {
    let (mut app, report) = machine_app(machine, options);
    let exit = app.run();
    let report = report.lock().unwrap().clone();
    if let Some(failure) = report.failure.clone() {
        return Err(failure);
    }
    if let AppExit::Error(code) = exit {
        return Err(format!("the app exited with code {code}"));
    }
    Ok(report)
}

fn collect(
    mut exits: MessageReader<AppExit>,
    slot: Option<NonSend<MachineSlot>>,
    status: Option<Res<MachineStatus>>,
    engine: Res<EngineExit>,
    sink: Res<ReportSink>,
) {
    if exits.read().next().is_none() {
        return;
    }
    *sink.0.lock().unwrap() = RunReport {
        machine: status.as_ref().map_or("", |s| s.name),
        frames: status.as_ref().map_or(0, |s| s.frames),
        diagnostic: slot.and_then(|s| s.0.diagnostic()),
        failure: engine.failure.clone(),
    };
}
