// SPDX-License-Identifier: Apache-2.0
//! Browser backend for the Aphrody file explorer wire protocol.
//!
//! The webos explorer sends `{"Query"|"Action": {method, library_id, payload}}`
//! envelopes and expects `{"json": ...}` or `{"error": ...}`. In the native app a daemon answers; in
//! the browser this module answers from the OPFS-persisted VFS, so the same UI runs unchanged.
//! Only the methods the explorer needs are served; any other method returns an explicit error.

use aphrody_shell_vfs::{FileKind, Vfs, VfsError, path as vpath};
use serde_json::{Value, json};

/// Device slug of the single browser device.
pub const DEVICE_SLUG: &str = "webos";
const LIBRARY_ID: &str = "00000000-0000-4000-8000-0000000000a1";
const LOCATION_ID: &str = "00000000-0000-4000-8000-0000000000b1";
const DEVICE_ID: &str = "00000000-0000-4000-8000-0000000000c1";
const VOLUME_ID: &str = "00000000-0000-4000-8000-0000000000d1";
const SPACE_ID: &str = "00000000-0000-4000-8000-0000000000e1";
/// Root of the indexed location.
pub const HOME: &str = "/home/user";
const DEFAULT_LIMIT: usize = 1000;
const SEARCH_LIMIT: usize = 200;
const SEARCH_DEPTH: usize = 12;

type Reply = Result<Value, String>;

fn vfs_err(e: VfsError) -> String {
    e.to_string()
}

fn sd_path(path: &str) -> Value {
    json!({ "Physical": { "device_slug": DEVICE_SLUG, "path": path } })
}

fn path_of(sd: &Value) -> Result<String, String> {
    let physical = sd
        .get("Physical")
        .ok_or("only Physical paths exist in the browser")?;
    let path = physical
        .get("path")
        .and_then(Value::as_str)
        .ok_or("path missing")?;
    let norm = vpath::normalize(path.as_bytes()).map_err(vfs_err)?;
    String::from_utf8(norm).map_err(|e| e.to_string())
}

fn content_kind(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" => "image",
        "mp4" | "webm" | "mkv" | "mov" => "video",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" => "audio",
        "zip" | "tar" | "gz" | "xz" | "7z" | "zst" => "archive",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "c" | "h" | "cpp" | "java" | "sh"
        | "html" | "css" => "code",
        "json" | "toml" | "yaml" | "yml" | "ini" | "conf" => "config",
        "txt" | "md" | "log" | "csv" => "text",
        "pdf" | "doc" | "docx" | "odt" => "document",
        "exe" | "dll" | "so" | "wasm" | "elf" => "executable",
        _ => "unknown",
    }
}

fn file_json(path: &str, kind: FileKind, size: u64, now: &str) -> Value {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = match kind {
        FileKind::File => name
            .rsplit_once('.')
            .filter(|(stem, _)| !stem.is_empty())
            .map(|(_, e)| e),
        FileKind::Dir => None,
    };
    json!({
        "id": format!("webos:{path}"),
        "sd_path": sd_path(path),
        "kind": if kind == FileKind::Dir { "Directory" } else { "File" },
        "name": name,
        "extension": extension,
        "size": size,
        "content_identity": null,
        "alternate_paths": [],
        "tags": [],
        "sidecars": [],
        "image_media_data": null,
        "video_media_data": null,
        "audio_media_data": null,
        "created_at": now,
        "modified_at": now,
        "accessed_at": null,
        "content_kind": extension.map_or("unknown", content_kind),
        "is_local": true,
        "duration_seconds": null,
    })
}

fn node(fs: &mut impl Vfs, path: &str, now: &str) -> Result<Value, String> {
    let st = fs.stat(path.as_bytes()).map_err(vfs_err)?;
    Ok(file_json(path, st.kind, st.size, now))
}

fn children(fs: &mut impl Vfs, dir: &str, hidden: bool, now: &str) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for entry in fs.read_dir(dir.as_bytes()).map_err(vfs_err)? {
        let name = String::from_utf8_lossy(&entry.name).into_owned();
        if !hidden && name.starts_with('.') {
            continue;
        }
        let child = String::from_utf8(vpath::join(dir.as_bytes(), &entry.name))
            .map_err(|e| e.to_string())?;
        let size = fs.stat(child.as_bytes()).map(|s| s.size).unwrap_or(0);
        out.push(file_json(&child, entry.kind, size, now));
    }
    Ok(out)
}

fn sort_files(files: &mut [Value], sort_by: &str, folders_first: bool) {
    let key = |v: &Value| v["name"].as_str().unwrap_or_default().to_lowercase();
    let size = |v: &Value| v["size"].as_u64().unwrap_or(0);
    let is_dir = |v: &Value| v["kind"] == "Directory";
    files.sort_by(|a, b| {
        let dirs = if folders_first {
            is_dir(b).cmp(&is_dir(a))
        } else {
            std::cmp::Ordering::Equal
        };
        dirs.then_with(|| match sort_by {
            "size" => size(b).cmp(&size(a)),
            _ => key(a).cmp(&key(b)),
        })
    });
}

