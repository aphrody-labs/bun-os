// SPDX-License-Identifier: GPL-3.0-or-later
//! Android property files and `getprop` output (`tools/helpers/props.py`, `images.make_prop`).

use std::collections::BTreeMap;

/// `getprop` prints `[key]: [value]` lines (props.host_list).
pub fn parse_getprop(output: &str, prefix: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for line in output.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once("]: [") else {
            continue;
        };
        let Some(k) = k.strip_prefix('[') else {
            continue;
        };
        if !k.starts_with(prefix) {
            continue;
        }
        m.insert(k.to_string(), v.strip_suffix(']').unwrap_or(v).to_string());
    }
    m
}

/// Value of `prop` in a `build.prop` style file (props.file_get). Empty when absent.
pub fn file_get(content: &str, prop: &str) -> String {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=')
            && k == prop
        {
            return v.to_string();
        }
    }
    String::new()
}

/// Session values copied into `waydroid.prop` (images.make_prop). `None` and the literal "None" are skipped.
#[derive(Debug, Default, Clone)]
pub struct Session {
    pub user_name: Option<String>,
    pub user_id: Option<String>,
    pub group_id: Option<String>,
    pub waydroid_data: Option<String>,
    pub background_start: Option<String>,
    pub lcd_density: Option<String>,
}

pub struct Container {
    pub xdg_runtime_dir: String,
    pub pulse_runtime_path: String,
    pub wayland_display: String,
}

impl Default for Container {
    fn default() -> Self {
        Container {
            xdg_runtime_dir: "/run/xdg".into(),
            pulse_runtime_path: "/run/xdg/pulse".into(),
            wayland_display: "wayland-0".into(),
        }
    }
}

/// Build the final `waydroid.prop` from `waydroid_base.prop` lines and the session.
pub fn make_prop(
    base: &str,
    s: &Session,
    c: &Container,
    has_sensord: bool,
) -> Result<String, &'static str> {
    let mut props: Vec<String> = base
        .lines()
        .map(str::to_string)
        .filter(|l| !l.is_empty())
        .collect();
    if props.is_empty() {
        return Err("waydroid_base.prop is broken");
    }
    let mut add = |key: &str, val: &Option<String>| {
        if let Some(v) = val
            && v != "None"
        {
            props.push(format!("{key}={}", v.replace("/mnt/", "/mnt_extra/")));
        }
    };
    add("waydroid.host.user", &s.user_name);
    add("waydroid.host.uid", &s.user_id);
    add("waydroid.host.gid", &s.group_id);
    add("waydroid.host_data_path", &s.waydroid_data);
    add("waydroid.background_start", &s.background_start);
    props.push(format!("waydroid.xdg_runtime_dir={}", c.xdg_runtime_dir));
    props.push(format!(
        "waydroid.pulse_runtime_path={}",
        c.pulse_runtime_path
    ));
    props.push(format!("waydroid.wayland_display={}", c.wayland_display));
    if !has_sensord {
        props.push("waydroid.stub_sensors_hal=1".into());
    }
    if let Some(d) = &s.lcd_density
        && d != "0"
    {
        props.push(format!("ro.sf.lcd_density={d}"));
    }
    Ok(props.join("\n") + "\n")
}

/// Properties Waydroid always sets for security, plus the memfd fallback when ashmem is missing
/// (head of `lxc.make_base_props`).
pub fn base_security_props(has_ashmem: bool) -> Vec<String> {
    let mut p = Vec::new();
    if !has_ashmem {
        p.push("sys.use_memfd=true".to_string());
    }
    p.push("ro.adb.secure=1".into());
    p.push("ro.debuggable=0".into());
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn getprop_and_file() {
        let m = parse_getprop("[ro.hardware]: [ranchu]\n[sys.x]: [1]\njunk\n", "ro.");
        assert_eq!(m.len(), 1);
        assert_eq!(m["ro.hardware"], "ranchu");
        assert_eq!(
            file_get(
                "# c\nwaydroid.tools_version=1.6.3\n",
                "waydroid.tools_version"
            ),
            "1.6.3"
        );
        assert_eq!(file_get("a=b\n", "x"), "");
    }

    #[test]
    fn make_prop_follows_upstream() {
        let s = Session {
            user_name: Some("u".into()),
            user_id: Some("1000".into()),
            group_id: Some("None".into()),
            waydroid_data: Some("/mnt/data/w".into()),
            background_start: Some("true".into()),
            lcd_density: Some("320".into()),
        };
        let out = make_prop("ro.a=1\n", &s, &Container::default(), false).unwrap();
        assert!(out.starts_with("ro.a=1\n"));
        assert!(out.contains("waydroid.host.uid=1000\n"));
        assert!(!out.contains("waydroid.host.gid"));
        assert!(out.contains("waydroid.host_data_path=/mnt_extra/data/w\n"));
        assert!(out.contains("waydroid.stub_sensors_hal=1\n"));
        assert!(out.ends_with("ro.sf.lcd_density=320\n"));
        assert!(make_prop("", &s, &Container::default(), true).is_err());
        assert_eq!(base_security_props(false)[0], "sys.use_memfd=true");
    }
}
