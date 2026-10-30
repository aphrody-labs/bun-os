// SPDX-License-Identifier: Apache-2.0
//! Host-configured HTTP client; no TLS provider, credentials or global runtime mutation.
//! Each resume owns one temporary file. Dropping it removes unpublished bytes.

use crate::store::{BlobId, Store};
use reqwest::{Client, StatusCode, Url, header};
use std::{path::Path, sync::Arc, time::Duration};
use tempfile::NamedTempFile;
use tokio::{
    io::{AsyncSeekExt, AsyncWriteExt},
    sync::Semaphore,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("download cancelled")]
    Cancelled,
    #[error("download exceeds configured byte limit")]
    TooLarge,
    #[error("invalid HTTP download response: {0}")]
    Protocol(&'static str),
    #[error("HTTP download timed out")]
    Timeout,
    #[error("HTTP transport failed")]
    Http(#[source] reqwest::Error),
    #[error("download I/O failed")]
    Io(#[from] std::io::Error),
    #[error("store worker failed")]
    Worker(#[source] tokio::task::JoinError),
}

/// Opaque per-download state; retries cannot accidentally share or append another URL.
pub struct Resume {
    file: NamedTempFile,
    url: Url,
    bytes: u64,
    etag: Option<header::HeaderValue>,
}

impl Resume {
    pub fn new(directory: &Path, url: Url) -> Result<Self, Error> {
        if !matches!(url.scheme(), "https" | "http")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(Error::Protocol(
                "HTTP URL without embedded credentials required",
            ));
        }
        Ok(Self {
            file: NamedTempFile::new_in(directory)?,
            url,
            bytes: 0,
            etag: None,
        })
    }

    pub fn downloaded_bytes(&self) -> u64 {
        self.bytes
    }
}

pub struct Downloader {
    client: Client,
    slots: Semaphore,
    max_bytes: u64,
    idle_timeout: Duration,
}

impl Downloader {
    pub fn new(
        client: Client,
        concurrency: usize,
        max_bytes: u64,
        idle_timeout: Duration,
    ) -> Result<Self, Error> {
        if concurrency == 0 || max_bytes == 0 || idle_timeout.is_zero() {
            return Err(Error::Protocol(
                "nonzero concurrency, size and timeout required",
            ));
        }
        Ok(Self {
            client,
            slots: Semaphore::new(concurrency),
            max_bytes,
            idle_timeout,
        })
    }

    /// Streams at most max_bytes, preserving partial bytes on transport failure.
    /// Publication is joined and atomic: once started it completes before returning.
    /// Caller configures redirect/SSRF/auth policy and TLS on the supplied Client.
    /// Disable automatic gzip/brotli/deflate/zstd decompression on that Client;
    /// ranges and digests refer to the wire representation, not decoded content.
    pub async fn download(
        &self,
        resume: &mut Resume,
        store: Arc<Store>,
        expected: Option<BlobId>,
        cancel: &CancellationToken,
    ) -> Result<BlobId, Error> {
        let _permit = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            permit = self.slots.acquire() => permit.map_err(|_| Error::Cancelled)?,
        };
        // Strong ETag is mandatory for safe resumptions; otherwise restart.
        let offset = if resume.etag.is_some() {
            resume.bytes
        } else {
            0
        };
        let mut request = self
            .client
            .get(resume.url.clone())
            .header(header::ACCEPT_ENCODING, "identity");
        if offset > 0 {
            request = request
                .header(header::RANGE, format!("bytes={offset}-"))
                .header(
                    header::IF_RANGE,
                    resume
                        .etag
                        .as_ref()
                        .ok_or(Error::Protocol("missing validator"))?
                        .clone(),
                );
        }
        let mut response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            result = tokio::time::timeout(self.idle_timeout, request.send()) => result.map_err(|_| Error::Timeout)?.map_err(Error::Http)?,
        };
        if response
            .headers()
            .get(header::CONTENT_ENCODING)
            .is_some_and(|v| v != "identity")
        {
            return Err(Error::Protocol("encoded response cannot be resumed"));
        }
        let status = response.status();
        let (start, total, response_length) = if status == StatusCode::PARTIAL_CONTENT {
            if offset == 0 {
                return Err(Error::Protocol("unsolicited partial response"));
            }
            let value = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .ok_or(Error::Protocol("missing Content-Range"))?;
            let (start, end, total) = parse_range(value)?;
            if start != offset || end.checked_add(1) != Some(total) {
                return Err(Error::Protocol("unexpected partial range"));
            }
            if response.headers().get(header::ETAG) != resume.etag.as_ref() {
                return Err(Error::Protocol("resume validator changed"));
            }
            (start, Some(total), Some(end - start + 1))
        } else if status == StatusCode::OK {
            (0, response.content_length(), response.content_length())
        } else {
            return Err(Error::Protocol("expected HTTP 200 or 206"));
        };
        if total.is_some_and(|total| total > self.max_bytes) {
            return Err(Error::TooLarge);
        }
        if response_length
            .is_some_and(|length| response.content_length().is_some_and(|n| n != length))
        {
            return Err(Error::Protocol("Content-Length disagrees with range"));
        }
        let validator = response
            .headers()
            .get(header::ETAG)
            .filter(|v| {
                v.to_str()
                    .is_ok_and(|s| s.starts_with('"') && s.ends_with('"'))
            })
            .cloned();
        let mut file = tokio::fs::File::from_std(resume.file.reopen()?);
        // A failed write may have produced unacknowledged trailing bytes.
        file.set_len(start).await?;
        if start == 0 {
            resume.bytes = 0;
        }
        file.seek(std::io::SeekFrom::Start(start)).await?;
        resume.etag = validator;
        loop {
            let chunk = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                result = tokio::time::timeout(self.idle_timeout, response.chunk()) => result.map_err(|_| Error::Timeout)?.map_err(Error::Http)?,
            };
            let Some(chunk) = chunk else { break };
            let next = resume
                .bytes
                .checked_add(chunk.len() as u64)
                .ok_or(Error::TooLarge)?;
            if next > self.max_bytes {
                return Err(Error::TooLarge);
            }
            if total.is_some_and(|total| next > total) {
                return Err(Error::Protocol("response exceeds declared length"));
            }
            // Finish each write before acknowledging its offset or cancellation.
            file.write_all(&chunk).await?;
            resume.bytes = next;
        }
        if total.is_some_and(|total| total != resume.bytes) {
            return Err(Error::Protocol("truncated response"));
        }
        file.sync_all().await?;
        drop(file);
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let reader = resume.file.reopen()?;
        tokio::task::spawn_blocking(move || store.put(reader, expected.as_ref()))
            .await
            .map_err(Error::Worker)?
            .map_err(Error::Io)
    }
}

