// SPDX-License-Identifier: Apache-2.0
//! Systemd service and unit supervisor, dependency resolver (DAG), and watchdog.

#[cfg(unix)]
use aphrody_proc::NoWindow as _;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::systemd::{
    journal::{Journal, LogLevel},
    unit::{ActiveState, Unit, UnitType},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitStatus {
    pub name: String,
    pub unit_type: UnitType,
    pub description: String,
    pub state: ActiveState,
    pub sub_state: String,
    pub main_pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub restart_count: u32,
    pub dependencies: Vec<String>,
}

pub struct ServiceManager {
    units: RwLock<HashMap<String, Unit>>,
    journal: Arc<Journal>,
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self::new(Arc::new(Journal::default()))
    }
}

impl ServiceManager {
    #[must_use]
    pub fn new(journal: Arc<Journal>) -> Self {
        let manager = Self {
            units: RwLock::new(HashMap::new()),
            journal,
        };
        manager.register_default_units();
        manager
    }

    #[must_use]
    pub fn journal(&self) -> Arc<Journal> {
        Arc::clone(&self.journal)
    }

    fn register_default_units(&self) {
        let mut default_target = Unit::new("default.target", UnitType::Target, "Default Target");
        default_target.wants = vec!["graphical.target".to_owned()];
        default_target.state = ActiveState::Active;
        default_target.sub_state = "active".to_owned();

        let mut graphical_target =
            Unit::new("graphical.target", UnitType::Target, "Graphical Interface");
        graphical_target.after = vec!["multi-user.target".to_owned()];
        graphical_target.wants = vec![
            "multi-user.target".to_owned(),
            "aphrody-shell.service".to_owned(),
        ];
        graphical_target.state = ActiveState::Active;
        graphical_target.sub_state = "active".to_owned();

        let mut multi_user = Unit::new("multi-user.target", UnitType::Target, "Multi-User System");
        multi_user.wants = vec!["aphrody-kernel.service".to_owned()];
        multi_user.state = ActiveState::Active;
        multi_user.sub_state = "active".to_owned();

        let mut kernel_svc = Unit::new(
            "aphrody-kernel.service",
            UnitType::Service,
            "Aphrody OS Privileged Control Plane",
        );
        kernel_svc.state = ActiveState::Active;
        kernel_svc.sub_state = "running".to_owned();
        kernel_svc.main_pid = Some(std::process::id());
        kernel_svc.started_at_usec = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_micros() as u64)
                .unwrap_or(0),
        );

        let mut shell_svc = Unit::new(
            "aphrody-shell.service",
            UnitType::Service,
            "Aphrody Graphical Desktop Shell",
        );
        shell_svc.after = vec!["aphrody-kernel.service".to_owned()];
        shell_svc.state = ActiveState::Active;
        shell_svc.sub_state = "running".to_owned();
        shell_svc.main_pid = Some(std::process::id());
        shell_svc.started_at_usec = kernel_svc.started_at_usec;

        let mut units = self.units.write().expect("units write lock");
        units.insert("default.target".to_owned(), default_target);
        units.insert("graphical.target".to_owned(), graphical_target);
        units.insert("multi-user.target".to_owned(), multi_user);
        units.insert("aphrody-kernel.service".to_owned(), kernel_svc);
        units.insert("aphrody-shell.service".to_owned(), shell_svc);
    }

    pub fn load_unit(&self, unit: Unit) {
        let name = unit.name.clone();
        let mut units = self.units.write().expect("units write lock");
        units.insert(name, unit);
    }

    pub fn load_unit_ini(&self, name: &str, content: &str) -> Result<(), String> {
        let unit = Unit::parse_ini(name, content)?;
        self.load_unit(unit);
        self.journal.log(
            name,
            LogLevel::Info,
            None,
            format!("Unit {name} loaded from configuration"),
        );
        Ok(())
    }

    pub fn list_units(&self) -> Vec<UnitStatus> {
        let units = self.units.read().expect("units read lock");
        let now_usec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0);

        let mut list = Vec::new();
        for unit in units.values() {
            let uptime_secs = unit.started_at_usec.map(|started| {
                if now_usec > started {
                    (now_usec - started) / 1_000_000
                } else {
                    0
                }
            });

            let mut dependencies = unit.requires.clone();
            dependencies.extend(unit.wants.clone());

            list.push(UnitStatus {
                name: unit.name.clone(),
                unit_type: unit.unit_type,
                description: unit.description.clone(),
                state: unit.state,
                sub_state: unit.sub_state.clone(),
                main_pid: unit.main_pid,
                uptime_secs,
                restart_count: unit.restart_count,
                dependencies,
            });
        }
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn get_unit_status(&self, name: &str) -> Result<UnitStatus, String> {
        let units = self.units.read().expect("units read lock");
        let unit = units
            .get(name)
            .ok_or_else(|| format!("unit `{name}` not found"))?;
        let now_usec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0);

        let uptime_secs = unit.started_at_usec.map(|started| {
            if now_usec > started {
                (now_usec - started) / 1_000_000
            } else {
                0
            }
        });

        let mut dependencies = unit.requires.clone();
        dependencies.extend(unit.wants.clone());

        Ok(UnitStatus {
            name: unit.name.clone(),
            unit_type: unit.unit_type,
            description: unit.description.clone(),
            state: unit.state,
            sub_state: unit.sub_state.clone(),
            main_pid: unit.main_pid,
            uptime_secs,
            restart_count: unit.restart_count,
            dependencies,
        })
    }

    /// Resolve dependency ordering (topological sort of units to start).
    pub fn resolve_order(&self, target_name: &str) -> Result<Vec<String>, String> {
        let units = self.units.read().expect("units read lock");
        if !units.contains_key(target_name) {
            return Err(format!("target unit `{target_name}` not found"));
        }

        let mut visited = HashSet::new();
        let mut order = Vec::new();
        let mut queue = VecDeque::new();
        queue.push_back(target_name.to_owned());

        while let Some(current) = queue.pop_front() {
            if !visited.insert(current.clone()) {
                continue;
            }

            if let Some(unit) = units.get(&current) {
                for req in &unit.requires {
                    if !visited.contains(req) {
                        queue.push_back(req.clone());
                    }
                }
                for want in &unit.wants {
                    if !visited.contains(want) {
                        queue.push_back(want.clone());
                    }
                }
                for after in &unit.after {
                    if !visited.contains(after) {
                        queue.push_back(after.clone());
                    }
                }
                order.push(current);
            }
        }

        order.reverse();
        Ok(order)
    }

    pub fn start_unit(&self, name: &str) -> Result<(), String> {
        let mut units = self.units.write().expect("units write lock");
        let unit = units
            .get_mut(name)
            .ok_or_else(|| format!("unit `{name}` not found"))?;

        if unit.state == ActiveState::Active {
            return Ok(());
        }

        unit.state = ActiveState::Activating;
        unit.sub_state = "start-pre".to_owned();
        self.journal
            .log(name, LogLevel::Info, None, format!("Starting {name}..."));

        let now_usec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros() as u64)
            .unwrap_or(0);

        unit.state = ActiveState::Active;
        unit.sub_state = "running".to_owned();
        unit.started_at_usec = Some(now_usec);
        self.journal.log(
            name,
            LogLevel::Info,
            unit.main_pid,
            format!("Started {name}"),
        );
        Ok(())
    }

    pub fn stop_unit(&self, name: &str) -> Result<(), String> {
        let mut units = self.units.write().expect("units write lock");
        let unit = units
            .get_mut(name)
            .ok_or_else(|| format!("unit `{name}` not found"))?;

        if unit.state == ActiveState::Inactive {
            return Ok(());
        }

        unit.state = ActiveState::Deactivating;
        unit.sub_state = "stop-sigterm".to_owned();
        self.journal.log(
            name,
            LogLevel::Info,
            unit.main_pid,
            format!("Stopping {name}..."),
        );

        unit.state = ActiveState::Inactive;
        unit.sub_state = "dead".to_owned();
        unit.main_pid = None;
        unit.started_at_usec = None;
        self.journal
            .log(name, LogLevel::Info, None, format!("Stopped {name}"));
        Ok(())
    }

    pub fn restart_unit(&self, name: &str) -> Result<(), String> {
        self.stop_unit(name)?;
        {
            let mut units = self.units.write().expect("units write lock");
            if let Some(unit) = units.get_mut(name) {
                unit.restart_count += 1;
            }
        }
        self.start_unit(name)
    }

    pub fn reload_unit(&self, name: &str) -> Result<(), String> {
        let units = self.units.read().expect("units read lock");
        let _ = units
            .get(name)
            .ok_or_else(|| format!("unit `{name}` not found"))?;
        self.journal.log(
            name,
            LogLevel::Notice,
            None,
            format!("Reloaded configuration for {name}"),
        );
        Ok(())
    }
}

