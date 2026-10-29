// SPDX-License-Identifier: Apache-2.0 OR MIT
use std::io::{BufRead, BufReader, Read};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use super::{BunConfig, Error, Result};

/// A running Bun server.
pub struct BunProcess {
    child: Child,
    pub port: u16,
    pub command: Vec<String>,
}

#[derive(Clone, Serialize)]
struct LogLine {
    stream: &'static str,
    line: String,
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
        .local_addr()?
        .port())
}

fn sidecar_path(name: &str) -> std::io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let mut path = dir.join(name);
    if cfg!(windows) && path.extension().is_none() {
        path.set_extension("exe");
    }
    Ok(path)
}

impl BunProcess {
    pub fn spawn<R: Runtime>(app: &AppHandle<R>, config: &BunConfig) -> Result<Self> {
        let mut command: Vec<String> = if let Some(sidecar) = &config.sidecar {
            vec![sidecar_path(sidecar)?.to_string_lossy().into_owned()]
        } else if let Some(entry) = &config.entry {
            let bun = config
                .binary
                .clone()
                .or_else(|| std::env::var("BUN_TAURI_BUN").ok())
                .unwrap_or_else(|| "bun".into());
            let mut c = vec![bun];
            if config.hot {
                c.push("--hot".into());
            }
            c.push(entry.clone());
            c
        } else {
            return Err(Error::NoEntry);
        };
        command.extend(config.args.iter().cloned());

        let port = match config.port {
            Some(p) => p,
            None => free_port()?,
        };
        let mut cmd = Command::new(&command[0]);
        cmd.args(&command[1..])
            .envs(&config.env)
            .env("PORT", port.to_string())
            .env("BUN_TAURI_PORT", port.to_string())
            .env("BUN_TAURI", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = &config.cwd {
            cmd.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;
        if let Some(out) = child.stdout.take() {
            forward(app.clone(), "stdout", out);
        }
        if let Some(err) = child.stderr.take() {
            forward(app.clone(), "stderr", err);
        }
        let mut process = BunProcess {
            child,
            port,
            command,
        };

        let timeout = Duration::from_millis(config.ready_timeout_ms.unwrap_or(15_000));
        let deadline = Instant::now() + timeout;
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        loop {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
                return Ok(process);
            }
            if let Ok(Some(status)) = process.child.try_wait() {
                return Err(Error::Exited(status.to_string()));
            }
            if Instant::now() >= deadline {
                process.kill();
                return Err(Error::NotReady(port));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for BunProcess {
    fn drop(&mut self) {
        if self.alive() {
            self.kill();
        }
    }
}

fn forward<R: Runtime>(app: AppHandle<R>, stream: &'static str, pipe: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(std::io::Result::ok) {
            ::log::debug!(target: "bun", "{line}");
            let _ = app.emit("aphrody://bun-log", LogLine { stream, line });
        }
    });
}
