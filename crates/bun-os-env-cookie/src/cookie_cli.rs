//! `bunos cookie`: cookie jars on disk, imported from browser exports.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::args::{Args, Spec, flag, option, short_flag};
use crate::fsutil;
use crate::jar::{self, Cookie, Format, Level};
use crate::mask;
use crate::{Io, errln, outln};

const USAGE: &str =
    "bunos cookie: keep browser cookies in jars on disk and turn them into Cookie headers

Usage:
  bunos cookie import SOURCE [--name JAR] [--domain D] [--format F] [--replace]
  bunos cookie jars [--json]
  bunos cookie list [--name JAR] [--domain D] [--json] [--reveal]
  bunos cookie get COOKIE [--name JAR] [--domain D] [--all] [--json] [--reveal]
  bunos cookie header URL [--name JAR] [--path P] [--insecure] [--value-only] [--json] [--reveal]
  bunos cookie rm COOKIE [--name JAR] [--domain D]
  bunos cookie rm --expired | --all [--name JAR]
  bunos cookie check [--name JAR] [--strict] [--json]

SOURCE is a file, `-` for standard input, or the cookie string itself. Formats (auto-detected, or
--format json|netscape|header): the JSON export of DevTools and cookie extensions (an array of
objects with name, value, domain, path, expires, httpOnly, secure, sameSite; Playwright storage
state also works), Netscape cookies.txt, and a `a=b; c=d` header string (needs --domain).
--domain keeps only the cookies of that domain and its subdomains, and gives a domain to the ones
that have none. Imports merge into the jar; --replace starts from an empty jar.

A jar is the JSON array ~/.aphrody/cookies/<JAR>.json (default jar: default), written atomically
with mode 0600. Override the directory with --dir or BUN_COOKIE_DIR.

header prints `Cookie: a=b; c=d` for the cookies a browser would send to URL (expired cookies,
other domains and paths, and Secure cookies on http are skipped). A bare host counts as https;
--insecure makes it http.

Cookie values are never printed unless --reveal is given. check reports expired cookies,
SameSite=None without Secure, missing Secure and HttpOnly, and __Secure-/__Host- prefix
violations; exit status 1 when a cookie has an error (--strict: or a warning).

Options:
      --name JAR     jar name (default: default)
      --dir DIR      jar directory
      --domain D     domain filter
      --path P       header: request path
      --format F     import: json, netscape or header
      --replace      import: replace the jar instead of merging
      --all          get: every match; rm: delete the whole jar
      --expired      rm: remove expired cookies
      --insecure     header: treat a bare host as http
      --value-only   header: print only the value of the header
      --reveal       print cookie values
      --strict       check: warnings fail too
      --json         machine-readable output
  -h, --help         print this help
Exit status: 0 success, 1 failure (no match, failed check, I/O), 2 usage.";

const SPECS: &[Spec] = &[
    option("name"),
    option("dir"),
    option("domain"),
    option("path"),
    option("format"),
    flag("replace"),
    flag("all"),
    flag("expired"),
    flag("insecure"),
    flag("value-only"),
    flag("reveal"),
    flag("strict"),
    flag("json"),
    short_flag("help", 'h'),
];

enum Failure {
    Usage(String),
    Run(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Run(message)
    }
}

type Outcome = Result<i32, Failure>;

pub fn main(args: &[String], io: &mut Io) -> i32 {
    let Some(sub) = args.first().map(String::as_str) else {
        outln!(io, "{USAGE}");
        return 0;
    };
    if matches!(sub, "help" | "-h" | "--help") {
        outln!(io, "{USAGE}");
        return 0;
    }
    let parsed = match Args::parse(&args[1..], SPECS) {
        Ok(parsed) => parsed,
        Err(message) => {
            errln!(io, "error: {message}");
            return 2;
        }
    };
    if parsed.has("help") {
        outln!(io, "{USAGE}");
        return 0;
    }
    let result = match sub {
        "import" => import(io, &parsed),
        "jars" => jars(io, &parsed),
        "list" | "ls" => list(io, &parsed),
        "get" => get(io, &parsed),
        "header" => header(io, &parsed),
        "rm" | "remove" | "delete" => remove(io, &parsed),
        "check" => check(io, &parsed),
        other => Err(Failure::Usage(format!("unknown subcommand {other:?}"))),
    };
    match result {
        Ok(code) => code,
        Err(Failure::Usage(message)) => {
            errln!(io, "error: {message}\nRun `bunos cookie --help` for usage.");
            2
        }
        Err(Failure::Run(message)) => {
            errln!(io, "error: {message}");
            1
        }
    }
}

