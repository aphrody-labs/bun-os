//! Cookie jars: the on-disk model (a Playwright-style JSON array), the input formats
//! (DevTools/extension JSON, Netscape `cookies.txt`, a `a=b; c=d` header string) and the
//! `Cookie:` header selection for a URL.

use serde_json::{Map, Number, Value, json};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SameSite {
    Strict,
    Lax,
    None,
}

impl SameSite {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SameSite::Strict => "Strict",
            SameSite::Lax => "Lax",
            SameSite::None => "None",
        }
    }

    fn parse(text: &str) -> Option<SameSite> {
        match text.trim().to_ascii_lowercase().as_str() {
            "strict" => Some(SameSite::Strict),
            "lax" => Some(SameSite::Lax),
            "none" | "no_restriction" => Some(SameSite::None),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Cookie {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) domain: String,
    pub(crate) path: String,
    /// Seconds since the Unix epoch; `None` for a session cookie.
    pub(crate) expires: Option<f64>,
    pub(crate) http_only: bool,
    pub(crate) secure: bool,
    pub(crate) same_site: Option<SameSite>,
    pub(crate) host_only: Option<bool>,
}

impl Cookie {
    pub(crate) fn is_expired(&self, now: f64) -> bool {
        self.expires.is_some_and(|e| e <= now)
    }

    pub(crate) fn bare_domain(&self) -> String {
        self.domain.trim_start_matches('.').to_ascii_lowercase()
    }

    fn is_host_only(&self) -> bool {
        self.host_only
            .unwrap_or_else(|| !self.domain.starts_with('.'))
    }

    pub(crate) fn same_key(&self, other: &Cookie) -> bool {
        self.name == other.name
            && self.bare_domain() == other.bare_domain()
            && self.path == other.path
    }

    pub(crate) fn to_json(&self) -> Value {
        let mut map = Map::new();
        map.insert("name".into(), json!(self.name));
        map.insert("value".into(), json!(self.value));
        map.insert("domain".into(), json!(self.domain));
        map.insert("path".into(), json!(self.path));
        let expires = match self.expires {
            None => json!(-1),
            Some(e) if e.fract() == 0.0 && e.abs() < 9.0e15 => json!(e as i64),
            Some(e) => Number::from_f64(e).map_or_else(|| json!(-1), Value::Number),
        };
        map.insert("expires".into(), expires);
        map.insert("httpOnly".into(), json!(self.http_only));
        map.insert("secure".into(), json!(self.secure));
        map.insert(
            "sameSite".into(),
            json!(self.same_site.unwrap_or(SameSite::Lax).as_str()),
        );
        if let Some(host_only) = self.host_only {
            map.insert("hostOnly".into(), json!(host_only));
        }
        Value::Object(map)
    }
}

fn first_field<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a Value> {
    names
        .iter()
        .find_map(|name| object.get(*name))
        .filter(|v| !v.is_null())
}

fn text_of(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn bool_of(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => matches!(s.to_ascii_lowercase().as_str(), "true" | "1"),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        _ => false,
    }
}

fn host_of_url(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = host.rsplit_once(':').map_or(host, |(h, port)| {
        if port.bytes().all(|b| b.is_ascii_digit()) {
            h
        } else {
            host
        }
    });
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

fn expires_of(object: &Map<String, Value>) -> Result<Option<f64>, String> {
    if bool_of(object.get("session")) {
        return Ok(None);
    }
    let Some(raw) = first_field(
        object,
        &["expires", "expirationDate", "expiry", "expiration"],
    ) else {
        return Ok(None);
    };
    let seconds = match raw {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    let Some(mut seconds) = seconds else {
        return Err(format!("unsupported expires value {raw}: use Unix seconds"));
    };
    if seconds <= 0.0 {
        return Ok(None);
    }
    if seconds > 1.0e11 {
        seconds /= 1000.0;
    }
    Ok(Some(seconds))
}

fn cookie_from_object(
    object: &Map<String, Value>,
    index: usize,
    default_domain: Option<&str>,
) -> Result<Cookie, String> {
    let name = first_field(object, &["name", "Name"])
        .and_then(text_of)
        .filter(|n| !n.is_empty())
        .ok_or_else(|| format!("cookie #{} has no name", index + 1))?;
    let value = first_field(object, &["value", "Value"])
        .and_then(text_of)
        .unwrap_or_default();
    let domain = first_field(object, &["domain", "Domain", "host", "host_key"])
        .and_then(text_of)
        .filter(|d| !d.is_empty())
        .or_else(|| {
            first_field(object, &["url"])
                .and_then(text_of)
                .and_then(|u| host_of_url(&u))
        })
        .or_else(|| default_domain.map(str::to_string))
        .ok_or_else(|| format!("cookie {name:?} has no domain: pass --domain"))?;
    let path = first_field(object, &["path", "Path"])
        .and_then(text_of)
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "/".to_string());
    Ok(Cookie {
        name,
        value,
        domain,
        path,
        expires: expires_of(object)?,
        http_only: bool_of(first_field(
            object,
            &["httpOnly", "http_only", "HttpOnly", "httponly"],
        )),
        secure: bool_of(first_field(object, &["secure", "Secure"])),
        same_site: first_field(object, &["sameSite", "same_site", "SameSite"])
            .and_then(text_of)
            .and_then(|s| SameSite::parse(&s)),
        host_only: first_field(object, &["hostOnly", "host_only"]).map(|v| bool_of(Some(v))),
    })
}

pub(crate) fn from_json(text: &str, default_domain: Option<&str>) -> Result<Vec<Cookie>, String> {
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("invalid JSON: {e}"))?;
    let items: Vec<&Value> = match &value {
        Value::Array(items) => items.iter().collect(),
        Value::Object(object) => match object.get("cookies") {
            Some(Value::Array(items)) => items.iter().collect(),
            _ if object.contains_key("name") => vec![&value],
            _ => {
                return Err(
                    "expected an array of cookies or an object with a \"cookies\" array"
                        .to_string(),
                );
            }
        },
        _ => return Err("expected an array of cookies".to_string()),
    };
    items
        .iter()
        .enumerate()
        .map(|(i, item)| match item {
            Value::Object(object) => cookie_from_object(object, i, default_domain),
            _ => Err(format!("cookie #{} is not an object", i + 1)),
        })
        .collect()
}

pub(crate) fn from_netscape(
    text: &str,
    default_domain: Option<&str>,
) -> Result<Vec<Cookie>, String> {
    let mut cookies = Vec::new();
    for (line_no, raw) in text.lines().enumerate() {
        let mut line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let mut http_only = false;
        if let Some(rest) = line.strip_prefix("#HttpOnly_") {
            http_only = true;
            line = rest;
        } else if line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 6 {
            return Err(format!(
                "line {}: expected 7 tab-separated fields",
                line_no + 1
            ));
        }
        let expires: f64 = fields[4]
            .trim()
            .parse()
            .map_err(|_| format!("line {}: invalid expiry {:?}", line_no + 1, fields[4]))?;
        let domain = if fields[0].is_empty() {
            default_domain
                .map(str::to_string)
                .ok_or_else(|| format!("line {}: no domain", line_no + 1))?
        } else {
            fields[0].to_string()
        };
        cookies.push(Cookie {
            name: fields[5].to_string(),
            value: fields.get(6).copied().unwrap_or("").to_string(),
            domain,
            path: if fields[2].is_empty() {
                "/".to_string()
            } else {
                fields[2].to_string()
            },
            expires: (expires > 0.0).then_some(expires),
            http_only,
            secure: fields[3].trim().eq_ignore_ascii_case("TRUE"),
            same_site: None,
            host_only: Some(!fields[1].trim().eq_ignore_ascii_case("TRUE")),
        });
    }
    Ok(cookies)
}

pub(crate) fn from_header(text: &str, domain: Option<&str>) -> Result<Vec<Cookie>, String> {
    let domain =
        domain.ok_or_else(|| "a header string has no domain: pass --domain".to_string())?;
    let trimmed = text.trim();
    let body = match trimmed.get(..7) {
        Some(prefix) if prefix.eq_ignore_ascii_case("cookie:") => trimmed[7..].trim(),
        _ => trimmed,
    };
    let mut cookies = Vec::new();
    for part in body.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some((name, value)) = part.split_once('=') else {
            return Err(format!("{part:?} is not name=value"));
        };
        if name.trim().is_empty() {
            return Err("a cookie has an empty name".to_string());
        }
        cookies.push(Cookie {
            name: name.trim().to_string(),
            value: value.trim().trim_matches('"').to_string(),
            domain: domain.to_string(),
            path: "/".to_string(),
            expires: None,
            http_only: false,
            secure: false,
            same_site: None,
            host_only: Some(true),
        });
    }
    if cookies.is_empty() {
        return Err("no cookies found in the header string".to_string());
    }
    Ok(cookies)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Format {
    Json,
    Netscape,
    Header,
}

impl Format {
    pub(crate) fn parse(name: &str) -> Option<Format> {
        match name {
            "json" => Some(Format::Json),
            "netscape" | "txt" => Some(Format::Netscape),
            "header" | "string" => Some(Format::Header),
            _ => None,
        }
    }

    pub(crate) fn detect(text: &str) -> Format {
        let trimmed = text.trim_start_matches('\u{feff}').trim_start();
        if trimmed.starts_with('[') || trimmed.starts_with('{') {
            Format::Json
        } else if trimmed.starts_with("# Netscape")
            || trimmed.starts_with("# HTTP Cookie File")
            || text.lines().any(|l| l.matches('\t').count() >= 5)
        {
            Format::Netscape
        } else {
            Format::Header
        }
    }
}

pub(crate) fn parse(
    format: Format,
    text: &str,
    domain: Option<&str>,
) -> Result<Vec<Cookie>, String> {
    match format {
        Format::Json => from_json(text, domain),
        Format::Netscape => from_netscape(text, domain),
        Format::Header => from_header(text, domain),
    }
}

/// True when `cookie_domain` is `filter` or a subdomain of it (leading dots ignored).
pub(crate) fn domain_within(cookie_domain: &str, filter: &str) -> bool {
    let cookie = cookie_domain.trim_start_matches('.').to_ascii_lowercase();
    let filter = filter.trim_start_matches('.').to_ascii_lowercase();
    cookie == filter || cookie.ends_with(&format!(".{filter}"))
}

pub(crate) struct Target {
    pub(crate) host: String,
    pub(crate) path: String,
    pub(crate) secure: bool,
}

pub(crate) fn parse_target(
    input: &str,
    insecure: bool,
    path: Option<&str>,
) -> Result<Target, String> {
    let input = input.trim();
    let (scheme, rest) = match input.split_once("://") {
        Some((scheme, rest)) => (Some(scheme.to_ascii_lowercase()), rest),
        None => (None, input),
    };
    let secure = match scheme.as_deref() {
        Some("https") | Some("wss") => true,
        Some("http") | Some("ws") => false,
        Some(other) => return Err(format!("unsupported scheme {other:?}")),
        None => !insecure,
    };
    let host = host_of_url(rest).ok_or_else(|| format!("{input:?} has no host"))?;
    let url_path = rest
        .find('/')
        .map(|i| rest[i..].split(['?', '#']).next().unwrap_or("/"))
        .filter(|p| !p.is_empty())
        .unwrap_or("/");
    Ok(Target {
        host,
        path: path.unwrap_or(url_path).to_string(),
        secure,
    })
}

fn domain_matches(cookie: &Cookie, host: &str) -> bool {
    let bare = cookie.bare_domain();
    if cookie.is_host_only() {
        host == bare
    } else {
        host == bare || host.ends_with(&format!(".{bare}"))
    }
}

fn path_matches(cookie_path: &str, request_path: &str) -> bool {
    let cookie_path = if cookie_path.is_empty() {
        "/"
    } else {
        cookie_path
    };
    request_path == cookie_path
        || (request_path.starts_with(cookie_path)
            && (cookie_path.ends_with('/') || request_path[cookie_path.len()..].starts_with('/')))
}

/// Cookies a client would send to `target` at time `now`, longest path first.
pub(crate) fn select<'a>(cookies: &'a [Cookie], target: &Target, now: f64) -> Vec<&'a Cookie> {
    let mut chosen: Vec<&Cookie> = cookies
        .iter()
        .filter(|c| {
            !c.is_expired(now)
                && domain_matches(c, &target.host)
                && path_matches(&c.path, &target.path)
                && (!c.secure || target.secure)
        })
        .collect();
    chosen.sort_by_key(|c| std::cmp::Reverse(c.path.len()));
    chosen
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Level {
    Error,
    Warning,
}

