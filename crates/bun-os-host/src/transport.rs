//! Moves cards between hosts: a directory of `<id>.json` files, local or on a POSIX host over the
//! system OpenSSH (`BatchMode`, keys and agent from `~/.ssh`, the same driver as `bun ssh`).
//! No daemon: the master pulls, the others push.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::registry::{Entry, valid_id, write_atomic};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    Dir(PathBuf),
    Ssh {
        dest: String,
        port: Option<u16>,
        dir: String,
    },
}

/// `ssh://[user@]host[:port]/dir`, `[user@]host:dir`, or a local directory.
pub fn parse_target(text: &str) -> Result<Target, String> {
    if let Some(rest) = text.strip_prefix("ssh://") {
        let (authority, dir) = rest
            .split_once('/')
            .ok_or("ssh:// target needs a directory: ssh://host/dir")?;
        let (dest, port) = match authority.rsplit_once(':') {
            Some((d, p)) => (
                d,
                Some(p.parse::<u16>().map_err(|_| format!("bad port {p:?}"))?),
            ),
            None => (authority, None),
        };
        // `ssh://host//abs/dir` is absolute; `ssh://host/dir` is relative to the remote home.
        let dir = dir
            .strip_prefix('/')
            .map_or_else(|| dir.to_string(), |abs| format!("/{abs}"));
        check_dest(dest)?;
        return Ok(Target::Ssh {
            dest: dest.to_string(),
            port,
            dir,
        });
    }
    if let Some((host, dir)) = text.split_once(':') {
        let drive = host.len() == 1 && host.as_bytes()[0].is_ascii_alphabetic();
        if !drive && !host.contains(['/', '\\']) && !dir.is_empty() {
            check_dest(host)?;
            return Ok(Target::Ssh {
                dest: host.to_string(),
                port: None,
                dir: dir.to_string(),
            });
        }
    }
    Ok(Target::Dir(PathBuf::from(text)))
}

fn check_dest(dest: &str) -> Result<(), String> {
    let ok = !dest.is_empty()
        && !dest.starts_with('-')
        && dest.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'@' | b'[' | b']' | b':')
        });
    ok.then_some(())
        .ok_or_else(|| format!("invalid ssh destination {dest:?}"))
}

fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// A remote path for `sh`: `~` expands, everything else is quoted.
fn remote_path(path: &str) -> String {
    match path {
        "~" => "\"$HOME\"".into(),
        p => match p.strip_prefix("~/") {
            Some(rest) => format!("\"$HOME\"/{}", quote(rest)),
            None => quote(p),
        },
    }
}

fn ssh(
    dest: &str,
    port: Option<u16>,
    command: &str,
    stdin: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let program = std::env::var("BUN_HOST_SSH").unwrap_or_else(|_| "ssh".into());
    let mut cmd = Command::new(program);
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]);
    if let Some(port) = port {
        cmd.args(["-p", &port.to_string()]);
    }
    cmd.arg("--").arg(dest).arg(command);
    cmd.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("ssh: {e}"))?;
    if let (Some(data), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(data).map_err(|e| format!("ssh: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("ssh: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ssh {dest}: {}", err.trim()));
    }
    Ok(out.stdout)
}

/// Drops `entry` as `<id>.json` in the target directory (atomic rename).
pub fn push(target: &Target, entry: &Entry) -> Result<String, String> {
    let id = entry
        .info
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| valid_id(id))
        .ok_or("card has no valid id")?;
    let bytes = serde_json::to_vec_pretty(entry).map_err(|e| e.to_string())?;
    match target {
        Target::Dir(dir) => {
            let path = dir.join(format!("{id}.json"));
            write_atomic(&path, &bytes)?;
            Ok(path.display().to_string())
        }
        Target::Ssh { dest, port, dir } => {
            let d = remote_path(dir);
            let file = format!("{}/{id}.json", d);
            let command = format!("mkdir -p {d} && cat > {file}.tmp && mv {file}.tmp {file}");
            ssh(dest, *port, &command, Some(&bytes))?;
            Ok(format!("{dest}:{dir}/{id}.json"))
        }
    }
}

/// Reads every card of the target directory.
pub fn pull(target: &Target) -> Result<(Vec<Entry>, Vec<String>), String> {
    match target {
        Target::Dir(dir) => Ok(crate::registry::read_cards(dir)),
        Target::Ssh { dest, port, dir } => {
            let d = remote_path(dir);
            let command =
                format!("for f in {d}/*.json; do [ -f \"$f\" ] && cat \"$f\" && echo; done; true");
            let out = ssh(dest, *port, &command, None)?;
            let (mut cards, mut errors) = (Vec::new(), Vec::new());
            for item in serde_json::Deserializer::from_slice(&out).into_iter::<Entry>() {
                match item {
                    Ok(card) => cards.push(card),
                    Err(e) => {
                        errors.push(format!("{dest}: {e}"));
                        break;
                    }
                }
            }
            Ok((cards, errors))
        }
    }
}
