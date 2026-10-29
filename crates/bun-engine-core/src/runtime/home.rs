//! Native home (feature `home`): a hero with one Play action, a system shelf, game tiles and a
//! controller-hints footer, navigated with the D-pad, the left stick or the arrow keys.
//!
//! - Data comes through the [`LibrarySource`] trait: [`MockLibrary`] (sample, empty, failing and
//!   slow variants) and [`SqliteLibrary`], which reads the `library.db` of `packages/bun-engine`
//!   (`usr/var/lib/bep/library.db`, tables `games`) read-only. Loading runs on a worker thread, so
//!   the home has real `Loading`, `Empty`, `Error` and `Ready` states ([`HomeLoad`]).
//! - Focus is `bevy_input_focus` ([`InputFocus`]); directions use the geometric
//!   [`AutoDirectionalNavigator`] (no hand-wired edges) over entities marked
//!   [`AutoDirectionalNavigation`]. The focused entity gets a solid 3 px ring in the accent role.
//! - Colours are the Material 3 roles of `tokens.json` (`runtime::theme`).
//! - Playing a game writes a [`HomeLaunch`] message; the host decides how to start the machine.
//!   Hosts and `bun` (through `runtime::remote`) can also send [`HomeCommand`] messages, which are
//!   the same commands the keyboard and the pad produce.
//!
//! Not done here: cover art (tiles show the system name), scrolling of long libraries (the grid
//! shows what fits and the shelf filters by system), and mouse/touch picking.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{Receiver, channel},
    },
    time::Duration,
};

use crate::bevy::{
    app::{App, Plugin, Update},
    color::Color,
    ecs::prelude::*,
    input::{
        ButtonInput,
        gamepad::{Gamepad, GamepadButton, GamepadRumbleRequest},
        keyboard::KeyCode,
    },
    input_focus::{
        FocusCause, InputFocus, InputFocusVisible, directional_navigation::DirectionalNavigationPlugin,
    },
    math::{CompassOctant, Vec2},
    state::prelude::*,
    text::{FontSize, TextColor, TextFont},
    time::Time,
    ui::{
        AlignItems, BackgroundColor, BorderRadius, FlexDirection, FlexWrap, JustifyContent, Node,
        Outline, Overflow, PositionType, UiRect, Val,
        auto_directional_navigation::{AutoDirectionalNavigation, AutoDirectionalNavigator},
        widget::Text,
    },
    window::{PrimaryWindow, Window},
};

use super::{
    shell::{RING, ShellState, Toast, rumble_confirm, ShellConfig},
    theme::{self, Role},
};

/// One library entry.
#[derive(Clone, Debug, PartialEq)]
pub struct Game {
    pub id: i64,
    /// Libretro-style system id (`nes`, `gba`, ...).
    pub system: String,
    pub title: String,
    pub path: String,
    pub favorite: bool,
    pub plays: u32,
    /// ISO-like timestamp of the last launch.
    pub last_played: Option<String>,
}

impl Game {
    fn system_label(&self) -> String {
        self.system.to_uppercase()
    }
}

/// Where the games come from.
pub trait LibrarySource: Send + Sync + 'static {
    /// Short description shown while loading and in errors.
    fn label(&self) -> String;
    /// Read every game. Runs on a worker thread; may block.
    fn load(&self) -> Result<Vec<Game>, String>;
}

/// In-memory library for tests, captures and demos.
#[derive(Clone, Debug)]
pub struct MockLibrary {
    pub games: Vec<Game>,
    pub error: Option<String>,
    /// Time `load` takes (a long delay keeps the home in its `Loading` state).
    pub delay: Duration,
}