fn jar_dir(io: &Io, args: &Args) -> Result<PathBuf, Failure> {
    let cwd = io.current_dir()?;
    if let Some(dir) = args.value("dir") {
        return Ok(cwd.join(dir));
    }
    if let Some(dir) = io.env_var("BUN_COOKIE_DIR").filter(|d| !d.is_empty()) {
        return Ok(cwd.join(dir));
    }
    match fsutil::home_dir(io) {
        Some(home) => Ok(home.join(".aphrody").join("cookies")),
        None => Err(Failure::Run(
            "cannot find the home directory: pass --dir".to_string(),
        )),
    }
}

fn jar_name(args: &Args) -> Result<String, Failure> {
    let name = args.value("name").unwrap_or("default");
    let valid = !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !valid {
        return Err(Failure::Usage(format!(
            "invalid jar name {name:?}: use letters, digits, '.', '_' and '-'"
        )));
    }
    Ok(name.to_string())
}

fn jar_path(io: &Io, args: &Args) -> Result<(PathBuf, String), Failure> {
    let name = jar_name(args)?;
    Ok((jar_dir(io, args)?.join(format!("{name}.json")), name))
}

fn load_jar(path: &Path) -> Result<Option<Vec<Cookie>>, Failure> {
    match fs::read_to_string(path) {
        Ok(text) => jar::from_json(&text, None)
            .map(Some)
            .map_err(|e| Failure::Run(format!("{}: {e}", path.display()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Failure::Run(format!("cannot read {}: {e}", path.display()))),
    }
}

fn load_existing(path: &Path, name: &str) -> Result<Vec<Cookie>, Failure> {
    load_jar(path)?
        .ok_or_else(|| Failure::Run(format!("jar {name:?} does not exist ({})", path.display())))
}

fn save_jar(path: &Path, cookies: &[Cookie]) -> Result<(), Failure> {
    let body = Value::Array(cookies.iter().map(Cookie::to_json).collect());
    let mut text = serde_json::to_string_pretty(&body).unwrap_or_default();
    text.push('\n');
    if let Some(dir) = path.parent() {
        fsutil::create_private_dir(dir)
            .map_err(|e| Failure::Run(format!("cannot create {}: {e}", dir.display())))?;
    }
    fsutil::atomic_write(path, text.as_bytes(), Some(0o600))
        .map_err(|e| Failure::Run(format!("cannot write {}: {e}", path.display())))
}

fn format_flag(args: &Args) -> Result<Option<Format>, Failure> {
    match args.value("format") {
        None | Some("auto") => Ok(None),
        Some(name) => Format::parse(name).map(Some).ok_or_else(|| {
            Failure::Usage(format!(
                "--format must be json, netscape or header, not {name:?}"
            ))
        }),
    }
}

fn import(io: &mut Io, args: &Args) -> Outcome {
    let [source] = args.positional.as_slice() else {
        return Err(Failure::Usage(
            "import needs exactly one SOURCE".to_string(),
        ));
    };
    let forced = format_flag(args)?;
    let cwd = io.current_dir()?;
    let text = if source == "-" {
        io.read_stdin()?
    } else {
        let path = cwd.join(source);
        match fs::read(&path) {
            Ok(bytes) => String::from_utf8(bytes)
                .map_err(|_| Failure::Run(format!("{} is not valid UTF-8", path.display())))?,
            Err(_)
                if forced == Some(Format::Header) || (forced.is_none() && source.contains('=')) =>
            {
                source.clone()
            }
            Err(e) => return Err(Failure::Run(format!("cannot read {}: {e}", path.display()))),
        }
    };
    let format = forced.unwrap_or_else(|| Format::detect(&text));
    let domain = args.value("domain");
    let mut incoming = jar::parse(format, &text, domain)?;
    if let (Some(filter), true) = (domain, format != Format::Header) {
        incoming.retain(|c| jar::domain_within(&c.domain, filter));
    }
    if incoming.is_empty() {
        return Err(Failure::Run("no cookies to import".to_string()));
    }
    let (path, name) = jar_path(io, args)?;
    let mut cookies = if args.has("replace") {
        Vec::new()
    } else {
        load_jar(&path)?.unwrap_or_default()
    };
    let count = incoming.len();
    for cookie in incoming {
        match cookies.iter_mut().find(|c| c.same_key(&cookie)) {
            Some(slot) => *slot = cookie,
            None => cookies.push(cookie),
        }
    }
    save_jar(&path, &cookies)?;
    outln!(
        io,
        "imported {count} cookies into jar {name} ({} total): {}",
        cookies.len(),
        path.display()
    );
    Ok(0)
}

fn jars(io: &mut Io, args: &Args) -> Outcome {
    let dir = jar_dir(io, args)?;
    let mut found: Vec<(String, usize)> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            if let Some(name) = file.strip_suffix(".json") {
                let count = load_jar(&entry.path())
                    .ok()
                    .flatten()
                    .map_or(0, |c| c.len());
                found.push((name.to_string(), count));
            }
        }
    }
    found.sort();
    if args.has("json") {
        let list: Vec<Value> = found
            .iter()
            .map(|(n, c)| json!({ "name": n, "cookies": c }))
            .collect();
        let body = json!({ "dir": dir.display().to_string(), "jars": list });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    } else {
        for (name, count) in &found {
            outln!(io, "{name}  ({count} cookies)");
        }
    }
    Ok(0)
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn iso_utc(seconds: f64) -> String {
    let secs = seconds.floor() as i64;
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn shown_value(cookie: &Cookie, reveal: bool) -> String {
    if reveal {
        cookie.value.clone()
    } else {
        mask::mask(&cookie.value)
    }
}

fn flags_of(cookie: &Cookie) -> String {
    let mut flags = Vec::new();
    if cookie.secure {
        flags.push("Secure".to_string());
    }
    if cookie.http_only {
        flags.push("HttpOnly".to_string());
    }
    if let Some(same_site) = cookie.same_site {
        flags.push(format!("SameSite={}", same_site.as_str()));
    }
    flags.join(" ")
}

fn cookie_json(cookie: &Cookie, reveal: bool) -> Value {
    let mut value = cookie.to_json();
    if let Value::Object(map) = &mut value {
        map.insert("value".into(), json!(shown_value(cookie, reveal)));
        map.insert("masked".into(), json!(!reveal && !cookie.value.is_empty()));
    }
    value
}

fn matching<'a>(cookies: &'a [Cookie], args: &Args) -> Vec<&'a Cookie> {
    let domain = args.value("domain");
    cookies
        .iter()
        .filter(|c| domain.is_none_or(|d| jar::domain_within(&c.domain, d)))
        .collect()
}