/// Common trait implemented by both the in-process virtual supervisor and host systemd controllers.
#[async_trait::async_trait]
pub trait SystemdSupervisor: Send + Sync {
    async fn start_unit(&self, name: &str) -> Result<(), String>;
    async fn stop_unit(&self, name: &str) -> Result<(), String>;
    async fn restart_unit(&self, name: &str) -> Result<(), String>;
    async fn reload_unit(&self, name: &str) -> Result<(), String>;
    async fn unit_status(&self, name: &str) -> Option<UnitStatus>;
    async fn list_units(&self) -> Vec<UnitStatus>;
}

/// The in-process DAG service supervisor for development, testing, and desktop shell.
pub type VirtualSupervisor = ServiceManager;

#[async_trait::async_trait]
impl SystemdSupervisor for ServiceManager {
    async fn start_unit(&self, name: &str) -> Result<(), String> {
        ServiceManager::start_unit(self, name)
    }

    async fn stop_unit(&self, name: &str) -> Result<(), String> {
        ServiceManager::stop_unit(self, name)
    }

    async fn restart_unit(&self, name: &str) -> Result<(), String> {
        ServiceManager::restart_unit(self, name)
    }

    async fn reload_unit(&self, name: &str) -> Result<(), String> {
        ServiceManager::reload_unit(self, name)
    }

