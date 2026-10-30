// SPDX-License-Identifier: Apache-2.0
//! Navigation policy: which URLs stay in the window, which go to the system browser, which are
//! blocked. Same table as `m3/packages/web-to-tauri/src/policy.ts`; both run
//! `m3/packages/web-to-tauri/fixtures/policy-cases.json`.

use url::Url;

use crate::wrap::config::{External, Origins};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    External,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Port {
    /// The default port of the scheme.
    Default,
    Any,
    Exact(u16),
}

/// `scheme://host[:port][/path/*]`, with `*.` before the host for subdomains.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pattern {
    scheme: String,
    host: String,
    subdomains: bool,
    port: Port,
    path: Option<String>,
}

impl Pattern {
    /// `None` for anything that is not `http(s)://[*.]host[:port|:*][/path]`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let (scheme, rest) = text.split_once("://")?;
        let scheme = scheme.to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return None;
        }
        let (authority, path) = match rest.find('/') {
            Some(index) => (&rest[..index], Some(&rest[index..])),
            None => (rest, None),
        };
        if authority.is_empty() || authority.contains(['?', '#']) {
            return None;
        }
        let (subdomains, authority) = match authority.strip_prefix("*.") {
            Some(stripped) => (true, stripped),
            None => (false, authority),
        };
        let (host, port) = match authority.split_once(':') {
            Some((host, "*")) => (host, Port::Any),
            Some((host, digits)) => (
                host,
                Port::Exact(
                    digits
                        .parse()
                        .ok()
                        .filter(|_| digits.chars().all(|c| c.is_ascii_digit()))?,
                ),
            ),
            None => (authority, Port::Default),
        };
        if host.is_empty() || host.contains(['*', ':', '/']) {
            return None;
        }
        let path = match path {
            None | Some("/" | "/*") => None,
            Some(path) if path.contains(['?', '#']) => return None,
            Some(path) => Some(
                path.strip_suffix('*')
                    .filter(|_| path.ends_with("/*"))
                    .unwrap_or(path)
                    .to_string(),
            ),
        };
        Some(Self {
            scheme,
            host: host.to_ascii_lowercase(),
            subdomains,
            port,
            path,
        })
    }

    #[must_use]
    pub fn matches(&self, url: &Url) -> bool {
        if url.scheme() != self.scheme {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        let host = host.to_ascii_lowercase();
        if self.subdomains {
            if !host.ends_with(&format!(".{}", self.host)) {
                return false;
            }
        } else if host != self.host {
            return false;
        }
        let actual = url.port_or_known_default();
        let wanted = match self.port {
            Port::Any => actual,
            Port::Default => default_port(&self.scheme),
            Port::Exact(port) => Some(port),
        };
        if wanted != actual {
            return false;
        }
        self.path
            .as_ref()
            .is_none_or(|prefix| path_matches(prefix, url.path()))
    }
}

