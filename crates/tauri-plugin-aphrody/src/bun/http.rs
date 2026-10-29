// SPDX-License-Identifier: Apache-2.0 OR MIT
//! HTTP/1.1 over loopback to the Bun server, `Connection: close`, no TLS: the only peer is the
//! process this plugin started.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpStream};
use std::time::Duration;

use serde::Serialize;

use super::{BunRequest, Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BunResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

pub fn send(port: u16, request: &BunRequest) -> Result<BunResponse> {
    let method = request.method.to_ascii_uppercase();
    if method.is_empty() || !method.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(Error::Http(format!("bad method {method:?}")));
    }
    let path = if request.path.starts_with('/') {
        request.path.clone()
    } else {
        format!("/{}", request.path)
    };
    if path.bytes().any(|b| b <= b' ' || b == 0x7f) {
        return Err(Error::Http("bad path".into()));
    }
    let body = request.body.as_deref().unwrap_or("").as_bytes();
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }
        if name.bytes().any(|b| !b.is_ascii_graphic() || b == b':')
            || value.bytes().any(|b| b == b'\r' || b == b'\n')
        {
            return Err(Error::Http(format!("bad header {name:?}")));
        }
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");

    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
    stream.set_read_timeout(Some(Duration::from_secs(60)))?;
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    parse(&raw)
}

fn parse(raw: &[u8]) -> Result<BunResponse> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| Error::Http("no header end".into()))?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|e| Error::Http(e.to_string()))?;
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| Error::Http(format!("bad status line {status_line:?}")))?;
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let mut body = raw[split + 4..].to_vec();
    let chunked = headers.iter().any(|(k, v)| {
        k.eq_ignore_ascii_case("transfer-encoding") && v.to_ascii_lowercase().contains("chunked")
    });
    if chunked {
        body = dechunk(&body)?;
    } else if let Some(len) = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
    {
        body.truncate(len);
    }
    Ok(BunResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn dechunk(mut data: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let eol = data
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or_else(|| Error::Http("truncated chunk".into()))?;
        let size_text =
            std::str::from_utf8(&data[..eol]).map_err(|e| Error::Http(e.to_string()))?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|e| Error::Http(e.to_string()))?;
        data = &data[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if data.len() < size {
            return Err(Error::Http("truncated chunk".into()));
        }
        out.extend_from_slice(&data[..size]);
        data = data.get(size + 2..).unwrap_or_default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_length_and_chunked_bodies() {
        let r =
            parse(b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nX-A: b\r\n\r\nokEXTRA").unwrap();
        assert_eq!((r.status, r.body.as_str()), (201, "ok"));
        assert!(r.headers.contains(&("X-A".into(), "b".into())));
        let r = parse(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n").unwrap();
        assert_eq!(r.body, "abcde");
    }
}
