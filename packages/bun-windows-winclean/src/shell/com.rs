// SPDX-License-Identifier: Apache-2.0
//! Late-bound COM automation (`IDispatch`), the equivalent of PowerShell's `New-Object -ComObject`
//! / VBScript `CreateObject`: create (or attach to) an automation object by ProgID or CLSID, walk a
//! chain of property gets / method calls / property puts, and optionally enumerate the final
//! collection (`_NewEnum`) reading chosen properties of each item.
//!
//! ```json
//! {"progId":"Shell.Application","steps":[{"name":"NameSpace","args":[10]},{"name":"Items"}],
//!  "enumerate":{"properties":["Name","Path","Size"]}}
//! ```

use std::io;

use serde_json::{Map, Value, json};
use windows::{
    Win32::{
        Foundation::DISP_E_EXCEPTION,
        System::{
            Com::{
                CLSCTX_LOCAL_SERVER, CLSCTX_INPROC_SERVER, CLSIDFromProgID, CLSIDFromString,
                COINIT_APARTMENTTHREADED, CoCreateInstance, DISPATCH_FLAGS, DISPATCH_METHOD,
                DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS, EXCEPINFO, IDispatch,
            },
            Ole::{DISPID_NEWENUM, DISPID_PROPERTYPUT, GetActiveObject, IEnumVARIANT},
            Variant::{VARIANT, VT_DISPATCH, VT_UNKNOWN},
        },
    },
    core::{GUID, IUnknown, Interface},
};

use super::variant::{OwnedVariant, from_dispatch, from_json, to_json};
use crate::win32::{ComScope, hresult_error, pcwstr, wide};

const LOCALE_USER_DEFAULT: u32 = 0x0400;
const MAX_ENUMERATE: usize = 100_000;

fn clsid(prog_id: Option<&str>, clsid: Option<&str>) -> io::Result<GUID> {
    if let Some(text) = clsid {
        let braced = if text.starts_with('{') { text.to_owned() } else { format!("{{{text}}}") };
        let wide_text = wide(&braced);
        // SAFETY: parses a CLSID string.
        return unsafe { CLSIDFromString(pcwstr(&wide_text)) }
            .map_err(|e| hresult_error(&e, &format!("parse CLSID {text}")));
    }
    let prog_id = prog_id.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "progId or clsid is required"))?;
    let wide_id = wide(prog_id);
    // SAFETY: registry lookup of a ProgID.
    unsafe { CLSIDFromProgID(pcwstr(&wide_id)) }.map_err(|e| hresult_error(&e, &format!("resolve ProgID {prog_id}")))
}

fn create(id: &GUID, attach: bool) -> io::Result<IDispatch> {
    if attach {
        let mut unknown: Option<IUnknown> = None;
        // SAFETY: looks the CLSID up in the running object table.
        unsafe { GetActiveObject(id, None, &mut unknown) }.map_err(|e| hresult_error(&e, "GetActiveObject"))?;
        return unknown
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no running instance"))?
            .cast::<IDispatch>()
            .map_err(|e| hresult_error(&e, "query IDispatch"));
    }
    // SAFETY: in-process or local-server automation object.
    unsafe { CoCreateInstance(id, None, CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER) }
        .map_err(|e| hresult_error(&e, "CoCreateInstance"))
}

fn dispid(object: &IDispatch, name: &str) -> io::Result<i32> {
    let wide_name = wide(name);
    let names = [pcwstr(&wide_name)];
    let mut id = 0i32;
    // SAFETY: one name in, one DISPID out.
    unsafe { object.GetIDsOfNames(&GUID::zeroed(), names.as_ptr(), 1, LOCALE_USER_DEFAULT, &mut id) }
        .map_err(|e| hresult_error(&e, &format!("unknown member `{name}`")))?;
    Ok(id)
}

fn invoke_id(
    object: &IDispatch,
    id: i32,
    label: &str,
    flags: DISPATCH_FLAGS,
    mut args: Vec<OwnedVariant>,
) -> io::Result<OwnedVariant> {
    // Automation passes arguments right to left.
    args.reverse();
    let mut named = [DISPID_PROPERTYPUT];
    let put = flags == DISPATCH_PROPERTYPUT;
    let params = DISPPARAMS {
        rgvarg: args.as_mut_ptr().cast::<VARIANT>(),
        rgdispidNamedArgs: if put { named.as_mut_ptr() } else { std::ptr::null_mut() },
        cArgs: args.len() as u32,
        cNamedArgs: u32::from(put),
    };
    let mut result = OwnedVariant::default();
    let mut exception = EXCEPINFO::default();
    let mut arg_error = 0u32;
    // SAFETY: `params` points into `args`/`named`, alive for the call.
    let outcome = unsafe {
        object.Invoke(
            id,
            &GUID::zeroed(),
            LOCALE_USER_DEFAULT,
            flags,
            &params,
            if put { None } else { Some(&mut result.0) },
            Some(&mut exception),
            Some(&mut arg_error),
        )
    };
    let description = exception.bstrDescription.to_string();
    let source = exception.bstrSource.to_string();
    // SAFETY: release the BSTRs the server may have filled in.
    unsafe {
        std::mem::ManuallyDrop::drop(&mut exception.bstrDescription);
        std::mem::ManuallyDrop::drop(&mut exception.bstrSource);
        std::mem::ManuallyDrop::drop(&mut exception.bstrHelpFile);
    }
    match outcome {
        Ok(()) => Ok(result),
        Err(error) if error.code() == DISP_E_EXCEPTION => Err(io::Error::other(format!(
            "{label}: {source}: {description}"
        ))),
        Err(error) => Err(hresult_error(&error, &format!("{label} (argument {arg_error})"))),
    }
}