    async fn unit_status(&self, name: &str) -> Option<UnitStatus> {
        self.get_unit_status(name).ok()
    }

    async fn list_units(&self) -> Vec<UnitStatus> {
        ServiceManager::list_units(self)
    }
}

/// Controller for the host Linux systemd init system (e.g. on a production VPS).
#[derive(Debug, Default, Clone)]
pub struct HostSystemdBackend {
    /// Whether to scope commands to the user session (`systemctl --user`).
    pub user_mode: bool,
}

impl HostSystemdBackend {
    #[must_use]
    pub fn new(user_mode: bool) -> Self {
        Self { user_mode }
    }

    fn run_systemctl(&self, action: &str, name: &str) -> Result<(), String> {
        #[cfg(unix)]
        {
            let mut cmd = std::process::Command::new("systemctl").no_window();
            if self.user_mode {
                cmd.arg("--user");
            }
            cmd.arg(action).arg(name);
            let output = cmd
                .output()
                .map_err(|e| format!("failed to execute systemctl: {e}"))?;
            if output.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                Err(format!("systemctl {action} failed: {}", err.trim()))
            }
        }
        #[cfg(not(unix))]
        {
            let _ = (action, name);
            Err("host systemd is only available on Unix/Linux".to_string())
        }
    }
}

