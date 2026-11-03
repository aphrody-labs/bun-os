// SPDX-License-Identifier: Apache-2.0
//! The Bun OS Windows tweak engine: one declarative catalog (`catalog/tweaks.toml`), one engine for the running
//! system (live) and for a mounted install image (offline).
//!
//! Every operation goes through a [`Backend`]: [`live::LiveBackend`] (Registry API, Service Control Manager,
//! `schtasks`, `powercfg`, WinRT `PackageManager`, DISM API online session) or [`offline::OfflineBackend`]
//! (`offreg.dll` on the image hives, DISM API image session, files under the mount). The engine itself is platform
//! independent and unit-tested with [`MemoryBackend`].
//!
//! Lifecycle per tweak, as in archinstall's modular sections: **detect** (read the current state of every
//! operation), **plan** (the operations that would change, saved as JSON before anything is applied), **apply**
//! (each change journaled with its previous state), **verify** (re-detect after apply) and **undo** (replay the
//! journal backwards).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[cfg(windows)]
pub mod dism;
pub mod dispatch;
#[cfg(windows)]
pub mod live;
#[cfg(windows)]
pub mod offline;
#[cfg(windows)]
pub mod restore;
pub mod runner;

/// The embedded catalog: the single source of truth for live, offline and the GUI.
pub const CATALOG_TOML: &str = include_str!("../../catalog/tweaks.toml");

// ------------------------------------------------------------------------------------------------------- model

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Conservative,
    Standard,
    Aggressive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Live,
    Offline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RegHive {
    /// `HKLM` (`SOFTWARE\...`, `SYSTEM\CurrentControlSet\...`); offline: the image `SOFTWARE`/`SYSTEM` hives.
    Machine,
    /// `HKCU`; offline: `Users\Default\NTUSER.DAT` (every new user).
    User,
}

/// Registry data, typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum RegData {
    Dword(u32),
    Qword(u64),
    Sz(String),
    ExpandSz(String),
    MultiSz(Vec<String>),
    Binary(Vec<u8>),
}

impl RegData {
    /// `(REG_* type, bytes)` as stored by the Registry API.
    #[must_use]
    pub fn encode(&self) -> (u32, Vec<u8>) {
        fn utf16z(s: &str) -> Vec<u8> {
            s.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect()
        }
        match self {
            Self::Dword(v) => (4, v.to_le_bytes().to_vec()),
            Self::Qword(v) => (11, v.to_le_bytes().to_vec()),
            Self::Sz(s) => (1, utf16z(s)),
            Self::ExpandSz(s) => (2, utf16z(s)),
            Self::MultiSz(items) => {
                let mut out: Vec<u8> = items
                    .iter()
                    .flat_map(|s| utf16z(s))
                    .collect();
                out.extend([0, 0]);
                (7, out)
            }
            Self::Binary(b) => (3, b.clone()),
        }
    }

