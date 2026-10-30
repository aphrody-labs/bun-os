// SPDX-License-Identifier: Apache-2.0
//! Persistence at boot: one declarative desired state for systemd units, Docker containers,
//! Windows scheduled tasks and Windows services (`aphrody infra boot plan|apply|audit`).
//!
//! Desired state = non-retired `services` of `infra/config/service-catalog.json` (unit or container
//! plus `host`) merged with its `boot.entries` section (timers, sockets, scheduled tasks, services).
//! `audit` reads the real state, `plan` lists the corrections, `apply` performs them.
//!
//! Linux entries are probed and corrected over `sh` (locally or through SSH). Windows entries are
//! read and corrected in-process through the Task Scheduler COM API ([`crate::wintask`]) and the
//! Service Control Manager ([`crate::winsvc`]); `apply` relaunches itself elevated (`sudo.exe`
//! inline, otherwise the UAC prompt) when a Windows correction is pending and the token is not.

use crate::catalog::{CatalogService, load_service_catalog};
use crate::wintask::{self, Action, Patch, Principal, Scheduler, Settings, TaskSpec, Trigger};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;

/// What must survive a reboot.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[expect(
    clippy::large_enum_variant,
    reason = "a few dozen catalog entries, read once per run"
)]
pub enum BootKind {
    /// systemd service, timer or socket: enabled, active and (long-running services) `Restart=`.
    #[serde(rename_all = "camelCase")]
    Systemd { unit: String },
    /// Docker container with a restart policy (`always` or `unless-stopped`), running.
    #[serde(rename_all = "camelCase")]
    Docker { container: String },
    /// Windows scheduled task with the declared triggers and restart-on-failure.
    #[serde(rename_all = "camelCase")]
    ScheduledTask {
        name: String,
        #[serde(default = "default_task_path")]
        path: String,
        /// `atStartup`, `atLogon`, `every:<N>m` (from midnight, every N minutes) and/or
        /// `daily@HH:MM` (local time); missing ones are added, extra ones kept.
        triggers: Vec<String>,
        /// Program; `{root}` (checkout) and `%VAR%` are expanded. Registers the task when it is
        /// missing and replaces a registered action that runs another program.
        #[serde(default)]
        execute: Option<String>,
        #[serde(default)]
        arguments: Option<String>,
        #[serde(default)]
        working_directory: Option<String>,
        /// Registration description, set when the task is registered.
        #[serde(default)]
        description: Option<String>,
        /// `system` (LocalSystem) or `user` (current user, S4U: no window station, so no console).
        #[serde(default = "default_principal")]
        principal: String,
        /// `highest` (default) or `limited`; SYSTEM always runs highest.
        #[serde(default = "default_run_level")]
        run_level: String,
        /// The task needs the interactive desktop (capture, tray): Interactive logon, action
        /// wrapped in `conhost.exe --headless` so that no console is ever shown.
        #[serde(default)]
        desktop: bool,
        /// Triggered by its own schedule (not kept running): visibility, logon type, declared
        /// triggers and action are audited and corrected; restart policy and run state are not.
        #[serde(default)]
        periodic: bool,
        /// Execution time limit in minutes, set when the task is registered (none by default).
        #[serde(default)]
        time_limit_minutes: Option<u32>,
    },
    /// Windows service: start type Automatic, running, optional failure-restart actions.
    #[serde(rename_all = "camelCase")]
    WindowsService {
        name: String,
        #[serde(default)]
        restart_on_failure: bool,
    },
}

fn default_task_path() -> String {
    "\\Aphrody\\".to_owned()
}

fn default_principal() -> String {
    "system".to_owned()
}

fn default_run_level() -> String {
    "highest".to_owned()
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BootEntry {
    pub host: String,
    #[serde(flatten)]
    pub kind: BootKind,
    /// Reason why the entry is audited but never corrected by `apply`
    /// (work owned by someone else, pending deploy).
    #[serde(default)]
    pub hold: Option<String>,
}

impl BootEntry {
    /// Unit, container, task or service name.
    #[must_use]
    pub fn name(&self) -> &str {
        match &self.kind {
            BootKind::Systemd { unit } => unit,
            BootKind::Docker { container } => container,
            BootKind::ScheduledTask { name, .. } | BootKind::WindowsService { name, .. } => name,
        }
    }

    #[must_use]
    pub fn label(&self) -> String {
        format!("{}:{}", self.host, self.name())
    }

    fn is_windows(&self) -> bool {
        matches!(
            self.kind,
            BootKind::ScheduledTask { .. } | BootKind::WindowsService { .. }
        )
    }
}

/// Entries derived from the supervised, non-retired catalog services plus `boot.entries`;
/// a service with a container is audited as a container (its unit, if any, is a wrapper
/// declared explicitly), an explicit entry wins over a derived one.
pub fn load_entries(root: &Path) -> Result<Vec<BootEntry>> {
    let catalog = load_service_catalog(root)?;
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(
        root.join("infra/config/service-catalog.json"),
    )?)?;
    let explicit: Vec<BootEntry> = match raw.pointer("/boot/entries") {
        Some(v) => serde_json::from_value(v.clone()).context("boot.entries invalide")?,
        None => Vec::new(),
    };
    let mut entries = merge_entries(&catalog.services, explicit);
    for entry in &mut entries {
        expand_task(root, entry);
    }
    Ok(entries)
}