fn directory_listing(fs: &mut impl Vfs, payload: &Value, now: &str) -> Reply {
    let dir = path_of(&payload["path"])?;
    let hidden = payload["include_hidden"].as_bool().unwrap_or(false);
    let mut files = children(fs, &dir, hidden, now)?;
    sort_files(
        &mut files,
        payload["sort_by"].as_str().unwrap_or("name"),
        payload["folders_first"].as_bool().unwrap_or(false),
    );
    let total = files.len();
    let limit = payload["limit"]
        .as_u64()
        .map_or(DEFAULT_LIMIT, |n| n as usize);
    files.truncate(limit);
    Ok(json!({ "files": files, "total_count": total, "has_more": total > limit }))
}

fn walk(
    fs: &mut impl Vfs,
    dir: &str,
    needle: &str,
    depth: usize,
    now: &str,
    out: &mut Vec<Value>,
) -> Result<(), String> {
    if depth > SEARCH_DEPTH || out.len() >= SEARCH_LIMIT {
        return Ok(());
    }
    for child in children(fs, dir, true, now)? {
        if out.len() >= SEARCH_LIMIT {
            break;
        }
        let name = child["name"].as_str().unwrap_or_default().to_lowercase();
        let is_dir = child["kind"] == "Directory";
        let path = path_of(&child["sd_path"])?;
        if name.contains(needle) {
            out.push(child);
        }
        if is_dir {
            walk(fs, &path, needle, depth + 1, now, out)?;
        }
    }
    Ok(())
}

fn search_files(fs: &mut impl Vfs, payload: &Value, now: &str) -> Reply {
    let needle = payload["query"].as_str().unwrap_or_default().to_lowercase();
    let root = match payload["scope"].get("Path") {
        Some(p) => path_of(&p["path"])?,
        None => HOME.to_owned(),
    };
    let mut files = Vec::new();
    if !needle.is_empty() {
        walk(fs, &root, &needle, 0, now, &mut files)?;
    }
    let results: Vec<Value> = files
        .iter()
        .map(|file| {
            json!({
                "file": file,
                "score": 1.0,
                "score_breakdown": {
                    "temporal_score": 0.0, "semantic_score": null, "metadata_score": 1.0,
                    "recency_boost": 0.0, "user_preference_boost": 0.0, "final_score": 1.0,
                },
                "highlights": [],
                "matched_content": null,
            })
        })
        .collect();
    let total = files.len();
    Ok(json!({
        "files": files,
        "results": results,
        "total_found": total,
        "search_id": "webos-search",
        "facets": { "file_types": {}, "tags": {}, "locations": {}, "date_ranges": {}, "size_ranges": {} },
        "suggestions": [],
        "pagination": {
            "current_page": 0, "total_pages": 1, "has_next": false, "has_previous": false,
            "limit": SEARCH_LIMIT, "offset": 0,
        },
        "execution_time_ms": 0,
        "index_type": "Ephemeral",
        "available_filters": [],
    }))
}

fn library() -> Value {
    json!({ "id": LIBRARY_ID, "name": "Aphrody OS", "path": "opfs://aphrody-webos", "stats": null })
}

/// The single browser space; the sidebar renders the files groups from its layout.
fn space(now: &str) -> Value {
    json!({ "id": SPACE_ID, "name": "Aphrody OS", "icon": "Planet", "color": "#6750A4", "order": 0,
        "created_at": now, "updated_at": now })
}

/// Layout of the browser space: the OPFS location and volume groups (members are queried by the groups).
fn space_layout(now: &str) -> Value {
    let group = |n: u8, name: &str, kind: &str| {
        json!({ "group": { "id": format!("00000000-0000-4000-8000-0000000000f{n}"), "space_id": SPACE_ID,
            "name": name, "group_type": kind, "is_collapsed": false, "order": n, "created_at": now },
            "items": [] })
    };
    json!({ "id": SPACE_ID, "space": space(now), "space_items": [],
        "groups": [group(1, "Locations", "Locations"), group(2, "Volumes", "Volumes")] })
}