/// Whether `pathname` starts with `prefix`; a `*` segment of the prefix matches one non-empty
/// segment (`/*/dialog/` matches `/v19.0/dialog/oauth`).
fn path_matches(prefix: &str, pathname: &str) -> bool {
    if !prefix.contains('*') {
        return pathname.starts_with(prefix);
    }
    let wanted: Vec<&str> = prefix.split('/').collect();
    let actual: Vec<&str> = pathname.split('/').collect();
    // A trailing slash leaves an empty last segment in the prefix: the URL only has to reach it.
    let trailing_slash = wanted.last() == Some(&"");
    let required = if trailing_slash {
        wanted.len() - 1
    } else {
        wanted.len()
    };
    for (index, segment) in wanted.iter().take(required).enumerate() {
        let Some(value) = actual.get(index) else {
            return false;
        };
        let matches = if *segment == "*" {
            !value.is_empty()
        } else {
            segment == value
        };
        if !matches {
            return false;
        }
    }
    !trailing_slash || actual.len() >= wanted.len()
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct Policy {
    patterns: Vec<Pattern>,
    external: External,
}

impl Policy {
    /// `extra` holds origins known only at run time (the loopback origin of a bundle or sidecar).
    /// Patterns that do not parse are dropped: `WrapConfig::parse` already refused them.
    #[must_use]
    pub fn new(origins: &Origins, extra: &[String]) -> Self {
        let patterns = origins
            .app
            .iter()
            .chain(&origins.auth)
            .chain(&origins.embeds)
            .chain(extra)
            .filter_map(|text| Pattern::parse(text))
            .collect();
        Self {
            patterns,
            external: origins.external,
        }
    }

    #[must_use]
    pub fn decide(&self, url: &Url) -> Decision {
        match url.scheme() {
            "about" => {
                if matches!(url.as_str(), "about:blank" | "about:srcdoc") {
                    Decision::Allow
                } else {
                    Decision::Deny
                }
            }
            "blob" | "data" | "javascript" => Decision::Allow,
            "file" => Decision::Deny,
            "http" | "https" => {
                if self.patterns.iter().any(|pattern| pattern.matches(url)) {
                    Decision::Allow
                } else {
                    match self.external {
                        External::System => Decision::External,
                        External::Deny => Decision::Deny,
                        External::Inapp => Decision::Allow,
                    }
                }
            }
            // mailto:, tel:, custom application schemes: only the operating system can handle them.
            _ => {
                if self.external == External::System {
                    Decision::External
                } else {
                    Decision::Deny
                }
            }
        }
    }

    /// `Deny` for text that is not a URL.
    #[must_use]
    pub fn decide_str(&self, text: &str) -> Decision {
        Url::parse(text).map_or(Decision::Deny, |url| self.decide(&url))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    const CASES: &str = include_str!("policy-cases.json");

    fn strings(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn matches_the_shared_cases() {
        let document: Value = serde_json::from_str(CASES).unwrap();
        let mut checked = 0;
        for suite in document["suites"].as_array().unwrap() {
            let origins = Origins {
                app: strings(&suite["origins"]["app"]),
                auth: strings(&suite["origins"]["auth"]),
                embeds: strings(&suite["origins"]["embeds"]),
                external: match suite["origins"]["external"].as_str().unwrap() {
                    "system" => External::System,
                    "inapp" => External::Inapp,
                    _ => External::Deny,
                },
            };
            let policy = Policy::new(&origins, &strings(&suite["extraAllowed"]));
            for case in suite["cases"].as_array().unwrap() {
                let url = case["url"].as_str().unwrap();
                let expected = match case["expect"].as_str().unwrap() {
                    "allow" => Decision::Allow,
                    "external" => Decision::External,
                    _ => Decision::Deny,
                };
                assert_eq!(policy.decide_str(url), expected, "{}: {url}", suite["name"]);
                checked += 1;
            }
        }
        assert!(checked > 40, "only {checked} cases ran");
    }

    #[test]
    fn parses_patterns_like_the_typescript_side() {
        let pattern = Pattern::parse("https://*.example.com:8443/app/*").unwrap();
        assert_eq!(pattern.host, "example.com");
        assert!(pattern.subdomains);
        assert_eq!(pattern.port, Port::Exact(8443));
        assert_eq!(pattern.path.as_deref(), Some("/app/"));
        assert!(Pattern::parse("example.com").is_none());
        assert!(Pattern::parse("ftp://example.com").is_none());
        assert!(Pattern::parse("https://example.com:abc").is_none());
        assert!(Pattern::parse("https://*.*.example.com").is_none());
    }

    #[test]
    fn a_star_segment_matches_exactly_one_path_segment() {
        assert!(path_matches("/*/dialog/", "/v19.0/dialog/oauth"));
        assert!(path_matches("/*/dialog/", "/v2.0/dialog/"));
        assert!(!path_matches("/*/dialog/", "/v19.0/dialog"));
        assert!(!path_matches("/*/dialog/", "//dialog/x"));
        assert!(!path_matches("/*/dialog/", "/v19.0/other/x"));
        assert!(!path_matches("/*/dialog/", "/dialog/x"));
        assert!(path_matches("/login/", "/login/oauth"));
        assert!(!path_matches("/login/", "/logins"));
    }

    #[test]
    fn default_port_matches_explicit_default() {
        let pattern = Pattern::parse("https://example.com").unwrap();
        assert!(pattern.matches(&Url::parse("https://example.com:443/").unwrap()));
        assert!(!pattern.matches(&Url::parse("https://example.com:444/").unwrap()));
    }
}
