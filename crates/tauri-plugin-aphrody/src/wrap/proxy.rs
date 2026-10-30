// SPDX-License-Identifier: Apache-2.0
//! Pure helpers of the bundle's reverse proxy: what is forwarded to the backend and how its answer
//! is re-scoped to the loopback origin. No I/O here; `serve.rs` does the sending.

use http::header::{self, HeaderMap, HeaderName, HeaderValue};
use url::Url;

/// Headers that describe one hop and must not be forwarded (RFC 9110 section 7.6.1) plus the ones
/// the HTTP client recomputes.
const HOP_BY_HOP: [&str; 10] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
    "host",
];

fn hop_by_hop(name: &HeaderName) -> bool {
    HOP_BY_HOP.contains(&name.as_str())
}

/// Whether `path` belongs to a proxied prefix (`/api` matches `/api`, `/api/x`, `/api?x`, not `/apix`).
#[must_use]
pub fn is_proxied(path: &str, prefixes: &[String]) -> bool {
    prefixes.iter().any(|prefix| {
        let prefix = prefix.trim_end_matches('/');
        !prefix.is_empty()
            && path.strip_prefix(prefix).is_some_and(|rest| {
                rest.is_empty() || rest.starts_with('/') || rest.starts_with('?')
            })
    })
}

/// `scheme://host[:port]` of the backend followed by the request's path and query.
#[must_use]
pub fn backend_url(backend: &Url, path_and_query: &str) -> String {
    format!(
        "{}{}",
        backend.origin().ascii_serialization(),
        path_and_query
    )
}

/// Request headers for the backend: hop-by-hop and `Accept-Encoding` dropped (the client negotiates
/// and decodes), `Origin` and `Referer` rewritten from the loopback origin to the backend's, so
/// origin checks on the backend see what they see for the public site.
#[must_use]
pub fn forward_request_headers(headers: &HeaderMap, backend: &Url, loopback: &str) -> HeaderMap {
    let backend_origin = backend.origin().ascii_serialization();
    let mut out = HeaderMap::new();
    for (name, value) in headers {
        if hop_by_hop(name) || *name == header::ACCEPT_ENCODING || *name == header::CONTENT_LENGTH {
            continue;
        }
        if *name == header::ORIGIN || *name == header::REFERER {
            let text = value.to_str().unwrap_or_default();
            let rewritten = text.replacen(loopback, &backend_origin, 1);
            if let Ok(value) = HeaderValue::from_str(&rewritten) {
                out.append(name.clone(), value);
            }
            continue;
        }
        out.append(name.clone(), value.clone());
    }
    out
}

/// Re-scopes one `Set-Cookie` to the loopback origin: `Domain` is dropped (it names the public
/// host), `Secure` and `Partitioned` are dropped (a loopback origin is plain HTTP, and a `Secure`
/// cookie is not guaranteed to be kept there), and `SameSite=None`, which needs `Secure`, becomes `Lax`. Names starting with
/// `__Host-` or `__Secure-` require `Secure` and cannot be re-scoped; they pass unchanged.
#[must_use]
pub fn rewrite_set_cookie(value: &str) -> String {
    let mut parts = value.split(';').map(str::trim);
    let Some(pair) = parts.next() else {
        return String::new();
    };
    if pair.starts_with("__Host-") || pair.starts_with("__Secure-") {
        return value.to_string();
    }
    let mut out = vec![pair.to_string()];
    for attribute in parts {
        let lower = attribute.to_ascii_lowercase();
        if lower == "secure" || lower == "partitioned" || lower.starts_with("domain=") {
            continue;
        }
        if lower == "samesite=none" {
            out.push("SameSite=Lax".to_string());
            continue;
        }
        if !attribute.is_empty() {
            out.push(attribute.to_string());
        }
    }
    out.join("; ")
}

/// A `Location` that points at the backend becomes relative, so the redirect stays on loopback.
/// Anything else is returned unchanged (the navigation policy decides about other origins).
#[must_use]
pub fn rewrite_location(location: &str, backend: &Url) -> String {
    let origin = backend.origin().ascii_serialization();
    match location.strip_prefix(&origin) {
        Some("") => "/".to_string(),
        Some(rest) if rest.starts_with(['/', '?', '#']) => rest.to_string(),
        _ => location.to_string(),
    }
}