    /// Decode `(REG_* type, bytes)`; unknown types are kept as binary.
    #[must_use]
    pub fn decode(kind: u32, data: &[u8]) -> Self {
        fn utf16(data: &[u8]) -> Vec<u16> {
            data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect()
        }
        fn until_nul(units: &[u16]) -> String {
            let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
            String::from_utf16_lossy(&units[..end])
        }
        match kind {
            4 if data.len() >= 4 => Self::Dword(u32::from_le_bytes([data[0], data[1], data[2], data[3]])),
            11 if data.len() >= 8 => {
                let mut b = [0u8; 8];
                b.copy_from_slice(&data[..8]);
                Self::Qword(u64::from_le_bytes(b))
            }
            1 => Self::Sz(until_nul(&utf16(data))),
            2 => Self::ExpandSz(until_nul(&utf16(data))),
            7 => Self::MultiSz(
                utf16(data)
                    .split(|&u| u == 0)
                    .filter(|s| !s.is_empty())
                    .map(String::from_utf16_lossy)
                    .collect(),
            ),
            _ => Self::Binary(data.to_vec()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RegAction {
    #[default]
    Set,
    DeleteValue,
    DeleteKey,
}

/// One registry entry of a tweak as written in the TOML catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegEntry {
    pub hive: RegHive,
    pub key: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub value: Option<toml::Value>,
    #[serde(default)]
    pub action: RegAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartType {
    Boot,
    System,
    Automatic,
    Manual,
    Disabled,
}

impl StartType {
    /// The `Start` value under `SYSTEM\CurrentControlSet\Services\<name>`.
    #[must_use]
    pub fn code(self) -> u32 {
        match self {
            Self::Boot => 0,
            Self::System => 1,
            Self::Automatic => 2,
            Self::Manual => 3,
            Self::Disabled => 4,
        }
    }
    #[must_use]
    pub fn from_code(code: u32) -> Option<Self> {
        Some(match code {
            0 => Self::Boot,
            1 => Self::System,
            2 => Self::Automatic,
            3 => Self::Manual,
            4 => Self::Disabled,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceEntry {
    pub name: String,
    pub start: StartType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureState {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureEntry {
    pub name: String,
    pub state: FeatureState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tweak {
    pub id: String,
    pub module: String,
    pub title: String,
    pub level: Level,
    #[serde(default = "both_targets")]
    pub targets: Vec<TargetKind>,
    #[serde(default)]
    pub registry: Vec<RegEntry>,
    #[serde(default)]
    pub appx: Vec<String>,
    #[serde(default)]
    pub services: Vec<ServiceEntry>,
    #[serde(default)]
    pub tasks: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub features: Vec<FeatureEntry>,
    #[serde(default)]
    pub files: Vec<String>,
    /// Power scheme GUID to activate (live only).
    #[serde(default)]
    pub power: Option<String>,
}

fn both_targets() -> Vec<TargetKind> {
    vec![TargetKind::Live, TargetKind::Offline]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Module {
    pub id: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub schema: u32,
    #[serde(rename = "module")]
    pub modules: Vec<Module>,
    #[serde(rename = "tweak")]
    pub tweaks: Vec<Tweak>,
}

/// One atomic, reversible operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    RegSet { hive: RegHive, key: String, name: String, data: RegData },
    RegDeleteValue { hive: RegHive, key: String, name: String },
    RegDeleteKey { hive: RegHive, key: String },
    AppxRemove { family: String },
    ServiceStart { name: String, start: StartType },
    TaskDisable { path: String },
    CapabilityRemove { name: String },
    Feature { name: String, state: FeatureState },
    FileRemove { path: String },
    PowerScheme { guid: String },
}

/// The observed state of one operation's target, recorded before a change (the undo payload).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum State {
    /// The target does not exist (no value, key, service, task, package or file).
    Absent,
    Value { data: RegData },
    KeyPresent,
    /// Installed packages matching the family prefix (full names).
    Packages { full_names: Vec<String> },
    Start { start: StartType },
    Task { enabled: bool },
    Installed { installed: bool },
    Feature { state: FeatureState },
    FilePresent,
    Power { guid: String },
}

// ---------------------------------------------------------------------------------------------------- guardrails

/// Services the engine refuses to touch whatever the catalog or profile says: security, updates, virtualisation
/// (WSL, Hyper-V), Store, networking, remote access and the Bun OS / agent stack.
pub const PROTECTED_SERVICES: &[&str] = &[
    "windefend", "wdnissvc", "sense", "securityhealthservice", "mpssvc", "bfe", "wscsvc", "wuauserv", "usosvc",
    "waasmedicsvc", "bits", "cryptsvc", "trustedinstaller", "lxssmanager", "wslservice", "vmcompute", "vmms",
    "hvhost", "vmicheartbeat", "hns", "sharedaccess", "installservice", "appxsvc", "clipsvc", "dnscache", "dhcp",
    "nsi", "netprofm", "nlasvc", "wlansvc", "lanmanworkstation", "winhttpautoproxysvc", "iphlpsvc", "sshd",
    "ssh-agent", "termservice", "eventlog", "rpcss", "schedule", "plugplay", "power", "audiosrv", "themes",
];

/// Service name prefixes protected the same way (WireGuard tunnels, cloudflared, Bun OS and agent services).
pub const PROTECTED_SERVICE_PREFIXES: &[&str] =
    &["wireguard", "cloudflared", "aphrody", "bunos", "claude", "tailscale", "openssh"];

/// Package family prefixes never removed: Store, App Installer (winget), runtimes, shell, security, WebView2.
pub const PROTECTED_APPX: &[&str] = &[
    "Microsoft.WindowsStore", "Microsoft.StorePurchaseApp", "Microsoft.DesktopAppInstaller", "Microsoft.VCLibs",
    "Microsoft.NET", "Microsoft.UI.Xaml", "Microsoft.WindowsAppRuntime", "Microsoft.SecHealthUI",
    "Microsoft.Windows.ShellExperienceHost", "Microsoft.Windows.StartMenuExperienceHost", "MicrosoftWindows.Client.CBS",
    "MicrosoftWindows.Client.Core", "Microsoft.Windows.SecHealthUI", "Microsoft.WebView2", "Microsoft.Win32WebViewHost",
    "Microsoft.WindowsTerminal", "Microsoft.WSL", "MicrosoftCorporationII.WindowsSubsystemForLinux",
    "Microsoft.AAD.BrokerPlugin", "Microsoft.AccountsControl", "Microsoft.Windows.CloudExperienceHost",
    "Microsoft.LockApp", "Microsoft.Windows.ContentDeliveryManager",
];

/// Registry key prefixes never written: Defender, Windows Update, virtualisation and networking policy.
pub const PROTECTED_KEYS: &[&str] = &[
    r"SOFTWARE\Policies\Microsoft\Windows Defender",
    r"SOFTWARE\Microsoft\Windows Defender",
    r"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate",
    r"SOFTWARE\Microsoft\WindowsUpdate\UX",
    r"SOFTWARE\Policies\Microsoft\Windows\DeviceGuard",
    r"SYSTEM\CurrentControlSet\Control\DeviceGuard",
    r"SOFTWARE\Policies\Microsoft\WindowsFirewall",
    r"SYSTEM\CurrentControlSet\Services\Tcpip",
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon",
    r"SOFTWARE\Policies\Microsoft\Windows\Appx",
];

/// Features and capabilities that may only be enabled, never disabled or removed.
pub const PROTECTED_FEATURES: &[&str] = &[
    "Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform", "Microsoft-Hyper-V", "HypervisorPlatform",
    "Containers", "NetFx", "OpenSSH", "Windows-Defender",
];

/// Paths (relative to the image root) never removed.
pub const PROTECTED_FILES: &[&str] = &[r"Windows\System32\Microsoft-Edge-Webview", r"Program Files (x86)\Microsoft\EdgeWebView"];

fn starts_with_ci(haystack: &str, prefix: &str) -> bool {
    haystack.len() >= prefix.len() && haystack[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// Why `op` is refused, if it is.
#[must_use]
pub fn guard(op: &Op) -> Option<String> {
    match op {
        Op::RegSet { key, .. } | Op::RegDeleteValue { key, .. } | Op::RegDeleteKey { key, .. } => PROTECTED_KEYS
            .iter()
            .find(|p| starts_with_ci(key, p))
            .map(|p| format!("registry key under protected {p}")),
        Op::ServiceStart { name, .. } => {
            let lower = name.to_ascii_lowercase();
            (PROTECTED_SERVICES.contains(&lower.as_str())
                || PROTECTED_SERVICE_PREFIXES.iter().any(|p| lower.starts_with(p)))
            .then(|| format!("protected service {name}"))
        }
        Op::AppxRemove { family } => PROTECTED_APPX
            .iter()
            .find(|p| starts_with_ci(family, p))
            .map(|p| format!("protected package {p}")),
        Op::CapabilityRemove { name } => PROTECTED_FEATURES
            .iter()
            .find(|p| name.to_ascii_lowercase().contains(&p.to_ascii_lowercase()))
            .map(|p| format!("protected capability {p}")),
        Op::Feature { name, state: FeatureState::Disabled } => PROTECTED_FEATURES
            .iter()
            .find(|p| starts_with_ci(name, p))
            .map(|p| format!("protected feature {p} may not be disabled")),
        Op::FileRemove { path } => {
            let norm = path.replace('/', "\\");
            (PROTECTED_FILES.iter().any(|p| starts_with_ci(&norm, p)) || norm.contains(".."))
                .then(|| format!("protected path {path}"))
        }
        Op::Feature { .. } | Op::TaskDisable { .. } | Op::PowerScheme { .. } => None,
    }
}

// ------------------------------------------------------------------------------------------------------ catalog

#[derive(Debug, thiserror::Error)]
pub enum TweakError {
    #[error("catalog: {0}")]
    Catalog(String),
    #[error("profile: {0}")]
    Profile(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

fn reg_data(entry: &RegEntry) -> Result<RegData, String> {
    let kind = entry.kind.as_deref().unwrap_or("dword");
    let value = entry.value.as_ref().ok_or("registry set without value")?;
    Ok(match (kind, value) {
        ("dword", toml::Value::Integer(i)) => RegData::Dword(u32::try_from(*i).map_err(|_| "dword out of range")?),
        ("qword", toml::Value::Integer(i)) => RegData::Qword(u64::try_from(*i).map_err(|_| "qword out of range")?),
        ("sz", toml::Value::String(s)) => RegData::Sz(s.clone()),
        ("expand_sz", toml::Value::String(s)) => RegData::ExpandSz(s.clone()),
        ("multi_sz", toml::Value::Array(a)) => RegData::MultiSz(
            a.iter().map(|v| v.as_str().map(str::to_owned).ok_or("multi_sz items must be strings")).collect::<Result<_, _>>()?,
        ),
        (k, v) => return Err(format!("unsupported type/value {k} = {v:?}")),
    })
}

impl Tweak {
    /// The operations of this tweak, in catalog order.
    pub fn ops(&self) -> Result<Vec<Op>, String> {
        let mut ops = Vec::new();
        for r in &self.registry {
            ops.push(match r.action {
                RegAction::Set => Op::RegSet {
                    hive: r.hive,
                    key: r.key.clone(),
                    name: r.name.clone().ok_or("registry set without name")?,
                    data: reg_data(r)?,
                },
                RegAction::DeleteValue => Op::RegDeleteValue {
                    hive: r.hive,
                    key: r.key.clone(),
                    name: r.name.clone().ok_or("delete_value without name")?,
                },
                RegAction::DeleteKey => Op::RegDeleteKey { hive: r.hive, key: r.key.clone() },
            });
        }
        ops.extend(self.appx.iter().map(|f| Op::AppxRemove { family: f.clone() }));
        ops.extend(self.services.iter().map(|s| Op::ServiceStart { name: s.name.clone(), start: s.start }));
        ops.extend(self.tasks.iter().map(|t| Op::TaskDisable { path: t.clone() }));
        ops.extend(self.capabilities.iter().map(|c| Op::CapabilityRemove { name: c.clone() }));
        ops.extend(self.features.iter().map(|f| Op::Feature { name: f.name.clone(), state: f.state }));
        ops.extend(self.files.iter().map(|f| Op::FileRemove { path: f.clone() }));
        ops.extend(self.power.iter().map(|g| Op::PowerScheme { guid: g.clone() }));
        Ok(ops)
    }
}

impl Catalog {
    /// Parse and validate a catalog: unique ids, known modules, well-formed operations, no guarded operation.
    pub fn parse(text: &str) -> Result<Self, TweakError> {
        let catalog: Self = toml::from_str(text).map_err(|e| TweakError::Catalog(e.to_string()))?;
        let mut seen = std::collections::BTreeSet::new();
        for t in &catalog.tweaks {
            if !seen.insert(t.id.as_str()) {
                return Err(TweakError::Catalog(format!("duplicate tweak id {}", t.id)));
            }
            if !catalog.modules.iter().any(|m| m.id == t.module) {
                return Err(TweakError::Catalog(format!("{}: unknown module {}", t.id, t.module)));
            }
            if !t.id.starts_with(&format!("{}.", t.module)) {
                return Err(TweakError::Catalog(format!("{}: id must start with its module", t.id)));
            }
            let ops = t.ops().map_err(|e| TweakError::Catalog(format!("{}: {e}", t.id)))?;
            for op in &ops {
                if let Some(why) = guard(op) {
                    return Err(TweakError::Catalog(format!("{}: refused: {why}", t.id)));
                }
                let offline_only = matches!(op, Op::FileRemove { .. } | Op::RegDeleteKey { .. });
                if offline_only && t.targets.contains(&TargetKind::Live) {
                    return Err(TweakError::Catalog(format!("{}: file/key removal is offline-only", t.id)));
                }
                if matches!(op, Op::PowerScheme { .. }) && t.targets.contains(&TargetKind::Offline) {
                    return Err(TweakError::Catalog(format!("{}: power schemes are live-only", t.id)));
                }
            }
        }
        Ok(catalog)
    }

    /// The embedded catalog.
    pub fn embedded() -> Result<Self, TweakError> {
        Self::parse(CATALOG_TOML)
    }

    #[must_use]
    pub fn tweak(&self, id: &str) -> Option<&Tweak> {
        self.tweaks.iter().find(|t| t.id == id)
    }
}

// ------------------------------------------------------------------------------------------------------ profile

/// A selection of tweaks, archinstall `user_configuration.json` style (here TOML):
///
/// ```toml
/// target = "live"            # or "offline"
/// level = "conservative"     # every tweak up to this level in the selected modules
/// modules = ["privacy", "ai"]   # empty = every module
/// include = ["shell.dark-mode"] # extra tweaks regardless of level
/// exclude = ["appx.consumer"]
/// desktop = "windows-mac"    # desktop profile, handled by bunos-win11
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    #[serde(default = "default_target")]
    pub target: TargetKind,
    #[serde(default = "default_level")]
    pub level: Level,
    #[serde(default)]
    pub modules: Vec<String>,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
    #[serde(default)]
    pub desktop: Option<String>,
    #[serde(default)]
    pub iso: Option<IsoSection>,
}

/// ISO build inputs (offline target).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct IsoSection {
    pub source: Option<String>,
    pub output: Option<String>,
    /// install.wim index (edition); default: the first Pro index.
    pub index: Option<u32>,
    pub scratch: Option<String>,
    #[serde(default)]
    pub unattend: bool,
}

fn default_target() -> TargetKind {
    TargetKind::Live
}
fn default_level() -> Level {
    Level::Conservative
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            target: TargetKind::Live,
            level: Level::Conservative,
            modules: Vec::new(),
            include: Vec::new(),
            exclude: Vec::new(),
            desktop: None,
            iso: None,
        }
    }
}

impl Profile {
    pub fn parse(text: &str) -> Result<Self, TweakError> {
        toml::from_str(text).map_err(|e| TweakError::Profile(e.to_string()))
    }

    /// The tweaks this profile selects, in catalog order.
    pub fn select<'c>(&self, catalog: &'c Catalog) -> Result<Vec<&'c Tweak>, TweakError> {
        for id in self.include.iter().chain(&self.exclude) {
            if catalog.tweak(id).is_none() {
                return Err(TweakError::Profile(format!("unknown tweak {id}")));
            }
        }
        for m in &self.modules {
            if !catalog.modules.iter().any(|x| &x.id == m) {
                return Err(TweakError::Profile(format!("unknown module {m}")));
            }
        }
        Ok(catalog
            .tweaks
            .iter()
            .filter(|t| t.targets.contains(&self.target))
            .filter(|t| !self.exclude.contains(&t.id))
            .filter(|t| {
                self.include.contains(&t.id)
                    || (t.level <= self.level && (self.modules.is_empty() || self.modules.contains(&t.module)))
            })
            .collect())
    }
}

// ------------------------------------------------------------------------------------------------------ backend

/// Everything the engine needs from a target system.
pub trait Backend {
    fn kind(&self) -> TargetKind;
    /// Observe the current state of `op`'s target.
    fn detect(&mut self, op: &Op) -> std::io::Result<State>;
    /// Perform `op`.
    fn apply(&mut self, op: &Op) -> std::io::Result<()>;
    /// Put `op`'s target back to `before` (the state detected before apply).
    fn restore(&mut self, op: &Op, before: &State) -> std::io::Result<()>;
}

/// Whether `state` already satisfies `op`.
#[must_use]
pub fn satisfied(op: &Op, state: &State) -> bool {
    match (op, state) {
        (Op::RegSet { data, .. }, State::Value { data: d }) => d == data,
        (Op::RegDeleteValue { .. } | Op::RegDeleteKey { .. }, State::Absent) => true,
        (Op::AppxRemove { .. }, State::Packages { full_names }) => full_names.is_empty(),
        (Op::AppxRemove { .. }, State::Absent) => true,
        (Op::ServiceStart { start, .. }, State::Start { start: s }) => s == start,
        (Op::ServiceStart { .. } | Op::TaskDisable { .. }, State::Absent) => true,
        (Op::TaskDisable { .. }, State::Task { enabled }) => !enabled,
        (Op::CapabilityRemove { .. }, State::Installed { installed }) => !installed,
        (Op::CapabilityRemove { .. } | Op::FileRemove { .. }, State::Absent) => true,
        (Op::Feature { state, .. }, State::Feature { state: s }) => s == state,
        (Op::PowerScheme { guid }, State::Power { guid: g }) => g.eq_ignore_ascii_case(guid),
        _ => false,
    }
}

/// Whether the change can be reverted from the journal alone.
#[must_use]
pub fn reversible(op: &Op, kind: TargetKind) -> bool {
    match op {
        Op::CapabilityRemove { .. } | Op::FileRemove { .. } => false,
        Op::RegDeleteKey { .. } => kind == TargetKind::Offline,
        _ => true,
    }
}

// --------------------------------------------------------------------------------------------------------- plan

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub tweak: String,
    pub module: String,
    pub op: Op,
    pub before: State,
    /// `change`, `ok` (already satisfied), `skip` (target not present) or `refused`/`error` with a reason.
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub schema: u32,
    pub target: TargetKind,
    pub created: String,
    pub profile: Profile,
    pub steps: Vec<Step>,
}

impl Plan {
    #[must_use]
    pub fn changes(&self) -> usize {
        self.steps.iter().filter(|s| s.action == "change").count()
    }

    /// Per-module summary: (changes, already ok, skipped/refused/error).
    #[must_use]
    pub fn summary(&self) -> BTreeMap<String, (usize, usize, usize)> {
        let mut out: BTreeMap<String, (usize, usize, usize)> = BTreeMap::new();
        for s in &self.steps {
            let e = out.entry(s.module.clone()).or_default();
            match s.action.as_str() {
                "change" => e.0 += 1,
                "ok" => e.1 += 1,
                _ => e.2 += 1,
            }
        }
        out
    }
}

fn not_present(op: &Op, state: &State) -> bool {
    // A task, service or package that does not exist on this system needs nothing; a registry value that does not
    // exist is simply created.
    matches!(state, State::Absent)
        && matches!(op, Op::TaskDisable { .. } | Op::ServiceStart { .. } | Op::AppxRemove { .. })
}

/// Detect every operation of `tweaks` and build the plan. Nothing is changed.
pub fn plan(backend: &mut dyn Backend, profile: &Profile, tweaks: &[&Tweak], now: &str) -> Plan {
    let mut steps = Vec::new();
    for t in tweaks {
        let ops = match t.ops() {
            Ok(ops) => ops,
            Err(e) => {
                steps.push(Step {
                    tweak: t.id.clone(),
                    module: t.module.clone(),
                    op: Op::PowerScheme { guid: String::new() },
                    before: State::Absent,
                    action: "error".into(),
                    reason: Some(e),
                    reversible: false,
                });
                continue;
            }
        };
        for op in ops {
            let rev = reversible(&op, backend.kind());
            let mut step = Step {
                tweak: t.id.clone(),
                module: t.module.clone(),
                op: op.clone(),
                before: State::Absent,
                action: String::new(),
                reason: None,
                reversible: rev,
            };
            if let Some(why) = guard(&op) {
                step.action = "refused".into();
                step.reason = Some(why);
            } else {
                match backend.detect(&op) {
                    Ok(state) => {
                        step.action = if satisfied(&op, &state) {
                            if not_present(&op, &state) { "skip" } else { "ok" }
                        } else {
                            "change"
                        }
                        .into();
                        step.before = state;
                    }
                    Err(e) => {
                        step.action = "error".into();
                        step.reason = Some(e.to_string());
                    }
                }
            }
            steps.push(step);
        }
    }
    Plan { schema: 1, target: backend.kind(), created: now.to_owned(), profile: profile.clone(), steps }
}

// ------------------------------------------------------------------------------------------------------ journal

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub tweak: String,
    pub op: Op,
    pub before: State,
    /// `applied`, `failed`, `unverified` (applied but re-detect disagrees).
    pub result: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Journal {
    pub schema: u32,
    pub target: Option<TargetKind>,
    pub started: String,
    #[serde(default)]
    pub restore_point: Option<String>,
    #[serde(default)]
    pub registry_exports: Vec<String>,
    pub entries: Vec<JournalEntry>,
    #[serde(default)]
    pub undone: bool,
}

/// Apply every `change` step, journaling the previous state and verifying each change by re-detection.
/// Apply continues after a failed step (each step is independent); `on_entry` sees each entry as it is recorded
/// so callers can persist the journal incrementally.
pub fn apply(backend: &mut dyn Backend, plan: &Plan, journal: &mut Journal, mut on_entry: impl FnMut(&Journal)) {
    journal.schema = 1;
    journal.target = Some(plan.target);
    for step in plan.steps.iter().filter(|s| s.action == "change") {
        // Re-check the guard at apply time: a hand-edited plan cannot smuggle a protected operation through.
        if let Some(why) = guard(&step.op) {
            journal.entries.push(JournalEntry {
                tweak: step.tweak.clone(),
                op: step.op.clone(),
                before: step.before.clone(),
                result: "failed".into(),
                error: Some(format!("refused: {why}")),
                reversible: false,
            });
            on_entry(journal);
            continue;
        }
        let before = backend.detect(&step.op).unwrap_or_else(|_| step.before.clone());
        let mut entry = JournalEntry {
            tweak: step.tweak.clone(),
            op: step.op.clone(),
            before,
            result: "applied".into(),
            error: None,
            reversible: step.reversible,
        };
        match backend.apply(&step.op) {
            Ok(()) => match backend.detect(&step.op) {
                Ok(after) if satisfied(&step.op, &after) => {}
                Ok(after) => {
                    entry.result = "unverified".into();
                    entry.error = Some(format!("after apply: {after:?}"));
                }
                Err(e) => {
                    entry.result = "unverified".into();
                    entry.error = Some(e.to_string());
                }
            },
            Err(e) => {
                entry.result = "failed".into();
                entry.error = Some(e.to_string());
            }
        }
        journal.entries.push(entry);
        on_entry(journal);
    }
}

/// Re-detect every journaled change; returns the ids of tweaks whose state no longer matches.
pub fn verify(backend: &mut dyn Backend, journal: &Journal) -> Vec<String> {
    let mut drift = Vec::new();
    for e in journal.entries.iter().filter(|e| e.result == "applied") {
        if !backend.detect(&e.op).is_ok_and(|s| satisfied(&e.op, &s)) && !drift.contains(&e.tweak) {
            drift.push(e.tweak.clone());
        }
    }
    drift
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoReport {
    pub restored: usize,
    pub skipped_irreversible: Vec<String>,
    pub errors: Vec<String>,
}

/// Replay the journal backwards, restoring each applied (or unverified) change to its previous state.
pub fn undo(backend: &mut dyn Backend, journal: &mut Journal) -> UndoReport {
    let mut report = UndoReport { restored: 0, skipped_irreversible: Vec::new(), errors: Vec::new() };
    for e in journal.entries.iter().rev().filter(|e| e.result != "failed") {
        if !e.reversible {
            report.skipped_irreversible.push(format!("{}: {:?}", e.tweak, e.op));
            continue;
        }
        match backend.restore(&e.op, &e.before) {
            Ok(()) => report.restored += 1,
            Err(err) => report.errors.push(format!("{}: {err}", e.tweak)),
        }
    }
    journal.undone = report.errors.is_empty();
    report
}

// --------------------------------------------------------------------------------------------- memory backend

/// An in-memory system for tests, previews and the GUI's offline mode.
#[derive(Debug, Clone, Default)]
pub struct MemoryBackend {
    pub kind: Option<TargetKind>,
    pub values: BTreeMap<(RegHive, String, String), RegData>,
    pub keys: std::collections::BTreeSet<(RegHive, String)>,
    pub packages: Vec<String>,
    pub services: BTreeMap<String, StartType>,
    pub tasks: BTreeMap<String, bool>,
    pub capabilities: std::collections::BTreeSet<String>,
    pub features: BTreeMap<String, FeatureState>,
    pub files: std::collections::BTreeSet<String>,
    pub power: String,
}

fn lc(s: &str) -> String {
    s.to_ascii_lowercase()
}

impl Backend for MemoryBackend {
    fn kind(&self) -> TargetKind {
        self.kind.unwrap_or(TargetKind::Live)
    }
    fn detect(&mut self, op: &Op) -> std::io::Result<State> {
        Ok(match op {
            Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name } => {
                self.values.get(&(*hive, lc(key), lc(name))).map_or(State::Absent, |d| State::Value { data: d.clone() })
            }
            Op::RegDeleteKey { hive, key } => {
                if self.keys.contains(&(*hive, lc(key))) { State::KeyPresent } else { State::Absent }
            }
            Op::AppxRemove { family } => {
                let full: Vec<String> = self.packages.iter().filter(|p| starts_with_ci(p, &format!("{family}_"))).cloned().collect();
                if full.is_empty() { State::Absent } else { State::Packages { full_names: full } }
            }
            Op::ServiceStart { name, .. } => self.services.get(&lc(name)).map_or(State::Absent, |s| State::Start { start: *s }),
            Op::TaskDisable { path } => self.tasks.get(&lc(path)).map_or(State::Absent, |e| State::Task { enabled: *e }),
            Op::CapabilityRemove { name } => State::Installed { installed: self.capabilities.contains(name) },
            Op::Feature { name, .. } => State::Feature { state: *self.features.get(name).unwrap_or(&FeatureState::Disabled) },
            Op::FileRemove { path } => if self.files.contains(&lc(path)) { State::FilePresent } else { State::Absent },
            Op::PowerScheme { .. } => State::Power { guid: self.power.clone() },
        })
    }
    fn apply(&mut self, op: &Op) -> std::io::Result<()> {
        match op {
            Op::RegSet { hive, key, name, data } => {
                self.values.insert((*hive, lc(key), lc(name)), data.clone());
            }
            Op::RegDeleteValue { hive, key, name } => {
                self.values.remove(&(*hive, lc(key), lc(name)));
            }
            Op::RegDeleteKey { hive, key } => {
                self.keys.remove(&(*hive, lc(key)));
            }
            Op::AppxRemove { family } => self.packages.retain(|p| !starts_with_ci(p, &format!("{family}_"))),
            Op::ServiceStart { name, start } => {
                self.services.insert(lc(name), *start);
            }
            Op::TaskDisable { path } => {
                self.tasks.insert(lc(path), false);
            }
            Op::CapabilityRemove { name } => {
                self.capabilities.remove(name);
            }
            Op::Feature { name, state } => {
                self.features.insert(name.clone(), *state);
            }
            Op::FileRemove { path } => {
                self.files.remove(&lc(path));
            }
            Op::PowerScheme { guid } => self.power.clone_from(guid),
        }
        Ok(())
    }
    fn restore(&mut self, op: &Op, before: &State) -> std::io::Result<()> {
        match (op, before) {
            (Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name }, State::Absent) => {
                self.values.remove(&(*hive, lc(key), lc(name)));
            }
            (Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name }, State::Value { data }) => {
                self.values.insert((*hive, lc(key), lc(name)), data.clone());
            }
            (Op::RegDeleteKey { hive, key }, State::KeyPresent) => {
                self.keys.insert((*hive, lc(key)));
            }
            (Op::AppxRemove { .. }, State::Packages { full_names }) => self.packages.extend(full_names.iter().cloned()),
            (Op::ServiceStart { name, .. }, State::Start { start }) => {
                self.services.insert(lc(name), *start);
            }
            (Op::TaskDisable { path }, State::Task { enabled }) => {
                self.tasks.insert(lc(path), *enabled);
            }
            (Op::Feature { name, .. }, State::Feature { state }) => {
                self.features.insert(name.clone(), *state);
            }
            (Op::PowerScheme { .. }, State::Power { guid }) => self.power.clone_from(guid),
            (_, State::Absent) => {}
            (op, s) => return Err(std::io::Error::other(format!("cannot restore {op:?} to {s:?}"))),
        }
        Ok(())
    }
}

/// Every `(hive, key)` the plan writes, for registry export before apply.
#[must_use]
pub fn touched_keys(plan: &Plan) -> Vec<(RegHive, String)> {
    let mut keys: Vec<(RegHive, String)> = plan
        .steps
        .iter()
        .filter(|s| s.action == "change")
        .filter_map(|s| match &s.op {
            Op::RegSet { hive, key, .. } | Op::RegDeleteValue { hive, key, .. } | Op::RegDeleteKey { hive, key } => {
                Some((*hive, key.clone()))
            }
            _ => None,
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// Offline mapping of a catalog key: (image hive file, key inside that hive).
///
/// `machine SOFTWARE\X` -> (`Windows\System32\config\SOFTWARE`, `X`); `machine SYSTEM\CurrentControlSet\X` ->
/// (`...\config\SYSTEM`, `ControlSet001\X`); `user X` -> (`Users\Default\NTUSER.DAT`, `X`).
pub fn offline_location(hive: RegHive, key: &str) -> Result<(&'static str, String), String> {
    match hive {
        RegHive::User => Ok((r"Users\Default\NTUSER.DAT", key.to_owned())),
        RegHive::Machine => {
            let (root, rest) = key.split_once('\\').ok_or_else(|| format!("bad machine key {key}"))?;
            if root.eq_ignore_ascii_case("SOFTWARE") {
                Ok((r"Windows\System32\config\SOFTWARE", rest.to_owned()))
            } else if root.eq_ignore_ascii_case("SYSTEM") {
                let rest = if starts_with_ci(rest, r"CurrentControlSet\") {
                    format!(r"ControlSet001\{}", &rest[r"CurrentControlSet\".len()..])
                } else {
                    rest.to_owned()
                };
                Ok((r"Windows\System32\config\SYSTEM", rest))
            } else {
                Err(format!("unsupported machine root {root}"))
            }
        }
    }
}

#[cfg(test)]
mod tests;