fn list(io: &mut Io, args: &Args) -> Outcome {
    let (path, name) = jar_path(io, args)?;
    let cookies = load_existing(&path, &name)?;
    let reveal = args.has("reveal");
    let shown = matching(&cookies, args);
    if args.has("json") {
        let body: Vec<Value> = shown.iter().map(|c| cookie_json(c, reveal)).collect();
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
        return Ok(0);
    }
    let rows: Vec<[String; 6]> = shown
        .iter()
        .map(|c| {
            [
                c.domain.clone(),
                c.path.clone(),
                c.name.clone(),
                shown_value(c, reveal),
                c.expires.map_or_else(|| "session".to_string(), iso_utc),
                flags_of(c),
            ]
        })
        .collect();
    let mut widths = [0usize; 5];
    for row in &rows {
        for (i, width) in widths.iter_mut().enumerate() {
            *width = (*width).max(row[i].chars().count());
        }
    }
    for row in &rows {
        let mut line = String::new();
        for (i, width) in widths.iter().enumerate() {
            line.push_str(&format!("{:<width$}  ", row[i], width = *width));
        }
        line.push_str(&row[5]);
        outln!(io, "{}", line.trim_end());
    }
    Ok(0)
}

fn get(io: &mut Io, args: &Args) -> Outcome {
    let [wanted] = args.positional.as_slice() else {
        return Err(Failure::Usage(
            "get needs exactly one COOKIE name".to_string(),
        ));
    };
    let (path, name) = jar_path(io, args)?;
    let cookies = load_existing(&path, &name)?;
    let found: Vec<&Cookie> = matching(&cookies, args)
        .into_iter()
        .filter(|c| &c.name == wanted)
        .collect();
    if found.is_empty() {
        return Err(Failure::Run(format!(
            "no cookie named {wanted:?} in jar {name}"
        )));
    }
    if found.len() > 1 && !args.has("all") {
        let domains: Vec<String> = found.iter().map(|c| c.domain.clone()).collect();
        return Err(Failure::Run(format!(
            "{} cookies are named {wanted:?} (domains: {}): pass --domain or --all",
            found.len(),
            domains.join(", ")
        )));
    }
    let reveal = args.has("reveal");
    if args.has("json") {
        let body: Vec<Value> = found.iter().map(|c| cookie_json(c, reveal)).collect();
        let body = if args.has("all") {
            Value::Array(body)
        } else {
            body.into_iter().next().unwrap_or(Value::Null)
        };
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    } else {
        for cookie in found {
            outln!(io, "{}", shown_value(cookie, reveal));
        }
    }
    Ok(0)
}

