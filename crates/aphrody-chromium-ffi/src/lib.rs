//! C ABI over the native parts of `@aphrody/chromium`, loaded with `bun:ffi` on upstream Bun.
//!
//! Ported from the aphrody-labs/bun fork's JSC host functions (`src/runtime/adblock/mod.rs`,
//! `src/runtime/privacy.rs`). Every function that returns data returns a buffer allocated here:
//!
//! ```text
//! [u64 payload length, little endian][u8 status: 0 ok, 1 error][payload]
//! ```
//!
//! The error payload is a UTF-8 message. Release every buffer with [`aphrody_chromium_buf_free`]
//! and every engine with [`aphrody_adblock_free`]. JSON crosses the boundary as UTF-8 bytes.
#![allow(unsafe_code, clippy::missing_safety_doc)]

use std::collections::HashSet;

use adblock::Engine;
use adblock::lists::{FilterFormat, FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::resources::Resource;
use serde::Deserialize;
use serde_json::json;

const HEADER: usize = 9;

fn buffer(status: u8, payload: &[u8]) -> *mut u8 {
    let mut out = Vec::with_capacity(HEADER + payload.len());
    out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    out.push(status);
    out.extend_from_slice(payload);
    let mut out = out.into_boxed_slice();
    let ptr = out.as_mut_ptr();
    std::mem::forget(out);
    ptr
}

fn ok(payload: &[u8]) -> *mut u8 {
    buffer(0, payload)
}

fn err(message: impl AsRef<str>) -> *mut u8 {
    buffer(1, message.as_ref().as_bytes())
}

fn ok_json(value: &serde_json::Value) -> *mut u8 {
    ok(value.to_string().as_bytes())
}

unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        // SAFETY: the caller passes a live buffer of `len` bytes.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

/// Free a buffer returned by any function of this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_chromium_buf_free(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: `ptr` came from `buffer`, whose header holds the payload length.
    unsafe {
        let mut len = [0u8; 8];
        std::ptr::copy_nonoverlapping(ptr, len.as_mut_ptr(), 8);
        let total = HEADER + u64::from_le_bytes(len) as usize;
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, total)));
    }
}

// ── adblock ─────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(untagged)]
enum Rules {
    Text(String),
    List(Vec<String>),
}

#[derive(Deserialize)]
struct EngineOptions {
    rules: Rules,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    debug: bool,
    #[serde(default)]
    resources: Option<Vec<Resource>>,
}

pub struct AdblockEngine {
    engine: Engine,
}

fn build_engine(json: &[u8]) -> Result<Box<AdblockEngine>, String> {
    let options: EngineOptions =
        serde_json::from_slice(json).map_err(|e| format!("Engine options: {e}"))?;
    let format = match options.format.as_deref() {
        None | Some("standard") => FilterFormat::Standard,
        Some("hosts") => FilterFormat::Hosts,
        Some(other) => return Err(format!("format must be \"standard\" or \"hosts\", got \"{other}\"")),
    };
    let opts = ParseOptions { format, ..ParseOptions::default() };
    let mut set = FilterSet::new(options.debug);
    match options.rules {
        Rules::Text(text) => set.add_filter_list(&text, opts),
        Rules::List(list) => set.add_filter_list(&list.join("\n"), opts),
    };
    let mut engine = Engine::new_with_filter_set(set);
    if let Some(resources) = options.resources {
        engine.use_resources(resources);
    }
    Ok(Box::new(AdblockEngine { engine }))
}

/// Build an engine from JSON options `{ rules, format?, debug?, resources? }`. Writes an error
/// buffer to `*error` and returns null on failure.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_new(json: *const u8, len: usize, error: *mut *mut u8) -> *mut AdblockEngine {
    // SAFETY: caller contract of `bytes`.
    match build_engine(unsafe { bytes(json, len) }) {
        Ok(engine) => Box::into_raw(engine),
        Err(message) => {
            if !error.is_null() {
                // SAFETY: `error` is a valid out pointer.
                unsafe { *error = err(message) };
            }
            std::ptr::null_mut()
        }
    }
}

