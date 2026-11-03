// SPDX-License-Identifier: Apache-2.0
//! The Bun OS Windows bridge: it exposes Windows to the Bun OS Linux side (WSL) by serving the WinClean tool catalog
//! over a stream transport, newline-delimited JSON, one request per line.
//!
//! On Windows the transport is hvsocket (`AF_HYPERV`); in the WSL guest the Bun client dials the matching `AF_VSOCK`.
//! The protocol, the allow-list and the dispatch are transport-agnostic and unit-tested over an in-process loopback,
//! so the bridge is exercised on this workstation before any WSL distro exists (coordinate with factory/wsl via this
//! interface and docs/WSL.md only).
//!
//! Policy: a shared token gates every connection, and only tools on [`Policy::allowed`] run. The default allow-list is
//! read-only and diagnostic — including the `nt_*` tools, so the guest sees the driver's event streams — and never
//! includes a tool that changes the machine. Destructive tools require an explicit opt-in (`--allow`), which is the
//! same consent boundary WinClean applies on the Windows side.

use std::io::{self, BufRead, BufReader, Write};

use serde_json::{Value, json};

/// Default service port on the hvsocket / vsock address family.
pub const DEFAULT_PORT: u32 = 0x4255_4e01; // "BUN\x01"

/// Prefixes of the tools served by default: read-only system inspection, the `nt_*` NT layer (event streams, handle
/// and module enumeration) and the read-only tweak queries. No tool here changes the machine.
pub const DEFAULT_ALLOW: &[&str] = &[
    "nt_",
    "get_",
    "list_",
    "query_event_log",
    "search_files",
    "search_windows",
    "wsl_get_status",
    "wsl_list_distributions",
    "wsl_list_processes",
    "wsl_read_only_probe",
    "gaming_get_",
    "gaming_environment",
    "tweak_catalog",
    "tweak_plan",
    "tweak_verify",
    "mem_list_processes",
    "mem_list_modules",
    "list_listening_ports",
    "list_tcp_connections",
];

/// Tools never served, even if an allow prefix would match, because they change the machine or move bytes a guest
/// should not drive through the bridge. A guest that needs these talks to WinClean through the normal elevated path.
pub const DENY: &[&str] = &[
    "tweak_apply",
    "tweak_undo",
    "delete_",
    "set_registry_value",
    "kill_process",
    "mem_write_",
    "mem_allocate",
    "mem_protect",
    "mem_free",
    "nt_events_start", // mutates the shared kernel session; the guest reads, it does not reconfigure sources
    "nt_events_stop",
];

/// The connection policy: token and allow-list.
#[derive(Clone, Debug)]
pub struct Policy {
    pub token: String,
    allow: Vec<String>,
}

impl Policy {
    /// Policy with the default read-only allow-list and `extra` prefixes appended.
    pub fn new(token: impl Into<String>, extra: impl IntoIterator<Item = String>) -> Self {
        let mut allow: Vec<String> = DEFAULT_ALLOW.iter().map(|s| (*s).to_string()).collect();
        allow.extend(extra);
        Policy { token: token.into(), allow }
    }

    /// Whether `tool` may run: never on the deny-list, and matching an allow prefix (exact or `prefix*`).
    pub fn allowed(&self, tool: &str) -> bool {
        if DENY.iter().any(|d| tool == *d || (d.ends_with('_') && tool.starts_with(d))) {
            return false;
        }
        self.allow.iter().any(|a| tool == a || (a.ends_with('_') && tool.starts_with(a)))
    }

    /// The concrete tool names served, from the live WinClean catalog.
    pub fn visible_tools(&self) -> Vec<String> {
        bun_windows_winclean::catalog()
            .iter()
            .map(|t| t.name.clone())
            .filter(|n| self.allowed(n))
            .collect()
    }
}

/// A request line: `{ "token": "...", "id": <any>, "tool": "name", "args": { ... } }`. `hello` lists the served
/// tools; `ping` round-trips.
#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    Hello,
    Ping,
    Call { tool: String, args: Value },
    Bad(String),
}

/// Parses one request body (token already checked) into a [`Request`].
pub fn parse_request(line: &Value) -> Request {
    match line.get("tool").and_then(Value::as_str) {
        Some("hello") => Request::Hello,
        Some("ping") => Request::Ping,
        Some(tool) => Request::Call { tool: tool.to_string(), args: line.get("args").cloned().unwrap_or(json!({})) },
        None => Request::Bad("missing tool".into()),
    }
}

/// Dispatches a checked request to WinClean, returning the JSON body to send back (without the envelope).
pub fn dispatch(policy: &Policy, request: &Request) -> Value {
    match request {
        Request::Hello => json!({ "ok": true, "tools": policy.visible_tools(), "bridge": env!("CARGO_PKG_VERSION") }),
        Request::Ping => json!({ "ok": true, "pong": true }),
        Request::Bad(msg) => json!({ "ok": false, "error": msg }),
        Request::Call { tool, args } => {
            if !policy.allowed(tool) {
                return json!({ "ok": false, "error": format!("tool {tool} is not served by the bridge") });
            }
            match bun_windows_winclean::dispatch::call_rust(tool, args.clone()) {
                Ok(value) => json!({ "ok": true, "result": value }),
                Err(e) => json!({ "ok": false, "error": e.to_string() }),
            }
        }
    }
}