fn header(io: &mut Io, args: &Args) -> Outcome {
    let [url] = args.positional.as_slice() else {
        return Err(Failure::Usage(
            "header needs exactly one URL or host".to_string(),
        ));
    };
    let target = jar::parse_target(url, args.has("insecure"), args.value("path"))?;
    let (path, name) = jar_path(io, args)?;
    let cookies = load_existing(&path, &name)?;
    let chosen = jar::select(&cookies, &target, io.now_secs());
    if chosen.is_empty() {
        return Err(Failure::Run(format!(
            "no cookie in jar {name} applies to {url}"
        )));
    }
    let reveal = args.has("reveal");
    let value = chosen
        .iter()
        .map(|c| format!("{}={}", c.name, shown_value(c, reveal)))
        .collect::<Vec<_>>()
        .join("; ");
    if args.has("json") {
        let names: Vec<&str> = chosen.iter().map(|c| c.name.as_str()).collect();
        let body = json!({
            "header": format!("Cookie: {value}"),
            "host": target.host,
            "path": target.path,
            "secure": target.secure,
            "masked": !reveal,
            "cookies": names,
        });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    } else if args.has("value-only") {
        outln!(io, "{value}");
    } else {
        outln!(io, "Cookie: {value}");
    }
    Ok(0)
}

fn remove(io: &mut Io, args: &Args) -> Outcome {
    let (path, name) = jar_path(io, args)?;
    let mut cookies = load_existing(&path, &name)?;
    if args.has("all") {
        fs::remove_file(&path)
            .map_err(|e| Failure::Run(format!("cannot remove {}: {e}", path.display())))?;
        outln!(io, "removed jar {name} ({} cookies)", cookies.len());
        return Ok(0);
    }
    let before = cookies.len();
    if args.has("expired") {
        let now = io.now_secs();
        cookies.retain(|c| !c.is_expired(now));
    } else {
        let [wanted] = args.positional.as_slice() else {
            return Err(Failure::Usage(
                "rm needs a COOKIE name, --expired or --all".to_string(),
            ));
        };
        let domain = args.value("domain");
        cookies.retain(|c| {
            !(c.name == *wanted && domain.is_none_or(|d| jar::domain_within(&c.domain, d)))
        });
    }
    let removed = before - cookies.len();
    if removed == 0 {
        return Err(Failure::Run(format!("no matching cookie in jar {name}")));
    }
    save_jar(&path, &cookies)?;
    outln!(
        io,
        "removed {removed} cookies from jar {name} ({} left)",
        cookies.len()
    );
    Ok(0)
}

fn check(io: &mut Io, args: &Args) -> Outcome {
    let (path, name) = jar_path(io, args)?;
    let cookies = load_existing(&path, &name)?;
    let now = io.now_secs();
    let mut errors = 0usize;
    let mut warnings = 0usize;
    let mut report: Vec<Value> = Vec::new();
    for cookie in &cookies {
        let issues = jar::check_cookie(cookie, now);
        for issue in &issues {
            match issue.level {
                Level::Error => errors += 1,
                Level::Warning => warnings += 1,
            }
        }
        if args.has("json") {
            let list: Vec<Value> = issues
                .iter()
                .map(|i| {
                    json!({
                        "level": if i.level == Level::Error { "error" } else { "warning" },
                        "code": i.code,
                        "message": i.message,
                    })
                })
                .collect();
            report.push(json!({ "name": cookie.name, "domain": cookie.domain, "path": cookie.path, "issues": list }));
        } else {
            for issue in &issues {
                let level = if issue.level == Level::Error {
                    "error  "
                } else {
                    "warning"
                };
                outln!(
                    io,
                    "{level}  {} ({}{}): {}",
                    cookie.name,
                    cookie.domain,
                    cookie.path,
                    issue.message
                );
            }
        }
    }
    let failed = errors > 0 || (args.has("strict") && warnings > 0);
    if args.has("json") {
        let body = json!({
            "jar": name,
            "cookies": cookies.len(),
            "errors": errors,
            "warnings": warnings,
            "passed": !failed,
            "report": report,
        });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    } else {
        outln!(
            io,
            "{} cookies: {errors} errors, {warnings} warnings",
            cookies.len()
        );
    }
    Ok(i32::from(failed))
}
