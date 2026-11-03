//! Which values are secrets, and how they are hidden.

pub(crate) const MASK: &str = "********";

const KEY_MARKERS: &[&str] = &[
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "PASSPHRASE",
    "CREDENTIAL",
    "PRIVATE",
    "APIKEY",
    "API_KEY",
    "ACCESS_KEY",
    "SECRET_KEY",
    "SIGNING",
    "COOKIE",
    "SESSION",
    "AUTH",
    "DSN",
];

/// Heuristic used by `bunos env`: a variable is sensitive when its name contains a secret-like word
/// (`TOKEN`, `PASSWORD`, `AUTH`, a `KEY` segment, ...) or its value is a URL carrying a password.
pub(crate) fn is_sensitive_env(key: &str, value: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if KEY_MARKERS.iter().any(|marker| upper.contains(marker)) {
        return true;
    }
    if upper
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|segment| segment == "KEY" || segment == "PASS")
        || upper.ends_with("KEY")
    {
        return true;
    }
    url_has_password(value)
}

fn url_has_password(value: &str) -> bool {
    let Some(scheme_end) = value.find("://") else {
        return false;
    };
    let rest = &value[scheme_end + 3..];
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let Some((userinfo, _)) = authority.rsplit_once('@') else {
        return false;
    };
    userinfo.contains(':') && !userinfo.ends_with(':')
}

pub(crate) fn mask(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        MASK.to_string()
    }
}