fn parse_range(value: &str) -> Result<(u64, u64, u64), Error> {
    let invalid = || Error::Protocol("invalid Content-Range");
    let (range, total) = value
        .strip_prefix("bytes ")
        .ok_or_else(invalid)?
        .split_once('/')
        .ok_or_else(invalid)?;
    let (start, end) = range.split_once('-').ok_or_else(invalid)?;
    let start: u64 = start.parse().map_err(|_| invalid())?;
    let end: u64 = end.parse().map_err(|_| invalid())?;
    let total: u64 = total.parse().map_err(|_| invalid())?;
    if start > end || end >= total {
        return Err(invalid());
    }
    Ok((start, end, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn fixture(response: &'static [u8]) -> (Url, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!(
            "http://{}/package",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            stream.write_all(response).unwrap();
            String::from_utf8(request).unwrap()
        });
        (url, handle)
    }

    fn downloader(limit: u64) -> Downloader {
        // Inject a per-client provider; tests never mutate rustls global state.
        // Fixtures only use HTTP, so the empty root store is sufficient here.
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
        let client = Client::builder()
            .use_preconfigured_tls(tls)
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .build()
            .unwrap();
        Downloader::new(client, 2, limit, Duration::from_secs(5)).unwrap()
    }

    #[tokio::test]
    async fn full_response_replaces_partial_instead_of_concatenating() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().join("store")));
        let (url, server) = fixture(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nETag: \"new\"\r\nConnection: close\r\n\r\nfull");
        let mut resume = Resume::new(dir.path(), url).unwrap();
        resume.file.write_all(b"old").unwrap();
        resume.bytes = 3;
        resume.etag = Some(header::HeaderValue::from_static("\"old\""));
        let id = downloader(100)
            .download(&mut resume, store.clone(), None, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(std::fs::read(store.blob_path(&id)).unwrap(), b"full");
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("range: bytes=3-"));
        assert!(request.contains("if-range: \"old\""));
    }

    #[tokio::test]
    async fn matching_partial_is_appended_and_digest_checked() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().join("store")));
        let expected = store.put(&b"abcdefgh"[..], None).unwrap();
        let (url, server) = fixture(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 3-7/8\r\nETag: \"v1\"\r\nConnection: close\r\n\r\ndefgh");
        let mut resume = Resume::new(dir.path(), url).unwrap();
        resume.file.write_all(b"abcUNACKNOWLEDGED").unwrap();
        resume.bytes = 3;
        resume.etag = Some(header::HeaderValue::from_static("\"v1\""));
        let id = downloader(100)
            .download(
                &mut resume,
                store.clone(),
                Some(expected.clone()),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(id, expected);
        assert_eq!(std::fs::read(store.blob_path(&id)).unwrap(), b"abcdefgh");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn oversized_and_wrong_digest_never_publish() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().join("store")));
        for (limit, digest) in [
            (2, None),
            (100, Some(BlobId::parse(&"0".repeat(64)).unwrap())),
        ] {
            let (url, server) =
                fixture(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata");
            let mut resume = Resume::new(dir.path(), url).unwrap();
            assert!(
                downloader(limit)
                    .download(
                        &mut resume,
                        store.clone(),
                        digest,
                        &CancellationToken::new()
                    )
                    .await
                    .is_err()
            );
            server.join().unwrap();
            assert_eq!(store.stats().unwrap().blobs, 0);
        }
    }

    #[tokio::test]
    async fn precancelled_requests_do_not_contact_network() {
        let dir = tempfile::tempdir().unwrap();
        let mut resume = Resume::new(
            dir.path(),
            Url::parse("http://127.0.0.1:1/package").unwrap(),
        )
        .unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(matches!(
            downloader(100)
                .download(
                    &mut resume,
                    Arc::new(Store::new(dir.path().join("store"))),
                    None,
                    &cancel
                )
                .await,
            Err(Error::Cancelled)
        ));
    }

    #[tokio::test]
    async fn changed_validator_rejects_partial_without_modifying_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::new(dir.path().join("store")));
        let (url, server) = fixture(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 3-7/8\r\nETag: \"v2\"\r\nConnection: close\r\n\r\ndefgh");
        let mut resume = Resume::new(dir.path(), url).unwrap();
        resume.file.write_all(b"abc").unwrap();
        resume.bytes = 3;
        resume.etag = Some(header::HeaderValue::from_static("\"v1\""));
        assert!(matches!(
            downloader(100)
                .download(&mut resume, store.clone(), None, &CancellationToken::new())
                .await,
            Err(Error::Protocol("resume validator changed"))
        ));
        assert_eq!(std::fs::read(resume.file.path()).unwrap(), b"abc");
        assert_eq!(store.stats().unwrap().blobs, 0);
        server.join().unwrap();
    }
    #[test]
    fn range_validation() {
        assert_eq!(parse_range("bytes 3-7/8").unwrap(), (3, 7, 8));
        for value in [
            "bytes 3-2/8",
            "bytes 0-8/8",
            "bytes 0-1/*",
            "items 0-1/2",
            "bytes */8",
        ] {
            assert!(parse_range(value).is_err());
        }
    }
}
