// SPDX-License-Identifier: GPL-3.0-or-later
//! `waydroid.cfg` (configparser INI, section `[waydroid]`) from `tools/config`.

use std::collections::BTreeMap;

pub const SECTION: &str = "waydroid";

/// Keys saved by upstream (`config_keys`) plus the binder keys written by `waydroid init`.
pub const KEYS: &[&str] = &[
    "arch",
    "images_path",
    "vendor_type",
    "system_datetime",
    "vendor_datetime",
    "suspend_action",
    "mount_overlays",
    "auto_adb",
];

pub const DEFAULTS: &[(&str, &str)] = &[
    ("arch", "arm64"),
    ("vendor_type", "MAINLINE"),
    ("system_datetime", "0"),
    ("vendor_datetime", "0"),
    ("suspend_action", "freeze"),
    ("mount_overlays", "True"),
    ("auto_adb", "False"),
];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Config {
    sections: BTreeMap<String, BTreeMap<String, String>>,
}

impl Config {
    pub fn parse(text: &str) -> Config {
        let mut c = Config::default();
        let mut cur = String::new();
        for raw in text.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }
            if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
                cur = name.to_string();
                c.sections.entry(cur.clone()).or_default();
            } else if let Some((k, v)) = line.split_once('=').or_else(|| line.split_once(':')) {
                c.sections
                    .entry(cur.clone())
                    .or_default()
                    .insert(k.trim().to_string(), v.trim().to_string());
            }
        }
        c
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.sections.get(SECTION)?.get(key).map(String::as_str)
    }

    /// Value with the upstream default applied.
    pub fn get_or_default(&self, key: &str) -> Option<String> {
        self.get(key).map(str::to_string).or_else(|| {
            DEFAULTS
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        })
    }

    pub fn set(&mut self, key: &str, value: &str) {
        self.sections
            .entry(SECTION.to_string())
            .or_default()
            .insert(key.to_string(), value.to_string());
    }

    pub fn datetime(&self, key: &str) -> u64 {
        self.get_or_default(key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    }

    pub fn to_ini(&self) -> String {
        let mut out = String::new();
        for (name, kv) in &self.sections {
            if name.is_empty() {
                continue;
            }
            out.push_str(&format!("[{name}]\n"));
            for (k, v) in kv {
                out.push_str(&format!("{k} = {v}\n"));
            }
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults() {
        let mut c = Config::parse(
            "[waydroid]\narch = x86_64\nsystem_datetime = 1790539062\n# c\nauto_adb=True\n",
        );
        assert_eq!(c.get("arch"), Some("x86_64"));
        assert_eq!(c.datetime("system_datetime"), 1790539062);
        assert_eq!(c.datetime("vendor_datetime"), 0);
        assert_eq!(
            c.get_or_default("suspend_action").as_deref(),
            Some("freeze")
        );
        c.set("vendor_datetime", "5");
        let again = Config::parse(&c.to_ini());
        assert_eq!(again, c);
        assert_eq!(again.get("auto_adb"), Some("True"));
    }
}
