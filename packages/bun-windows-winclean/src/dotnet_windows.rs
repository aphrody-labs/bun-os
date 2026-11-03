// SPDX-License-Identifier: Apache-2.0
//! `winget_*` tools through `bunos_windows.dll`, the C# Native AOT library of `packages/bun-dotnet-windows`
//! (C ABI in `packages/bun-dotnet-windows/include/bunos_windows.h`). It drives winget's own COM/WinRT API
//! (`Microsoft.Management.Deployment`) in process; this module only loads it and forwards JSON.
//!
//! Library lookup, first found: `BUNOS_DOTNET_WINDOWS_DIR`, `%SystemRoot%\BunOS\dotnet-windows` (the elevated
//! install), then the checkout build (`target/bun-dotnet-windows/native`).

use serde_json::Value;

use crate::SubsystemError;

/// Tool name to `bunos_call` method.
pub(crate) fn method(tool: &str) -> Option<&'static str> {
    Some(match tool {
        "winget_sources" => "winget.sources",
        "winget_search" => "winget.search",
        "winget_list" => "winget.list",
        "winget_show" => "winget.show",
        "winget_install" => "winget.install",
        "winget_upgrade" => "winget.upgrade",
        "winget_uninstall" => "winget.uninstall",
        _ => return None,
    })
}

#[cfg(windows)]
mod imp {
    use std::ffi::{CStr, CString, c_char};
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use serde_json::Value;

    use crate::SubsystemError;

    type Call = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
    type Free = unsafe extern "C" fn(*mut c_char);

    struct Native {
        call: Call,
        free: Free,
        // Never unloaded: the CLR-free AOT runtime and COM objects live for the process.
        _library: libloading::Library,
    }

    static NATIVE: OnceLock<Result<Native, String>> = OnceLock::new();

    fn candidates() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Some(dir) = std::env::var_os("BUNOS_DOTNET_WINDOWS_DIR") {
            paths.push(PathBuf::from(dir).join("bunos_windows.dll"));
        }
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        paths.push(
            PathBuf::from(system_root)
                .join("BunOS")
                .join("dotnet-windows")
                .join("bunos_windows.dll"),
        );
        paths.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/bun-dotnet-windows/native/bunos_windows.dll"),
        );
        paths
    }

    fn load() -> Result<Native, String> {
        let candidates = candidates();
        let path = candidates.iter().find(|p| p.is_file()).ok_or_else(|| {
            format!(
                "bunos_windows.dll not found ({}); build with `bun packages/bun-dotnet-windows/scripts/build.ts` \
                 and install with `sudo.exe bun packages/bun-dotnet-windows/install/install.ts install`",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        // SAFETY: bunos_windows.dll is our own Native AOT library; its exports follow bunos_windows.h.
        unsafe {
            let library =
                libloading::Library::new(path).map_err(|e| format!("{}: {e}", path.display()))?;
            let call = *library
                .get::<Call>(b"bunos_call\0")
                .map_err(|e| format!("bunos_call: {e}"))?;
            let free = *library
                .get::<Free>(b"bunos_free\0")
                .map_err(|e| format!("bunos_free: {e}"))?;
            Ok(Native {
                call,
                free,
                _library: library,
            })
        }
    }

    pub(crate) fn call(method: &str, args: &Value) -> Result<Value, SubsystemError> {
        let native = NATIVE
            .get_or_init(load)
            .as_ref()
            .map_err(|e| SubsystemError::Unavailable(e.clone()))?;
        let method =
            CString::new(method).map_err(|e| SubsystemError::InvalidArguments(e.to_string()))?;
        let args = CString::new(args.to_string())
            .map_err(|e| SubsystemError::InvalidArguments(e.to_string()))?;
        // SAFETY: both strings are NUL-terminated; the result is a NUL-terminated UTF-8 string owned by the
        // library and released with bunos_free exactly once.
        let text = unsafe {
            let raw = (native.call)(method.as_ptr(), args.as_ptr());
            if raw.is_null() {
                return Err(SubsystemError::Failed("bunos_call returned null".into()));
            }
            let text = CStr::from_ptr(raw).to_string_lossy().into_owned();
            (native.free)(raw);
            text
        };
        let mut envelope: Value = serde_json::from_str(&text)
            .map_err(|e| SubsystemError::Failed(format!("bunos_call: {e}")))?;
        if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
            return Ok(envelope
                .get_mut("value")
                .map(Value::take)
                .unwrap_or(Value::Null));
        }
        let error = envelope.get("error").cloned().unwrap_or(Value::Null);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("failed");
        let code = error.get("code").and_then(Value::as_str).unwrap_or("?");
        Err(if code == "EINVAL" {
            SubsystemError::InvalidArguments(message.to_owned())
        } else {
            SubsystemError::Failed(format!("{message} ({code})"))
        })
    }
}

/// Runs a `winget_*` tool.
pub(crate) fn dispatch(tool: &str, arguments: &Value) -> Result<Value, SubsystemError> {
    let method = method(tool).ok_or_else(|| SubsystemError::UnknownTool(tool.to_owned()))?;
    #[cfg(windows)]
    {
        // Null optionals are dropped: the library treats a missing key as "not given".
        let args = match arguments {
            Value::Object(map) => Value::Object(
                map.iter()
                    .filter(|(_, v)| !v.is_null())
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            ),
            _ => Value::Object(serde_json::Map::new()),
        };
        imp::call(method, &args)
    }
    #[cfg(not(windows))]
    {
        let _ = (method, arguments);
        Err(SubsystemError::Unavailable("winget is Windows only".into()))
    }
}