fn location(fs: &mut impl Vfs, now: &str) -> Value {
    let (mut files, mut dirs, mut bytes) = (0u64, 0u64, 0u64);
    let mut stack = vec![HOME.to_owned()];
    while let Some(dir) = stack.pop() {
        for child in children(fs, &dir, true, now).unwrap_or_default() {
            if child["kind"] == "Directory" {
                dirs += 1;
                if let Ok(p) = path_of(&child["sd_path"]) {
                    stack.push(p);
                }
            } else {
                files += 1;
                bytes += child["size"].as_u64().unwrap_or(0);
            }
        }
    }
    json!({
        "id": LOCATION_ID,
        "library_id": LIBRARY_ID,
        "sd_path": sd_path(HOME),
        "name": "Home",
        "index_mode": "Shallow",
        "scan_interval": null,
        "total_size": bytes,
        "file_count": files,
        "directory_count": dirs,
        "scan_state": "Completed",
        "created_at": now,
        "updated_at": now,
        "last_scan_at": now,
        "is_available": true,
        "ignore_patterns": [],
    })
}

fn device(now: &str) -> Value {
    json!({
        "id": DEVICE_ID,
        "name": "Aphrody OS (browser)",
        "slug": DEVICE_SLUG,
        "os": "Other",
        "os_version": null,
        "hardware_model": null,
        "cpu_model": null,
        "cpu_architecture": "wasm32",
        "cpu_cores_physical": null,
        "cpu_cores_logical": null,
        "cpu_frequency_mhz": null,
        "memory_total_bytes": null,
        "form_factor": "Other",
        "manufacturer": null,
        "gpu_models": null,
        "boot_disk_type": null,
        "boot_disk_capacity_bytes": null,
        "swap_total_bytes": null,
        "network_addresses": [],
        "capabilities": {},
        "is_online": true,
        "last_seen_at": now,
        "sync_enabled": false,
        "created_at": now,
        "updated_at": now,
        "is_current": true,
        "is_paired": false,
        "is_connected": true,
    })
}

fn volume(now: &str) -> Value {
    json!({
        "id": VOLUME_ID,
        "fingerprint": "webos-opfs",
        "device_id": DEVICE_ID,
        "name": "Browser storage (OPFS)",
        "library_id": LIBRARY_ID,
        "is_tracked": true,
        "mount_point": "/",
        "mount_points": ["/"],
        "volume_type": "Primary",
        "mount_type": "System",
        "disk_type": "Virtual",
        "file_system": { "Other": "APFS1" },
        "total_capacity": aphrody_shell_web::opfs::MAX_IMAGE_BYTES,
        "available_space": aphrody_shell_web::opfs::MAX_IMAGE_BYTES,
        "is_read_only": false,
        "is_mounted": true,
        "hardware_id": null,
        "cloud_identifier": null,
        "cloud_config": null,
        "apfs_container": null,
        "container_volume_id": null,
        "path_mappings": [],
        "is_user_visible": true,
        "auto_track_eligible": false,
        "read_speed_mbps": null,
        "write_speed_mbps": null,
        "created_at": now,
        "updated_at": now,
        "last_seen_at": now,
        "total_files": null,
        "total_directories": null,
        "last_stats_update": null,
        "display_name": null,
        "is_favorite": false,
        "color": null,
        "icon": null,
        "error_message": null,
    })
}

fn receipt(name: &str) -> Value {
    json!({ "id": format!("webos-{name}"), "job_name": name })
}

fn rename(fs: &mut impl Vfs, payload: &Value) -> Reply {
    let from = path_of(&payload["target"])?;
    let name = payload["new_name"].as_str().ok_or("new_name missing")?;
    if name.is_empty() || name.contains('/') {
        return Err("invalid file name".into());
    }
    let (parent, _) = vpath::split_parent(from.as_bytes()).ok_or("cannot rename the root")?;
    let to = vpath::join(parent, name.as_bytes());
    fs.rename(from.as_bytes(), &to).map_err(vfs_err)?;
    Ok(receipt("rename"))
}

fn delete(fs: &mut impl Vfs, payload: &Value) -> Reply {
    let paths = payload["targets"]["paths"]
        .as_array()
        .ok_or("targets missing")?;
    for sd in paths {
        let path = path_of(sd)?;
        if path == "/" || path == HOME {
            return Err("refusing to delete a protected directory".into());
        }
        fs.remove_all(path.as_bytes()).map_err(vfs_err)?;
    }
    Ok(receipt("delete"))
}