/// Response headers that must not be copied: hop-by-hop, plus length and encoding because the
/// client already decoded the body.
#[must_use]
pub fn skip_response_header(name: &HeaderName) -> bool {
    hop_by_hop(name) || *name == header::CONTENT_LENGTH || *name == header::CONTENT_ENCODING
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> Url {
        Url::parse("https://api.example.com").unwrap()
    }

    #[test]
    fn proxies_whole_path_segments_only() {
        let prefixes = vec!["/api".to_string(), "/graphql/".to_string()];
        assert!(is_proxied("/api", &prefixes));
        assert!(is_proxied("/api/users", &prefixes));
        assert!(is_proxied("/api?x=1", &prefixes));
        assert!(is_proxied("/graphql", &prefixes));
        assert!(!is_proxied("/apix", &prefixes));
        assert!(!is_proxied("/about", &prefixes));
        assert!(!is_proxied("/api", &[String::new(), "/".to_string()]));
    }

    #[test]
    fn builds_the_backend_url_from_origin_path_and_query() {
        assert_eq!(
            backend_url(&backend(), "/api/users?id=1"),
            "https://api.example.com/api/users?id=1"
        );
        let with_port = Url::parse("http://localhost:8080/ignored").unwrap();
        assert_eq!(backend_url(&with_port, "/x"), "http://localhost:8080/x");
    }

    #[test]
    fn rewrites_origin_and_referer_and_drops_hop_by_hop_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://127.0.0.1:4000"),
        );
        headers.insert(
            header::REFERER,
            HeaderValue::from_static("http://127.0.0.1:4000/cart?x=1"),
        );
        headers.insert(header::COOKIE, HeaderValue::from_static("sid=1"));
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:4000"));
        headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
        headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer t"));
        let out = forward_request_headers(&headers, &backend(), "http://127.0.0.1:4000");
        assert_eq!(out[header::ORIGIN], "https://api.example.com");
        assert_eq!(out[header::REFERER], "https://api.example.com/cart?x=1");
        assert_eq!(out[header::COOKIE], "sid=1");
        assert_eq!(out[header::AUTHORIZATION], "Bearer t");
        assert!(!out.contains_key(header::HOST));
        assert!(!out.contains_key(header::CONNECTION));
        assert!(!out.contains_key(header::ACCEPT_ENCODING));
    }

    #[test]
    fn rescopes_cookies_to_the_loopback_origin() {
        assert_eq!(
            rewrite_set_cookie(
                "sid=abc; Path=/; Domain=example.com; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=60"
            ),
            "sid=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=60"
        );
        assert_eq!(rewrite_set_cookie("a=b"), "a=b");
        assert_eq!(
            rewrite_set_cookie("t=1; SameSite=Strict; secure"),
            "t=1; SameSite=Strict"
        );
    }

    #[test]
    fn leaves_prefixed_cookies_alone() {
        let raw = "__Host-sid=1; Secure; Path=/";
        assert_eq!(rewrite_set_cookie(raw), raw);
        assert_eq!(
            rewrite_set_cookie("__Secure-x=1; Secure"),
            "__Secure-x=1; Secure"
        );
    }

    #[test]
    fn keeps_redirects_on_loopback() {
        assert_eq!(
            rewrite_location("https://api.example.com/login?next=/", &backend()),
            "/login?next=/"
        );
        assert_eq!(rewrite_location("https://api.example.com", &backend()), "/");
        assert_eq!(
            rewrite_location("https://api.example.com.evil.test/x", &backend()),
            "https://api.example.com.evil.test/x"
        );
        assert_eq!(rewrite_location("/relative", &backend()), "/relative");
        assert_eq!(
            rewrite_location("https://other.test/", &backend()),
            "https://other.test/"
        );
    }

    #[test]
    fn skips_headers_the_client_already_resolved() {
        assert!(skip_response_header(&header::CONTENT_ENCODING));
        assert!(skip_response_header(&header::CONTENT_LENGTH));
        assert!(skip_response_header(&header::TRANSFER_ENCODING));
        assert!(!skip_response_header(&header::CONTENT_TYPE));
        assert!(!skip_response_header(&header::SET_COOKIE));
    }
}