fn argument(value: &Value, objects: &[IDispatch]) -> io::Result<OwnedVariant> {
    if let Some(index) = value.get("$step").and_then(Value::as_u64) {
        let object = objects
            .get(index as usize)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("$step {index} is not an object")))?;
        return Ok(from_dispatch(object));
    }
    Ok(from_json(value))
}

fn get_property(object: &IDispatch, name: &str) -> Value {
    dispid(object, name)
        .and_then(|id| invoke_id(object, id, name, DISPATCH_PROPERTYGET, Vec::new()))
        .map_or(Value::Null, |v| to_json(&v.0))
}

fn enumerate(object: &IDispatch, spec: &Value) -> io::Result<Value> {
    let properties: Vec<String> = spec
        .get("properties")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(|n| n.as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    let limit = spec.get("limit").and_then(Value::as_u64).map_or(MAX_ENUMERATE, |n| n as usize);
    let holder = invoke_id(object, DISPID_NEWENUM, "_NewEnum", DISPATCH_METHOD | DISPATCH_PROPERTYGET, Vec::new())?;
    // SAFETY: `_NewEnum` returns VT_UNKNOWN or VT_DISPATCH; read the matching member.
    let unknown: Option<IUnknown> = unsafe {
        let inner = &holder.0.Anonymous.Anonymous;
        match inner.vt {
            VT_UNKNOWN => (*inner.Anonymous.punkVal).clone(),
            VT_DISPATCH => (*inner.Anonymous.pdispVal).clone().map(|d| d.cast::<IUnknown>()).transpose().ok().flatten(),
            _ => None,
        }
    };
    let enumerator: IEnumVARIANT = unknown
        .ok_or_else(|| io::Error::other("_NewEnum returned no enumerator"))?
        .cast()
        .map_err(|e| hresult_error(&e, "query IEnumVARIANT"))?;
    let mut items = Vec::new();
    while items.len() < limit {
        let mut slot = [VARIANT::default()];
        let mut fetched = 0u32;
        // SAFETY: one slot; `fetched` reports how many were filled.
        let hr = unsafe { enumerator.Next(&mut slot, &mut fetched) };
        if hr.is_err() || fetched == 0 {
            break;
        }
        let [variant] = slot;
        let item = OwnedVariant(variant);
        match (item.dispatch(), properties.is_empty()) {
            (Some(element), false) => {
                let mut row = Map::new();
                for name in &properties {
                    row.insert(name.clone(), get_property(&element, name));
                }
                items.push(Value::Object(row));
            }
            _ => items.push(to_json(&item.0)),
        }
    }
    Ok(Value::Array(items))
}

/// `com_invoke`: see the module documentation for the argument shape.
pub fn invoke(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let id = clsid(
        args.get("progId").and_then(Value::as_str),
        args.get("clsid").and_then(Value::as_str),
    )?;
    let attach = args.get("attach").and_then(Value::as_bool).unwrap_or(false);
    let root = create(&id, attach)?;
    let mut objects = vec![root.clone()];
    let mut current = root;
    let mut last = from_dispatch(&current);
    let steps = args.get("steps").and_then(Value::as_array).cloned().unwrap_or_default();
    for (index, step) in steps.iter().enumerate() {
        let name = step
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("step {index} has no name")))?;
        let op = step.get("op").and_then(Value::as_str).unwrap_or("auto");
        let mut call_args = Vec::new();
        for value in step.get("args").and_then(Value::as_array).into_iter().flatten() {
            call_args.push(argument(value, &objects)?);
        }
        let flags = match op {
            "get" => DISPATCH_PROPERTYGET,
            "call" => DISPATCH_METHOD,
            "put" => {
                let value = step.get("value").unwrap_or(&Value::Null);
                call_args.push(argument(value, &objects)?);
                DISPATCH_PROPERTYPUT
            }
            _ => DISPATCH_METHOD | DISPATCH_PROPERTYGET,
        };
        let member = dispid(&current, name)?;
        last = invoke_id(&current, member, name, flags, call_args)?;
        if let Some(next) = last.dispatch() {
            objects.push(next.clone());
            current = next;
        } else if index + 1 < steps.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("step {index} (`{name}`) returned a value, not an object"),
            ));
        }
    }
    let result = match args.get("enumerate") {
        Some(spec) if !spec.is_null() => enumerate(&current, spec)?,
        _ => match args.get("properties").and_then(Value::as_array) {
            Some(names) if last.dispatch().is_some() => {
                let mut row = Map::new();
                for name in names.iter().filter_map(Value::as_str) {
                    row.insert(name.to_owned(), get_property(&current, name));
                }
                Value::Object(row)
            }
            _ => to_json(&last.0),
        },
    };
    Ok(json!({ "result": result }))
}