/// Answer one wire request; `now` is an RFC 3339 timestamp (the VFS stores none).
///
/// # Errors
/// Returns a message for malformed envelopes, unsupported methods and VFS failures.
pub fn handle(fs: &mut impl Vfs, request: &Value, now: &str) -> Reply {
    if request.as_str() == Some("Ping") {
        return Ok(json!("Pong"));
    }
    let call = request
        .get("Query")
        .or_else(|| request.get("Action"))
        .ok_or("malformed request")?;
    let method = call["method"].as_str().ok_or("method missing")?;
    let payload = &call["payload"];
    fs.mkdir_all(HOME.as_bytes()).map_err(vfs_err)?;
    match method {
        "query:libraries.list" => Ok(json!([library()])),
        "query:spaces.list" => Ok(json!({ "spaces": [space(now)] })),
        "query:spaces.get_layout" => Ok(space_layout(now)),
        "query:locations.list" => Ok(json!({ "locations": [location(fs, now)] })),
        "query:locations.suggested" => Ok(json!({ "locations": [] })),
        "query:devices.list" => Ok(json!([device(now)])),
        "query:volumes.list" => Ok(json!({ "volumes": [volume(now)] })),
        "query:files.directory_listing" => directory_listing(fs, payload, now),
        "query:search.files" => search_files(fs, payload, now),
        "query:files.by_path" => {
            let path = payload["path"].as_str().ok_or("path missing")?;
            node(fs, path, now)
        }
        "query:files.by_id" => {
            let id = payload["file_id"].as_str().ok_or("file_id missing")?;
            node(fs, id.strip_prefix("webos:").ok_or("unknown file id")?, now)
        }
        "action:files.rename" => rename(fs, payload),
        "action:files.delete" => delete(fs, payload),
        other => Err(format!("{other} is not served by the browser backend")),
    }
}

/// Wire envelope: `{"json": ...}` on success, `{"error": "..."}` otherwise.
#[must_use]
pub fn envelope(reply: Reply) -> String {
    match reply {
        Ok(Value::String(s)) if s == "Pong" => json!("Pong").to_string(),
        Ok(value) => json!({ "json": value }).to_string(),
        Err(message) => json!({ "error": message }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_shell_web::opfs::OpfsVfs;

    const NOW: &str = "2026-10-10T00:00:00Z";

    fn query(fs: &mut OpfsVfs, method: &str, payload: Value) -> Value {
        let req = json!({ "Query": { "method": method, "library_id": null, "payload": payload } });
        let text = envelope(handle(fs, &req, NOW));
        serde_json::from_str(&text).expect("json")
    }

    #[test]
    fn lists_searches_renames_and_deletes() {
        let mut fs = OpfsVfs::new();
        fs.mkdir_all(b"/home/user/docs").expect("mkdir");
        fs.write(b"/home/user/docs/Notes.md", b"hello")
            .expect("write");
        fs.write(b"/home/user/b.txt", b"xy").expect("write");
        let listing = query(
            &mut fs,
            "query:files.directory_listing",
            json!({ "path": sd_path(HOME), "sort_by": "name", "folders_first": true }),
        );
        let files = listing["json"]["files"].as_array().expect("files");
        assert_eq!(files[0]["name"], "docs");
        assert_eq!(files[1]["name"], "b.txt");
        assert_eq!(files[1]["size"], 2);
        let found = query(
            &mut fs,
            "query:search.files",
            json!({ "query": "notes", "scope": "Library" }),
        );
        assert_eq!(found["json"]["total_found"], 1);
        let rename_req = json!({ "Action": { "method": "action:files.rename", "library_id": null,
            "payload": { "target": sd_path("/home/user/b.txt"), "new_name": "c.txt" } } });
        assert!(envelope(handle(&mut fs, &rename_req, NOW)).contains("job_name"));
        assert_eq!(fs.read(b"/home/user/c.txt").expect("renamed"), b"xy");
        let del = json!({ "Action": { "method": "action:files.delete", "library_id": null,
            "payload": { "targets": { "paths": [sd_path("/home/user/docs")] }, "permanent": true, "recursive": true } } });
        assert!(envelope(handle(&mut fs, &del, NOW)).contains("job_name"));
        assert!(!fs.exists(b"/home/user/docs"));
        let bad = query(&mut fs, "query:nope", json!({}));
        assert!(bad["error"].as_str().expect("error").contains("not served"));
    }

    #[test]
    fn serves_context_queries_and_protects_home() {
        let mut fs = OpfsVfs::new();
        assert_eq!(
            query(&mut fs, "query:libraries.list", json!({}))["json"][0]["name"],
            "Aphrody OS"
        );
        assert_eq!(
            query(&mut fs, "query:locations.list", json!({}))["json"]["locations"][0]["name"],
            "Home"
        );
        let spaces = query(&mut fs, "query:spaces.list", json!(null));
        let space_id = spaces["json"]["spaces"][0]["id"].clone();
        let layout = query(
            &mut fs,
            "query:spaces.get_layout",
            json!({ "space_id": space_id }),
        );
        assert_eq!(
            layout["json"]["groups"][0]["group"]["group_type"],
            "Locations"
        );
        assert_eq!(layout["json"]["space"]["id"], space_id);
        let del = json!({ "Action": { "method": "action:files.delete", "library_id": null,
            "payload": { "targets": { "paths": [sd_path(HOME)] } } } });
        assert!(envelope(handle(&mut fs, &del, NOW)).contains("protected"));
        assert_eq!(envelope(handle(&mut fs, &json!("Ping"), NOW)), "\"Pong\"");
    }
}
