// SPDX-License-Identifier: Apache-2.0
//! Typed compatibility registry for the frozen WinClean catalog, and the Windows registry
//! tools (`list_registry_key`, `get_registry_value`, `set_registry_value`,
//! `delete_registry_entry`, HAGS and GPU preferences) backed by the native Registry API in the
//! Windows-only `winreg` module; path parsing and value decoding/encoding here are platform
//! independent.
//!
//! The registry is the only routing input consumed by the kernel.  The
//! migration ledger is now complete: every entry resolves to the Rust owner.
//! The legacy and dual variants remain deserializable for historical ledger
//! compatibility, but are rejected by the kernel as production routes.

use std::{collections::BTreeMap, sync::OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ToolInfo, catalog};

/// Historical implementation states retained for ledger compatibility.
#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DispatchMode {
    /// The Rust implementation remains the sole production implementation.
    Legacy,
    /// Deterministic reads compare the Rust implementation with the oracle.
    Dual,
    /// Production calls execute the Rust owner directly.
    Rust,
}

/// A catalog tool joined with its planned Rust owner and dispatch mode.
#[derive(Debug, Clone)]
pub struct ToolRegistration {
    /// Frozen public MCP metadata.
    pub tool: ToolInfo,
    /// Crate that owns the Rust implementation.
    pub owner: String,
    /// Active implementation selection.
    pub dispatch: DispatchMode,
}

#[derive(Debug, Deserialize)]
struct OwnerRule {
    owner: String,
    prefixes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Ledger {
    tools: Vec<String>,
    owner_rules: Vec<OwnerRule>,
    dispatch: DispatchMode,
    #[serde(default)]
    dispatch_overrides: BTreeMap<String, DispatchMode>,
    #[serde(default)]
    native_rust_tools: Vec<String>,
}

fn matches(tool: &str, prefix: &str) -> bool {
    prefix == "*" || tool == prefix || tool.starts_with(prefix)
}

fn build() -> Vec<ToolRegistration> {
    let ledger: Ledger = serde_json::from_str(include_str!("../tool-migration.json"))
        .expect("tool migration ledger must be valid JSON");
    let source = catalog();
    assert_eq!(
        ledger.tools.len(),
        source.len(),
        "tool migration ledger count drift"
    );

    ledger
        .tools
        .into_iter()
        .map(|name| {
            let tool = source
                .iter()
                .find(|candidate| candidate.name == name)
                .cloned()
                .expect("tool migration ledger contains an unknown catalog tool");
            let owner = ledger
                .owner_rules
                .iter()
                .find(|rule| rule.prefixes.iter().any(|prefix| matches(&name, prefix)))
                .map(|rule| rule.owner.clone())
                .expect("tool migration ledger has an unowned catalog tool");
            let dispatch = ledger
                .native_rust_tools
                .iter()
                .any(|candidate| candidate == &name)
                .then_some(DispatchMode::Rust)
                .or_else(|| ledger.dispatch_overrides.get(&name).copied())
                .unwrap_or(ledger.dispatch);
            ToolRegistration {
                tool,
                owner,
                dispatch,
            }
        })
        .collect()
}

/// All compatibility registrations, in frozen catalog order.
#[must_use]
pub fn registrations() -> &'static [ToolRegistration] {
    static REGISTRY: OnceLock<Vec<ToolRegistration>> = OnceLock::new();
    REGISTRY.get_or_init(build)
}

/// Looks up one registered compatibility tool by its stable public name.
#[must_use]
pub fn lookup(name: &str) -> Option<&'static ToolRegistration> {
    registrations().iter().find(|entry| entry.tool.name == name)
}

/// One registry value of `list_registry_key`: `data` keeps the `reg.exe` rendering (strings as
/// is, integers as `0x…`, `REG_MULTI_SZ` joined by `\0`, binary as upper-case hex) and `value`
/// carries the typed decoding (string, array of strings, integer or hex string).
#[derive(Debug, Clone, Serialize)]
pub struct RegistryValue {
    pub name: String,
    pub value_type: String,
    pub data: String,
    pub value: Value,
}

