// SPDX-License-Identifier: Apache-2.0
//! `VARIANT` <-> JSON for the COM automation and WMI tools: scalars map directly, one-dimensional
//! `SAFEARRAY`s become JSON arrays, `IDispatch` values are kept as live objects by the caller and
//! surface as `{"$dispatch": "<type name>"}` in the final result; anything else falls back to the
//! propsys string conversion (`VariantToStringAlloc`) so nothing is silently dropped.

use std::{ffi::c_void, mem::ManuallyDrop};

use serde_json::{Map, Value};
use windows::{
    Win32::{
        Foundation::{VARIANT_FALSE, VARIANT_TRUE},
        System::{
            Com::{CoTaskMemFree, IDispatch},
            Ole::{SafeArrayGetDim, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound},
            Variant::{
                VARENUM, VARIANT, VT_ARRAY, VT_BOOL, VT_BSTR, VT_BYREF, VT_DISPATCH, VT_EMPTY,
                VT_ERROR, VT_I1, VT_I2, VT_I4, VT_I8, VT_INT, VT_NULL, VT_R4, VT_R8, VT_TYPEMASK,
                VT_UI1, VT_UI2, VT_UI4, VT_UI8, VT_UINT, VT_VARIANT, VariantClear,
                VariantToStringAlloc,
            },
        },
    },
    core::BSTR,
};

/// `DISP_E_PARAMNOTFOUND`: the documented "optional argument omitted" marker.
const DISP_E_PARAMNOTFOUND: i32 = 0x8002_0004_u32 as i32;

/// An owned `VARIANT` cleared on drop (layout-identical to `VARIANT`, so a slice of them is a
/// valid `DISPPARAMS::rgvarg`).
#[repr(transparent)]
pub(crate) struct OwnedVariant(pub(crate) VARIANT);

impl Drop for OwnedVariant {
    fn drop(&mut self) {
        // SAFETY: releases whatever BSTR/interface/array the variant owns.
        let _ = unsafe { VariantClear(&mut self.0) };
    }
}

impl Default for OwnedVariant {
    fn default() -> Self {
        Self(VARIANT::default())
    }
}

impl OwnedVariant {
    pub(crate) fn vt(&self) -> VARENUM {
        // SAFETY: `vt` is always initialised (zeroed = VT_EMPTY).
        unsafe { self.0.Anonymous.Anonymous.vt }
    }

    /// The `IDispatch` carried by a `VT_DISPATCH` variant.
    pub(crate) fn dispatch(&self) -> Option<IDispatch> {
        if self.vt() != VT_DISPATCH {
            return None;
        }
        // SAFETY: the tag says `pdispVal` is live; cloning adds a reference.
        unsafe { (*self.0.Anonymous.Anonymous.Anonymous.pdispVal).clone() }
    }
}

fn set(vt: VARENUM, fill: impl FnOnce(&mut windows::Win32::System::Variant::VARIANT_0_0_0)) -> OwnedVariant {
    let mut variant = VARIANT::default();
    // SAFETY: writes the tag and the matching union member of a zeroed variant.
    unsafe {
        let inner = &mut *variant.Anonymous.Anonymous;
        inner.vt = vt;
        fill(&mut inner.Anonymous);
    }
    OwnedVariant(variant)
}

/// JSON -> `VARIANT` for method arguments and property puts. `null` is an omitted optional
/// argument; integers that fit 32 bits are `VT_I4` (what automation servers expect), larger
/// ones `VT_I8`; objects and arrays are passed as their JSON text.
pub(crate) fn from_json(value: &Value) -> OwnedVariant {
    match value {
        Value::Null => set(VT_ERROR, |u| u.scode = DISP_E_PARAMNOTFOUND),
        Value::Bool(flag) => set(VT_BOOL, |u| u.boolVal = if *flag { VARIANT_TRUE } else { VARIANT_FALSE }),
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                match i32::try_from(int) {
                    Ok(small) => set(VT_I4, |u| u.lVal = small),
                    Err(_) => set(VT_I8, |u| u.llVal = int),
                }
            } else {
                let float = number.as_f64().unwrap_or_default();
                set(VT_R8, |u| u.dblVal = float)
            }
        }
        Value::String(text) => set(VT_BSTR, |u| u.bstrVal = ManuallyDrop::new(BSTR::from(text.as_str()))),
        other => {
            let text = other.to_string();
            set(VT_BSTR, |u| u.bstrVal = ManuallyDrop::new(BSTR::from(text.as_str())))
        }
    }
}

