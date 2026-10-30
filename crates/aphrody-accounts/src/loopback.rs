//! Loopback redirect receiver for the installed-app authorization code flow (RFC 8252 section 7.3).

use crate::error::{Error, Result};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// A listener bound to an ephemeral port on 127.0.0.1.
pub struct Loopback {
    listener: TcpListener,
    host: String,
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title><body style=\"font-family:system-ui;margin:3rem\"><h1>Signed in</h1><p>You can close this tab and return to Aphrody OS.</p></body>";
const PAGE_ERR: &str = "<!doctype html><meta charset=utf-8><title>Sign-in failed</title><body style=\"font-family:system-ui;margin:3rem\"><h1>Sign-in failed</h1><p>Return to Aphrody OS for details.</p></body>";

impl Loopback {
    /// Bind `127.0.0.1:0`. `advertised_host` is what goes into `redirect_uri` (`127.0.0.1` for Google,
    /// `localhost` for Entra, which ignores the port of `http://localhost`).
    pub fn bind(advertised_host: &str) -> Result<Self> {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
        Ok(Self {
            listener,
            host: advertised_host.to_owned(),
        })
    }
    /// Port actually bound.
    pub fn port(&self) -> u16 {
        self.listener.local_addr().map_or(0, |a| a.port())
    }
    /// The `redirect_uri` to register in the authorization request.
    pub fn redirect_uri(&self) -> String {
        format!("http://{}:{}", self.host, self.port())
    }
    /// Wait for the browser redirect and return the authorization `code`.
    ///
    /// Requests without `code`/`error` (favicon, probes) are answered 404 and ignored.
    pub fn wait_for_code(self, expected_state: &str, timeout: Duration) -> Result<String> {
        self.listener.set_nonblocking(true)?;
        let deadline = Instant::now() + timeout;
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if let Some(outcome) = handle(stream, expected_state)? {
                        return outcome;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(Error::Timeout);
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
}

/// `Ok(None)` = keep waiting; `Ok(Some(result))` = final.
fn handle(mut stream: TcpStream, expected_state: &str) -> Result<Option<Result<String>>> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 16 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let target = head.lines().next().and_then(|l| {
        let mut it = l.split_whitespace();
        (it.next() == Some("GET")).then(|| it.next()).flatten()
    });
    let params: Vec<(String, String)> = target
        .and_then(|t| url::Url::parse(&format!("http://127.0.0.1{t}")).ok())
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());

    let outcome = if let Some(err) = get("error") {
        let desc = get("error_description").unwrap_or_default();
        Some(Err(Error::Denied(if desc.is_empty() {
            err.to_owned()
        } else {
            format!("{err}: {desc}")
        })))
    } else if let Some(code) = get("code") {
        if get("state") == Some(expected_state) {
            Some(Ok(code.to_owned()))
        } else {
            Some(Err(Error::StateMismatch))
        }
    } else {
        None
    };
    let (status, page) = match &outcome {
        Some(Ok(_)) => ("200 OK", PAGE_OK),
        Some(Err(_)) => ("400 Bad Request", PAGE_ERR),
        None => ("404 Not Found", ""),
    };
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn receives_code_and_ignores_noise() {
        let lb = Loopback::bind("localhost").unwrap();
        let port = lb.port();
        assert_eq!(lb.redirect_uri(), format!("http://localhost:{port}"));
        let t = std::thread::spawn(move || lb.wait_for_code("S1", Duration::from_secs(10)));
        assert!(hit(port, "/favicon.ico").starts_with("HTTP/1.1 404"));
        let page = hit(port, "/?code=4%2F0AbC&scope=x&state=S1");
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Signed in"));
        assert_eq!(t.join().unwrap().unwrap(), "4/0AbC");
    }

    #[test]
    fn rejects_wrong_state() {
        let lb = Loopback::bind("127.0.0.1").unwrap();
        let port = lb.port();
        let t = std::thread::spawn(move || lb.wait_for_code("good", Duration::from_secs(10)));
        let _ = hit(port, "/?code=x&state=evil");
        assert!(matches!(t.join().unwrap(), Err(Error::StateMismatch)));
    }

    #[test]
    fn surfaces_consent_denial() {
        let lb = Loopback::bind("127.0.0.1").unwrap();
        let port = lb.port();
        let t = std::thread::spawn(move || lb.wait_for_code("s", Duration::from_secs(10)));
        let _ = hit(port, "/?error=access_denied&state=s");
        assert!(matches!(t.join().unwrap(), Err(Error::Denied(m)) if m == "access_denied"));
    }

    #[test]
    fn times_out() {
        let lb = Loopback::bind("127.0.0.1").unwrap();
        assert!(matches!(
            lb.wait_for_code("s", Duration::from_millis(100)),
            Err(Error::Timeout)
        ));
    }
}