impl MockLibrary {
    /// Twenty games over four systems; the first ones played recently.
    pub fn sample() -> Self {
        let systems = ["nes", "gba", "nds", "psx"];
        let titles = [
            "Alter Ego", "Lan Master", "Hello GBA", "Micro Mages", "Star Harbor", "Pocket Rally",
            "Blue Orchard", "Night Courier", "Paper Moon", "Iron Garden", "Loop Runner",
            "Glass Maze", "Tiny Orbit", "Copper Trail", "Salt Flats", "Echo Valley", "Brass Keys",
            "Lantern Run", "Pixel Harvest", "Quiet Reactor",
        ];
        let games = titles
            .iter()
            .enumerate()
            .map(|(i, title)| Game {
                id: i as i64 + 1,
                system: systems[i % systems.len()].to_owned(),
                title: (*title).to_owned(),
                path: format!("/library/{}/{}", systems[i % systems.len()], title),
                favorite: i % 5 == 1,
                plays: if i < 6 { 12 - i as u32 } else { 0 },
                last_played: (i < 6).then(|| format!("2026-10-{:02} 20:00:00", 22 - i)),
            })
            .collect();
        Self { games, error: None, delay: Duration::ZERO }
    }

    pub fn empty() -> Self {
        Self { games: Vec::new(), error: None, delay: Duration::ZERO }
    }

    pub fn failing(message: impl Into<String>) -> Self {
        Self { games: Vec::new(), error: Some(message.into()), delay: Duration::ZERO }
    }

    /// A library that never answers within a session (for the `Loading` state).
    pub fn slow() -> Self {
        Self { delay: Duration::from_secs(3600), ..Self::sample() }
    }
}

impl LibrarySource for MockLibrary {
    fn label(&self) -> String {
        "mock library".into()
    }

    fn load(&self) -> Result<Vec<Game>, String> {
        std::thread::sleep(self.delay);
        match &self.error {
            Some(e) => Err(e.clone()),
            None => Ok(self.games.clone()),
        }
    }
}

/// The `library.db` of `packages/bun-engine` (SQLite, table `games`), opened read-only.
#[derive(Clone, Debug)]
pub struct SqliteLibrary {
    pub path: PathBuf,
}

impl SqliteLibrary {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// `$BEP_ROOT/var/lib/bep/library.db`, or `usr/var/lib/bep/library.db` below the working
    /// directory (the same root the Bun side uses: `BEP_ROOT` or `<repo>/usr`).
    pub fn default_path() -> PathBuf {
        let root = std::env::var_os("BEP_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("usr"));
        root.join("var").join("lib").join("bep").join("library.db")
    }
}

impl LibrarySource for SqliteLibrary {
    fn label(&self) -> String {
        self.path.display().to_string()
    }

