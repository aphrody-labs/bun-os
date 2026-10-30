// SPDX-License-Identifier: Apache-2.0
//! Explicit public-registry queries using the shared bounded downloader.
use super::{Command, inspect_bytes};
use crate::net::{Downloader, Resume};
use crate::store::Store;
use reqwest::{Client, Url};
use serde_json::{Value, json};
use std::{io, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

/// OS trust roots and a per-client provider. No global TLS installation and no
/// provider cookie/profile import. Redirects are rejected at this boundary.
pub fn metadata_client() -> io::Result<Client> {
    let certificates = rustls_native_certs::load_native_certs();
    let mut roots = rustls::RootCertStore::empty();
    let (accepted, _) = roots.add_parsable_certificates(certificates.certs);
    if accepted == 0 {
        return Err(io::Error::other("no valid OS TLS trust roots available"));
    }
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(io::Error::other)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(tls)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("bun-pkg/", env!("CARGO_PKG_VERSION")))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(io::Error::other)
}

fn url(value: &str) -> io::Result<Url> {
    Url::parse(value).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

/// Select only the public source endpoints. Name encoding happens through URL
/// segments, preventing names or queries from replacing an authority/path.
fn info_url(source: &str, package: &str) -> io::Result<Url> {
    if package.is_empty() || package.chars().any(char::is_control) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid package name",
        ));
    }
    match source {
        "npm" => {
            let mut result = url("https://registry.npmjs.org/")?;
            result
                .path_segments_mut()
                .map_err(|_| io::Error::other("invalid registry URL"))?
                .pop_if_empty()
                .push(package);
            Ok(result)
        }
        "nuget" => {
            if !package
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid NuGet package ID",
                ));
            }
            let mut result = url("https://api.nuget.org/v3-flatcontainer/")?;
            result
                .path_segments_mut()
                .map_err(|_| io::Error::other("invalid registry URL"))?
                .pop_if_empty()
                .push(&package.to_ascii_lowercase())
                .push("index.json");
            Ok(result)
        }
        "cargo" => {
            if !package
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid Cargo package name",
                ));
            }
            let name = package.to_ascii_lowercase();
            let path = match name.len() {
                1 => format!("1/{name}"),
                2 => format!("2/{name}"),
                3 => format!("3/{}/{name}", &name[..1]),
                _ => format!("{}/{}/{name}", &name[..2], &name[2..4]),
            };
            url("https://index.crates.io/")?
                .join(&path)
                .map_err(io::Error::other)
        }
        source => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("remote info unavailable for {source}"),
        )),
    }
}

fn search_url(source: &str, query: &str, limit: u16) -> io::Result<Url> {
    if query.trim().is_empty() || !(1..=100).contains(&limit) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "nonempty query and limit 1..100 required",
        ));
    }
    let (base, query_key, limit_key) = match source {
        "npm" => ("https://registry.npmjs.org/-/v1/search", "text", "size"),
        "cargo" => ("https://crates.io/api/v1/crates", "q", "per_page"),
        "nuget" => ("https://azuresearch-usnc.nuget.org/query", "q", "take"),
        source => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("remote search unavailable for {source}"),
            ));
        }
    };
    let mut result = url(base)?;
    result
        .query_pairs_mut()
        .append_pair(query_key, query)
        .append_pair(limit_key, &limit.to_string());
    Ok(result)
}

async fn fetch(client: Client, address: Url) -> io::Result<Vec<u8>> {
    let temporary = tempfile::tempdir()?;
    let store = Arc::new(Store::new(temporary.path().join("store")));
    let downloader = Downloader::new(client, 1, 64 * 1024 * 1024, Duration::from_secs(30))
        .map_err(io::Error::other)?;
    let mut resume = Resume::new(temporary.path(), address).map_err(io::Error::other)?;
    let id = downloader
        .download(
            &mut resume,
            Arc::clone(&store),
            None,
            &CancellationToken::new(),
        )
        .await
        .map_err(io::Error::other)?;
    // Store publication verified the content-address. This is metadata, not an
    // authenticated upstream package signature or an installation receipt.
    tokio::fs::read(store.blob_path(&id)).await
}

/// Inject an HTTP client configured by the host for its TLS/proxy/auth policy.
/// These public registry queries never alter the selected domain's store.
pub async fn execute_remote(command: &Command, client: Client) -> io::Result<Value> {
    match command {
        Command::RemoteInfo {
            source,
            package,
            version,
        } => {
            let bytes = fetch(client, info_url(source, package)?).await?;
            inspect_bytes(source, package, &bytes, version.as_deref())
        }
        Command::Search {
            source,
            query,
            limit,
        } => {
            let bytes = fetch(client, search_url(source, query, *limit)?).await?;
            let response: Value = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            Ok(json!({"source":source,"query":query,"response":response}))
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected a remote command",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_urls_encode_npm_scopes_and_use_nuget_flatcontainer() {
        assert_eq!(
            info_url("npm", "@scope/name").unwrap().as_str(),
            "https://registry.npmjs.org/@scope%2Fname"
        );
        assert_eq!(
            info_url("nuget", "Newtonsoft.Json").unwrap().as_str(),
            "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/index.json"
        );
        assert!(info_url("nuget", "../escape").is_err());
        assert!(info_url("apk", "busybox").is_err());
    }

    #[test]
    fn cargo_sparse_sharding_and_search_queries_are_source_specific() {
        for (name, suffix) in [
            ("a", "1/a"),
            ("ab", "2/ab"),
            ("abc", "3/a/abc"),
            ("serde", "se/rd/serde"),
        ] {
            assert_eq!(
                info_url("cargo", name).unwrap().path(),
                format!("/{suffix}")
            );
        }
        let endpoint = search_url("npm", "x&size=999", 20).unwrap();
        assert_eq!(
            endpoint.query_pairs().collect::<Vec<_>>(),
            vec![
                ("text".into(), "x&size=999".into()),
                ("size".into(), "20".into())
            ]
        );
        assert!(search_url("npm", "x", 101).is_err());
    }
}