/// A `VARIANT` wrapping an existing `IDispatch` (for passing COM objects back as arguments).
pub(crate) fn from_dispatch(dispatch: &IDispatch) -> OwnedVariant {
    let clone = dispatch.clone();
    set(VT_DISPATCH, |u| u.pdispVal = ManuallyDrop::new(Some(clone)))
}

fn type_name(dispatch: &IDispatch) -> String {
    // SAFETY: standard IDispatch type-info lookup; failures just yield an empty name.
    unsafe {
        dispatch
            .GetTypeInfo(0, 0)
            .and_then(|info| {
                let mut name = BSTR::new();
                info.GetDocumentation(-1, Some(&mut name), None, std::ptr::null_mut(), None)?;
                Ok(name.to_string())
            })
            .unwrap_or_default()
    }
}

fn fallback_string(variant: &VARIANT) -> Value {
    // SAFETY: propsys converts any variant it understands into a CoTaskMem string.
    match unsafe { VariantToStringAlloc(variant) } {
        Ok(text) => {
            // SAFETY: `text` is a NUL-terminated CoTaskMem string owned by us.
            let out = unsafe { text.to_string() }.unwrap_or_default();
            unsafe { CoTaskMemFree(Some(text.0 as *const c_void)) };
            Value::String(out)
        }
        Err(_) => Value::Null,
    }
}

/// `VARIANT` -> JSON.
pub(crate) fn to_json(variant: &VARIANT) -> Value {
    // SAFETY: the `vt` tag selects the live union member.
    unsafe {
        let inner = &variant.Anonymous.Anonymous;
        let vt = inner.vt;
        if vt.0 & VT_BYREF.0 != 0 {
            return fallback_string(variant);
        }
        if vt.0 & VT_ARRAY.0 != 0 {
            return array_to_json(inner.Anonymous.parray, VARENUM(vt.0 & VT_TYPEMASK.0))
                .unwrap_or_else(|| fallback_string(variant));
        }
        let u = &inner.Anonymous;
        match vt {
            VT_EMPTY | VT_NULL => Value::Null,
            VT_ERROR => Value::Null,
            VT_BOOL => Value::Bool(u.boolVal.0 != 0),
            VT_BSTR => Value::String(u.bstrVal.to_string()),
            VT_I1 => Value::from(u.cVal as i8),
            VT_UI1 => Value::from(u.bVal),
            VT_I2 => Value::from(u.iVal),
            VT_UI2 => Value::from(u.uiVal),
            VT_I4 | VT_INT => Value::from(u.lVal),
            VT_UI4 | VT_UINT => Value::from(u.ulVal),
            VT_I8 => Value::from(u.llVal),
            VT_UI8 => Value::from(u.ullVal),
            VT_R4 => serde_json::Number::from_f64(f64::from(u.fltVal)).map_or(Value::Null, Value::Number),
            VT_R8 => serde_json::Number::from_f64(u.dblVal).map_or(Value::Null, Value::Number),
            VT_DISPATCH => match &*u.pdispVal {
                Some(dispatch) => {
                    let mut map = Map::new();
                    map.insert("$dispatch".into(), Value::String(type_name(dispatch)));
                    Value::Object(map)
                }
                None => Value::Null,
            },
            _ => fallback_string(variant),
        }
    }
}

/// One-dimensional `SAFEARRAY` -> JSON array; each element is read into a scratch variant of the
/// element type so every scalar (and `VARIANT` elements) reuse [`to_json`].
unsafe fn array_to_json(
    array: *const windows::Win32::System::Com::SAFEARRAY,
    element: VARENUM,
) -> Option<Value> {
    if array.is_null() {
        return Some(Value::Array(Vec::new()));
    }
    // SAFETY: `array` is a live SAFEARRAY owned by the enclosing variant.
    unsafe {
        if SafeArrayGetDim(array) != 1 {
            return None;
        }
        let lower = SafeArrayGetLBound(array, 1).ok()?;
        let upper = SafeArrayGetUBound(array, 1).ok()?;
        let mut out = Vec::with_capacity((upper - lower + 1).max(0) as usize);
        for index in lower..=upper {
            let mut scratch = OwnedVariant::default();
            if element == VT_VARIANT {
                SafeArrayGetElement(array, &index, (&raw mut scratch.0).cast()).ok()?;
            } else {
                let inner = &mut *scratch.0.Anonymous.Anonymous;
                inner.vt = element;
                SafeArrayGetElement(array, &index, (&raw mut inner.Anonymous).cast()).ok()?;
            }
            out.push(to_json(&scratch.0));
        }
        Some(Value::Array(out))
    }
}
