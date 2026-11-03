//! The `host_inventory` and `host_find` tools of `bun mcp`: schemas, and the functions behind them.
//! The MCP crate only wraps these.

use std::path::Path;

use serde_json::{Value, json};

use crate::registry::{self, Inventory, Query, Secret};
use crate::{collect, schema};

pub const INVENTORY_NAME: &str = "host_inventory";
pub const INVENTORY_TITLE: &str = "Host inventory";
pub const INVENTORY_DESCRIPTION: &str = "Resources of the machines of the mesh (CPU, RAM, GPU and free VRAM, disks, kernel, OS, WireGuard IPs), from the shared registry of `bunos host`. Cards are merged from `~/.bun/host` (override: BUN_HOST_DIR); `refresh` adds a fresh card of this machine.";
pub const INVENTORY_SCHEMA: &str = r#"{"type":"object","properties":{"host":{"type":"string","description":"Only this host id"},"refresh":{"type":"boolean","description":"Collect this machine now and include its card (default true)"},"max_age_s":{"type":"integer","minimum":0,"description":"Drop cards older than this"}}}"#;

pub const FIND_NAME: &str = "host_find";
pub const FIND_TITLE: &str = "Find a host";
pub const FIND_DESCRIPTION: &str = "Which host has the resources: at least N GiB of free VRAM, N GiB of available RAM or of free disk, a GPU name, CUDA, an OS. Returns the matches, most free VRAM first, so inference and builds can pick a machine.";
pub const FIND_SCHEMA: &str = r#"{"type":"object","properties":{"min_vram_free_gb":{"type":"number","minimum":0},"min_ram_gb":{"type":"number","minimum":0,"description":"Available RAM"},"min_disk_free_gb":{"type":"number","minimum":0,"description":"Free space on the largest-free volume"},"gpu":{"type":"string","description":"Substring of the GPU name, e.g. 4070"},"os":{"type":"string","description":"Substring of the OS family or name, e.g. windows, ubuntu"},"cuda":{"type":"boolean","description":"Only hosts with CUDA"},"max_age_s":{"type":"integer","minimum":0,"description":"Drop cards older than this (default 86400)"},"refresh":{"type":"boolean","description":"Include a fresh card of this machine (default true)"}}}"#;

const DEFAULT_MAX_AGE_S: u64 = 86_400;

/// Secret of the registry, from `BUN_HOST_SECRET_FILE` (0600 file) or `BUN_HOST_SECRET_ENV` (the
/// name of a variable). With a secret, unsigned or badly signed cards are dropped.
pub fn secret_from_env() -> Result<Option<Secret>, String> {
    if let Some(file) = std::env::var_os("BUN_HOST_SECRET_FILE").filter(|f| !f.is_empty()) {
        return Secret::from_file(Path::new(&file)).map(Some);
    }
    if let Some(name) = std::env::var("BUN_HOST_SECRET_ENV")
        .ok()
        .filter(|n| !n.is_empty())
    {
        return Secret::from_env(&name).map(Some);
    }
    Ok(None)
}

fn load(refresh: bool) -> Result<(Inventory, Vec<String>), String> {
    let secret = secret_from_env()?;
    let loaded = registry::load(&registry::store_dir(), secret.as_ref());
    let (mut inventory, rejected) = (loaded.inventory, loaded.rejected);
    if refresh {
        let local = collect::collect(&collect::default_id());
        inventory.merge(registry::card(&local, secret.as_ref()), secret.as_ref());
    }
    Ok((inventory, rejected))
}

fn bool_arg(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub fn inventory(args: &Value) -> Result<String, String> {
    let (inventory, rejected) = load(bool_arg(args, "refresh", true))?;
    let now = collect::now_ms();
    let max_age = args.get("max_age_s").and_then(Value::as_u64);
    let only = args.get("host").and_then(Value::as_str);
    let hosts: Vec<Value> = inventory
        .hosts
        .iter()
        .filter(|(id, _)| only.is_none_or(|h| h == id.as_str()))
        .filter(|(_, e)| {
            let at = e
                .info
                .get("collected_at")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            max_age.is_none_or(|m| now.saturating_sub(at) / 1000 <= m)
        })
        .map(|(_, e)| {
            let mut info = e.info.clone();
            let at = info
                .get("collected_at")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            info["age_s"] = json!(now.saturating_sub(at) / 1000);
            info["signed"] = json!(e.sig.is_some());
            info
        })
        .collect();
    serde_json::to_string_pretty(
        &json!({ "schema": schema::SCHEMA, "hosts": hosts, "rejected": rejected }),
    )
    .map_err(|e| e.to_string())
}

pub fn find(args: &Value) -> Result<String, String> {
    let (inventory, rejected) = load(bool_arg(args, "refresh", true))?;
    let num = |k: &str| args.get(k).and_then(Value::as_f64);
    let query = Query {
        min_vram_free_gb: num("min_vram_free_gb"),
        min_ram_gb: num("min_ram_gb"),
        min_disk_free_gb: num("min_disk_free_gb"),
        gpu: args.get("gpu").and_then(Value::as_str).map(str::to_owned),
        os: args.get("os").and_then(Value::as_str).map(str::to_owned),
        cuda: bool_arg(args, "cuda", false),
        max_age_s: Some(
            args.get("max_age_s")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_MAX_AGE_S),
        ),
    };
    let matches = registry::find(&inventory, &query, collect::now_ms());
    serde_json::to_string_pretty(
        &json!({ "count": matches.len(), "matches": matches, "rejected": rejected }),
    )
    .map_err(|e| e.to_string())
}