pub(crate) struct Issue {
    pub(crate) level: Level,
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// RFC 6265bis checks on one cookie: expiry, `Secure`, `SameSite`, `HttpOnly` and the
/// `__Secure-` / `__Host-` prefix rules.
pub(crate) fn check_cookie(cookie: &Cookie, now: f64) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut add = |level, code, message: &str| {
        issues.push(Issue {
            level,
            code,
            message: message.to_string(),
        });
    };
    if cookie.is_expired(now) {
        add(Level::Error, "expired", "the cookie has expired");
    } else if cookie.expires.is_some_and(|e| e - now < 86_400.0) {
        add(
            Level::Warning,
            "expires-soon",
            "the cookie expires within 24 hours",
        );
    }
    if cookie.same_site == Some(SameSite::None) && !cookie.secure {
        add(
            Level::Error,
            "samesite-none-insecure",
            "SameSite=None requires Secure; browsers reject the cookie",
        );
    }
    if !cookie.secure {
        add(
            Level::Warning,
            "not-secure",
            "the cookie is not marked Secure and is sent over plain HTTP",
        );
    }
    if !cookie.http_only {
        add(
            Level::Warning,
            "not-httponly",
            "the cookie is readable by page scripts (no HttpOnly)",
        );
    }
    let lower = cookie.name.to_ascii_lowercase();
    if lower.starts_with("__secure-") && !cookie.secure {
        add(
            Level::Error,
            "prefix-secure",
            "a __Secure- cookie must be Secure",
        );
    }
    if lower.starts_with("__host-") {
        if !cookie.secure {
            add(
                Level::Error,
                "prefix-host",
                "a __Host- cookie must be Secure",
            );
        }
        if cookie.path != "/" {
            add(
                Level::Error,
                "prefix-host",
                "a __Host- cookie must have Path=/",
            );
        }
        if !cookie.is_host_only() {
            add(
                Level::Error,
                "prefix-host",
                "a __Host- cookie must not set a Domain (host-only)",
            );
        }
    }
    issues
}
