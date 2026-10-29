// SPDX-License-Identifier: Apache-2.0
//! The `sidecar` mode: the project's own server runs as a child process on loopback, the window
//! loads it from there. The server is the one that already answers the page and its API, so
//! nothing is proxied or rewritten.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime};

use crate::wrap::config::Sidecar;

/// Owns the child process. Dropping it (app exit) kills the server.
pub struct Guard(Mutex<Option<Child>>);

impl Guard {
    fn stop(&self) {
        if let Ok(mut slot) = self.0.lock()
            && let Some(mut child) = slot.take()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Path of the bundled executable next to the app binary, else the bare name (found on `PATH` in dev).
fn executable(program: &str) -> PathBuf {
    let name = if cfg!(windows) && !program.ends_with(".exe") {
        format!("{program}.exe")
    } else {
        program.to_string()
    };
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(&name)))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(program))
}

/// A port the OS reports as free right now. The small window before the child binds it is accepted.
fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

/// One HTTP request to `path`; ready means the server answered with any HTTP status line.
fn answers(port: u16, path: &str) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0_u8; 5];
    stream.read_exact(&mut head).is_ok() && &head == b"HTTP/"
}

/// Starts the server and waits until it answers.
///
/// # Errors
///
/// Fails when the executable cannot start, exits early, or does not answer within
/// `ready_timeout_secs`. The child is killed in every failure case.
pub fn start<R: Runtime>(
    app: &AppHandle<R>,
    sidecar: &Sidecar,
) -> Result<String, Box<dyn std::error::Error>> {
    let port = if sidecar.port == 0 {
        free_port()?
    } else {
        sidecar.port
    };
    let mut command = Command::new(executable(&sidecar.program));
    command
        .args(&sidecar.args)
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .envs(&sidecar.env)
        .stdin(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start sidecar {}: {error}", sidecar.program))?;
    let deadline = Instant::now() + Duration::from_secs(sidecar.ready_timeout_secs.max(1));
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(format!(
                "sidecar {} exited before it was ready: {status}",
                sidecar.program
            )
            .into());
        }
        if answers(port, &sidecar.ready_path) {
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "sidecar {} did not answer on port {port} within {} s",
                sidecar.program, sidecar.ready_timeout_secs
            )
            .into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    app.manage(Guard(Mutex::new(Some(child))));
    Ok(format!("http://127.0.0.1:{port}"))
}

/// Stops the sidecar, if one runs.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Some(guard) = app.try_state::<Guard>() {
        guard.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_port_is_not_ready() {
        let port = free_port().unwrap();
        assert!(!answers(port, "/"));
    }

    #[test]
    fn a_server_that_speaks_http_is_ready() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 256];
            let _ = stream.read(&mut buffer);
            stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        assert!(answers(port, "/ready"));
        server.join().unwrap();
    }

    #[test]
    fn a_listener_that_is_not_http_is_not_ready() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.write_all(b"SSH-2.0-test\r\n").unwrap();
        });
        assert!(!answers(port, "/"));
        server.join().unwrap();
    }

    #[test]
    fn a_missing_executable_falls_back_to_its_name() {
        assert_eq!(
            executable("definitely-not-bundled-server"),
            PathBuf::from("definitely-not-bundled-server")
        );
    }
}