/// Restore an engine from [`aphrody_adblock_serialize`] bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_deserialize(
    data: *const u8,
    len: usize,
    error: *mut *mut u8,
) -> *mut AdblockEngine {
    let mut engine = Engine::default();
    // SAFETY: caller contract of `bytes`.
    match engine.deserialize(unsafe { bytes(data, len) }) {
        Ok(()) => Box::into_raw(Box::new(AdblockEngine { engine })),
        Err(e) => {
            if !error.is_null() {
                // SAFETY: `error` is a valid out pointer.
                unsafe { *error = err(format!("Invalid serialized engine: {e:?}")) };
            }
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_free(engine: *mut AdblockEngine) {
    if !engine.is_null() {
        // SAFETY: `engine` came from `Box::into_raw` in this library.
        drop(unsafe { Box::from_raw(engine) });
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckArgs {
    url: String,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    request_type: Option<String>,
    #[serde(default)]
    method: Option<String>,
}

/// `{ url, sourceUrl?, requestType?, method? }` to the check result JSON
/// `{ matched, blocked, important, filter?, exception?, redirect?, rewrittenUrl? }`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_check(engine: *const AdblockEngine, json: *const u8, len: usize) -> *mut u8 {
    // SAFETY: `engine` is a live engine from this library.
    let Some(engine) = (unsafe { engine.as_ref() }) else { return err("engine is closed") };
    // SAFETY: caller contract of `bytes`.
    let args: CheckArgs = match serde_json::from_slice(unsafe { bytes(json, len) }) {
        Ok(args) => args,
        Err(e) => return err(format!("check arguments: {e}")),
    };
    let source = args.source_url.unwrap_or_else(|| args.url.clone());
    let kind = args.request_type.unwrap_or_else(|| "other".into());
    let method = args.method.unwrap_or_else(|| "get".into()).to_ascii_lowercase();
    let request = match Request::new(&args.url, &source, &kind, &method) {
        Ok(request) => request,
        Err(e) => return err(format!("Invalid request URL: {e:?}")),
    };
    let result = engine.engine.check_network_request(&request);
    let mut out = json!({
        "matched": result.filter.is_some(),
        "blocked": result.should_block(),
        "important": result.important,
    });
    if let Some(filter) = &result.filter {
        out["filter"] = json!(filter.raw_line.as_deref().unwrap_or(""));
    }
    if let Some(exception) = &result.exception {
        out["exception"] = json!(exception.raw_line.as_deref().unwrap_or(""));
    }
    if let Some(redirect) = &result.redirect {
        out["redirect"] = json!(redirect);
    }
    if let Some(rewritten) = &result.rewritten_url {
        out["rewrittenUrl"] = json!(rewritten);
    }
    ok_json(&out)
}

/// Cosmetic resources of a page URL (UTF-8), as JSON.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_url_cosmetic_resources(
    engine: *const AdblockEngine,
    url: *const u8,
    len: usize,
) -> *mut u8 {
    // SAFETY: `engine` is a live engine from this library.
    let Some(engine) = (unsafe { engine.as_ref() }) else { return err("engine is closed") };
    // SAFETY: caller contract of `bytes`.
    let Ok(url) = std::str::from_utf8(unsafe { bytes(url, len) }) else { return err("url must be UTF-8") };
    let resources = engine.engine.url_cosmetic_resources(url);
    let sorted = |set: &HashSet<String>| {
        let mut values: Vec<&String> = set.iter().collect();
        values.sort();
        values
    };
    ok_json(&json!({
        "hideSelectors": sorted(&resources.hide_selectors),
        "proceduralActions": sorted(&resources.procedural_actions),
        "exceptions": sorted(&resources.exceptions),
        "injectedScript": resources.injected_script,
        "generichide": resources.generichide,
    }))
}

#[derive(Deserialize)]
struct HiddenArgs {
    #[serde(default)]
    classes: Vec<String>,
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    exceptions: Vec<String>,
}

/// `{ classes, ids, exceptions }` to the sorted selector list JSON.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_hidden_class_id_selectors(
    engine: *const AdblockEngine,
    json: *const u8,
    len: usize,
) -> *mut u8 {
    // SAFETY: `engine` is a live engine from this library.
    let Some(engine) = (unsafe { engine.as_ref() }) else { return err("engine is closed") };
    // SAFETY: caller contract of `bytes`.
    let args: HiddenArgs = match serde_json::from_slice(unsafe { bytes(json, len) }) {
        Ok(args) => args,
        Err(e) => return err(format!("hiddenClassIdSelectors arguments: {e}")),
    };
    let exceptions: HashSet<String> = args.exceptions.into_iter().collect();
    let mut selectors = engine.engine.hidden_class_id_selectors(&args.classes, &args.ids, &exceptions);
    selectors.sort();
    ok_json(&json!(selectors))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_adblock_serialize(engine: *const AdblockEngine) -> *mut u8 {
    // SAFETY: `engine` is a live engine from this library.
    let Some(engine) = (unsafe { engine.as_ref() }) else { return err("engine is closed") };
    ok(&engine.engine.serialize())
}

// ── privacy ─────────────────────────────────────────────────────────────────────────────────────

/// One `bun_privacy::call`. `args`/`lens` are `nargs` buffers (a null pointer is an empty
/// argument). Output payload: `[u8 kind: 0 bool, 1 bytes, 2 list][body]`; bool body is one byte,
/// list body is `[u32 LE length][bytes]` repeated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_privacy_call(
    op: *const u8,
    op_len: usize,
    args: *const *const u8,
    lens: *const usize,
    nargs: usize,
) -> *mut u8 {
    // SAFETY: caller contract of `bytes`.
    let Ok(op) = std::str::from_utf8(unsafe { bytes(op, op_len) }) else {
        return err("privacy operation must be ASCII");
    };
    let mut list: Vec<&[u8]> = Vec::with_capacity(nargs);
    for i in 0..nargs {
        // SAFETY: `args` and `lens` hold `nargs` entries.
        let (ptr, len) = unsafe { (*args.add(i), *lens.add(i)) };
        // SAFETY: caller contract of `bytes`.
        list.push(unsafe { bytes(ptr, len) });
    }
    match aphrody_privacy::call(op, &list) {
        Err(message) => err(message),
        Ok(aphrody_privacy::Output::Bool(value)) => ok(&[0, u8::from(value)]),
        Ok(aphrody_privacy::Output::Bytes(data)) => {
            let mut out = Vec::with_capacity(1 + data.len());
            out.push(1);
            out.extend_from_slice(&data);
            ok(&out)
        }
        Ok(aphrody_privacy::Output::List(items)) => {
            let mut out = vec![2u8];
            for item in items {
                out.extend_from_slice(&(item.len() as u32).to_le_bytes());
                out.extend_from_slice(&item);
            }
            ok(&out)
        }
    }
}