/// Registry value type codes (`winnt.h`).
mod kind {
    pub(super) const NONE: u32 = 0;
    pub(super) const SZ: u32 = 1;
    pub(super) const EXPAND_SZ: u32 = 2;
    pub(super) const BINARY: u32 = 3;
    pub(super) const DWORD: u32 = 4;
    pub(super) const DWORD_BIG_ENDIAN: u32 = 5;
    pub(super) const LINK: u32 = 6;
    pub(super) const MULTI_SZ: u32 = 7;
    pub(super) const RESOURCE_LIST: u32 = 8;
    pub(super) const FULL_RESOURCE_DESCRIPTOR: u32 = 9;
    pub(super) const RESOURCE_REQUIREMENTS_LIST: u32 = 10;
    pub(super) const QWORD: u32 = 11;
}

/// A predefined registry root key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hive {
    CurrentUser,
    LocalMachine,
    ClassesRoot,
    Users,
    CurrentConfig,
}

impl Hive {
    /// The `HKEY_*` spelling used in error messages.
    #[must_use]
    pub fn long_name(self) -> &'static str {
        match self {
            Self::CurrentUser => "HKEY_CURRENT_USER",
            Self::LocalMachine => "HKEY_LOCAL_MACHINE",
            Self::ClassesRoot => "HKEY_CLASSES_ROOT",
            Self::Users => "HKEY_USERS",
            Self::CurrentConfig => "HKEY_CURRENT_CONFIG",
        }
    }
}

/// A validated registry key path: the hive and the sub-key below it (empty for the hive root).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryPath {
    pub hive: Hive,
    pub subkey: String,
}

fn invalid(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, message.to_owned())
}

/// Parse `HKCU:\Software\X`, `HKCU\Software\X` or `HKEY_CURRENT_USER\Software\X` (hive names
/// are case-insensitive; `HKLM`, `HKCR`, `HKU` and `HKCC` are accepted the same way).
pub fn parse_path(path: &str) -> std::io::Result<RegistryPath> {
    let trimmed = path.trim();
    if trimmed.is_empty()
        || trimmed.chars().any(|c| c.is_control() || c == '"')
        || trimmed.contains("..")
    {
        return Err(invalid("invalid registry path"));
    }
    let (hive_name, rest) = trimmed.split_once('\\').unwrap_or((trimmed, ""));
    let hive = match hive_name
        .trim_end_matches(':')
        .to_ascii_uppercase()
        .as_str()
    {
        "HKCU" | "HKEY_CURRENT_USER" => Hive::CurrentUser,
        "HKLM" | "HKEY_LOCAL_MACHINE" => Hive::LocalMachine,
        "HKCR" | "HKEY_CLASSES_ROOT" => Hive::ClassesRoot,
        "HKU" | "HKEY_USERS" => Hive::Users,
        "HKCC" | "HKEY_CURRENT_CONFIG" => Hive::CurrentConfig,
        _ => return Err(invalid("registry path must use a supported hive")),
    };
    let subkey = rest.trim_matches('\\');
    if subkey.split('\\').any(str::is_empty) && !subkey.is_empty() {
        return Err(invalid("registry path contains an empty key name"));
    }
    Ok(RegistryPath {
        hive,
        subkey: subkey.to_owned(),
    })
}

fn validate_value_name(name: &str) -> std::io::Result<()> {
    if name.is_empty() || name.chars().any(|c| c.is_control() || c == '"') {
        return Err(invalid("invalid registry value name"));
    }
    Ok(())
}

/// The API name of a value: `(default)` addresses the unnamed default value.
#[cfg(any(windows, test))]
fn api_value_name(name: &str) -> &str {
    if name.eq_ignore_ascii_case("(default)") {
        ""
    } else {
        name
    }
}

