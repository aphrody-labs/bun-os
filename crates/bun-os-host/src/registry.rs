//! `Inventory`: the shared registry of host cards. Entries are `{info, sig}`; `info` stays a raw JSON
//! value so a card from a newer collector survives a merge byte for byte and its signature still
//! verifies. Merging is idempotent and order independent: per host the newest `collected_at` wins and
//! an exact tie goes to the larger canonical text.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;

use crate::schema::{HostInfo, SCHEMA};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub info: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inventory {
    pub schema: u32,
    pub updated_at: u64,
    pub hosts: BTreeMap<String, Entry>,
}

/// An HMAC key. It comes from an environment variable or a 0600 file, never from argv.
pub struct Secret(Vec<u8>);

impl Secret {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let trimmed: &[u8] = bytes.trim_ascii();
        if trimmed.len() < 16 {
            return Err("the secret must be at least 16 bytes".into());
        }
        Ok(Self(trimmed.to_vec()))
    }

    /// The value of the environment variable `name` (`bunos host ... -s NAME`).
    pub fn from_env(name: &str) -> Result<Self, String> {
        let value =
            std::env::var(name).map_err(|_| format!("environment variable {name} is not set"))?;
        Self::from_bytes(value.as_bytes())
    }

    /// A file readable by its owner only.
    pub fn from_file(path: &Path) -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(path)
                .map_err(|e| format!("{}: {e}", path.display()))?
                .permissions()
                .mode();
            if mode & 0o077 != 0 {
                return Err(format!(
                    "{}: mode {:o} is too open, use 0600",
                    path.display(),
                    mode & 0o777
                ));
            }
        }
        let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Self::from_bytes(&bytes)
    }

    fn mac(&self, info: &Value) -> HmacSha256 {
        let mut mac = HmacSha256::new_from_slice(&self.0).expect("HMAC takes any key length");
        mac.update(canonical(info).as_bytes());
        mac
    }

    pub fn sign(&self, info: &Value) -> String {
        hex(&self.mac(info).finalize().into_bytes())
    }

    pub fn verify(&self, info: &Value, sig: &str) -> bool {
        match unhex(sig) {
            Some(bytes) => self.mac(info).verify_slice(&bytes).is_ok(),
            None => false,
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
        encoded.push(char::from(DIGITS[usize::from(byte & 0xf)]));
    }
    encoded
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

/// JSON with object keys sorted: the text that is signed.
pub fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", Value::String((*k).clone()), canonical(&map[*k])))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}

/// Host ids become file names: letters, digits and `-_.`, no leading dot.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// A signed card for the local machine.
pub fn card(info: &HostInfo, secret: Option<&Secret>) -> Entry {
    let info = serde_json::to_value(info).unwrap_or(Value::Null);
    let sig = secret.map(|s| s.sign(&info));
    Entry { info, sig }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Added,
    Updated,
    Unchanged,
    /// An older card than the one held.
    Stale,
    Rejected(String),
}

fn collected_at(entry: &Entry) -> u64 {
    entry
        .info
        .get("collected_at")
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn check(entry: &Entry, secret: Option<&Secret>) -> Result<String, String> {
    let id = entry.info.get("id").and_then(Value::as_str).unwrap_or("");
    if !valid_id(id) {
        return Err(format!("invalid host id {id:?}"));
    }
    if entry.info.get("schema").and_then(Value::as_u64) != Some(u64::from(SCHEMA)) {
        return Err(format!("{id}: unsupported schema"));
    }
    if entry
        .info
        .get("collected_at")
        .and_then(Value::as_u64)
        .is_none()
    {
        return Err(format!("{id}: missing collected_at"));
    }
    if let Some(secret) = secret {
        match &entry.sig {
            Some(sig) if secret.verify(&entry.info, sig) => {}
            Some(_) => return Err(format!("{id}: bad signature")),
            None => return Err(format!("{id}: unsigned")),
        }
    }
    Ok(id.to_string())
}

impl Inventory {
    pub fn new() -> Self {
        Self {
            schema: SCHEMA,
            updated_at: 0,
            hosts: BTreeMap::new(),
        }
    }

    pub fn merge(&mut self, entry: Entry, secret: Option<&Secret>) -> Outcome {
        let id = match check(&entry, secret) {
            Ok(id) => id,
            Err(reason) => return Outcome::Rejected(reason),
        };
        let Some(held) = self.hosts.get(&id) else {
            self.hosts.insert(id, entry);
            return Outcome::Added;
        };
        let (new, old) = (collected_at(&entry), collected_at(held));
        let wins = new > old || (new == old && canonical(&entry.info) > canonical(&held.info));
        if new == old && canonical(&entry.info) == canonical(&held.info) {
            // Same card; keep a signature if only one side has one.
            if held.sig.is_none() && entry.sig.is_some() {
                self.hosts.insert(id, entry);
                return Outcome::Updated;
            }
            return Outcome::Unchanged;
        }
        if wins {
            self.hosts.insert(id, entry);
            Outcome::Updated
        } else {
            Outcome::Stale
        }
    }

    /// Merges every entry of `other`; returns the rejection reasons.
    pub fn merge_inventory(&mut self, other: Inventory, secret: Option<&Secret>) -> Vec<String> {
        let mut rejected = Vec::new();
        for (_, entry) in other.hosts {
            if let Outcome::Rejected(reason) = self.merge(entry, secret) {
                rejected.push(reason);
            }
        }
        rejected
    }

    pub fn infos(&self) -> Vec<HostInfo> {
        self.hosts
            .values()
            .filter_map(|e| serde_json::from_value(e.info.clone()).ok())
            .collect()
    }
}

/// `$BUN_HOST_DIR`, else `~/.bun/host`.
pub fn store_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BUN_HOST_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".bun").join("host")
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".{}.tmp", std::process::id()));
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

