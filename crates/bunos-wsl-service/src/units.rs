// SPDX-License-Identifier: Apache-2.0
//! Platform-independent part: the guest monitor script, parsers for what it prints, systemd unit listings and the
//! mapping between systemd unit names and Windows service names.

use serde::Serialize;

/// Name of the instance service in the Service Control Manager. `BunOS` is taken by the bunos.sys driver.
pub const SERVICE_NAME: &str = "BunOSWsl";
/// Prefix of the per-unit Windows services.
pub const UNIT_PREFIX: &str = "BunOSWsl.";

/// Windows service name of a systemd unit. SCM forbids `/` and `\` in names; unit names never contain them, but a
/// template instance can (`foo@a\x2db.service` is escaped by systemd, so only plain characters remain).
pub fn windows_name(unit: &str) -> String {
    format!("{UNIT_PREFIX}{}", unit.replace(['/', '\\'], "_"))
}

/// A systemd unit name we accept: no shell metacharacters, because it is passed through wsl.exe to `sh`.
pub fn valid_unit(unit: &str) -> bool {
    !unit.is_empty()
        && unit.len() <= 255
        && unit.contains('.')
        && unit.chars().all(|c| c.is_ascii_alphanumeric() || "@._-:".contains(c))
}

/// The script run as root in the distro by the instance service, through one long-lived `wsl.exe --exec`.
/// That process is what keeps the instance alive (a WSL instance stays up while a client is attached), and its stdout
/// is the only channel back: `READY <state> <guest-uptime-s>`, then a block of `systemctl show` lines terminated by
/// `END` every `period` seconds, and journal entries as JSON lines (`{...}`) for the watched units.
/// Only single quotes are used, so the script survives Windows command-line quoting unchanged.
pub fn monitor_script(units: &[String], period: u32) -> String {
    let mut s = String::from(
        "systemctl is-system-running --wait >/dev/null 2>&1; \
         echo READY $(systemctl is-system-running 2>/dev/null) $(cut -d' ' -f1 /proc/uptime); ",
    );
    if units.is_empty() {
        s.push_str(&format!("while :; do echo END; sleep {}; done", period.max(1) * 15));
        return s;
    }
    let list = units.join(" ");
    let journal: Vec<String> = units.iter().map(|u| format!("-u {u}")).collect();
    s.push_str(&format!(
        "journalctl -f -n 0 -q -o json --output-fields=MESSAGE,PRIORITY,_SYSTEMD_UNIT,UNIT,SYSLOG_IDENTIFIER {} & \
         while :; do systemctl show --property=Id,ActiveState,SubState,Result,MainPID {list} 2>/dev/null; echo END; \
         sleep {period}; done",
        journal.join(" ")
    ));
    s
}

/// One unit as `systemctl show` reports it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct UnitState {
    pub id: String,
    pub active: String,
    pub sub: String,
    pub result: String,
    pub main_pid: u32,
}

impl UnitState {
    pub fn is_running(&self) -> bool {
        matches!(self.active.as_str(), "active" | "reloading" | "activating" | "deactivating")
    }
}

/// Parses the `Key=Value` blocks of `systemctl show` (blank line between units).
pub fn parse_show(text: &str) -> Vec<UnitState> {
    let mut out = Vec::new();
    let mut cur = UnitState::default();
    let mut any = false;
    for line in text.lines().chain(std::iter::once("")) {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if any {
                out.push(std::mem::take(&mut cur));
                any = false;
            }
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        any = true;
        match k {
            "Id" => cur.id = v.to_string(),
            "ActiveState" => cur.active = v.to_string(),
            "SubState" => cur.sub = v.to_string(),
            "Result" => cur.result = v.to_string(),
            "MainPID" => cur.main_pid = v.parse().unwrap_or(0),
            _ => {}
        }
    }
    out
}

/// A line from the monitor.
#[derive(Debug, PartialEq)]
pub enum Line {
    Ready { state: String, uptime_s: f64 },
    End,
    Show(String),
    Journal(JournalEntry),
}

