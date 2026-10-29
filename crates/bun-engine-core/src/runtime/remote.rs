//! Remote control over the Bevy Remote Protocol (feature `remote`, native only).
//!
//! `RemoteControlPlugin` starts BRP's JSON-RPC HTTP server on **127.0.0.1** only (the address is
//! never configurable here; Bevy's `RemoteHttpPlugin` default is loopback). BRP has no
//! authentication, so loopback is the whole access control: do not forward the port.
//! Bevy also starts a second loopback server for the render sub-app on port 15703.
//!
//! Besides Bevy's reflection methods (`world.query`, `world.get_resources`, ...) the engine adds
//! these methods, all `POST` JSON-RPC 2.0 to `http://127.0.0.1:<port>`:
//!
//! | method | params | effect |
//! |---|---|---|
//! | `bun/status` | none | shell state, machine, filter, window and home summary |
//! | `bun/filter` | `{kind?, strength?, integer_scale?}` | set the display filter |
//! | `bun/pause` | `{paused?}` (toggles when absent) | pause or resume the machine |
//! | `bun/menu` | `{open}` | open or close the quick menu |
//! | `bun/capture` | `{path?, delay?}` | PNG of the composed window (UI + filter + picture) |
//! | `bun/home` | `{command}` (`up`, `down`, `left`, `right`, `activate`, `back`, `reload`) | home input (feature `home`) |
//! | `bun/exit` | none | clean exit |

use serde_json::{Value, json};

use crate::bevy::{
    app::{AppExit, Plugin},
    ecs::prelude::*,
    remote::{BrpError, BrpResult, RemotePlugin, error_codes, http::RemoteHttpPlugin},
    state::prelude::*,
    window::{CursorOptions, PrimaryWindow, Window},
};

use super::{
    MachineStatus,
    display_filter::{DisplayFilter, FilterKind},
    shell::{PendingCaptures, ShellConfig, ShellState, WasPaused},
};

/// Default BRP port (Bevy's own default).
pub const DEFAULT_PORT: u16 = 15702;

/// Adds BRP with the `bun/*` methods on loopback.
pub struct RemoteControlPlugin {
    pub port: u16,
}

impl Default for RemoteControlPlugin {
    fn default() -> Self {
        Self { port: DEFAULT_PORT }
    }
}

impl Plugin for RemoteControlPlugin {
    fn build(&self, app: &mut crate::bevy::app::App) {
        let methods = RemotePlugin::default()
            .with_method_main("bun/status", status)
            .with_method_main("bun/filter", filter)
            .with_method_main("bun/pause", pause)
            .with_method_main("bun/menu", menu)
            .with_method_main("bun/capture", capture)
            .with_method_main("bun/home", home)
            .with_method_main("bun/exit", exit);
        app.add_plugins((methods, RemoteHttpPlugin::default().with_port(self.port)));
    }
}

fn invalid(message: impl ToString) -> BrpError {
    BrpError {
        code: error_codes::INVALID_PARAMS,
        message: message.to_string(),
        data: None,
    }
}

fn status(In(_): In<Option<Value>>, world: &mut World) -> BrpResult {
    let state = world
        .get_resource::<State<ShellState>>()
        .map(|s| format!("{:?}", **s));
    let machine = world.get_resource::<MachineStatus>().map(|m| {
        json!({ "name": m.name, "frames": m.frames, "paused": m.paused })
    });
    let filter = world.get_resource::<DisplayFilter>().map(|f| {
        json!({ "kind": f.kind.name(), "strength": f.strength, "integer_scale": f.integer_scale })
    });
    let window = world
        .query_filtered::<(&Window, Option<&CursorOptions>), With<PrimaryWindow>>()
        .iter(world)
        .next()
        .map(|(w, c)| {
            json!({
                "width": w.width(),
                "height": w.height(),
                "physical_width": w.physical_width(),
                "physical_height": w.physical_height(),
                "mode": format!("{:?}", w.mode),
                "cursor_visible": c.map(|c| c.visible),
            })
        });
    #[allow(unused_mut)]
    let mut out = json!({ "state": state, "machine": machine, "filter": filter, "window": window });
    #[cfg(feature = "home")]
    {
        use super::home::{HomeAction, HomeData, HomeLoad, HomeUi};
        use crate::bevy::input_focus::InputFocus;
        let focus = world.get_resource::<InputFocus>().and_then(InputFocus::get);
        let focused = focus.and_then(|e| world.get::<HomeAction>(e)).map(|a| match a {
            HomeAction::Play(i) => format!("play:{i}"),
            HomeAction::Filter(s) => format!("filter:{}", s.as_deref().unwrap_or("all")),
            HomeAction::Retry => "retry".to_owned(),
        });
        if let (Some(data), Some(ui)) = (world.get_resource::<HomeData>(), world.get_resource::<HomeUi>()) {
            out["home"] = json!({
                "load": match &data.load {
                    HomeLoad::Loading => "loading".to_owned(),
                    HomeLoad::Ready => "ready".to_owned(),
                    HomeLoad::Empty => "empty".to_owned(),
                    HomeLoad::Error(e) => format!("error: {e}"),
                },
                "games": data.games.len(),
                "filter": ui.filter,
                "focused": focused,
                "last_launch": ui.last_launch.as_ref().map(|g| g.title.clone()),
            });
        }
    }
    Ok(out)
}