/// Serves newline-delimited JSON on one accepted stream until EOF. Each line must carry the token; a line with the
/// wrong token is answered once with an error and the connection is dropped.
pub fn serve_stream<S: io::Read + Write>(policy: &Policy, stream: S) -> io::Result<()> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => {
                let id = value.get("id").cloned().unwrap_or(Value::Null);
                if value.get("token").and_then(Value::as_str) != Some(policy.token.as_str()) {
                    let mut body = json!({ "ok": false, "error": "bad token", "id": id });
                    write_line(reader.get_mut(), &body)?;
                    // One strike: a guest that cannot authenticate does not get to keep trying on this connection.
                    body["fatal"] = Value::Bool(true);
                    return Ok(());
                }
                let mut body = dispatch(policy, &parse_request(&value));
                body["id"] = id;
                body
            }
            Err(e) => json!({ "ok": false, "error": format!("invalid JSON: {e}") }),
        };
        write_line(reader.get_mut(), &reply)?;
    }
}

fn write_line<W: Write>(w: &mut W, value: &Value) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    w.write_all(&bytes)?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy::new("secret", [])
    }

    #[test]
    fn allow_and_deny() {
        let p = policy();
        assert!(p.allowed("nt_status"));
        assert!(p.allowed("get_os_info"));
        assert!(p.allowed("tweak_catalog"));
        // Deny wins over an allow prefix.
        assert!(!p.allowed("delete_path"));
        assert!(!p.allowed("set_registry_value"));
        assert!(!p.allowed("tweak_apply"));
        assert!(!p.allowed("nt_events_start"));
        assert!(!p.allowed("kill_process"));
        // Not on any allow prefix.
        assert!(!p.allowed("computer_click"));
    }

    #[test]
    fn extra_allow_still_respects_deny() {
        let p = Policy::new("t", ["computer_".to_string(), "delete_".to_string()]);
        assert!(p.allowed("computer_click"));
        assert!(!p.allowed("delete_path"), "deny-list is absolute");
    }

    #[test]
    fn parse_requests() {
        assert_eq!(parse_request(&json!({"tool":"hello"})), Request::Hello);
        assert_eq!(parse_request(&json!({"tool":"ping"})), Request::Ping);
        assert_eq!(
            parse_request(&json!({"tool":"nt_status","args":{"x":1}})),
            Request::Call { tool: "nt_status".into(), args: json!({"x":1}) }
        );
        assert!(matches!(parse_request(&json!({})), Request::Bad(_)));
    }

    #[test]
    fn hello_lists_only_served_tools() {
        let body = dispatch(&policy(), &Request::Hello);
        let tools = body["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t == "nt_status"));
        assert!(tools.iter().all(|t| {
            let n = t.as_str().unwrap();
            !DENY.iter().any(|d| n == *d || (d.ends_with('_') && n.starts_with(d)))
        }));
    }

    #[test]
    fn disallowed_call_is_refused_without_dispatch() {
        let body = dispatch(&policy(), &Request::Call { tool: "delete_path".into(), args: json!({"path":"x"}) });
        assert_eq!(body["ok"], json!(false));
        assert!(body["error"].as_str().unwrap().contains("not served"));
    }

    /// End-to-end over an in-process loopback pipe (the loopback transport of `--transport loopback`): a client
    /// writes request lines, the server answers, bad token drops the connection.
    #[test]
    fn serve_over_loopback() {
        use std::io::{Read, Write};

        // A bidirectional in-memory stream: the two halves share two queues behind a mutex.
        #[derive(Clone)]
        struct Pipe {
            inbox: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<u8>>>,
            outbox: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<u8>>>,
            open: std::sync::Arc<std::sync::atomic::AtomicBool>,
        }
        impl Read for Pipe {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                loop {
                    {
                        let mut q = self.inbox.lock().unwrap();
                        if !q.is_empty() {
                            let n = q.len().min(buf.len());
                            for b in buf.iter_mut().take(n) {
                                *b = q.pop_front().unwrap();
                            }
                            return Ok(n);
                        }
                    }
                    if !self.open.load(std::sync::atomic::Ordering::Acquire) {
                        return Ok(0);
                    }
                    std::thread::yield_now();
                }
            }
        }
        impl Write for Pipe {
            fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
                self.outbox.lock().unwrap().extend(buf.iter().copied());
                Ok(buf.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let a = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
        let b = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
        let open = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let server_side = Pipe { inbox: a.clone(), outbox: b.clone(), open: open.clone() };
        let mut client = Pipe { inbox: b, outbox: a, open: open.clone() };

        let handle = std::thread::spawn(move || serve_stream(&policy(), server_side));

        client.write_all(b"{\"token\":\"secret\",\"id\":1,\"tool\":\"ping\"}\n").unwrap();
        client.write_all(b"{\"token\":\"secret\",\"id\":2,\"tool\":\"hello\"}\n").unwrap();
        client.write_all(b"{\"token\":\"nope\",\"id\":3,\"tool\":\"ping\"}\n").unwrap();
        open.store(false, std::sync::atomic::Ordering::Release);
        handle.join().unwrap().unwrap();

        let mut out = String::new();
        client.read_to_string(&mut out).unwrap();
        let lines: Vec<Value> = out.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines[0], json!({ "ok": true, "pong": true, "id": 1 }));
        assert_eq!(lines[1]["ok"], json!(true));
        assert!(lines[1]["tools"].as_array().unwrap().iter().any(|t| t == "nt_status"));
        assert_eq!(lines[2]["error"], json!("bad token"));
        assert_eq!(lines.len(), 3, "connection dropped after the bad token");
    }
}