/// A registry value decoded from its raw `(type, bytes)` form.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedValue {
    /// `REG_SZ`, `REG_DWORD`, … (`REG_0x…` for undocumented type codes).
    pub type_name: String,
    /// The `reg.exe` rendering, kept for callers of the historical string shape.
    pub data: String,
    /// The typed value.
    pub value: Value,
}

fn type_name(code: u32) -> String {
    match code {
        kind::NONE => "REG_NONE",
        kind::SZ => "REG_SZ",
        kind::EXPAND_SZ => "REG_EXPAND_SZ",
        kind::BINARY => "REG_BINARY",
        kind::DWORD => "REG_DWORD",
        kind::DWORD_BIG_ENDIAN => "REG_DWORD_BIG_ENDIAN",
        kind::LINK => "REG_LINK",
        kind::MULTI_SZ => "REG_MULTI_SZ",
        kind::RESOURCE_LIST => "REG_RESOURCE_LIST",
        kind::FULL_RESOURCE_DESCRIPTOR => "REG_FULL_RESOURCE_DESCRIPTOR",
        kind::RESOURCE_REQUIREMENTS_LIST => "REG_RESOURCE_REQUIREMENTS_LIST",
        kind::QWORD => "REG_QWORD",
        other => return format!("REG_0x{other:X}"),
    }
    .to_owned()
}

fn utf16_units(data: &[u8]) -> Vec<u16> {
    data.as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect()
}

fn hex_upper(data: &[u8]) -> String {
    data.iter().map(|byte| format!("{byte:02X}")).collect()
}

/// Decode raw registry data. Malformed integers (too few bytes) fall back to hex.
#[must_use]
pub fn decode_value(code: u32, data: &[u8]) -> DecodedValue {
    let type_name = type_name(code);
    let binary = |type_name: String| {
        let hex = hex_upper(data);
        DecodedValue {
            type_name,
            data: hex.clone(),
            value: Value::String(hex),
        }
    };
    match code {
        kind::SZ | kind::EXPAND_SZ | kind::LINK => {
            let units = utf16_units(data);
            let end = units
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(units.len());
            let text = String::from_utf16_lossy(&units[..end]);
            DecodedValue {
                type_name,
                data: text.clone(),
                value: Value::String(text),
            }
        }
        kind::MULTI_SZ => {
            let units = utf16_units(data);
            let items: Vec<String> = units
                .split(|&unit| unit == 0)
                .take_while(|item| !item.is_empty())
                .map(String::from_utf16_lossy)
                .collect();
            DecodedValue {
                type_name,
                data: items.join("\\0"),
                value: Value::Array(items.into_iter().map(Value::String).collect()),
            }
        }
        kind::DWORD | kind::DWORD_BIG_ENDIAN if data.len() >= 4 => {
            let bytes = [data[0], data[1], data[2], data[3]];
            let number = if code == kind::DWORD {
                u32::from_le_bytes(bytes)
            } else {
                u32::from_be_bytes(bytes)
            };
            DecodedValue {
                type_name,
                data: format!("0x{number:x}"),
                value: Value::from(number),
            }
        }
        kind::QWORD if data.len() >= 8 => {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&data[..8]);
            let number = u64::from_le_bytes(bytes);
            DecodedValue {
                type_name,
                data: format!("0x{number:x}"),
                value: Value::from(number),
            }
        }
        _ => binary(type_name),
    }
}

fn parse_integer(value: &str) -> Option<u64> {
    let value = value.trim();
    match value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        Some(hex) => u64::from_str_radix(hex, 16).ok(),
        None => value.parse().ok(),
    }
}