#[derive(Debug, PartialEq, Eq)]
pub struct JournalEntry {
    /// The unit the entry is about: `_SYSTEMD_UNIT` (the process that logged it), and for systemd's own messages
    /// (logged by init.scope) the `UNIT` it reports on.
    pub units: Vec<String>,
    pub priority: u8,
    pub message: String,
}

pub fn classify(line: &str) -> Line {
    let line = line.trim_end_matches(['\r', '\n']);
    if let Some(rest) = line.strip_prefix("READY ") {
        let mut it = rest.split_whitespace();
        let state = it.next().unwrap_or("unknown").to_string();
        let uptime_s = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
        return Line::Ready { state, uptime_s };
    }
    if line == "END" {
        return Line::End;
    }
    if line.starts_with('{')
        && let Some(e) = parse_journal(line)
    {
        return Line::Journal(e);
    }
    Line::Show(line.to_string())
}

fn parse_journal(line: &str) -> Option<JournalEntry> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let field = |k: &str| -> Option<String> {
        match v.get(k)? {
            serde_json::Value::String(s) => Some(s.clone()),
            // journalctl emits non-UTF-8 messages as byte arrays.
            serde_json::Value::Array(a) => {
                Some(String::from_utf8_lossy(&a.iter().filter_map(|b| b.as_u64().map(|b| b as u8)).collect::<Vec<_>>()).into_owned())
            }
            other => Some(other.to_string()),
        }
    };
    let units = [field("_SYSTEMD_UNIT"), field("UNIT")].into_iter().flatten().filter(|u| u != "init.scope").collect();
    let priority = field("PRIORITY").and_then(|p| p.parse().ok()).unwrap_or(6);
    let mut message = field("MESSAGE").unwrap_or_default();
    if let Some(id) = field("SYSLOG_IDENTIFIER") {
        message = format!("{id}: {message}");
    }
    Some(JournalEntry { units, priority, message })
}

/// A row of `systemctl list-units --all` joined with `list-unit-files`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnitRow {
    pub unit: String,
    pub load: String,
    pub active: String,
    pub sub: String,
    pub enabled: String,
    pub description: String,
}

/// Parses `systemctl list-units --type=service --all --no-legend --plain --no-pager` and
/// `systemctl list-unit-files --type=service --no-legend --no-pager` into one table sorted by name.
pub fn parse_list(units: &str, files: &str) -> Vec<UnitRow> {
    let mut enabled = std::collections::BTreeMap::new();
    for l in files.lines() {
        let mut it = l.split_whitespace();
        if let (Some(u), Some(s)) = (it.next(), it.next()) {
            enabled.insert(u.to_string(), s.to_string());
        }
    }
    let mut rows = std::collections::BTreeMap::new();
    for l in units.lines() {
        let l = l.trim_start_matches(['●', '*', ' ']);
        let mut it = l.split_whitespace();
        let (Some(unit), Some(load), Some(active), Some(sub)) = (it.next(), it.next(), it.next(), it.next()) else {
            continue;
        };
        let description = it.collect::<Vec<_>>().join(" ");
        rows.insert(
            unit.to_string(),
            UnitRow {
                unit: unit.into(),
                load: load.into(),
                active: active.into(),
                sub: sub.into(),
                enabled: enabled.get(unit).cloned().unwrap_or_default(),
                description,
            },
        );
    }
    // Installed but never loaded (disabled, not a dependency of anything running).
    for (u, s) in enabled {
        if !u.contains("@.") {
            rows.entry(u.clone()).or_insert(UnitRow {
                unit: u,
                load: "not-loaded".into(),
                active: "inactive".into(),
                sub: "dead".into(),
                enabled: s,
                description: String::new(),
            });
        }
    }
    rows.into_values().collect()
}

/// Quotes one argument for a Windows command line (CommandLineToArgvW rules), as std::process::Command does.
pub fn quote_arg(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\x0b', '"']) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut backslashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
}

pub fn command_line(program: &str, args: &[String]) -> String {
    let mut s = String::new();
    quote_arg(program, &mut s);
    for a in args {
        s.push(' ');
        quote_arg(a, &mut s);
    }
    s
}

