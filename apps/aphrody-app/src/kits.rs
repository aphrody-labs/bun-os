// SPDX-License-Identifier: Apache-2.0
//! Kit bridge of the main window (protocol `aphrody.kit/1`): the `admin` and `creator` routes of the UI run the
//! Bun kits `packages/infra/product` and `packages/infra/product` as child processes, `<kit> desktop catalog`
//! or `<kit> desktop run <action> [input-json]`. The kits keep their logic; this module only starts them, forwards
//! their JSON-line events to the window over a channel and writes the answers of its dialogs to their stdin.
//!
//! Only the `main` window may call it; remote pages and other windows get nothing. The kit program is fixed per
//! kit (next to the desktop executable, the Omar install folder, `PATH`, or the sources of a development
//! checkout through `bun`); the window chooses neither the program nor free arguments.

use aphrody_proc::NoWindow as _;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use serde_json::{Value, json};
use tauri::WebviewWindow;
use tauri::ipc::Channel;

use crate::integration::MAIN;

/// Longest event line forwarded at once; a longer line arrives in several events.
const MAX_LINE: u64 = 64 * 1024;
/// Longest argument (the action input JSON included).
const MAX_ARG: usize = 32 * 1024;
/// Kit processes running at once (a bot can run for hours).
const MAX_SESSIONS: usize = 4;

struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
}

static SESSIONS: LazyLock<Mutex<HashMap<u64, Session>>> = LazyLock::new(Mutex::default);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn sessions() -> MutexGuard<'static, HashMap<u64, Session>> {
    SESSIONS.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kit {
    Omar,
    Creator,
}

impl Kit {
    fn product_role(self) -> &'static str {
        match self {
            Self::Omar => "admin",
            Self::Creator => "creator",
        }
    }
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "omar" => Ok(Self::Omar),
            "creator" => Ok(Self::Creator),
            _ => Err(format!("unknown kit `{name}`")),
        }
    }

    /// Executable names, compiled kit first.
    fn binaries(self) -> &'static [&'static str] {
        match self {
            Self::Omar => &["Aphrody-Omar", "aphrody-omar"],
            Self::Creator => &["creator-kit"],
        }
    }

    fn source_dir(self) -> &'static str {
        match self {
            Self::Omar => "omar-kit",
            Self::Creator => "creator-kit",
        }
    }
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn on_path(name: &str) -> Option<PathBuf> {
    let file = executable_name(name);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(&file))
        .find(|path| path.is_file())
}

/// Program and leading arguments of one kit.
fn locate(kit: Kit) -> Option<(PathBuf, Vec<String>)> {
    // One product contains both roles. Arguments remain fixed by this native bridge.
    let mut product_candidates = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        product_candidates.push(dir.join(executable_name("Aphrody-Setup")));
        product_candidates.push(dir.join(executable_name("aphrody-product")));
    }
    if cfg!(windows)
        && let Some(local) = std::env::var_os("LOCALAPPDATA")
    {
        product_candidates.push(
            PathBuf::from(local)
                .join("Aphrody")
                .join("Setup")
                .join("Aphrody-Setup.exe"),
        );
    }
    if let Some(product) = product_candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| on_path("aphrody-product"))
        .or_else(|| on_path("aphrody-setup"))
    {
        return Some((product, vec![kit.product_role().into()]));
    }
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        candidates.extend(
            kit.binaries()
                .iter()
                .map(|name| dir.join(executable_name(name))),
        );
    }
    if kit == Kit::Omar
        && cfg!(windows)
        && let Some(local) = std::env::var_os("LOCALAPPDATA")
    {
        // Where the kit copies itself (`stepKit` of omar-kit) and where Aphrody-Setup installs it.
        candidates.push(
            PathBuf::from(local)
                .join("Aphrody")
                .join("Omar")
                .join("Aphrody-Omar.exe"),
        );
    }
    if kit == Kit::Creator
        && cfg!(windows)
        && let Some(local) = std::env::var_os("LOCALAPPDATA")
    {
        // Where Aphrody-Setup installs creator-kit (role « créateur »).
        candidates.push(
            PathBuf::from(local)
                .join("Aphrody")
                .join("Creator")
                .join("creator-kit.exe"),
        );
    }
    if let Some(found) = candidates.into_iter().find(|path| path.is_file()) {
        return Some((found, Vec::new()));
    }
    if let Some(found) = kit.binaries().iter().find_map(|name| on_path(name)) {
        return Some((found, Vec::new()));
    }
    // A development checkout runs the kit from its sources.
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/product/src/cli.ts");
    if source.is_file() {
        return on_path("bun").map(|bun| {
            (
                bun,
                vec![source.display().to_string(), kit.product_role().into()],
            )
        });
    }
    None
}

fn validate(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("catalog") if args.len() == 1 => {}
        Some("run") if (2..=3).contains(&args.len()) => {}
        _ => return Err("kit arguments must be `catalog` or `run <action> [input-json]`".into()),
    }
    if args
        .iter()
        .any(|arg| arg.len() > MAX_ARG || arg.contains('\0'))
    {
        return Err(format!(
            "kit arguments are limited to {MAX_ARG} bytes without NUL"
        ));
    }
    Ok(())
}

/// One stdout line of the kit as an event: its JSON object, or the plain text as a `say` event.
fn event_of(line: &str, stream: &str) -> Value {
    if stream == "out"
        && let Ok(value) = serde_json::from_str::<Value>(line)
        && value.get("type").is_some_and(Value::is_string)
    {
        return value;
    }
    json!({ "type": "say", "text": line, "stream": stream })
}