fn utf16_bytes<'a>(items: impl IntoIterator<Item = &'a str>) -> Vec<u8> {
    let mut bytes = Vec::new();
    for item in items {
        for unit in item.encode_utf16().chain(std::iter::once(0)) {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
    }
    bytes
}

/// Encode a `set_registry_value` argument: `String`, `ExpandString`, `DWord`, `QWord` (decimal
/// or `0x` hex), `MultiString` (newline-separated), `Binary` (hex) or `None` (empty data). The
/// `REG_*` names that `get_registry_value` reports are accepted too, so a read value can be
/// written back unchanged. Returns the `REG_*` code and data bytes.
pub fn encode_value(value: &str, value_type: &str) -> std::io::Result<(u32, Vec<u8>)> {
    let lowered = match value_type.trim().to_ascii_lowercase().as_str() {
        "reg_sz" => "string".to_owned(),
        "reg_expand_sz" => "expandstring".to_owned(),
        "reg_dword" => "dword".to_owned(),
        "reg_qword" => "qword".to_owned(),
        "reg_multi_sz" => "multistring".to_owned(),
        "reg_binary" => "binary".to_owned(),
        "reg_none" => "none".to_owned(),
        other => other.to_owned(),
    };
    if value.contains('\0') {
        return Err(invalid("registry value contains NUL"));
    }
    match lowered.as_str() {
        "string" | "expandstring" => {
            let code = if lowered == "string" {
                kind::SZ
            } else {
                kind::EXPAND_SZ
            };
            Ok((code, utf16_bytes([value])))
        }
        "dword" => parse_integer(value)
            .and_then(|number| u32::try_from(number).ok())
            .map(|number| (kind::DWORD, number.to_le_bytes().to_vec()))
            .ok_or_else(|| invalid("DWord value must be a 32-bit decimal or 0x-hex integer")),
        "qword" => parse_integer(value)
            .map(|number| (kind::QWORD, number.to_le_bytes().to_vec()))
            .ok_or_else(|| invalid("QWord value must be a 64-bit decimal or 0x-hex integer")),
        "multistring" => {
            let body = value.strip_suffix('\n').unwrap_or(value);
            let body = body.strip_suffix('\r').unwrap_or(body);
            let items: Vec<&str> = if body.is_empty() {
                Vec::new()
            } else {
                body.split('\n')
                    .map(|line| line.strip_suffix('\r').unwrap_or(line))
                    .collect()
            };
            if items.iter().any(|item| item.is_empty()) {
                return Err(invalid("MultiString lines must be non-empty"));
            }
            let mut bytes = utf16_bytes(items);
            bytes.extend_from_slice(&0u16.to_le_bytes());
            Ok((kind::MULTI_SZ, bytes))
        }
        "none" => Ok((kind::NONE, Vec::new())),
        "binary" => {
            let hex: String = value.chars().filter(|c| !c.is_whitespace()).collect();
            if hex.len() % 2 != 0 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(invalid("Binary value must be an even-length hex string"));
            }
            Ok((
                kind::BINARY,
                (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)).collect(),
            ))
        }
        _ => Err(invalid("unsupported registry value type")),
    }
}

#[cfg(windows)]
fn registry_value(raw: crate::winreg::RawValue) -> RegistryValue {
    let decoded = decode_value(raw.kind, &raw.data);
    RegistryValue {
        name: if raw.name.is_empty() {
            "(default)".to_owned()
        } else {
            raw.name
        },
        value_type: decoded.type_name,
        data: decoded.data,
        value: decoded.value,
    }
}

#[cfg(not(windows))]
fn windows_only() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Unsupported, "registry is Windows-only")
}

/// List the sub-keys (as full paths in the caller's spelling) and values of a key.
pub fn list_key(path: &str) -> std::io::Result<Value> {
    let parsed = parse_path(path)?;
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err(windows_only())
    }
    #[cfg(windows)]
    {
        let key = crate::winreg::open_read(parsed.hive, &parsed.subkey)?;
        let base = path.trim().trim_end_matches('\\');
        let subkeys: Vec<String> = crate::winreg::subkeys(&key)?
            .into_iter()
            .map(|name| format!("{base}\\{name}"))
            .collect();
        let values: Vec<RegistryValue> = crate::winreg::values(&key)?
            .into_iter()
            .map(registry_value)
            .collect();
        Ok(json!({"Path": path, "SubKeys": subkeys, "Values": values}))
    }
}

