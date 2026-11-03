// SPDX-License-Identifier: Apache-2.0
//! Generic WMI/CIM queries in-process (`IWbemLocator` -> `IWbemServices::ExecQuery`), the
//! equivalent of `Get-CimInstance` / `wmic` for any namespace, returning every non-system
//! property of every instance as JSON.

use std::io;

use serde_json::{Map, Value};
use windows::{
    Win32::System::{
        Com::{
            CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoSetProxyBlanket,
            EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
        },
        Wmi::{
            IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices, WBEM_FLAG_ALWAYS,
            WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_NONSYSTEM_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
            WBEM_INFINITE, WbemLocator,
        },
    },
    core::{BSTR, PCWSTR},
};

use super::variant::{OwnedVariant, to_json};
use crate::win32::{ComScope, hresult_error, pcwstr, wide};

const RPC_C_AUTHN_WINNT: u32 = 10;
const RPC_C_AUTHZ_NONE: u32 = 0;

fn connect(namespace: &str) -> io::Result<IWbemServices> {
    // SAFETY: in-process locator; COM is initialised by the caller.
    let locator: IWbemLocator = unsafe { CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER) }
        .map_err(|e| hresult_error(&e, "create the WMI locator"))?;
    let empty = BSTR::new();
    // SAFETY: local connection with the caller's token.
    let services = unsafe {
        locator.ConnectServer(&BSTR::from(namespace), &empty, &empty, &empty, 0, &empty, None)
    }
    .map_err(|e| hresult_error(&e, &format!("connect to WMI namespace {namespace}")))?;
    // SAFETY: impersonation, as every WMI provider expects.
    unsafe {
        CoSetProxyBlanket(
            &services,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            PCWSTR::null(),
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )
    }
    .map_err(|e| hresult_error(&e, "CoSetProxyBlanket"))?;
    Ok(services)
}

fn next(enumerator: &IEnumWbemClassObject) -> io::Result<Option<IWbemClassObject>> {
    let mut objects = [None];
    let mut returned = 0u32;
    // SAFETY: room for one object.
    let hr = unsafe { enumerator.Next(WBEM_INFINITE, &mut objects, &mut returned) };
    if hr.is_err() {
        return Err(hresult_error(&windows::core::Error::from(hr), "WMI enumeration"));
    }
    let [object] = objects;
    Ok(if returned == 0 { None } else { object })
}

fn names(object: &IWbemClassObject) -> io::Result<Vec<String>> {
    // SAFETY: returns a SAFEARRAY of BSTR owned by us, wrapped in a variant for cleanup.
    let array = unsafe {
        object.GetNames(
            PCWSTR::null(),
            windows::Win32::System::Wmi::WBEM_CONDITION_FLAG_TYPE(WBEM_FLAG_ALWAYS.0 | WBEM_FLAG_NONSYSTEM_ONLY.0),
            std::ptr::null(),
        )
    }
    .map_err(|e| hresult_error(&e, "read WMI property names"))?;
    let mut holder = OwnedVariant::default();
    // SAFETY: hand the array to a VT_ARRAY|VT_BSTR variant so `VariantClear` destroys it.
    unsafe {
        let inner = &mut *holder.0.Anonymous.Anonymous;
        inner.vt = windows::Win32::System::Variant::VARENUM(
            windows::Win32::System::Variant::VT_ARRAY.0 | windows::Win32::System::Variant::VT_BSTR.0,
        );
        inner.Anonymous.parray = array;
    }
    Ok(match to_json(&holder.0) {
        Value::Array(items) => items.into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect(),
        _ => Vec::new(),
    })
}

fn row(object: &IWbemClassObject, wanted: &[String]) -> io::Result<Map<String, Value>> {
    let mut map = Map::new();
    for name in wanted {
        let wide_name = wide(name);
        let mut value = OwnedVariant::default();
        // SAFETY: `value` receives an owned copy of the property.
        if unsafe { object.Get(pcwstr(&wide_name), 0, &mut value.0, None, None) }.is_ok() {
            map.insert(name.clone(), to_json(&value.0));
        }
    }
    Ok(map)
}

/// Run a WQL query against `namespace` (default `ROOT\CIMV2`) and return at most `limit` rows.
pub fn query(namespace: Option<&str>, wql: &str, limit: Option<usize>) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_MULTITHREADED)?;
    let namespace = namespace.unwrap_or(r"ROOT\CIMV2");
    let services = connect(namespace)?;
    // SAFETY: WQL query on a connected namespace.
    let rows = unsafe {
        services.ExecQuery(
            &BSTR::from("WQL"),
            &BSTR::from(wql),
            WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
            None,
        )
    }
    .map_err(|e| hresult_error(&e, &format!("WMI query `{wql}`")))?;
    let limit = limit.unwrap_or(usize::MAX);
    let mut out = Vec::new();
    // Names are read per instance: a query over a base class returns subclasses with more columns.
    while out.len() < limit {
        let Some(object) = next(&rows)? else { break };
        let wanted = names(&object)?;
        out.push(Value::Object(row(&object, &wanted)?));
    }
    Ok(serde_json::json!({ "namespace": namespace, "query": wql, "count": out.len(), "rows": out }))
}