fn forward(reader: impl Read, stream: &'static str, channel: &Channel<Value>) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader
            .by_ref()
            .take(MAX_LINE)
            .read_until(b'\n', &mut buffer)
        {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buffer);
                let line = text.trim_end_matches(['\r', '\n']);
                if channel.send(event_of(line, stream)).is_err() {
                    break;
                }
            }
        }
    }
}

/// Start `<kit> desktop <args...>` and stream its events; returns the session id used to answer or stop it.
#[tauri::command]
pub fn aphrody_kit_start(
    window: WebviewWindow,
    kit: String,
    args: Vec<String>,
    channel: Channel<Value>,
) -> Result<u64, String> {
    if window.label() != MAIN {
        return Err(format!("this command is restricted to the `{MAIN}` window"));
    }
    let kit = Kit::parse(&kit)?;
    validate(&args)?;
    if sessions().len() >= MAX_SESSIONS {
        return Err("too many kit actions are running; stop one first".into());
    }
    let (program, prefix) = locate(kit).ok_or_else(|| {
        format!(
            "the {} kit is not installed next to Aphrody nor on PATH",
            kit.source_dir()
        )
    })?;
    let mut command = Command::new(&program).no_window();
    command
        .args(&prefix)
        .arg("desktop")
        .args(&args)
        .env("APHRODY_KIT_DESKTOP", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("{}: {error}", program.display()))?;
    let stdout = child.stdout.take().ok_or("kit stdout is not piped")?;
    let stderr = child.stderr.take().ok_or("kit stderr is not piped")?;
    let stdin = child.stdin.take();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    sessions().insert(id, Session { child, stdin });

    let err_channel = channel.clone();
    std::thread::Builder::new()
        .name("aphrody-kit-stderr".into())
        .spawn(move || forward(stderr, "err", &err_channel))
        .map_err(|error| error.to_string())?;
    std::thread::Builder::new()
        .name("aphrody-kit-stdout".into())
        .spawn(move || {
            forward(stdout, "out", &channel);
            // EOF: the kit ended (or was stopped); reap it unless `aphrody_kit_cancel` already did.
            let code = sessions()
                .remove(&id)
                .and_then(|mut session| session.child.wait().ok())
                .and_then(|status| status.code());
            let _ = channel.send(json!({ "type": "exit", "session": id, "code": code }));
        })
        .map_err(|error| error.to_string())?;
    Ok(id)
}

/// Answer the pending question of a session (`null` cancels the dialog).
#[tauri::command]
pub fn aphrody_kit_answer(
    window: WebviewWindow,
    session: u64,
    answer: Option<String>,
) -> Result<(), String> {
    if window.label() != MAIN {
        return Err(format!("this command is restricted to the `{MAIN}` window"));
    }
    if answer.as_ref().is_some_and(|text| text.len() > MAX_ARG) {
        return Err(format!("answers are limited to {MAX_ARG} bytes"));
    }
    let mut sessions = sessions();
    let stdin = sessions
        .get_mut(&session)
        .and_then(|entry| entry.stdin.as_mut())
        .ok_or("this kit action has ended")?;
    let line = format!("{}\n", json!({ "answer": answer }));
    stdin
        .write_all(line.as_bytes())
        .and_then(|()| stdin.flush())
        .map_err(|error| error.to_string())
}

/// Stop a running kit action.
#[tauri::command]
pub fn aphrody_kit_cancel(window: WebviewWindow, session: u64) -> Result<(), String> {
    if window.label() != MAIN {
        return Err(format!("this command is restricted to the `{MAIN}` window"));
    }
    if let Some(mut entry) = sessions().remove(&session) {
        drop(entry.stdin.take());
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    Ok(())
}

/// Stop every kit action; called when the desktop exits.
pub fn stop_all() {
    for (_, mut entry) in sessions().drain() {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_fixed_kits_and_verbs_are_accepted() {
        assert_eq!(Kit::parse("omar"), Ok(Kit::Omar));
        assert_eq!(Kit::parse("creator"), Ok(Kit::Creator));
        assert_eq!(Kit::Omar.product_role(), "admin");
        assert_eq!(Kit::Creator.product_role(), "creator");
        assert!(Kit::parse("../omar").is_err());
        assert!(validate(&["catalog".into()]).is_ok());
        assert!(validate(&["run".into(), "pc.1".into()]).is_ok());
        assert!(validate(&["run".into(), "x".into(), "{}".into()]).is_ok());
        assert!(validate(&[]).is_err());
        assert!(validate(&["catalog".into(), "x".into()]).is_err());
        assert!(validate(&["install".into()]).is_err());
        assert!(validate(&["run".into(), "x".repeat(MAX_ARG + 1)]).is_err());
        assert!(validate(&["run".into(), "a\0b".into()]).is_err());
    }

    #[test]
    fn plain_lines_and_stderr_become_say_events() {
        assert_eq!(
            event_of(r#"{"type":"done","code":0}"#, "out"),
            json!({"type":"done","code":0})
        );
        assert_eq!(
            event_of("hello", "out"),
            json!({"type":"say","text":"hello","stream":"out"})
        );
        assert_eq!(event_of("[1,2]", "out")["type"], "say");
        assert_eq!(
            event_of(r#"{"type":"done","code":0}"#, "err")["type"],
            "say"
        );
    }
}