/// Read one value; `(default)` reads the unnamed default value.
pub fn get_value(path: &str, name: &str) -> std::io::Result<Value> {
    let parsed = parse_path(path)?;
    validate_value_name(name)?;
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err(windows_only())
    }
    #[cfg(windows)]
    {
        let key = crate::winreg::open_read(parsed.hive, &parsed.subkey)?;
        let raw = crate::winreg::query_value(&key, api_value_name(name))?;
        let decoded = decode_value(raw.kind, &raw.data);
        Ok(json!({
            "Path": path,
            "Name": name,
            "Type": decoded.type_name,
            "Data": decoded.data,
            "Value": decoded.value,
        }))
    }
}

pub fn get_hags_mode() -> std::io::Result<Value> {
    let path = r"HKLM:\System\CurrentControlSet\Control\GraphicsDrivers";
    match get_value(path, "HwSchMode") {
        Ok(value) => {
            let mode = value["Value"]
                .as_u64()
                .and_then(|raw| u32::try_from(raw).ok());
            Ok(
                json!({"Mode": mode, "Description": match mode { Some(0) => "CPU scheduling", Some(1) => "OS-managed default", Some(2) => "Hardware-Accelerated GPU Scheduling", _ => "unset/unknown" }}),
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(json!({"Mode": null, "Description": "unset/unknown"}))
        }
        Err(error) => Err(error),
    }
}

pub fn get_gpu_preferences() -> std::io::Result<Value> {
    list_key(r"HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences")
}

pub fn set_hags_mode(mode: u32) -> std::io::Result<Value> {
    if mode > 2 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "HAGS mode must be 0, 1, or 2",
        ));
    }
    let path = r"HKLM:\System\CurrentControlSet\Control\GraphicsDrivers";
    let previous = get_value(path, "HwSchMode")
        .ok()
        .and_then(|value| value.get("Data").cloned());
    set_value(path, "HwSchMode", &mode.to_string(), "DWord")?;
    Ok(json!({"Previous": previous, "NewValue": mode}))
}

pub fn set_gpu_preference(exe_path: &str, preference: &str) -> std::io::Result<Value> {
    let path = std::path::Path::new(exe_path);
    if !path.is_absolute()
        || !exe_path.to_ascii_lowercase().ends_with(".exe")
        || exe_path.chars().any(|c| c.is_control() || c == '"')
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "exePath must be an absolute .exe path",
        ));
    }
    let mode = match preference.trim().to_ascii_lowercase().as_str() {
        "systemdefault" => 0,
        "powersaving" => 1,
        "highperformance" => 2,
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "preference must be SystemDefault, PowerSaving, or HighPerformance",
            ));
        }
    };
    let key = r"HKCU:\SOFTWARE\Microsoft\DirectX\UserGpuPreferences";
    let previous = get_value(key, exe_path)
        .ok()
        .and_then(|value| value.get("Data").cloned());
    set_value(key, exe_path, &format!("GpuPreference={mode};"), "String")?;
    Ok(
        json!({"ExePath": exe_path, "Previous": previous, "NewValue": format!("GpuPreference={mode};")}),
    )
}

/// Write one value, creating the key (and missing parents) when needed.
pub fn set_value(path: &str, name: &str, value: &str, value_type: &str) -> std::io::Result<String> {
    let parsed = parse_path(path)?;
    validate_value_name(name)?;
    let (code, bytes) = encode_value(value, value_type)?;
    #[cfg(not(windows))]
    {
        let _ = (parsed, code, bytes);
        Err(windows_only())
    }
    #[cfg(windows)]
    {
        let key = crate::winreg::create(parsed.hive, &parsed.subkey)?;
        crate::winreg::set_value(&key, api_value_name(name), code, &bytes)?;
        Ok(format!("Set registry value {path}\\{name}"))
    }
}

