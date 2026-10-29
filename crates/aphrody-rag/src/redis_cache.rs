// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Zero-dependency async Redis cache client for RAG queries and evaluation reports.
//!
//! Communicates over standard RESP (REdis Serialization Protocol) via Tokio TCP,
//! providing fast caching of hybrid search results and evaluation runs with
//! guaranteed non-blocking, fail-safe degradation when Redis is unavailable.

use std::time::Duration;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

const DEFAULT_TIMEOUT: Duration = Duration::from_millis(600);
const DEFAULT_TTL_SECS: u64 = 3600;

/// Pure-Rust async Redis client for caching RAG query results and benchmarks.
#[derive(Debug, Clone)]
pub struct RedisRagCache {
    host: String,
    port: u16,
    db: u8,
    prefix: String,
    enabled: bool,
}

impl RedisRagCache {
    /// Create a cache instance from an optional `REDIS_URL` (e.g. `redis://127.0.0.1:6379/1`).
    /// If `url` is None, empty, or unparseable, caching operations will gracefully no-op.
    pub fn from_url(url: Option<&str>, prefix: Option<&str>) -> Self {
        let prefix = prefix.unwrap_or("aphrody:rag:").to_string();
        let Some(raw) = url.map(str::trim).filter(|s| !s.is_empty()) else {
            return Self {
                host: "127.0.0.1".to_string(),
                port: 6379,
                db: 0,
                prefix,
                enabled: false,
            };
        };

        let parsed = match reqwest::Url::parse(raw) {
            Ok(u) => u,
            Err(_) => {
                return Self {
                    host: "127.0.0.1".to_string(),
                    port: 6379,
                    db: 0,
                    prefix,
                    enabled: false,
                };
            }
        };

        let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
        let port = parsed.port().unwrap_or(6379);
        let db = parsed
            .path()
            .trim_start_matches('/')
            .parse::<u8>()
            .unwrap_or(0);

        Self {
            host,
            port,
            db,
            prefix,
            enabled: true,
        }
    }

    /// Check if the Redis cache is enabled and responding.
    pub async fn ping(&self) -> bool {
        if !self.enabled {
            return false;
        }
        match self.execute_cmd(&["PING"]).await {
            Ok(resp) => resp.starts_with("+PONG"),
            Err(_) => false,
        }
    }

    /// Retrieve a cached RAG search result for a given query and mode.
    pub async fn get_rag_result(&self, query: &str, mode: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let key = format!(
            "{}cache:{}:{}",
            self.prefix,
            mode,
            blake3::hash(query.as_bytes()).to_hex()
        );
        self.get(&key).await
    }

    /// Store a RAG search result in cache with TTL.
    pub async fn cache_rag_result(&self, query: &str, mode: &str, result_json: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let key = format!(
            "{}cache:{}:{}",
            self.prefix,
            mode,
            blake3::hash(query.as_bytes()).to_hex()
        );
        self.set_ex(&key, result_json, DEFAULT_TTL_SECS).await
    }

    /// Store an evaluation report JSON under `eval:<timestamp>`.
    pub async fn store_eval_report(&self, eval_name: &str, report_json: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let key = format!("{}eval:{}:{}", self.prefix, eval_name, now);
        // Persist report for 7 days
        self.set_ex(&key, report_json, 7 * 86400).await
    }

    /// Low-level GET command.
    pub async fn get(&self, key: &str) -> Option<String> {
        let resp = self.execute_cmd(&["GET", key]).await.ok()?;
        parse_bulk_string(&resp)
    }

    /// Low-level SET with expiration (EX seconds).
    pub async fn set_ex(&self, key: &str, value: &str, ttl_secs: u64) -> bool {
        let ttl_str = ttl_secs.to_string();
        let cmd = ["SET", key, value, "EX", &ttl_str];
        match self.execute_cmd(&cmd).await {
            Ok(resp) => resp.starts_with("+OK"),
            Err(_) => false,
        }
    }