#[async_trait::async_trait]
impl SystemdSupervisor for HostSystemdBackend {
    async fn start_unit(&self, name: &str) -> Result<(), String> {
        self.run_systemctl("start", name)
    }

    async fn stop_unit(&self, name: &str) -> Result<(), String> {
        self.run_systemctl("stop", name)
    }

    async fn restart_unit(&self, name: &str) -> Result<(), String> {
        self.run_systemctl("restart", name)
    }

    async fn reload_unit(&self, name: &str) -> Result<(), String> {
        self.run_systemctl("reload", name)
    }

    async fn unit_status(&self, name: &str) -> Option<UnitStatus> {
        #[cfg(unix)]
        {
            let mut cmd = std::process::Command::new("systemctl").no_window();
            if self.user_mode {
                cmd.arg("--user");
            }
            cmd.args([
                "show",
                name,
                "--property=ActiveState,SubState,MainPID,Description",
            ]);
            let output = cmd.output().ok()?;
            if !output.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&output.stdout);
            let mut active = "inactive";
            let mut sub = "dead".to_string();
            let mut pid = None;
            let mut desc = name.to_string();
            for line in text.lines() {
                if let Some(val) = line.strip_prefix("ActiveState=") {
                    active = val;
                } else if let Some(val) = line.strip_prefix("SubState=") {
                    sub = val.to_string();
                } else if let Some(val) = line.strip_prefix("MainPID=") {
                    pid = val.parse::<u32>().ok().filter(|&p| p > 0);
                } else if let Some(val) = line.strip_prefix("Description=") {
                    desc = val.to_string();
                }
            }
            let state = match active {
                "active" => ActiveState::Active,
                "reloading" => ActiveState::Reloading,
                "inactive" => ActiveState::Inactive,
                "failed" => ActiveState::Failed,
                "activating" => ActiveState::Activating,
                "deactivating" => ActiveState::Deactivating,
                _ => ActiveState::Inactive,
            };
            Some(UnitStatus {
                name: name.to_string(),
                unit_type: if name.ends_with(".target") {
                    UnitType::Target
                } else {
                    UnitType::Service
                },
                description: desc,
                state,
                sub_state: sub,
                main_pid: pid,
                uptime_secs: None,
                restart_count: 0,
                dependencies: Vec::new(),
            })
        }
        #[cfg(not(unix))]
        {
            let _ = name;
            None
        }
    }

    async fn list_units(&self) -> Vec<UnitStatus> {
        #[cfg(unix)]
        {
            let mut cmd = std::process::Command::new("systemctl").no_window();
            if self.user_mode {
                cmd.arg("--user");
            }
            cmd.args([
                "list-units",
                "--type=service,target",
                "--all",
                "--plain",
                "--no-legend",
            ]);
            let Ok(output) = cmd.output() else {
                return Vec::new();
            };
            if !output.status.success() {
                return Vec::new();
            }
            let text = String::from_utf8_lossy(&output.stdout);
            let mut units = Vec::new();
            for line in text.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let name = parts[0];
                    let active = parts[2];
                    let sub = parts[3];
                    let state = match active {
                        "active" => ActiveState::Active,
                        "reloading" => ActiveState::Reloading,
                        "failed" => ActiveState::Failed,
                        "activating" => ActiveState::Activating,
                        "deactivating" => ActiveState::Deactivating,
                        _ => ActiveState::Inactive,
                    };
                    units.push(UnitStatus {
                        name: name.to_string(),
                        unit_type: if name.ends_with(".target") {
                            UnitType::Target
                        } else {
                            UnitType::Service
                        },
                        description: parts[4..].join(" "),
                        state,
                        sub_state: sub.to_string(),
                        main_pid: None,
                        uptime_secs: None,
                        restart_count: 0,
                        dependencies: Vec::new(),
                    });
                }
            }
            units
        }
        #[cfg(not(unix))]
        {
            Vec::new()
        }
    }
}