/// Delete a value (`name` set; `(default)` is the unnamed default value) or the whole key with
/// its sub-keys (`name` null or empty). A hive root is never deleted.
pub fn delete_entry(path: &str, name: Option<&str>) -> std::io::Result<String> {
    let parsed = parse_path(path)?;
    let name = name.filter(|value| !value.is_empty());
    if let Some(name) = name {
        validate_value_name(name)?;
    } else if parsed.subkey.is_empty() {
        return Err(invalid("refusing to delete a registry hive root"));
    }
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err(windows_only())
    }
    #[cfg(windows)]
    {
        if let Some(name) = name {
            let key = crate::winreg::open_write(parsed.hive, &parsed.subkey)?;
            crate::winreg::delete_value(&key, api_value_name(name))?;
            Ok(format!("Deleted registry value {path}\\{name}"))
        } else {
            crate::winreg::delete_tree(parsed.hive, &parsed.subkey)?;
            Ok(format!("Deleted registry key {path}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        DispatchMode, Hive, api_value_name, decode_value, encode_value, kind, lookup, parse_path,
        registrations,
    };

    #[test]
    fn registry_preserves_catalog_and_ownership() {
        let entries = registrations();
        assert_eq!(entries.len(), crate::TOOL_NAMES.len());
        assert!(entries.iter().all(|entry| !entry.owner.is_empty()));
        assert!(
            entries
                .iter()
                .all(|entry| entry.dispatch == DispatchMode::Rust)
        );
        assert_eq!(
            lookup("binary_entropy_map").map(|entry| entry.dispatch),
            Some(DispatchMode::Rust)
        );
        assert_eq!(
            lookup("computer_observe").map(|entry| entry.dispatch),
            Some(DispatchMode::Rust)
        );
        assert_eq!(
            lookup("computer_observe").map(|entry| entry.owner.as_str()),
            Some("aphrody-winclean")
        );
        assert_eq!(
            lookup("binary_entropy_map").map(|entry| entry.owner.as_str()),
            Some("bun-re")
        );
        assert_eq!(
            lookup("computer_capture_screen").map(|entry| entry.dispatch),
            Some(DispatchMode::Rust)
        );
        for name in [
            "winml_get_version",
            "winml_inspect_onnx",
            "winml_list_providers",
            "winml_run_float32",
        ] {
            assert_eq!(
                lookup(name).map(|entry| entry.dispatch),
                Some(DispatchMode::Rust),
                "{name}"
            );
        }
        assert!(lookup("not_a_winclean_tool").is_none());
    }

    #[test]
    fn registry_paths_accept_every_hive_spelling() {
        let short = parse_path(r"HKCU:\Software\Aphrody\").expect("PowerShell spelling");
        assert_eq!(short.hive, Hive::CurrentUser);
        assert_eq!(short.subkey, r"Software\Aphrody");
        assert_eq!(
            parse_path(r"hklm\SYSTEM").expect("reg.exe spelling").hive,
            Hive::LocalMachine
        );
        assert_eq!(
            parse_path(r"HKEY_CLASSES_ROOT\.txt")
                .expect("long spelling")
                .hive,
            Hive::ClassesRoot
        );
        assert_eq!(parse_path("HKU").expect("hive root").subkey, "");
        assert_eq!(
            parse_path(r"HKCC:\").expect("hive root").hive,
            Hive::CurrentConfig
        );
        for bad in [
            r"bad\path",
            "",
            r"HKCU:\a\..\b",
            "HKCU:\\a\"b",
            "HKCU:\\a\\\\b",
            "HKCU\u{1}",
        ] {
            assert_eq!(
                parse_path(bad).expect_err(bad).kind(),
                std::io::ErrorKind::InvalidInput,
                "{bad}"
            );
        }
    }

    #[test]
    fn default_value_name_maps_to_the_unnamed_value() {
        assert_eq!(api_value_name("(default)"), "");
        assert_eq!(api_value_name("(Default)"), "");
        assert_eq!(api_value_name("HwSchMode"), "HwSchMode");
    }

    #[test]
    fn values_decode_to_typed_json_and_reg_exe_strings() {
        let (code, bytes) = encode_value("C:\\Apps\\é", "String").expect("REG_SZ");
        assert_eq!(code, kind::SZ);
        let decoded = decode_value(code, &bytes);
        assert_eq!(decoded.type_name, "REG_SZ");
        assert_eq!(decoded.data, "C:\\Apps\\é");
        assert_eq!(decoded.value, json!("C:\\Apps\\é"));

        let (code, bytes) = encode_value("%SystemRoot%\\x", "ExpandString").expect("REG_EXPAND_SZ");
        assert_eq!(decode_value(code, &bytes).type_name, "REG_EXPAND_SZ");
        assert_eq!(decode_value(code, &bytes).value, json!("%SystemRoot%\\x"));

        let (code, bytes) = encode_value("0x2a", "DWord").expect("REG_DWORD");
        assert_eq!(bytes, 42u32.to_le_bytes());
        let decoded = decode_value(code, &bytes);
        assert_eq!((decoded.data.as_str(), decoded.value), ("0x2a", json!(42)));

        let (code, bytes) = encode_value("18446744073709551615", "QWord").expect("REG_QWORD");
        let decoded = decode_value(code, &bytes);
        assert_eq!(decoded.type_name, "REG_QWORD");
        assert_eq!(decoded.value, json!(u64::MAX));
        assert_eq!(decoded.data, "0xffffffffffffffff");

        let (code, bytes) = encode_value("one\r\ntwo\n", "MultiString").expect("REG_MULTI_SZ");
        let decoded = decode_value(code, &bytes);
        assert_eq!(decoded.type_name, "REG_MULTI_SZ");
        assert_eq!(decoded.value, json!(["one", "two"]));
        assert_eq!(decoded.data, "one\\0two");

        let decoded = decode_value(kind::BINARY, &[0x01, 0xab, 0xff]);
        assert_eq!(
            (decoded.type_name.as_str(), decoded.data.as_str()),
            ("REG_BINARY", "01ABFF")
        );
        assert_eq!(decoded.value, json!("01ABFF"));
        assert_eq!(
            decode_value(kind::DWORD_BIG_ENDIAN, &[0, 0, 1, 0]).value,
            json!(256)
        );
        // Truncated integers never panic: they fall back to hex.
        assert_eq!(decode_value(kind::DWORD, &[1, 2]).data, "0102");
        assert_eq!(decode_value(0x55, &[]).type_name, "REG_0x55");
    }

    #[test]
    fn invalid_values_are_rejected_before_any_write() {
        for (value, kind) in [
            ("4294967296", "DWord"),
            ("-1", "DWord"),
            ("abc", "QWord"),
            ("a\n\nb", "MultiString"),
            ("a\0b", "String"),
            ("1", "Binary"),
        ] {
            assert_eq!(
                encode_value(value, kind).expect_err(kind).kind(),
                std::io::ErrorKind::InvalidInput,
                "{value} as {kind}"
            );
        }
    }

    #[test]
    fn hive_roots_are_never_deleted() {
        assert_eq!(
            super::delete_entry(r"HKCU:\", None)
                .expect_err("hive root")
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    #[cfg(windows)]
    mod live {
        use serde_json::json;

        use super::super::{delete_entry, get_value, list_key, set_value};
        use crate::registry::{Hive, kind};

        /// A per-test key under `HKCU\Software\AphrodyTest`, removed on drop.
        struct TestKey {
            path: String,
            subkey: String,
        }

        impl TestKey {
            fn new(tag: &str) -> Self {
                let nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or_default();
                let subkey = format!(r"Software\AphrodyTest\{tag}-{}-{nanos}", std::process::id());
                Self {
                    path: format!(r"HKCU:\{subkey}"),
                    subkey,
                }
            }
        }

        impl Drop for TestKey {
            fn drop(&mut self) {
                let _ = crate::winreg::delete_tree(Hive::CurrentUser, &self.subkey);
                // Leave no empty AphrodyTest parent behind when no other test is using it.
                if let Ok(parent) =
                    crate::winreg::open_read(Hive::CurrentUser, r"Software\AphrodyTest")
                {
                    let empty = crate::winreg::subkeys(&parent).is_ok_and(|keys| keys.is_empty());
                    drop(parent);
                    if empty {
                        let _ =
                            crate::winreg::delete_tree(Hive::CurrentUser, r"Software\AphrodyTest");
                    }
                }
            }
        }

        #[test]
        fn native_registry_round_trip_under_hkcu() {
            let key = TestKey::new("roundtrip");
            let path = key.path.as_str();
            set_value(path, "Text", "hello é", "String").expect("REG_SZ");
            set_value(path, "Expand", "%TEMP%\\aphrody", "ExpandString").expect("REG_EXPAND_SZ");
            set_value(path, "Count", "4294967295", "DWord").expect("REG_DWORD");
            set_value(path, "Big", "0x100000000", "QWord").expect("REG_QWORD");
            set_value(path, "Lines", "a\nb", "MultiString").expect("REG_MULTI_SZ");
            set_value(path, "(default)", "root", "String").expect("default value");
            let handle = crate::winreg::open_write(Hive::CurrentUser, &key.subkey).expect("open");
            crate::winreg::set_value(&handle, "Blob", kind::BINARY, &[0xde, 0xad]).expect("binary");
            drop(handle);
            set_value(&format!(r"{path}\Child"), "Nested", "1", "DWord").expect("nested key");

            let text = get_value(path, "Text").expect("read REG_SZ");
            assert_eq!(text["Type"], "REG_SZ");
            assert_eq!(text["Data"], "hello é");
            assert_eq!(text["Value"], "hello é");
            assert_eq!(
                get_value(path, "Expand").expect("read")["Value"],
                "%TEMP%\\aphrody"
            );
            let count = get_value(path, "Count").expect("read REG_DWORD");
            assert_eq!(
                (count["Type"].as_str(), count["Data"].as_str()),
                (Some("REG_DWORD"), Some("0xffffffff"))
            );
            assert_eq!(count["Value"], json!(u32::MAX));
            assert_eq!(
                get_value(path, "Big").expect("read REG_QWORD")["Value"],
                json!(1u64 << 32)
            );
            assert_eq!(
                get_value(path, "Lines").expect("read REG_MULTI_SZ")["Value"],
                json!(["a", "b"])
            );
            assert_eq!(
                get_value(path, "Blob").expect("read REG_BINARY")["Data"],
                "DEAD"
            );
            assert_eq!(
                get_value(path, "(default)").expect("read default")["Value"],
                "root"
            );

            let listing = list_key(path).expect("list key");
            assert_eq!(listing["SubKeys"], json!([format!(r"{path}\Child")]));
            let values = listing["Values"].as_array().expect("values");
            assert_eq!(values.len(), 7);
            let names: Vec<&str> = values
                .iter()
                .filter_map(|value| value["name"].as_str())
                .collect();
            for expected in [
                "Text",
                "Expand",
                "Count",
                "Big",
                "Lines",
                "Blob",
                "(default)",
            ] {
                assert!(
                    names.contains(&expected),
                    "{expected} missing from {names:?}"
                );
            }

            let deleted = delete_entry(path, Some("Text")).expect("delete value");
            assert_eq!(deleted, format!(r"Deleted registry value {path}\Text"));
            assert_eq!(
                get_value(path, "Text").expect_err("deleted").kind(),
                std::io::ErrorKind::NotFound
            );
            delete_entry(path, None).expect("delete key tree");
            assert_eq!(
                list_key(path).expect_err("key gone").kind(),
                std::io::ErrorKind::NotFound
            );
        }

        #[test]
        fn missing_keys_and_values_report_not_found() {
            let key = TestKey::new("missing");
            assert_eq!(
                list_key(&key.path).expect_err("absent key").kind(),
                std::io::ErrorKind::NotFound
            );
            set_value(&key.path, "Present", "1", "DWord").expect("create key");
            assert_eq!(
                get_value(&key.path, "Absent")
                    .expect_err("absent value")
                    .kind(),
                std::io::ErrorKind::NotFound
            );
        }
    }
}