fn filter(In(params): In<Option<Value>>, mut filter: ResMut<DisplayFilter>) -> BrpResult {
    let params = params.unwrap_or(Value::Null);
    if let Some(kind) = params.get("kind") {
        let name = kind.as_str().ok_or_else(|| invalid("`kind` must be a string"))?;
        filter.kind = FilterKind::parse(name).ok_or_else(|| {
            invalid(format!(
                "unknown filter `{name}` (off, plain, scanlines, crt, lcd, sharp)"
            ))
        })?;
    }
    if let Some(strength) = params.get("strength") {
        let v = strength.as_f64().ok_or_else(|| invalid("`strength` must be a number"))?;
        filter.strength = (v as f32).clamp(0.0, 1.0);
    }
    if let Some(integer) = params.get("integer_scale") {
        filter.integer_scale = integer
            .as_bool()
            .ok_or_else(|| invalid("`integer_scale` must be a boolean"))?;
    }
    Ok(json!({
        "kind": filter.kind.name(),
        "strength": filter.strength,
        "integer_scale": filter.integer_scale,
    }))
}

fn pause(
    In(params): In<Option<Value>>,
    status: Option<ResMut<MachineStatus>>,
    state: Option<Res<State<ShellState>>>,
    mut was: ResMut<WasPaused>,
) -> BrpResult {
    let Some(mut status) = status else {
        return Err(BrpError::internal("no machine is running"));
    };
    let in_menu = state.is_some_and(|s| **s == ShellState::QuickMenu);
    // Inside the quick menu the machine is held paused; the request changes what the menu
    // restores when it closes.
    let current = if in_menu { was.0 } else { status.paused };
    let want = match params.as_ref().and_then(|p| p.get("paused")) {
        Some(v) => v.as_bool().ok_or_else(|| invalid("`paused` must be a boolean"))?,
        None => !current,
    };
    if in_menu {
        was.0 = want;
    } else {
        status.paused = want;
    }
    Ok(json!({ "paused": want, "frames": status.frames }))
}

fn menu(
    In(params): In<Option<Value>>,
    state: Res<State<ShellState>>,
    mut next: ResMut<NextState<ShellState>>,
) -> BrpResult {
    let open = params
        .as_ref()
        .and_then(|p| p.get("open"))
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("`open` (boolean) is required"))?;
    match (**state, open) {
        (ShellState::Playing, true) => next.set(ShellState::QuickMenu),
        (ShellState::QuickMenu, false) => next.set(ShellState::Playing),
        (ShellState::Home, true) => return Err(BrpError::internal("no machine: the quick menu needs a running game")),
        _ => {}
    }
    Ok(json!({ "requested": if open { "QuickMenu" } else { "Playing" } }))
}

fn capture(
    In(params): In<Option<Value>>,
    config: Res<ShellConfig>,
    mut captures: ResMut<PendingCaptures>,
) -> BrpResult {
    let params = params.unwrap_or(Value::Null);
    let delay = params.get("delay").and_then(Value::as_u64).unwrap_or(1).min(600) as u32;
    let path = match params.get("path").and_then(Value::as_str) {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis());
            config.state_dir.join("screenshots").join(format!("window-{stamp}.png"))
        }
    };
    if path.extension().and_then(|e| e.to_str()) != Some("png") {
        return Err(invalid("`path` must end in .png"));
    }
    captures.request(delay, path.clone());
    Ok(json!({ "queued": path.display().to_string() }))
}

fn home(
    In(params): In<Option<Value>>,
    #[cfg(feature = "home")] mut commands: MessageWriter<super::home::HomeCommand>,
) -> BrpResult {
    #[cfg(not(feature = "home"))]
    {
        let _ = params;
        Err(BrpError::internal("this build has no `home` feature"))
    }
    #[cfg(feature = "home")]
    {
        use super::home::HomeCommand;
        use crate::bevy::math::CompassOctant;
        let name = params
            .as_ref()
            .and_then(|p| p.get("command"))
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("`command` is required"))?;
        commands.write(match name {
            "up" => HomeCommand::Move(CompassOctant::North),
            "down" => HomeCommand::Move(CompassOctant::South),
            "left" => HomeCommand::Move(CompassOctant::West),
            "right" => HomeCommand::Move(CompassOctant::East),
            "activate" => HomeCommand::Activate,
            "back" => HomeCommand::Back,
            "reload" => HomeCommand::Reload,
            other => return Err(invalid(format!("unknown command `{other}`"))),
        });
        Ok(json!({ "sent": name }))
    }
}

fn exit(In(_): In<Option<Value>>, mut exits: MessageWriter<AppExit>) -> BrpResult {
    exits.write(AppExit::Success);
    Ok(json!({ "exiting": true }))
}