    fn load(&self) -> Result<Vec<Game>, String> {
        use rusqlite::{Connection, OpenFlags};
        if !self.path.is_file() {
            return Err(format!("no library at {} (scan sources with the frontend first)", self.path.display()));
        }
        let db = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("{}: {e}", self.path.display()))?;
        let has_games: bool = db
            .query_row(
                "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'games'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("{}: {e}", self.path.display()))?;
        if !has_games {
            return Err(format!("{} has no games table", self.path.display()));
        }
        let mut statement = db
            .prepare(
                "SELECT id, system, COALESCE(NULLIF(title, ''), name), path, favorite, playCount, lastPlayed \
                 FROM games ORDER BY favorite DESC, lastPlayed DESC, 3 COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(Game {
                    id: row.get(0)?,
                    system: row.get(1)?,
                    title: row.get(2)?,
                    path: row.get(3)?,
                    favorite: row.get::<_, i64>(4)? != 0,
                    plays: row.get::<_, i64>(5)?.max(0) as u32,
                    last_played: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

/// Parse the CLI `--library` value: a `library.db` path, or `mock`, `mock:empty`, `mock:error`,
/// `mock:loading`.
pub fn source_from_spec(spec: &str) -> Arc<dyn LibrarySource> {
    match spec {
        "mock" => Arc::new(MockLibrary::sample()),
        "mock:empty" => Arc::new(MockLibrary::empty()),
        "mock:error" => Arc::new(MockLibrary::failing("the mock library failed to open")),
        "mock:loading" => Arc::new(MockLibrary::slow()),
        path => Arc::new(SqliteLibrary::new(Path::new(path))),
    }
}

/// The library the home reads. Insert it before the first frame; otherwise the default
/// [`SqliteLibrary`] is used.
#[derive(Resource, Clone)]
pub struct HomeLibrary(pub Arc<dyn LibrarySource>);

/// Load state of the home.
#[derive(Clone, Debug, PartialEq)]
pub enum HomeLoad {
    Loading,
    Ready,
    Empty,
    Error(String),
}

#[derive(Resource, Debug)]
pub struct HomeData {
    pub load: HomeLoad,
    pub games: Vec<Game>,
}

impl Default for HomeData {
    fn default() -> Self {
        Self { load: HomeLoad::Loading, games: Vec::new() }
    }
}

/// What a focusable element does.
#[derive(Component, Clone, Debug, PartialEq)]
pub enum HomeAction {
    /// Start `HomeData::games[index]`.
    Play(usize),
    /// Show one system (`None` = all).
    Filter(Option<String>),
    /// Load the library again.
    Retry,
}

/// A command from input, the host or BRP.
#[derive(Message, Clone, Debug, PartialEq)]
pub enum HomeCommand {
    Move(CompassOctant),
    Activate,
    Back,
    Reload,
}

/// The user chose to play a game.
#[derive(Message, Clone, Debug)]
pub struct HomeLaunch(pub Game);

/// View state of the home.
#[derive(Resource, Default)]
pub struct HomeUi {
    pub filter: Option<String>,
    pub last_launch: Option<Game>,
    dirty: bool,
    reload: bool,
    layout: (u32, u32),
    focus_key: Option<HomeAction>,
}

#[derive(Resource)]
struct Loader(Mutex<Option<Receiver<Result<Vec<Game>, String>>>>);

#[derive(Component)]
struct HomeRoot;

/// Background of a focusable element when it has no focus.
#[derive(Component)]
struct FocusBase(Color);

/// Adds the home. Added by `BunEnginePlugin`.
#[derive(Default)]
pub struct HomePlugin;

impl Plugin for HomePlugin {
    fn build(&self, app: &mut App) {
        if !app.is_plugin_added::<DirectionalNavigationPlugin>() {
            app.add_plugins(DirectionalNavigationPlugin);
        }
        app.init_resource::<HomeData>()
            .init_resource::<HomeUi>()
            .insert_resource(Loader(Mutex::new(None)))
            .add_message::<HomeCommand>()
            .add_message::<HomeLaunch>()
            .add_systems(OnEnter(ShellState::Home), enter_home)
            .add_systems(OnExit(ShellState::Home), leave_home)
            .add_systems(
                Update,
                (
                    poll_load,
                    begin_load,
                    detect_resize,
                    gather_input,
                    apply_commands,
                    rebuild,
                    focus_ring,
                )
                    .chain()
                    .run_if(in_state(ShellState::Home)),
            );
    }
}

fn enter_home(mut ui: ResMut<HomeUi>, mut visible: ResMut<InputFocusVisible>) {
    ui.dirty = true;
    ui.reload = true;
    visible.0 = true;
}

fn leave_home(mut commands: Commands, roots: Query<Entity, With<HomeRoot>>, mut focus: ResMut<InputFocus>) {
    for root in &roots {
        commands.entity(root).despawn();
    }
    focus.clear();
}

/// Start the worker thread when `reload` is set.
fn begin_load(
    mut ui: ResMut<HomeUi>,
    mut data: ResMut<HomeData>,
    loader: Res<Loader>,
    library: Option<Res<HomeLibrary>>,
) {
    if !ui.reload {
        return;
    }
    ui.reload = false;
    ui.dirty = true;
    data.load = HomeLoad::Loading;
    let source: Arc<dyn LibrarySource> = library.map_or_else(
        || Arc::new(SqliteLibrary::new(SqliteLibrary::default_path())) as Arc<dyn LibrarySource>,
        |l| l.0.clone(),
    );
    let (tx, rx) = channel();
    *loader.0.lock().unwrap() = Some(rx);
    std::thread::spawn(move || {
        let _ = tx.send(source.load());
    });
}

fn poll_load(mut ui: ResMut<HomeUi>, mut data: ResMut<HomeData>, loader: Res<Loader>) {
    let mut slot = loader.0.lock().unwrap();
    let Some(rx) = slot.as_ref() else { return };
    let Ok(result) = rx.try_recv() else { return };
    *slot = None;
    match result {
        Ok(games) if games.is_empty() => {
            data.games.clear();
            data.load = HomeLoad::Empty;
        }
        Ok(games) => {
            data.games = games;
            data.load = HomeLoad::Ready;
        }
        Err(e) => {
            data.games.clear();
            data.load = HomeLoad::Error(e);
        }
    }
    ui.dirty = true;
}

fn detect_resize(mut ui: ResMut<HomeUi>, windows: Query<&Window, With<PrimaryWindow>>) {
    if let Ok(window) = windows.single() {
        let size = (window.width() as u32, window.height() as u32);
        if size != ui.layout {
            ui.layout = size;
            ui.dirty = true;
        }
    }
}

/// Keyboard, pad and left stick to [`HomeCommand`].
fn gather_input(
    keys: Option<Res<ButtonInput<KeyCode>>>,
    pads: Query<&Gamepad>,
    mut commands: MessageWriter<HomeCommand>,
    mut stick_was: Local<Option<CompassOctant>>,
) {
    let key = |codes: &[KeyCode]| keys.as_ref().is_some_and(|k| codes.iter().any(|c| k.just_pressed(*c)));
    let pad = |button: GamepadButton| pads.iter().any(|p| p.just_pressed(button));
    for (octant, codes, button) in [
        (CompassOctant::North, [KeyCode::ArrowUp, KeyCode::KeyW], GamepadButton::DPadUp),
        (CompassOctant::South, [KeyCode::ArrowDown, KeyCode::KeyS], GamepadButton::DPadDown),
        (CompassOctant::West, [KeyCode::ArrowLeft, KeyCode::KeyA], GamepadButton::DPadLeft),
        (CompassOctant::East, [KeyCode::ArrowRight, KeyCode::KeyD], GamepadButton::DPadRight),
    ] {
        if key(&codes) || pad(button) {
            commands.write(HomeCommand::Move(octant));
        }
    }
    // Left stick: one move per push past the threshold.
    let stick = pads
        .iter()
        .map(|p| p.left_stick())
        .find(|v| v.length() > 0.6)
        .map(|v: Vec2| {
            if v.x.abs() > v.y.abs() {
                if v.x > 0.0 { CompassOctant::East } else { CompassOctant::West }
            } else if v.y > 0.0 {
                CompassOctant::North
            } else {
                CompassOctant::South
            }
        });
    if stick.is_some() && stick != *stick_was {
        commands.write(HomeCommand::Move(stick.unwrap()));
    }
    *stick_was = stick;
    if key(&[KeyCode::Enter, KeyCode::Space]) || pad(GamepadButton::South) {
        commands.write(HomeCommand::Activate);
    }
    if key(&[KeyCode::Backspace]) || pad(GamepadButton::East) {
        commands.write(HomeCommand::Back);
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_commands(
    mut messages: MessageReader<HomeCommand>,
    mut navigator: AutoDirectionalNavigator,
    actions: Query<&HomeAction>,
    mut ui: ResMut<HomeUi>,
    data: Res<HomeData>,
    mut launches: MessageWriter<HomeLaunch>,
    mut toast: ResMut<Toast>,
    time: Res<Time>,
    config: Res<ShellConfig>,
    gamepads: Query<Entity, With<Gamepad>>,
    mut rumble: MessageWriter<GamepadRumbleRequest>,
) {
    for command in messages.read() {
        match command {
            HomeCommand::Move(octant) => {
                let _ = navigator.navigate(*octant);
            }
            HomeCommand::Back => {
                if ui.filter.is_some() {
                    ui.filter = None;
                    ui.focus_key = Some(HomeAction::Filter(None));
                    ui.dirty = true;
                }
            }
            HomeCommand::Reload => ui.reload = true,
            HomeCommand::Activate => {
                let Some(action) = navigator.input_focus().and_then(|e| actions.get(e).ok()) else { continue };
                rumble_confirm(config.rumble, &gamepads, &mut rumble);
                match action {
                    HomeAction::Play(index) => {
                        if let Some(game) = data.games.get(*index) {
                            toast.say(
                                format!("Play: {} ({})", game.title, game.system_label()),
                                time.elapsed_secs_f64(),
                            );
                            ui.last_launch = Some(game.clone());
                            launches.write(HomeLaunch(game.clone()));
                        }
                    }
                    HomeAction::Filter(system) => {
                        ui.filter = system.clone();
                        ui.focus_key = Some(action.clone());
                        ui.dirty = true;
                    }
                    HomeAction::Retry => ui.reload = true,
                }
            }
        }
    }
}

/// Paint the focus ring (3 px, accent role) on the focused element and nothing else.
fn focus_ring(
    focus: Res<InputFocus>,
    visible: Res<InputFocusVisible>,
    mut items: Query<(Entity, &mut Outline, &mut BackgroundColor, &FocusBase)>,
) {
    for (entity, mut outline, mut background, base) in &mut items {
        let focused = visible.0 && focus.get() == Some(entity);
        let ring = if focused { theme::color(Role::Accent) } else { Color::NONE };
        if outline.color != ring {
            outline.color = ring;
        }
        let fill = if focused { lift(base.0) } else { base.0 };
        if background.0 != fill {
            background.0 = fill;
        }
    }
}

/// A focused element sits one step above its resting surface; the accent fill stays accent.
fn lift(base: Color) -> Color {
    if base == theme::color(Role::Accent) {
        base
    } else {
        theme::color(Role::Border)
    }
}

struct Metrics {
    tile_w: f32,
    gap: f32,
    cap: usize,
}

const TILE_W: f32 = 200.0;
const TILE_H: f32 = 96.0;
const GAP: f32 = 12.0;

fn metrics(width: f32, height: f32) -> Metrics {
    let inner = (width - 2.0 * 24.0).max(TILE_W);
    let cols = (((inner + GAP) / (TILE_W + GAP)).floor() as usize).max(1);
    // Header, hero, shelf, labels, footer, paddings and gaps.
    let rows = (((height - 440.0 + GAP) / (TILE_H + GAP)).floor() as isize).max(1) as usize;
    Metrics { tile_w: TILE_W, gap: GAP, cap: cols * rows }
}

fn label(text: impl Into<String>, size: f32, role: Role) -> impl Bundle {
    (
        Text::new(text),
        TextFont { font_size: FontSize::Px(size), ..Default::default() },
        TextColor(theme::color(role)),
    )
}

/// A focusable element; the caller adds the `Node`.
fn focusable(action: HomeAction, base: Color) -> impl Bundle {
    (
        action,
        AutoDirectionalNavigation::default(),
        BackgroundColor(base),
        FocusBase(base),
        Outline::new(Val::Px(RING), Val::Px(2.0), Color::NONE),
    )
}

/// Games shown as tiles: the current filter, in library order, as many as fit.
fn visible_games<'a>(data: &'a HomeData, filter: &Option<String>, cap: usize) -> Vec<(usize, &'a Game)> {
    data.games
        .iter()
        .enumerate()
        .filter(|(_, g)| filter.as_ref().is_none_or(|f| &g.system == f))
        .take(cap)
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn rebuild(
    mut commands: Commands,
    mut ui: ResMut<HomeUi>,
    data: Res<HomeData>,
    roots: Query<Entity, With<HomeRoot>>,
    mut focus: ResMut<InputFocus>,
    windows: Query<&Window, With<PrimaryWindow>>,
    actions: Query<&HomeAction>,
) {
    if !ui.dirty {
        return;
    }
    ui.dirty = false;
    // Keep the focused element across a rebuild (an explicit choice wins).
    let keep = ui
        .focus_key
        .take()
        .or_else(|| focus.get().and_then(|e| actions.get(e).ok().cloned()));
    for root in &roots {
        commands.entity(root).despawn();
    }
    let (width, height) = windows
        .single()
        .map_or((1024.0, 768.0), |w| (w.width(), w.height()));
    let m = metrics(width, height);
    let mut focusables: Vec<(HomeAction, Entity)> = Vec::new();
    let systems: Vec<(String, usize)> = {
        let mut counts: Vec<(String, usize)> = Vec::new();
        for g in &data.games {
            match counts.iter_mut().find(|(s, _)| *s == g.system) {
                Some((_, n)) => *n += 1,
                None => counts.push((g.system.clone(), 1)),
            }
        }
        counts.sort();
        counts
    };
    let hero_index = data
        .games
        .iter()
        .enumerate()
        .filter(|(_, g)| g.last_played.is_some())
        .max_by(|a, b| a.1.last_played.cmp(&b.1.last_played))
        .map(|(i, _)| i)
        .or_else(|| data.games.iter().position(|g| g.favorite))
        .or(if data.games.is_empty() { None } else { Some(0) });
    let filter = ui.filter.clone();

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(Val::Px(24.0), Val::Px(20.0)),
                row_gap: Val::Px(14.0),
                overflow: Overflow::clip(),
                ..Default::default()
            },
            BackgroundColor(theme::color(Role::Bg)),
            HomeRoot,
        ))
        .with_children(|root| {
            // Header.
            root.spawn(Node {
                justify_content: JustifyContent::SpaceBetween,
                align_items: AlignItems::Center,
                ..Default::default()
            })
            .with_children(|row| {
                row.spawn(label("Bun Engine", 28.0, Role::Text));
                let summary = match &data.load {
                    HomeLoad::Ready => format!("{} games, {} systems", data.games.len(), systems.len()),
                    HomeLoad::Loading => "Loading".to_owned(),
                    HomeLoad::Empty => "No games".to_owned(),
                    HomeLoad::Error(_) => "Library unavailable".to_owned(),
                };
                row.spawn(label(summary, 16.0, Role::TextMuted));
            });

            match &data.load {
                HomeLoad::Loading => {
                    centered(root, |panel| {
                        panel.spawn(label("Loading library", 28.0, Role::Text));
                        panel.spawn(label("Reading games", 16.0, Role::TextMuted));
                        panel
                            .spawn((
                                Node {
                                    width: Val::Px(240.0),
                                    height: Val::Px(6.0),
                                    border_radius: BorderRadius::all(Val::Px(3.0)),
                                    ..Default::default()
                                },
                                BackgroundColor(theme::color(Role::Border)),
                            ))
                            .with_children(|bar| {
                                bar.spawn((
                                    Node {
                                        width: Val::Percent(35.0),
                                        height: Val::Percent(100.0),
                                        border_radius: BorderRadius::all(Val::Px(3.0)),
                                        ..Default::default()
                                    },
                                    BackgroundColor(theme::color(Role::Accent)),
                                ));
                            });
                    });
                }
                HomeLoad::Empty | HomeLoad::Error(_) => {
                    let (title, body, role) = match &data.load {
                        HomeLoad::Error(e) => ("Library unavailable".to_owned(), e.clone(), Role::Danger),
                        _ => (
                            "No games yet".to_owned(),
                            "Add a folder in the Bun Engine frontend and scan it; games appear here.".to_owned(),
                            Role::Text,
                        ),
                    };
                    centered(root, |panel| {
                        panel.spawn(label(title, 30.0, role));
                        panel.spawn(label(body, 16.0, Role::TextMuted));
                        let retry = panel
                            .spawn((
                                focusable(HomeAction::Retry, theme::color(Role::Accent)),
                                Node {
                                    padding: UiRect::axes(Val::Px(28.0), Val::Px(12.0)),
                                    border_radius: BorderRadius::all(Val::Px(12.0)),
                                    ..Default::default()
                                },
                                label("Retry", 22.0, Role::OnAccent),
                            ))
                            .id();
                        focusables.push((HomeAction::Retry, retry));
                    });
                }
                HomeLoad::Ready => {
                    // Hero.
                    if let Some(index) = hero_index {
                        let game = &data.games[index];
                        root.spawn((
                            Node {
                                height: Val::Px(160.0),
                                padding: UiRect::all(Val::Px(24.0)),
                                justify_content: JustifyContent::SpaceBetween,
                                align_items: AlignItems::Center,
                                border_radius: BorderRadius::all(Val::Px(20.0)),
                                ..Default::default()
                            },
                            BackgroundColor(theme::color(Role::SurfaceHigh)),
                        ))
                        .with_children(|hero| {
                            hero.spawn(Node {
                                flex_direction: FlexDirection::Column,
                                row_gap: Val::Px(6.0),
                                ..Default::default()
                            })
                            .with_children(|text| {
                                let kicker =
                                    if game.last_played.is_some() { "Continue" } else { "Featured" };
                                text.spawn(label(kicker, 14.0, Role::Accent));
                                text.spawn(label(game.title.clone(), 36.0, Role::Text));
                                let meta = format!(
                                    "{}   {} plays",
                                    game.system_label(),
                                    game.plays
                                );
                                text.spawn(label(meta, 16.0, Role::TextMuted));
                                let play = text
                                    .spawn((
                                        focusable(HomeAction::Play(index), theme::color(Role::Accent)),
                                        Node {
                                            margin: UiRect::top(Val::Px(8.0)),
                                            padding: UiRect::axes(Val::Px(32.0), Val::Px(10.0)),
                                            border_radius: BorderRadius::all(Val::Px(12.0)),
                                            ..Default::default()
                                        },
                                        label("Play", 22.0, Role::OnAccent),
                                    ))
                                    .id();
                                focusables.push((HomeAction::Play(index), play));
                            });
                            // Cover placeholder: the system name on a surface (no art loaded).
                            hero.spawn((
                                Node {
                                    width: Val::Px(110.0),
                                    height: Val::Px(110.0),
                                    align_items: AlignItems::Center,
                                    justify_content: JustifyContent::Center,
                                    border_radius: BorderRadius::all(Val::Px(14.0)),
                                    ..Default::default()
                                },
                                BackgroundColor(theme::color(Role::Surface)),
                                label(game.system_label(), 28.0, Role::TextMuted),
                            ));
                        });
                    }
                    // System shelf.
                    root.spawn(label("Systems", 14.0, Role::TextMuted));
                    root.spawn(Node {
                        flex_wrap: FlexWrap::Wrap,
                        column_gap: Val::Px(m.gap),
                        row_gap: Val::Px(m.gap),
                        ..Default::default()
                    })
                    .with_children(|shelf| {
                        let mut chips: Vec<(Option<String>, String)> =
                            vec![(None, format!("All {}", data.games.len()))];
                        chips.extend(
                            systems.iter().map(|(s, n)| (Some(s.clone()), format!("{} {n}", s.to_uppercase()))),
                        );
                        for (system, text) in chips {
                            let selected = system == filter;
                            let base = if selected {
                                theme::color(Role::SurfaceHigh)
                            } else {
                                theme::color(Role::Surface)
                            };
                            let action = HomeAction::Filter(system);
                            let chip = shelf
                                .spawn((
                                    focusable(action.clone(), base),
                                    Node {
                                        padding: UiRect::axes(Val::Px(18.0), Val::Px(8.0)),
                                        border_radius: BorderRadius::all(Val::Px(18.0)),
                                        ..Default::default()
                                    },
                                    label(
                                        text,
                                        18.0,
                                        if selected { Role::Accent } else { Role::Text },
                                    ),
                                ))
                                .id();
                            focusables.push((action, chip));
                        }
                    });
                    // Tiles.
                    let shown = visible_games(&data, &filter, m.cap);
                    let total = data
                        .games
                        .iter()
                        .filter(|g| filter.as_ref().is_none_or(|f| &g.system == f))
                        .count();
                    root.spawn(label(
                        match (&filter, total > shown.len()) {
                            (Some(f), false) => format!("{}", f.to_uppercase()),
                            (Some(f), true) => format!("{}, {} of {total}", f.to_uppercase(), shown.len()),
                            (None, false) => "Games".to_owned(),
                            (None, true) => format!("Games, {} of {total}", shown.len()),
                        },
                        14.0,
                        Role::TextMuted,
                    ));
                    root.spawn(Node {
                        flex_wrap: FlexWrap::Wrap,
                        column_gap: Val::Px(m.gap),
                        row_gap: Val::Px(m.gap),
                        ..Default::default()
                    })
                    .with_children(|grid| {
                        for (index, game) in shown {
                            let action = HomeAction::Play(index);
                            let tile = grid
                                .spawn((
                                    focusable(action.clone(), theme::color(Role::Surface)),
                                    Node {
                                        width: Val::Px(m.tile_w),
                                        height: Val::Px(TILE_H),
                                        padding: UiRect::all(Val::Px(14.0)),
                                        flex_direction: FlexDirection::Column,
                                        justify_content: JustifyContent::SpaceBetween,
                                        border_radius: BorderRadius::all(Val::Px(14.0)),
                                        overflow: Overflow::clip(),
                                        ..Default::default()
                                    },
                                ))
                                .with_children(|tile| {
                                    tile.spawn(label(game.title.clone(), 20.0, Role::Text));
                                    let meta = if game.favorite {
                                        format!("{}   favourite", game.system_label())
                                    } else {
                                        game.system_label()
                                    };
                                    tile.spawn(label(meta, 14.0, Role::TextMuted));
                                })
                                .id();
                            focusables.push((action, tile));
                        }
                    });
                }
            }

            // Footer: controller hints.
            root.spawn(Node {
                margin: UiRect::top(Val::Auto),
                column_gap: Val::Px(28.0),
                flex_wrap: FlexWrap::Wrap,
                ..Default::default()
            })
            .with_children(|footer| {
                for hint in [
                    "D-pad / arrows  Move",
                    "A / Enter  Select",
                    "B / Backspace  Back",
                    "Mode / F1  Quick menu in game",
                ] {
                    footer.spawn(label(hint, 14.0, Role::TextMuted));
                }
            });
        });

    // Focus: keep the previous element if it still exists, else the Play button, else the first.
    let wanted = keep
        .and_then(|key| focusables.iter().find(|(a, _)| *a == key))
        .or_else(|| {
            focusables
                .iter()
                .find(|(a, _)| matches!(a, HomeAction::Play(_)) || matches!(a, HomeAction::Retry))
        })
        .or_else(|| focusables.first());
    if let Some((_, entity)) = wanted {
        focus.set(*entity, FocusCause::Navigated);
    }
}

fn centered(root: &mut ChildSpawnerCommands, build: impl FnOnce(&mut ChildSpawnerCommands)) {
    root.spawn(Node {
        flex_grow: 1.0,
        flex_direction: FlexDirection::Column,
        align_items: AlignItems::Center,
        justify_content: JustifyContent::Center,
        row_gap: Val::Px(14.0),
        ..Default::default()
    })
    .with_children(build);
}

/// One-line description of the focused element (for BRP and logs).
pub fn describe_focus(focus: &InputFocus, actions: &Query<&HomeAction>) -> Option<String> {
    focus.get().and_then(|e| actions.get(e).ok()).map(|a| match a {
        HomeAction::Play(i) => format!("play:{i}"),
        HomeAction::Filter(s) => format!("filter:{}", s.as_deref().unwrap_or("all")),
        HomeAction::Retry => "retry".to_owned(),
    })
}