    /// Execute a RESP command over a fresh socket connection.
    async fn execute_cmd(&self, args: &[&str]) -> Result<String, &'static str> {
        let address = format!("{}:{}", self.host, self.port);
        let stream = timeout(DEFAULT_TIMEOUT, TcpStream::connect(&address))
            .await
            .map_err(|_| "redis connect timeout")?
            .map_err(|_| "redis connect failed")?;

        let mut stream = stream;

        // If a non-zero DB is specified, SELECT it first
        if self.db > 0 {
            let db_str = self.db.to_string();
            let select_req = encode_resp_cmd(&["SELECT", &db_str]);
            stream
                .write_all(select_req.as_bytes())
                .await
                .map_err(|_| "redis write failed")?;
            let mut sel_buf = [0u8; 64];
            let _ = stream.read(&mut sel_buf).await;
        }

        let request = encode_resp_cmd(args);
        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|_| "redis write failed")?;

        let mut buf = Vec::with_capacity(4096);
        let mut temp = [0u8; 2048];
        loop {
            let n = timeout(DEFAULT_TIMEOUT, stream.read(&mut temp))
                .await
                .map_err(|_| "redis read timeout")?
                .map_err(|_| "redis read failed")?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&temp[..n]);
            // Check if RESP frame is complete
            if is_resp_complete(&buf) {
                break;
            }
        }

        String::from_utf8(buf).map_err(|_| "invalid utf8 from redis")
    }
}

/// Encode command arguments into standard RESP array wire format.
fn encode_resp_cmd(args: &[&str]) -> String {
    let mut out = format!("*{}\r\n", args.len());
    for arg in args {
        out.push_str(&format!("${}\r\n{}\r\n", arg.len(), arg));
    }
    out
}

/// Parse a RESP bulk string reply (`$length\r\ndata\r\n` or `$-1\r\n`).
fn parse_bulk_string(raw: &str) -> Option<String> {
    if raw.starts_with("$-1") {
        return None;
    }
    if let Some(stripped) = raw.strip_prefix('$') {
        let (_len_str, data_and_rest) = stripped.split_once("\r\n")?;
        if let Some(pos) = data_and_rest.rfind("\r\n") {
            return Some(data_and_rest[..pos].to_string());
        }
        return Some(data_and_rest.to_string());
    }
    None
}

/// Check if buffer contains at least one complete RESP response.
fn is_resp_complete(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return false;
    }
    match buf[0] {
        b'+' | b'-' | b':' => buf.ends_with(b"\r\n"),
        b'$' => {
            if buf.starts_with(b"$-1\r\n") {
                return true;
            }
            // Need header \r\n and data \r\n
            let mut crlf_count = 0;
            for i in 0..buf.len().saturating_sub(1) {
                if buf[i] == b'\r' && buf[i + 1] == b'\n' {
                    crlf_count += 1;
                }
            }
            crlf_count >= 2
        }
        b'*' => buf.ends_with(b"\r\n"),
        _ => buf.ends_with(b"\r\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_resp_format() {
        let encoded = encode_resp_cmd(&["SET", "foo", "bar"]);
        assert_eq!(encoded, "*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n");
    }

    #[test]
    fn parse_bulk_string_valid() {
        let resp = "$6\r\nfoobar\r\n";
        assert_eq!(parse_bulk_string(resp).as_deref(), Some("foobar"));
        let nil = "$-1\r\n";
        assert_eq!(parse_bulk_string(nil), None);
    }

    #[tokio::test]
    async fn disabled_cache_fails_gracefully() {
        let cache = RedisRagCache::from_url(None, None);
        assert!(!cache.ping().await);
        assert_eq!(cache.get_rag_result("test query", "hybrid").await, None);
        assert!(!cache.cache_rag_result("test query", "hybrid", "{}").await);
    }
}