/// Decodes wsl.exe's own messages, which are UTF-16LE (Linux output relayed by `--exec` is raw UTF-8).
pub fn decode_wsl(bytes: &[u8]) -> String {
    let utf16 = bytes.len() >= 2 && bytes.len() % 2 == 0 && bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count() * 2 >= bytes.len() / 2;
    if utf16 {
        let w: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&w).trim_start_matches('\u{feff}').to_string()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(windows_name("docker.service"), "BunOSWsl.docker.service");
        assert!(valid_unit("getty@tty1.service"));
        assert!(!valid_unit("a;rm -rf /.service"));
        assert!(!valid_unit("docker"));
        assert!(!valid_unit("x'.service"));
    }

    #[test]
    fn script_has_no_double_quotes() {
        let s = monitor_script(&["docker.service".into(), "ssh.service".into()], 2);
        assert!(!s.contains('"'));
        assert!(s.contains("-u docker.service -u ssh.service"));
        assert!(s.contains("systemctl show --property=Id,ActiveState,SubState,Result,MainPID docker.service ssh.service"));
        assert!(!monitor_script(&[], 2).contains("journalctl"));
    }

    #[test]
    fn show_blocks() {
        let t = "Id=docker.service\nActiveState=active\nSubState=running\nResult=success\nMainPID=412\n\nId=ssh.service\nActiveState=failed\nSubState=failed\nResult=exit-code\nMainPID=0\n";
        let v = parse_show(t);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].main_pid, 412);
        assert!(v[0].is_running());
        assert!(!v[1].is_running());
        assert_eq!(v[1].result, "exit-code");
    }

    #[test]
    fn lines() {
        assert_eq!(classify("READY running 1.84\n"), Line::Ready { state: "running".into(), uptime_s: 1.84 });
        assert_eq!(classify("READY degraded"), Line::Ready { state: "degraded".into(), uptime_s: 0.0 });
        assert_eq!(classify("END\r"), Line::End);
        match classify(r#"{"MESSAGE":"hello","PRIORITY":"3","_SYSTEMD_UNIT":"docker.service","SYSLOG_IDENTIFIER":"dockerd"}"#) {
            Line::Journal(e) => {
                assert_eq!(e.units, ["docker.service"]);
                assert_eq!(e.priority, 3);
                assert_eq!(e.message, "dockerd: hello");
            }
            other => panic!("{other:?}"),
        }
        match classify(r#"{"MESSAGE":[104,105],"UNIT":"a.service"}"#) {
            Line::Journal(e) => assert_eq!((e.message.as_str(), e.priority, e.units.as_slice()), ("hi", 6, ["a.service".to_string()].as_slice())),
            other => panic!("{other:?}"),
        }
        match classify(r#"{"MESSAGE":"Stopped Docker.","_SYSTEMD_UNIT":"init.scope","UNIT":"docker.service","SYSLOG_IDENTIFIER":"systemd"}"#) {
            Line::Journal(e) => assert_eq!(e.units, ["docker.service"]),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn list() {
        let units = "  docker.service loaded active running Docker Application Container Engine\n● foo.service loaded failed failed Foo\n";
        let files = "docker.service enabled enabled\nfoo.service disabled enabled\nbar.service disabled enabled\ngetty@.service enabled enabled\n";
        let rows = parse_list(units, files);
        assert_eq!(rows.iter().map(|r| r.unit.as_str()).collect::<Vec<_>>(), ["bar.service", "docker.service", "foo.service"]);
        assert_eq!(rows[1].description, "Docker Application Container Engine");
        assert_eq!(rows[0].load, "not-loaded");
        assert_eq!(rows[2].active, "failed");
    }

    #[test]
    fn quoting() {
        let c = command_line("wsl.exe", &["-d".into(), "bunos".into(), "sh -c 'a b'".into(), "x\"y".into(), "a\\".into(), "".into()]);
        assert_eq!(c, r#"wsl.exe -d bunos "sh -c 'a b'" "x\"y" a\ """#);
        let mut s = String::new();
        quote_arg("a b\\", &mut s);
        assert_eq!(s, r#""a b\\""#);
    }

    #[test]
    fn wsl_text() {
        let b: Vec<u8> = "Erreur\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_wsl(&b), "Erreur\r\n");
        assert_eq!(decode_wsl(b"plain"), "plain");
    }
}