/// Expands `{root}` and `%VAR%` in the program of a scheduled task (Windows entries are local).
pub fn expand_task(root: &Path, entry: &mut BootEntry) {
    let BootKind::ScheduledTask {
        execute,
        arguments,
        working_directory,
        ..
    } = &mut entry.kind
    else {
        return;
    };
    let root = root.to_string_lossy().replace('/', "\\");
    let root = root.strip_prefix(r"\\?\").unwrap_or(&root);
    for field in [execute, arguments, working_directory]
        .into_iter()
        .flatten()
    {
        *field = wintask::expand_env(&field.replace("{root}", root));
    }
}

#[must_use]
pub fn merge_entries(services: &[CatalogService], explicit: Vec<BootEntry>) -> Vec<BootEntry> {
    let mut out = explicit;
    for s in services.iter().filter(|s| !s.is_retired()) {
        let Some(host) = s.host.clone() else { continue };
        let kind = match (&s.container, &s.unit) {
            (Some(c), _) => BootKind::Docker {
                container: c.clone(),
            },
            (None, Some(u)) => BootKind::Systemd { unit: u.clone() },
            _ => continue,
        };
        let hold = None;
        let entry = BootEntry { host, kind, hold };
        if !out
            .iter()
            .any(|e| e.host == entry.host && e.kind == entry.kind)
        {
            out.push(entry);
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Finding {
    pub entry: String,
    pub problem: String,
    /// Correction: the `sh` script run on a Linux target, or the description of the native
    /// Task Scheduler / Service Control Manager operations for a Windows entry; `None` when the
    /// source unit/artifact itself must change.
    pub fix: Option<String>,
    pub held: Option<String>,
}

/// Raw observation of one entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observed {
    Props(HashMap<String, String>),
    Json(Value),
    Missing,
}

fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[must_use]
pub fn evaluate(entry: &BootEntry, observed: &Observed) -> Vec<Finding> {
    let label = entry.label();
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    match (&entry.kind, observed) {
        (BootKind::Systemd { unit }, Observed::Props(p)) => {
            let get = |k: &str| p.get(k).map_or("", String::as_str);
            if get("LoadState") == "not-found" {
                out.push((
                    format!("unité {unit} absente de l'hôte (déploiement requis)"),
                    None,
                ));
            } else {
                let enabled = matches!(
                    get("UnitFileState"),
                    "enabled" | "enabled-runtime" | "alias"
                );
                let indirect = get("UnitFileState") == "indirect" && unit.contains('@');
                let active = get("ActiveState") == "active";
                if !enabled && !indirect {
                    out.push((
                        format!("non activé au boot ({})", get("UnitFileState")),
                        Some(format!("sudo -n systemctl enable --now {}", q(unit))),
                    ));
                } else if !active {
                    out.push((
                        format!("activé mais {}", get("ActiveState")),
                        Some(format!(
                            "sudo -n systemctl reset-failed {u} ; sudo -n systemctl start {u}",
                            u = q(unit)
                        )),
                    ));
                }
                let long_running = unit.ends_with(".service")
                    && get("Type") != "oneshot"
                    && get("RemainAfterExit") != "yes";
                if long_running
                    && !matches!(get("Restart"), "always" | "on-failure" | "on-abnormal")
                {
                    out.push((
                        format!(
                            "Restart={} (auto-redémarrage absent dans l'unité source)",
                            get("Restart")
                        ),
                        None,
                    ));
                }
            }
        }
        (BootKind::Docker { container }, Observed::Props(p)) => {
            let get = |k: &str| p.get(k).map_or("", String::as_str);
            let policy_ok = matches!(get("restart"), "always" | "unless-stopped");
            if !policy_ok {
                out.push((
                    format!("restart policy '{}'", get("restart")),
                    Some(format!(
                        "docker update --restart unless-stopped {}",
                        q(container)
                    )),
                ));
            }
            if get("running") != "true" {
                out.push((
                    format!("conteneur arrêté ({})", get("status")),
                    Some(format!("docker start {}", q(container))),
                ));
            }
        }
        (
            BootKind::ScheduledTask {
                triggers,
                principal,
                desktop,
                periodic,
                ..
            },
            Observed::Json(j),
        ) => {
            let have: Vec<&str> = j["Triggers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let missing: Vec<&String> = triggers
                .iter()
                .filter(|t| !have.contains(&t.as_str()))
                .collect();
            let restart = if *periodic {
                1
            } else {
                j["RestartCount"].as_u64().unwrap_or(0)
            };
            let enabled = j["Enabled"].as_bool().unwrap_or(false);
            let running = *periodic || j["State"].as_str() == Some("Running");
            let hidden = j["Hidden"].as_bool() == Some(true);
            let want_logon = task_principal(principal, *desktop).logon_label();
            let logon_ok = j["Logon"].as_str() == Some(want_logon);
            let seen = observed_action(j);
            let wrapped = !*desktop || seen.as_ref().is_some_and(Action::is_headless);
            let action_ok = match (declared_action(entry), &seen) {
                (Some(declared), Some(seen)) => action_matches(&declared, seen),
                (Some(_), None) => false,
                (None, _) => true,
            };
            let mut why = Vec::new();
            let mut ops = Vec::new();
            if !hidden {
                why.push("non cachée (Settings.Hidden)".to_owned());
                ops.push("cachée".to_owned());
            }
            if !logon_ok {
                why.push(format!(
                    "session {} au lieu de {want_logon} (fenêtre possible)",
                    j["Logon"].as_str().unwrap_or("?")
                ));
                ops.push(format!("principal {want_logon}"));
            }
            if !action_ok {
                why.push(format!(
                    "action {} au lieu de la déclaration",
                    seen.as_ref()
                        .map_or_else(|| "absente".to_owned(), |a| a.unwrapped().command)
                ));
                ops.push("action déclarée".to_owned());
            }
            if !wrapped {
                why.push("console non masquée (conhost --headless absent)".to_owned());
                ops.push("conhost --headless".to_owned());
            }
            if !missing.is_empty() {
                why.push(format!("déclencheurs manquants {missing:?}"));
                ops.push(format!(
                    "+{}",
                    missing
                        .iter()
                        .map(|t| t.as_str())
                        .collect::<Vec<_>>()
                        .join(" +")
                ));
            }
            if restart == 0 {
                why.push("pas de redémarrage sur échec".to_owned());
                ops.push("redémarrage sur échec 999".to_owned());
            }
            if !enabled {
                why.push("désactivée".to_owned());
                ops.push("activée".to_owned());
            }
            if !running {
                why.push(format!("état {}", j["State"].as_str().unwrap_or("?")));
                ops.push("démarrée".to_owned());
            }
            if !why.is_empty() {
                out.push((
                    why.join(", "),
                    Some(format!(
                        "mettre à jour {} : {}",
                        task_path(entry),
                        ops.join(", ")
                    )),
                ));
            }
        }
        (
            BootKind::WindowsService {
                name,
                restart_on_failure,
            },
            Observed::Json(j),
        ) => {
            let auto = matches!(j["StartMode"].as_str(), Some("Auto"));
            let running = j["State"].as_str() == Some("Running");
            let failure = !*restart_on_failure || j["FailureRestart"].as_bool() == Some(true);
            if !auto || !running || !failure {
                let mut ops = Vec::new();
                if !auto {
                    ops.push("démarrage Auto".to_owned());
                }
                if !failure {
                    ops.push("actions d'échec redémarrage 5 s/5 s/60 s (reset 24 h)".to_owned());
                }
                if !running {
                    ops.push("démarré".to_owned());
                }
                out.push((
                    format!(
                        "service: démarrage {} / état {} / restart-on-failure {}",
                        j["StartMode"].as_str().unwrap_or("?"),
                        j["State"].as_str().unwrap_or("?"),
                        failure
                    ),
                    Some(format!("service {name} : {}", ops.join(", "))),
                ));
            }
        }
        (_, Observed::Missing) => {
            out.push((
                "absent de l'hôte".to_owned(),
                match &entry.kind {
                    BootKind::ScheduledTask {
                        execute: Some(exe),
                        arguments,
                        principal,
                        desktop,
                        triggers,
                        ..
                    } => Some(format!(
                        "enregistrer {} ({}, cachée, déclencheurs [{}]) : {exe}{}",
                        task_path(entry),
                        task_principal(principal, *desktop).logon_label(),
                        triggers.join(", "),
                        arguments
                            .as_deref()
                            .map_or(String::new(), |a| format!(" {a}")),
                    )),
                    _ => None,
                },
            ));
        }
        _ => out.push(("observation inattendue".to_owned(), None)),
    }
    out.into_iter()
        .map(|(problem, fix)| Finding {
            entry: label.clone(),
            problem,
            fix,
            held: entry.hold.clone(),
        })
        .collect()
}

/// `\Folder\Name` of a scheduled-task entry.
fn task_path(entry: &BootEntry) -> String {
    match &entry.kind {
        BootKind::ScheduledTask { name, path, .. } => wintask::full_path(path, name),
        _ => String::new(),
    }
}

/// Principal of a task: SYSTEM runs in session 0, a user task without a desktop need runs S4U
/// (no window station): neither can display a console. Desktop tasks run on the interactive
/// session with their console created by `conhost --headless`.
fn task_principal(principal: &str, desktop: bool) -> Principal {
    match (principal, desktop) {
        ("system", _) => Principal::System,
        (_, true) => Principal::Interactive,
        _ => Principal::S4U,
    }
}

fn system_root() -> String {
    std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned())
}

/// The declared program of a task entry, wrapped in `conhost --headless` for desktop tasks.
fn declared_action(entry: &BootEntry) -> Option<Action> {
    let BootKind::ScheduledTask {
        execute,
        arguments,
        working_directory,
        desktop,
        ..
    } = &entry.kind
    else {
        return None;
    };
    let action = Action {
        command: execute.clone()?,
        arguments: arguments.clone().filter(|a| !a.is_empty()),
        working_directory: working_directory.clone().filter(|d| !d.is_empty()),
    };
    Some(if *desktop {
        action.headless(&system_root())
    } else {
        action
    })
}

fn observed_action(j: &Value) -> Option<Action> {
    Some(Action {
        command: j["Exe"].as_str().filter(|e| !e.is_empty())?.to_owned(),
        arguments: j["Arguments"].as_str().map(str::to_owned),
        working_directory: j["WorkingDirectory"].as_str().map(str::to_owned),
    })
}

/// Same program and arguments, and the same working directory when one is declared.
fn action_matches(declared: &Action, seen: &Action) -> bool {
    let dir = |a: &Action| {
        a.working_directory
            .as_deref()
            .map(|d| d.trim_end_matches('\\').to_ascii_lowercase())
    };
    declared.same_program(seen)
        && (declared.working_directory.is_none() || dir(declared) == dir(seen))
}

/// Reads the Windows entries of the local host in-process.
fn observe_windows(
    host: &str,
    entries: &[(usize, &BootEntry)],
) -> Result<HashMap<usize, Observed>> {
    if !crate::lifecycle::is_local_target(host) {
        bail!("les entrées Windows ne s'exécutent que sur l'hôte local");
    }
    let mut scheduler = None;
    let mut map = HashMap::new();
    for (i, entry) in entries {
        let observed = match &entry.kind {
            BootKind::ScheduledTask { .. } => {
                if scheduler.is_none() {
                    scheduler = Some(Scheduler::connect()?);
                }
                let Some(scheduler) = scheduler.as_ref() else {
                    continue;
                };
                match scheduler.get(&task_path(entry))? {
                    None => Observed::Missing,
                    Some(registered) => {
                        let seen = wintask::observe(&registered.xml);
                        let action = seen.action.unwrap_or(Action {
                            command: String::new(),
                            arguments: None,
                            working_directory: None,
                        });
                        Observed::Json(json!({
                            "State": registered.state,
                            "Enabled": registered.enabled,
                            "Hidden": seen.hidden,
                            "Logon": seen.logon,
                            "Exe": action.command,
                            "Arguments": action.arguments,
                            "WorkingDirectory": action.working_directory,
                            "RestartCount": seen.restart_count,
                            "Triggers": seen.triggers,
                        }))
                    }
                }
            }
            BootKind::WindowsService { name, .. } => match crate::winsvc::query(name)? {
                None => Observed::Missing,
                Some(state) => Observed::Json(json!({
                    "StartMode": state.start_mode,
                    "State": state.state,
                    "FailureRestart": state.failure_restart,
                })),
            },
            _ => continue,
        };
        map.insert(*i, observed);
    }
    Ok(map)
}

/// Registers or corrects one scheduled task through the Task Scheduler, then starts it when it
/// is long-running and not running.
fn apply_task(entry: &BootEntry) -> Result<String> {
    let BootKind::ScheduledTask {
        triggers,
        description,
        principal,
        run_level,
        desktop,
        periodic,
        time_limit_minutes,
        path,
        name,
        ..
    } = &entry.kind
    else {
        bail!("{} n'est pas une tâche planifiée", entry.label());
    };
    let principal = task_principal(principal, *desktop);
    let highest = run_level != "limited";
    let triggers: Vec<Trigger> = triggers
        .iter()
        .map(|t| Trigger::parse(t).with_context(|| format!("déclencheur inconnu {t:?}")))
        .collect::<Result<_>>()?;
    let full = task_path(entry);
    let user = wintask::current_user();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let declared = declared_action(entry);
    let scheduler = Scheduler::connect()?;
    let mut done = Vec::new();
    match scheduler.get(&full)? {
        None => {
            let Some(action) = declared else {
                bail!("tâche {full} absente et sans commande déclarée");
            };
            let spec = TaskSpec {
                path: path.clone(),
                name: name.clone(),
                description: description.clone(),
                action,
                principal,
                highest,
                triggers,
                settings: Settings {
                    restart: !*periodic,
                    time_limit_minutes: *time_limit_minutes,
                },
            };
            scheduler.register(
                &full,
                &wintask::task_xml(&spec, &user, &today),
                principal,
                &user,
            )?;
            done.push("enregistrée");
        }
        Some(registered) => {
            let seen = wintask::observe(&registered.xml).action;
            let action = match (declared, seen) {
                (Some(declared), Some(seen))
                    if action_matches(&declared, &seen) && (!*desktop || seen.is_headless()) =>
                {
                    None
                }
                (Some(declared), _) => Some(declared),
                (None, Some(seen)) if *desktop && !seen.is_headless() => {
                    Some(seen.headless(&system_root()))
                }
                (None, _) => None,
            };
            let patch = Patch {
                principal,
                highest,
                settings: (!*periodic).then_some(Settings {
                    restart: true,
                    time_limit_minutes: None,
                }),
                add_triggers: triggers,
                action,
            };
            let xml = wintask::patch_xml(&registered.xml, &patch, &user, &today);
            scheduler.register(&full, &xml, principal, &user)?;
            done.push("mise à jour");
        }
    }
    if !*periodic && scheduler.get(&full)?.is_some_and(|r| r.state != "Running") {
        scheduler.run(&full)?;
        done.push("démarrée");
    }
    Ok(format!("{full} {}", done.join(", ")))
}

/// Corrects one Windows entry in-process.
fn apply_windows(entry: &BootEntry) -> Result<String> {
    match &entry.kind {
        BootKind::ScheduledTask { .. } => apply_task(entry),
        BootKind::WindowsService {
            name,
            restart_on_failure,
        } => {
            let done = crate::winsvc::ensure(name, *restart_on_failure)?;
            Ok(format!(
                "service {name} {}",
                if done.is_empty() {
                    "inchangé".to_owned()
                } else {
                    done.join(", ")
                }
            ))
        }
        _ => bail!("{} n'est pas une entrée Windows", entry.label()),
    }
}

/// Runs this same command line with administrator rights (`sudo.exe` inline, else UAC) and
/// returns its exit code; only the `aphrody` binaries relaunch themselves.
pub(crate) fn relaunch_elevated(command: &str) -> Result<i32> {
    let exe = std::env::current_exe().context("exécutable courant")?;
    let stem = exe
        .file_stem()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !stem.starts_with("aphrody") {
        bail!("droits administrateur requis : relancer `aphrody infra {command}` élevé");
    }
    let path = aphrody_proc::Elevation::detect().context("élévation")?;
    eprintln!(
        "{command}: corrections Windows en attente, relance élevée ({})",
        path.label()
    );
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    aphrody_proc::run_elevated(exe.as_os_str(), &args, None).context("relance élevée")
}

/// Probe script for the Linux entries of one host (`@@<index>` header then `key=value` lines).
#[must_use]
pub fn linux_probe(entries: &[(usize, &BootEntry)]) -> String {
    let mut s = String::new();
    for (i, e) in entries {
        match &e.kind {
            BootKind::Systemd { unit } => s.push_str(&format!(
                "echo '@@{i}'; systemctl show {} -p LoadState,UnitFileState,ActiveState,Restart,Type,RemainAfterExit 2>/dev/null; ",
                q(unit)
            )),
            BootKind::Docker { container } => s.push_str(&format!(
                "echo '@@{i}'; docker inspect -f 'restart={{{{.HostConfig.RestartPolicy.Name}}}}{{{{\"\\n\"}}}}running={{{{.State.Running}}}}{{{{\"\\n\"}}}}status={{{{.State.Status}}}}' {} 2>/dev/null; ",
                q(container)
            )),
            _ => {},
        }
    }
    s
}

/// Parses the `@@<index>` blocks of a Linux probe; entries without a block are `Missing`.
#[must_use]
pub fn parse_probe(entries: &[(usize, &BootEntry)], output: &str) -> HashMap<usize, Observed> {
    let mut blocks: HashMap<usize, Vec<&str>> = HashMap::new();
    let mut current = None;
    for line in output.lines() {
        if let Some(idx) = line.trim().strip_prefix("@@") {
            current = idx.parse::<usize>().ok();
            if let Some(i) = current {
                blocks.entry(i).or_default();
            }
        } else if let (Some(i), false) = (current, line.trim().is_empty()) {
            blocks.entry(i).or_default().push(line.trim());
        }
    }
    let mut map = HashMap::new();
    for (i, e) in entries {
        let lines = blocks.get(i).cloned().unwrap_or_default();
        let observed = if e.is_windows() || lines.is_empty() {
            Observed::Missing
        } else {
            Observed::Props(
                lines
                    .iter()
                    .filter_map(|l| l.split_once('='))
                    .map(|(k, v)| (k.to_owned(), v.to_owned()))
                    .collect(),
            )
        };
        map.insert(*i, observed);
    }
    map
}

/// Runs an `sh` script on a Linux target (locally or over SSH).
fn run_host(host: &str, script: &str) -> Result<String> {
    let argv: Vec<String> = vec!["sh".into(), "-c".into(), script.into()];
    let out = crate::lifecycle::run_on_target(host, &argv)
        .with_context(|| format!("{host}: exécution"))?;
    if !out.status.success() && out.stdout.is_empty() {
        bail!("{host}: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum BootAction {
    Plan,
    Apply,
    Audit,
}

#[derive(Debug, Serialize)]
pub struct HostReport {
    pub host: String,
    pub checked: usize,
    pub error: Option<String>,
    pub findings: Vec<Finding>,
    pub applied: Vec<String>,
}

fn hosts_of(entries: &[BootEntry], only: Option<&str>) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for e in entries {
        if only.is_none_or(|o| o == e.host) && !hosts.contains(&e.host) {
            hosts.push(e.host.clone());
        }
    }
    hosts
}

fn audit_host(entries: &[BootEntry], host: &str) -> Result<(usize, Vec<Finding>)> {
    let mut findings = Vec::new();
    let mut checked = 0;
    for windows in [false, true] {
        let subset: Vec<(usize, &BootEntry)> = entries
            .iter()
            .enumerate()
            .filter(|(_, e)| e.host == host && e.is_windows() == windows)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let observed = if windows {
            observe_windows(host, &subset)?
        } else {
            parse_probe(&subset, &run_host(host, &linux_probe(&subset))?)
        };
        for (i, e) in &subset {
            checked += 1;
            findings.extend(evaluate(e, &observed[i]));
        }
    }
    Ok((checked, findings))
}

/// `entry` limits the run to one entry, by name (`Container`, `nginx.service`) or label (`local:Container`).
pub fn run_boot(
    root: &Path,
    action: BootAction,
    host: Option<&str>,
    entry: Option<&str>,
    json: bool,
) -> Result<bool> {
    let mut entries = load_entries(root)?;
    if let Some(wanted) = entry {
        entries.retain(|e| e.name() == wanted || e.label() == wanted);
        if entries.is_empty() {
            bail!("aucune entrée de boot nommée {wanted}");
        }
    }
    let hosts = hosts_of(&entries, host);
    if hosts.is_empty() {
        bail!(
            "aucune entrée de boot pour l'hôte {}",
            host.unwrap_or("<tous>")
        );
    }
    let mut reports = Vec::new();
    for h in &hosts {
        let mut report = HostReport {
            host: h.clone(),
            checked: 0,
            error: None,
            findings: vec![],
            applied: vec![],
        };
        match audit_host(&entries, h) {
            Ok((n, findings)) => {
                report.checked = n;
                report.findings = findings;
            }
            Err(e) => report.error = Some(format!("{e:#}")),
        }
        reports.push(report);
    }
    let windows_pending = reports
        .iter()
        .filter(|r| r.error.is_none())
        .flat_map(|r| &r.findings)
        .any(|f| {
            f.held.is_none()
                && f.fix.is_some()
                && entries
                    .iter()
                    .any(|e| e.label() == f.entry && e.is_windows())
        });
    if action == BootAction::Apply
        && windows_pending
        && cfg!(windows)
        && !aphrody_proc::is_elevated()
    {
        // The elevated run applies and reports everything; this one only recomputes the drift.
        let code = relaunch_elevated("boot apply")?;
        if code != 0 {
            bail!("apply élevé : code de sortie {code}");
        }
        return Ok(hosts.iter().any(|h| {
            audit_host(&entries, h).map_or(true, |(_, findings)| {
                findings.iter().any(|f| f.held.is_none())
            })
        }));
    }
    if action == BootAction::Apply {
        for report in reports.iter_mut().filter(|r| r.error.is_none()) {
            let h = report.host.clone();
            for f in report.findings.iter().filter(|f| f.held.is_none()) {
                let Some(fix) = &f.fix else { continue };
                let windows_entry = entries
                    .iter()
                    .find(|e| e.label() == f.entry && e.is_windows());
                let result = match windows_entry {
                    Some(entry) => apply_windows(entry),
                    None => run_host(&h, fix).map(|_| f.entry.clone()),
                };
                match result {
                    Ok(done) => report.applied.push(done),
                    Err(e) => report.applied.push(format!("{} ÉCHEC: {e:#}", f.entry)),
                }
            }
            if !report.applied.is_empty() {
                let (n, findings) = audit_host(&entries, &h)?;
                report.checked = n;
                report.findings = findings;
            }
        }
    }
    let drift = reports
        .iter()
        .any(|r| r.error.is_some() || r.findings.iter().any(|f| f.held.is_none()));
    if json {
        println!("{}", serde_json::to_string_pretty(&reports)?);
    } else {
        for r in &reports {
            println!("== {} ({} entrées)", r.host, r.checked);
            if let Some(e) = &r.error {
                println!("  ERREUR {e}");
            }
            for f in &r.findings {
                let held = f
                    .held
                    .as_deref()
                    .map_or(String::new(), |h| format!(" [retenu: {h}]"));
                println!("  DÉRIVE {}: {}{held}", f.entry, f.problem);
                if action == BootAction::Plan {
                    match (&f.fix, &f.held) {
                        (Some(fix), None) => println!("    -> {fix}"),
                        (Some(_), Some(_)) => println!("    -> (non appliqué)"),
                        (None, _) => println!("    -> correction manuelle (source/déploiement)"),
                    }
                }
            }
            for a in &r.applied {
                println!("  appliqué {a}");
            }
            if r.findings.is_empty() && r.error.is_none() {
                println!("  conforme");
            }
        }
    }
    Ok(drift)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(pairs: &[(&str, &str)]) -> Observed {
        Observed::Props(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        )
    }

    fn unit(u: &str) -> BootEntry {
        BootEntry {
            host: "vps".into(),
            kind: BootKind::Systemd { unit: u.into() },
            hold: None,
        }
    }

    #[test]
    fn systemd_compliant() {
        let e = unit("a.service");
        let o = props(&[
            ("LoadState", "loaded"),
            ("UnitFileState", "enabled"),
            ("ActiveState", "active"),
            ("Restart", "on-failure"),
            ("Type", "simple"),
        ]);
        assert!(evaluate(&e, &o).is_empty());
    }

    #[test]
    fn systemd_disabled_gets_enable_now() {
        let e = unit("a.service");
        let o = props(&[
            ("LoadState", "loaded"),
            ("UnitFileState", "disabled"),
            ("ActiveState", "inactive"),
            ("Restart", "always"),
        ]);
        let f = evaluate(&e, &o);
        assert_eq!(f.len(), 1);
        assert!(
            f[0].fix
                .as_deref()
                .unwrap()
                .contains("enable --now 'a.service'")
        );
    }

    #[test]
    fn systemd_missing_restart_is_manual_and_oneshot_exempt() {
        let base = [
            ("LoadState", "loaded"),
            ("UnitFileState", "enabled"),
            ("ActiveState", "active"),
        ];
        let mut p = base.to_vec();
        p.push(("Restart", "no"));
        let f = evaluate(&unit("a.service"), &props(&p));
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
        p.push(("Type", "oneshot"));
        assert!(evaluate(&unit("a.service"), &props(&p)).is_empty());
        let mut t = base.to_vec();
        t.push(("Restart", "no"));
        assert!(evaluate(&unit("a.timer"), &props(&t)).is_empty());
    }

    #[test]
    fn systemd_absent_unit_is_manual() {
        let f = evaluate(&unit("a.service"), &props(&[("LoadState", "not-found")]));
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
    }

    #[test]
    fn docker_policy_and_running() {
        let e = BootEntry {
            host: "dbfr".into(),
            kind: BootKind::Docker {
                container: "c1".into(),
            },
            hold: None,
        };
        assert!(
            evaluate(
                &e,
                &props(&[("restart", "unless-stopped"), ("running", "true")])
            )
            .is_empty()
        );
        let f = evaluate(
            &e,
            &props(&[
                ("restart", "no"),
                ("running", "false"),
                ("status", "exited"),
            ]),
        );
        assert_eq!(f.len(), 2);
        assert!(
            f[0].fix
                .as_deref()
                .unwrap()
                .contains("update --restart unless-stopped")
        );
        assert!(f[1].fix.as_deref().unwrap().contains("docker start"));
    }

    fn task() -> BootEntry {
        BootEntry {
            host: "local".into(),
            kind: BootKind::ScheduledTask {
                name: "T".into(),
                path: "\\Aphrody\\".into(),
                triggers: vec!["atStartup".into()],
                execute: None,
                arguments: None,
                working_directory: None,
                description: None,
                principal: "user".into(),
                run_level: default_run_level(),
                desktop: false,
                periodic: false,
                time_limit_minutes: None,
            },
            hold: None,
        }
    }

    fn set_task(
        entry: &mut BootEntry,
        f: impl FnOnce(&mut bool, &mut bool, &mut Option<String>, &mut Option<String>),
    ) {
        if let BootKind::ScheduledTask {
            desktop,
            periodic,
            execute,
            arguments,
            ..
        } = &mut entry.kind
        {
            f(desktop, periodic, execute, arguments);
        }
    }

    #[test]
    fn task_needs_startup_trigger_and_restart() {
        let ok = Observed::Json(
            serde_json::json!({"State":"Running","Enabled":true,"RestartCount":999,"Hidden":true,"Logon":"S4U","Triggers":["atStartup","atLogon"]}),
        );
        assert!(evaluate(&task(), &ok).is_empty());
        let bad = Observed::Json(
            serde_json::json!({"State":"Running","Enabled":true,"RestartCount":0,"Triggers":["atLogon"]}),
        );
        let f = evaluate(&task(), &bad);
        assert_eq!(f.len(), 1);
        let fix = f[0].fix.as_deref().unwrap();
        assert!(fix.starts_with("mettre à jour \\Aphrody\\T"), "{fix}");
        assert!(
            fix.contains("+atStartup")
                && fix.contains("redémarrage sur échec 999")
                && fix.contains("principal S4U")
        );
    }

    #[test]
    fn visible_or_interactive_task_is_corrected_hidden_s4u() {
        let vis = Observed::Json(
            serde_json::json!({"State":"Running","Enabled":true,"RestartCount":999,"Hidden":false,"Logon":"Interactive","Triggers":["atStartup"]}),
        );
        let f = evaluate(&task(), &vis);
        assert_eq!(f.len(), 1);
        assert!(
            f[0].problem.contains("non cachée") && f[0].problem.contains("session Interactive")
        );
        let fix = f[0].fix.as_deref().unwrap();
        assert!(fix.contains("cachée") && fix.contains("S4U") && !fix.contains("conhost"));
    }

    #[test]
    fn desktop_task_is_interactive_and_wrapped_headless() {
        let mut e = task();
        set_task(&mut e, |desktop, _, execute, _| {
            *desktop = true;
            *execute = Some("C:\\x\\a.exe".into());
        });
        let bare = Observed::Json(
            serde_json::json!({"State":"Running","Enabled":true,"RestartCount":999,"Hidden":true,"Logon":"Interactive","Exe":"C:\\x\\a.exe","Triggers":["atStartup"]}),
        );
        let f = evaluate(&e, &bare);
        assert_eq!(f.len(), 1);
        let fix = f[0].fix.as_deref().unwrap();
        assert!(fix.contains("conhost --headless"), "{fix}");
        let ok = Observed::Json(
            serde_json::json!({"State":"Running","Enabled":true,"RestartCount":999,"Hidden":true,"Logon":"Interactive","Exe":"C:\\Windows\\system32\\conhost.exe","Arguments":"--headless \"C:\\x\\a.exe\"","Triggers":["atStartup"]}),
        );
        assert!(evaluate(&e, &ok).is_empty());
        let missing = evaluate(&e, &Observed::Missing);
        let fix = missing[0].fix.as_deref().unwrap();
        assert!(
            fix.starts_with("enregistrer \\Aphrody\\T (Interactive"),
            "{fix}"
        );
        assert_eq!(
            declared_action(&e).unwrap().arguments.as_deref(),
            Some("--headless \"C:\\x\\a.exe\"")
        );
    }

    #[test]
    fn declared_action_drift_is_detected() {
        let mut e = task();
        set_task(&mut e, |_, periodic, execute, arguments| {
            *periodic = true;
            *execute = Some("conhost.exe".into());
            *arguments = Some("--headless \"C:\\b\\bun.exe\" x.ts".into());
        });
        let same = Observed::Json(
            serde_json::json!({"State":"Ready","Enabled":true,"Hidden":true,"Logon":"S4U","Exe":"C:\\WINDOWS\\System32\\conhost.exe","Arguments":"--headless \"C:\\b\\bun.exe\" x.ts","Triggers":["atStartup"]}),
        );
        assert!(evaluate(&e, &same).is_empty());
        let other = Observed::Json(
            serde_json::json!({"State":"Ready","Enabled":true,"Hidden":true,"Logon":"S4U","Exe":"pwsh.exe","Arguments":"-File old.ps1","Triggers":["atStartup"]}),
        );
        let f = evaluate(&e, &other);
        assert_eq!(f.len(), 1);
        assert!(
            f[0].problem.contains("action pwsh.exe")
                && f[0].fix.as_deref().unwrap().contains("action déclarée")
        );
    }

    #[test]
    fn periodic_task_checks_visibility_triggers_and_not_run_state() {
        let mut e = task();
        set_task(&mut e, |_, periodic, _, _| *periodic = true);
        let ok = Observed::Json(
            serde_json::json!({"State":"Ready","Enabled":true,"RestartCount":0,"Hidden":true,"Logon":"S4U","Triggers":["atStartup","every:30m"]}),
        );
        assert!(evaluate(&e, &ok).is_empty());
        let vis = Observed::Json(
            serde_json::json!({"State":"Ready","Enabled":true,"RestartCount":0,"Hidden":false,"Logon":"Interactive","Triggers":[]}),
        );
        let f = evaluate(&e, &vis);
        assert_eq!(f.len(), 1);
        let fix = f[0].fix.as_deref().unwrap();
        assert!(fix.contains("cachée") && fix.contains("+atStartup"));
        assert!(!fix.contains("démarrée") && !fix.contains("redémarrage"));
    }

    #[test]
    fn missing_task_without_command_has_no_fix_script_registration() {
        let f = evaluate(&task(), &Observed::Missing);
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
    }

    #[test]
    fn windows_service_auto_and_failure_actions() {
        let e = BootEntry {
            host: "local".into(),
            kind: BootKind::WindowsService {
                name: "S".into(),
                restart_on_failure: true,
            },
            hold: None,
        };
        let ok = Observed::Json(
            serde_json::json!({"StartMode":"Auto","State":"Running","FailureRestart":true}),
        );
        assert!(evaluate(&e, &ok).is_empty());
        let bad = Observed::Json(
            serde_json::json!({"StartMode":"Manual","State":"Stopped","FailureRestart":false}),
        );
        let f = evaluate(&e, &bad);
        let fix = f[0].fix.as_deref().unwrap();
        assert!(
            fix.contains("démarrage Auto")
                && fix.contains("actions d'échec")
                && fix.contains("démarré")
        );
    }

    #[test]
    fn task_program_expands_root_and_environment() {
        let mut e = task();
        set_task(&mut e, |_, _, execute, arguments| {
            *execute = Some("%APHRODY_BOOT_TEST_BIN%\\bun.exe".into());
            *arguments = Some("{root}/scripts/x.ts".into());
        });
        // SAFETY: test-local variable name, no other test reads it.
        unsafe { std::env::set_var("APHRODY_BOOT_TEST_BIN", "C:\\b") };
        expand_task(Path::new("\\\\?\\C:\\repo"), &mut e);
        let action = declared_action(&e).unwrap();
        assert_eq!(action.command, "C:\\b\\bun.exe");
        assert_eq!(action.arguments.as_deref(), Some("C:\\repo/scripts/x.ts"));
    }

    /// Read-only audit of the declared local Windows entries through COM and the SCM.
    #[cfg(windows)]
    #[test]
    fn local_windows_entries_are_readable() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let entries = load_entries(&root).unwrap();
        let (checked, findings) = audit_host(&entries, "local").unwrap();
        assert!(checked >= entries.iter().filter(|e| e.host == "local").count());
        for f in findings {
            println!(
                "{}: {} -> {}",
                f.entry,
                f.problem,
                f.fix.unwrap_or_default()
            );
        }
    }

    /// Every declared Windows trigger is in the native vocabulary.
    #[test]
    fn catalog_task_triggers_parse() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for entry in load_entries(&root).unwrap() {
            if let BootKind::ScheduledTask { triggers, .. } = &entry.kind {
                for t in triggers {
                    assert!(Trigger::parse(t).is_some(), "{}: {t}", entry.label());
                }
            }
        }
    }

    #[test]
    fn hold_is_carried_to_findings() {
        let mut e = unit("a.service");
        e.hold = Some("autre agent".into());
        let f = evaluate(&e, &props(&[("LoadState", "not-found")]));
        assert_eq!(f[0].held.as_deref(), Some("autre agent"));
    }

    #[test]
    fn parse_probe_blocks() {
        let e = unit("a.service");
        let d = BootEntry {
            host: "vps".into(),
            kind: BootKind::Docker {
                container: "c".into(),
            },
            hold: None,
        };
        let entries = [(0usize, &e), (1usize, &d)];
        let m = parse_probe(&entries, "@@0\nLoadState=loaded\nRestart=always\n@@1\n");
        assert!(matches!(&m[&0], Observed::Props(p) if p["Restart"] == "always"));
        assert_eq!(m[&1], Observed::Missing);
    }

    #[test]
    fn merge_skips_retired_and_prefers_container() {
        let services: Vec<CatalogService> = serde_json::from_value(serde_json::json!([
            {"id":"a","kind":"k","runtime":"r","unit":"a.service","host":"vps"},
            {"id":"b","kind":"k","runtime":"r","unit":"b.service","host":"vps","status":"retired","retiredAt":"2026-10-09"},
            {"id":"c","kind":"k","runtime":"r","unit":"c.service","container":"c-1","host":"dbfr"},
            {"id":"d","kind":"k","runtime":"r","unit":"d.service"}
        ]))
        .unwrap();
        let explicit = vec![unit("a.service")];
        let merged = merge_entries(&services, explicit);
        assert_eq!(merged.len(), 2);
        assert!(
            merged
                .iter()
                .any(|e| matches!(&e.kind, BootKind::Docker { container } if container == "c-1"))
        );
    }

    #[test]
    fn entries_deserialize_flat() {
        let e: BootEntry = serde_json::from_value(serde_json::json!(
            {"host":"local","kind":"scheduledTask","name":"X","triggers":["atStartup"]}
        ))
        .unwrap();
        assert!(
            matches!(e.kind, BootKind::ScheduledTask { ref path, .. } if path == "\\Aphrody\\")
        );
    }
}