/// Cards (`{info, sig}`) dropped as `*.json` in `dir`; unreadable files are reported, not fatal.
pub fn read_cards(dir: &Path) -> (Vec<Entry>, Vec<String>) {
    let (mut cards, mut errors) = (Vec::new(), Vec::new());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (cards, errors);
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    for path in paths {
        match std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|b| serde_json::from_slice::<Entry>(&b).map_err(|e| e.to_string()))
        {
            Ok(card) => cards.push(card),
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }
    }
    (cards, errors)
}

#[derive(Debug, Default)]
pub struct Loaded {
    pub inventory: Inventory,
    pub rejected: Vec<String>,
}

/// `inventory.json` plus the cards in `inbox/`, merged. Writes nothing.
pub fn load(dir: &Path, secret: Option<&Secret>) -> Loaded {
    let mut inventory = Inventory::new();
    let mut rejected = Vec::new();
    if let Ok(bytes) = std::fs::read(dir.join("inventory.json")) {
        match serde_json::from_slice::<Inventory>(&bytes) {
            Ok(saved) => {
                inventory.updated_at = saved.updated_at;
                rejected.extend(inventory.merge_inventory(saved, secret));
            }
            Err(e) => rejected.push(format!("inventory.json: {e}")),
        }
    }
    let (cards, errors) = read_cards(&dir.join("inbox"));
    rejected.extend(errors);
    for card in cards {
        if let Outcome::Rejected(reason) = inventory.merge(card, secret) {
            rejected.push(reason);
        }
    }
    Loaded {
        inventory,
        rejected,
    }
}

pub fn save(dir: &Path, inventory: &mut Inventory) -> Result<(), String> {
    inventory.updated_at = crate::collect::now_ms();
    let text = serde_json::to_string_pretty(inventory).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("inventory.json"), text.as_bytes())
}

#[derive(Debug, Default, Clone)]
pub struct Query {
    pub min_vram_free_gb: Option<f64>,
    pub min_ram_gb: Option<f64>,
    pub min_disk_free_gb: Option<f64>,
    /// Case-insensitive substring of a GPU name.
    pub gpu: Option<String>,
    /// Case-insensitive substring of the OS family or name.
    pub os: Option<String>,
    pub cuda: bool,
    pub max_age_s: Option<u64>,
}

/// Hosts satisfying `query`, best free VRAM first, as JSON objects.
pub fn find(inventory: &Inventory, query: &Query, now_ms: u64) -> Vec<Value> {
    const GIB: f64 = 1024.0;
    let mut hits: Vec<(u64, u64, Value)> = Vec::new();
    for info in inventory.infos() {
        let age_s = now_ms.saturating_sub(info.collected_at) / 1000;
        if query.max_age_s.is_some_and(|max| age_s > max) {
            continue;
        }
        let gpu_ok = |g: &crate::schema::Gpu| {
            query.gpu.as_ref().is_none_or(|n| {
                g.name
                    .to_ascii_lowercase()
                    .contains(&n.to_ascii_lowercase())
            }) && (!query.cuda || g.cuda.is_some())
                && query
                    .min_vram_free_gb
                    .is_none_or(|min| g.vram_free_mib.is_some_and(|f| f as f64 >= min * GIB))
        };
        let gpus: Vec<&crate::schema::Gpu> = info.gpus.iter().filter(|g| gpu_ok(g)).collect();
        if (query.gpu.is_some() || query.cuda || query.min_vram_free_gb.is_some())
            && gpus.is_empty()
        {
            continue;
        }
        if query
            .min_ram_gb
            .is_some_and(|min| (info.memory.available_mib as f64) < min * GIB)
        {
            continue;
        }
        let disk_free = info.disks.iter().map(|d| d.free_mib).max().unwrap_or(0);
        if query
            .min_disk_free_gb
            .is_some_and(|min| (disk_free as f64) < min * GIB)
        {
            continue;
        }
        if let Some(os) = &query.os {
            let os = os.to_ascii_lowercase();
            if !info.os.family.to_ascii_lowercase().contains(&os)
                && !info.os.name.to_ascii_lowercase().contains(&os)
            {
                continue;
            }
        }
        let best_vram = gpus
            .iter()
            .filter_map(|g| g.vram_free_mib)
            .max()
            .unwrap_or(0);
        hits.push((
            best_vram,
            info.memory.available_mib,
            json!({
                "id": info.id,
                "age_s": age_s,
                "os": format!("{} {}", info.os.name, info.os.version).trim(),
                "kernel": info.kernel.release,
                "cpu": info.cpu.model,
                "logical_cores": info.cpu.logical_cores,
                "ram_available_gib": round1(info.memory.available_mib as f64 / GIB),
                "ram_total_gib": round1(info.memory.total_mib as f64 / GIB),
                "gpus": gpus.iter().map(|g| json!({
                    "name": g.name,
                    "vram_free_gib": g.vram_free_mib.map(|m| round1(m as f64 / GIB)),
                    "vram_total_gib": round1(g.vram_total_mib as f64 / GIB),
                    "cuda": g.cuda,
                })).collect::<Vec<_>>(),
                "disk_free_gib_max": round1(disk_free as f64 / GIB),
                "wireguard": info.network.wireguard.iter().map(|a| a.ip.clone()).collect::<Vec<_>>(),
            }),
        ));
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    hits.into_iter().map(|h| h.2).collect()
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}
