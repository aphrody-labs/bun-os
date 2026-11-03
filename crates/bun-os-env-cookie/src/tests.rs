use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::dotenv::{self, Doc, Layer};
use crate::jar::{self, Format, Level, SameSite, Target};
use crate::mask;
use crate::{Io, cookie_main, env_main};

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> TempDir {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "bun-env-cookie-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn write(&self, name: &str, text: &str) {
        fs::write(self.0.join(name), text).unwrap();
    }

    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.0.join(name)).unwrap()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn io_in(dir: &TempDir, env: &[(&str, &str)]) -> Io {
    let environ: BTreeMap<String, String> = env
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    Io {
        cwd: Some(dir.path().to_path_buf()),
        environ: Some(environ),
        now: Some(1_800_000_000.0),
        ..Io::default()
    }
}

fn run_env(dir: &TempDir, env: &[(&str, &str)], args: &[&str]) -> (i32, String, String) {
    let mut io = io_in(dir, env);
    let code = env_main(
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        &mut io,
    );
    (code, io.out, io.err)
}

fn run_cookie(dir: &TempDir, args: &[&str]) -> (i32, String, String) {
    let mut io = io_in(dir, &[("HOME", dir.path().to_str().unwrap())]);
    let code = cookie_main(
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        &mut io,
    );
    (code, io.out, io.err)
}

fn values(doc: &Doc) -> Vec<(String, String)> {
    doc.pairs()
}

fn pair(k: &str, v: &str) -> (String, String) {
    (k.to_string(), v.to_string())
}

#[test]
fn parser_follows_bun_rules() {
    let doc = Doc::parse(
        "# comment\nA=1\nexport B = two # trailing\nC: three\nD=\"line1\\nline2\"\nE='it''s'\nF=`back`\nG=\"multi\nline\"\nA=override\nH=x#y\nBAD LINE\n",
    );
    assert_eq!(
        values(&doc),
        vec![
            pair("A", "override"),
            pair("B", "two"),
            pair("C", "three"),
            pair("D", "line1\nline2"),
            pair("E", "it"),
            pair("F", "back"),
            pair("G", "multi\nline"),
            pair("H", "x"),
        ]
    );
}

#[test]
fn bom_is_kept() {
    let doc = Doc::parse("\u{feff}A=1\n");
    assert_eq!(values(&doc), vec![pair("A", "1")]);
    assert!(doc.render().starts_with('\u{feff}'));
}

#[test]
fn edits_preserve_comments_order_and_line_endings() {
    let mut doc = Doc::parse("# top\r\nA=1\r\n\r\n# mid\r\nexport B=\"two\" # keep\r\nC=3\r\n");
    doc.set("B", "new value").unwrap();
    doc.set("D", "4").unwrap();
    assert_eq!(
        doc.render(),
        "# top\r\nA=1\r\n\r\n# mid\r\nexport B=new value # keep\r\nC=3\r\nD=4\r\n"
    );
    assert_eq!(doc.unset("A"), 1);
    assert_eq!(doc.unset("missing"), 0);
    assert_eq!(
        doc.render(),
        "# top\r\n\r\n# mid\r\nexport B=new value # keep\r\nC=3\r\nD=4\r\n"
    );
}

#[test]
fn set_appends_after_a_missing_final_newline() {
    let mut doc = Doc::parse("A=1");
    doc.set("B", "2").unwrap();
    assert_eq!(doc.render(), "A=1\nB=2\n");
}

#[test]
fn unset_removes_multiline_values() {
    let mut doc = Doc::parse("A=1\nB=\"x\ny\"\nC=3\n");
    assert_eq!(doc.unset("B"), 1);
    assert_eq!(doc.render(), "A=1\nC=3\n");
}

#[test]
fn written_values_read_back_unchanged() {
    for value in [
        "plain",
        "with space",
        " leading",
        "trailing ",
        "a#b",
        "has \"double\" quotes",
        "it's",
        "both ' and \"",
        "dollar $HOME and ${X:-y}",
        "back\\slash",
        "line1\nline2",
        "=starts-with-equals",
        "'quoted'",
        "\"quoted\"",
        "postgres://user:p@ss@host/db?x=1#frag",
    ] {
        let mut doc = Doc::parse("");
        doc.set("K", value)
            .unwrap_or_else(|e| panic!("{value:?}: {e}"));
        let layer = Layer {
            label: "t".into(),
            path: PathBuf::new(),
            doc: Some(Doc::parse(&doc.render())),
        };
        let vars = dotenv::resolve(&[layer], &BTreeMap::new(), false, true);
        assert_eq!(
            vars[0].value,
            value,
            "round trip of {value:?} through {:?}",
            doc.render()
        );
    }
}

#[test]
fn invalid_keys_are_rejected() {
    let mut doc = Doc::parse("");
    assert!(doc.set("bad key", "x").is_err());
    assert!(doc.set("", "x").is_err());
    assert!(doc.set("a=b", "x").is_err());
}

fn layer(label: &str, text: &str) -> Layer {
    Layer {
        label: label.into(),
        path: PathBuf::new(),
        doc: Some(Doc::parse(text)),
    }
}

#[test]
fn resolution_follows_bun_precedence_and_expansion() {
    let low_to_high = [
        layer(
            ".env",
            "A=env\nB=env\nURL=${HOST:-localhost}:$PORT/$A\nESC=\\$A\n",
        ),
        layer(".env.local", "B=local\nPORT=5432\n"),
    ];
    let process = BTreeMap::from([
        ("HOST".to_string(), "db".to_string()),
        ("A".to_string(), "proc".to_string()),
    ]);
    let vars = dotenv::resolve(&low_to_high, &process, true, true);
    let get = |name: &str| vars.iter().find(|v| v.name == name).unwrap();
    assert_eq!(get("A").value, "proc");
    assert_eq!(get("A").source, "process");
    assert_eq!(get("A").shadowed, vec![".env".to_string()]);
    assert_eq!(get("B").value, "local");
    assert_eq!(get("B").shadowed, vec![".env".to_string()]);
    assert_eq!(get("URL").value, "db:5432/proc");
    assert_eq!(get("ESC").value, "$A");

    let no_process = dotenv::resolve(&low_to_high, &process, false, true);
    let url = no_process.iter().find(|v| v.name == "URL").unwrap();
    assert_eq!(url.value, "localhost:5432/env");

    let raw = dotenv::resolve(&low_to_high, &BTreeMap::new(), false, false);
    assert_eq!(
        raw.iter().find(|v| v.name == "URL").unwrap().value,
        "${HOST:-localhost}:$PORT/$A"
    );
}

#[test]
fn secrets_are_recognised() {
    for key in [
        "API_TOKEN",
        "DB_PASSWORD",
        "STRIPE_SECRET_KEY",
        "OPENAI_API_KEY",
        "AUTH_HEADER",
        "SIGNING_SALT",
        "STRIPE_KEY",
        "SENTRY_DSN",
    ] {
        assert!(mask::is_sensitive_env(key, "x"), "{key}");
    }
    for key in [
        "NODE_ENV",
        "PORT",
        "HOST",
        "LOG_LEVEL",
        "PWD",
        "KEYBOARD_LAYOUT",
    ] {
        assert!(!mask::is_sensitive_env(key, "x"), "{key}");
    }
    assert!(mask::is_sensitive_env(
        "DATABASE_URL",
        "postgres://u:pw@h/db"
    ));
    assert!(!mask::is_sensitive_env("DATABASE_URL", "postgres://h/db"));
    assert!(!mask::is_sensitive_env(
        "SITE_URL",
        "https://example.com/a@b"
    ));
}

#[test]
fn env_cli_edits_and_reads() {
    let dir = TempDir::new("envcli");
    dir.write(".env", "# my env\nNAME=world\n");
    let (code, out, err) = run_env(
        &dir,
        &[],
        &["set", "API_TOKEN=abc123", "GREETING=hello $NAME"],
    );
    assert_eq!((code, err.as_str()), (0, ""), "{out}");
    assert_eq!(
        dir.read(".env"),
        "# my env\nNAME=world\nAPI_TOKEN=abc123\nGREETING=hello \\$NAME\n"
    );

    let (code, out, _) = run_env(&dir, &[], &["get", "API_TOKEN"]);
    assert_eq!((code, out.as_str()), (0, "********\n"));
    let (_, out, _) = run_env(&dir, &[], &["get", "API_TOKEN", "--reveal"]);
    assert_eq!(out, "abc123\n");
    let (_, out, _) = run_env(&dir, &[], &["get", "GREETING"]);
    assert_eq!(out, "hello $NAME\n");
    let (code, _, err) = run_env(&dir, &[], &["get", "NOPE"]);
    assert_eq!((code, err.as_str()), (1, "error: NOPE is not set\n"));

    let (_, out, _) = run_env(&dir, &[], &["list", "--sources"]);
    assert_eq!(
        out,
        "API_TOKEN=********\t# .env\nGREETING=hello $NAME\t# .env\nNAME=world\t# .env\n"
    );

    let (code, out, _) = run_env(&dir, &[], &["unset", "GREETING", "MISSING"]);
    assert_eq!(code, 0);
    assert!(
        out.contains("GREETING removed") && out.contains("MISSING is not defined"),
        "{out}"
    );
    assert_eq!(dir.read(".env"), "# my env\nNAME=world\nAPI_TOKEN=abc123\n");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.path().join(".env"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn env_cli_set_value_from_stdin_and_new_file() {
    let dir = TempDir::new("envstdin");
    let mut io = io_in(&dir, &[]);
    io.stdin = Some("s3cret value\n".to_string());
    let code = env_main(
        &["set", "PASSWORD", "--stdin", "--file", ".env.local"].map(String::from),
        &mut io,
    );
    assert_eq!(code, 0, "{}", io.err);
    assert_eq!(dir.read(".env.local"), "PASSWORD=s3cret value\n");
    assert!(!io.out.contains("s3cret"));
}

#[test]
fn env_cli_resolves_in_bun_order_for_a_mode() {
    let dir = TempDir::new("envorder");
    dir.write(".env", "A=env\nB=env\nC=env\nD=env\n");
    dir.write(".env.production", "B=prod\nC=prod\nD=prod\n");
    dir.write(".env.local", "C=local\nD=local\n");
    dir.write(".env.production.local", "D=prodlocal\n");
    let (_, out, _) = run_env(&dir, &[("NODE_ENV", "production")], &["list", "--sources"]);
    assert_eq!(
        out,
        "A=env\t# .env\nB=prod\t# .env.production\nC=local\t# .env.local\nD=prodlocal\t# .env.production.local\n"
    );
    let (_, out, _) = run_env(&dir, &[("NODE_ENV", "test")], &["list"]);
    assert_eq!(out, "A=env\nB=env\nC=env\nD=env\n");
    let (_, out, _) = run_env(
        &dir,
        &[("D", "process")],
        &["list", "--mode", "development"],
    );
    assert_eq!(out, "A=env\nB=env\nC=local\nD=process\n");
    let (_, out, _) = run_env(&dir, &[], &["list", "--file", ".env,.env.local", "--json"]);
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(json["explicit"], true);
    let c = json["variables"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "C")
        .unwrap();
    assert_eq!(c["value"], "local");
    assert_eq!(c["source"], ".env.local");
    let (_, out, _) = run_env(&dir, &[], &["files"]);
    assert!(out.contains(".env.development.local  (not found)"), "{out}");
}

#[test]
fn env_cli_check_compares_with_the_example() {
    let dir = TempDir::new("envcheck");
    dir.write(".env.example", "A=\nB=\nC=\n");
    dir.write(".env", "A=1\nC=\nEXTRA=1\n");
    let (code, out, _) = run_env(&dir, &[], &["check"]);
    assert_eq!(code, 1);
    assert!(
        out.contains("missing  B") && out.contains("empty    C") && out.contains("extra    EXTRA"),
        "{out}"
    );
    dir.write(".env", "A=1\nB=2\nC=3\nEXTRA=1\n");
    let (code, _, _) = run_env(&dir, &[], &["check"]);
    assert_eq!(code, 0);
    let (code, _, _) = run_env(&dir, &[], &["check", "--strict"]);
    assert_eq!(code, 1);
    let (code, out, _) = run_env(
        &dir,
        &[("B", "x")],
        &["check", "--json", "--example", ".env.example"],
    );
    assert_eq!(code, 0);
    assert!(out.contains("\"passed\": true"), "{out}");
    dir.write(
        ".env", "A=1
C=3
",
    );
    let (code, _, _) = run_env(&dir, &[("B", "from-process")], &["check"]);
    assert_eq!(code, 0);
    let (code, out, _) = run_env(&dir, &[("B", "from-process")], &["check", "--no-process"]);
    assert_eq!(code, 1);
    assert!(out.contains("missing  B"), "{out}");
}

#[test]
fn env_cli_usage_errors() {
    let dir = TempDir::new("envusage");
    assert_eq!(run_env(&dir, &[], &["bogus"]).0, 2);
    assert_eq!(run_env(&dir, &[], &["get"]).0, 2);
    assert_eq!(run_env(&dir, &[], &["set", "NOEQUALS"]).0, 2);
    assert_eq!(run_env(&dir, &[], &["list", "--mode", "staging"]).0, 2);
    assert_eq!(run_env(&dir, &[], &["list", "--nope"]).0, 2);
    assert_eq!(
        run_env(&dir, &[], &["set", "A=1", "--file", "a", "--file", "b"]).0,
        2
    );
    assert_eq!(run_env(&dir, &[], &["--help"]).0, 0);
    assert_eq!(run_env(&dir, &[], &[]).0, 0);
}

#[test]
fn json_export_with_aliases() {
    let cookies = jar::from_json(
        r#"[
            {"name":"sid","value":"abc","domain":".example.com","path":"/","expirationDate":1900000000.5,"httpOnly":true,"secure":true,"sameSite":"no_restriction"},
            {"name":"pref","value":"dark","domain":"example.com","expires":-1,"sameSite":"unspecified"},
            {"name":"ms","value":"1","url":"https://app.example.com/x","expires":1900000000000}
        ]"#,
        None,
    )
    .unwrap();
    assert_eq!(cookies.len(), 3);
    assert_eq!(cookies[0].expires, Some(1_900_000_000.5));
    assert_eq!(cookies[0].same_site, Some(SameSite::None));
    assert!(cookies[0].http_only && cookies[0].secure);
    assert_eq!(cookies[1].expires, None);
    assert_eq!(cookies[1].same_site, None);
    assert_eq!(cookies[2].domain, "app.example.com");
    assert_eq!(cookies[2].expires, Some(1_900_000_000.0));
    assert!(jar::from_json(r#"[{"value":"x","domain":"a.com"}]"#, None).is_err());
    assert!(jar::from_json(r#"[{"name":"x"}]"#, None).is_err());
    assert_eq!(
        jar::from_json(r#"{"cookies":[{"name":"x","domain":"a.com"}]}"#, None)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        jar::from_json(r#"[{"name":"x"}]"#, Some("fallback.com")).unwrap()[0].domain,
        "fallback.com"
    );
}

#[test]
fn netscape_and_header_formats() {
    let text = "# Netscape HTTP Cookie File\n\n.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc\n#HttpOnly_www.example.com\tFALSE\t/app\tFALSE\t0\ttoken\txyz\n";
    assert_eq!(Format::detect(text), Format::Netscape);
    let cookies = jar::from_netscape(text, None).unwrap();
    assert_eq!(cookies.len(), 2);
    assert!(cookies[0].secure && cookies[0].host_only == Some(false));
    assert!(cookies[1].http_only && cookies[1].expires.is_none() && cookies[1].path == "/app");
    assert_eq!(cookies[1].host_only, Some(true));

    assert_eq!(Format::detect("a=b; c=d"), Format::Header);
    assert_eq!(Format::detect(" [ {} ]"), Format::Json);
    let cookies = jar::from_header("Cookie: a=b; c=\"d\" ;e=", Some("x.com")).unwrap();
    let pairs: Vec<(&str, &str)> = cookies
        .iter()
        .map(|c| (c.name.as_str(), c.value.as_str()))
        .collect();
    assert_eq!(pairs, vec![("a", "b"), ("c", "d"), ("e", "")]);
    assert!(jar::from_header("a=b", None).is_err());
    assert!(jar::from_header("novalue", Some("x.com")).is_err());
}

fn cookie(name: &str, domain: &str, path: &str) -> jar::Cookie {
    jar::Cookie {
        name: name.into(),
        value: "v".into(),
        domain: domain.into(),
        path: path.into(),
        expires: None,
        http_only: false,
        secure: false,
        same_site: None,
        host_only: None,
    }
}

#[test]
fn header_selection_matches_browser_rules() {
    let mut secure = cookie("secure", ".example.com", "/");
    secure.secure = true;
    let mut expired = cookie("expired", ".example.com", "/");
    expired.expires = Some(1.0);
    let cookies = vec![
        cookie("root", ".example.com", "/"),
        cookie("hostonly", "example.com", "/"),
        cookie("deep", ".example.com", "/app/inner"),
        cookie("app", ".example.com", "/app"),
        cookie("other", ".other.com", "/"),
        cookie("sibling", ".sub.example.com", "/"),
        secure,
        expired,
    ];
    let names = |host: &str, path: &str, https: bool| -> Vec<String> {
        let target = Target {
            host: host.into(),
            path: path.into(),
            secure: https,
        };
        jar::select(&cookies, &target, 1_800_000_000.0)
            .iter()
            .map(|c| c.name.clone())
            .collect()
    };
    assert_eq!(
        names("example.com", "/", true),
        vec!["root", "hostonly", "secure"]
    );
    assert_eq!(names("example.com", "/", false), vec!["root", "hostonly"]);
    assert_eq!(
        names("www.example.com", "/app/inner/x", true),
        vec!["deep", "app", "root", "secure"]
    );
    assert_eq!(
        names("www.example.com", "/application", true),
        vec!["root", "secure"]
    );
    assert_eq!(
        names("a.sub.example.com", "/", true),
        vec!["root", "sibling", "secure"]
    );

    let t = jar::parse_target("https://Www.Example.com:8443/a/b?q=1#f", false, None).unwrap();
    assert_eq!(
        (t.host.as_str(), t.path.as_str(), t.secure),
        ("www.example.com", "/a/b", true)
    );
    let t = jar::parse_target("example.com/x", true, None).unwrap();
    assert_eq!(
        (t.host.as_str(), t.path.as_str(), t.secure),
        ("example.com", "/x", false)
    );
    assert!(jar::parse_target("ftp://example.com", false, None).is_err());
}

#[test]
fn check_reports_security_problems() {
    let now = 1_800_000_000.0;
    let codes = |c: &jar::Cookie| -> Vec<&'static str> {
        jar::check_cookie(c, now).iter().map(|i| i.code).collect()
    };

    let mut good = cookie("sid", "example.com", "/");
    good.secure = true;
    good.http_only = true;
    good.same_site = Some(SameSite::Lax);
    assert!(codes(&good).is_empty());

    let mut bad = cookie("sid", "example.com", "/");
    bad.expires = Some(now - 5.0);
    bad.same_site = Some(SameSite::None);
    assert_eq!(
        codes(&bad),
        vec![
            "expired",
            "samesite-none-insecure",
            "not-secure",
            "not-httponly"
        ]
    );

    let mut soon = good;
    soon.expires = Some(now + 60.0);
    assert_eq!(codes(&soon), vec!["expires-soon"]);

    let mut host = cookie("__Host-id", ".example.com", "/app");
    host.http_only = true;
    host.secure = false;
    let issues = jar::check_cookie(&host, now);
    assert_eq!(
        issues
            .iter()
            .filter(|i| i.code == "prefix-host" && i.level == Level::Error)
            .count(),
        3
    );
    let mut secure_prefix = cookie("__secure-x", "example.com", "/");
    secure_prefix.http_only = true;
    assert!(codes(&secure_prefix).contains(&"prefix-secure"));
}

#[test]
fn cookie_cli_round_trip() {
    let dir = TempDir::new("cookiecli");
    dir.write(
        "export.json",
        r#"[{"name":"sid","value":"top-secret","domain":".example.com","path":"/","expires":1900000000,"httpOnly":true,"secure":true,"sameSite":"Lax"},
            {"name":"theme","value":"dark","domain":"example.com","path":"/","expires":-1},
            {"name":"keep","value":"x","domain":".other.org","path":"/"}]"#,
    );
    let (code, out, err) = run_cookie(
        &dir,
        &[
            "import",
            "export.json",
            "--name",
            "site",
            "--domain",
            "example.com",
            "--dir",
            "jars",
        ],
    );
    assert_eq!((code, err.as_str()), (0, ""), "{out}");
    assert!(
        out.starts_with("imported 2 cookies into jar site (2 total)"),
        "{out}"
    );
    assert!(!out.contains("top-secret"));

    let jar_file = dir.path().join("jars").join("site.json");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&jar_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(dir.path().join("jars"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    let saved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&jar_file).unwrap()).unwrap();
    assert_eq!(saved.as_array().unwrap().len(), 2);
    assert_eq!(saved[0]["expires"], 1_900_000_000);
    assert_eq!(saved[1]["expires"], -1);

    let (_, out, _) = run_cookie(&dir, &["list", "--name", "site", "--dir", "jars"]);
    assert!(
        !out.contains("top-secret") && out.contains("********"),
        "{out}"
    );
    assert!(out.contains("2030-03-17T17:46:40Z"), "{out}");
    let (_, out, _) = run_cookie(
        &dir,
        &[
            "list", "--name", "site", "--dir", "jars", "--reveal", "--json",
        ],
    );
    assert!(out.contains("top-secret"), "{out}");

    let (code, out, _) = run_cookie(
        &dir,
        &[
            "header",
            "https://www.example.com/home",
            "--name",
            "site",
            "--dir",
            "jars",
        ],
    );
    assert_eq!((code, out.as_str()), (0, "Cookie: sid=********\n"));
    let (_, out, _) = run_cookie(
        &dir,
        &[
            "header",
            "example.com",
            "--name",
            "site",
            "--dir",
            "jars",
            "--reveal",
        ],
    );
    assert_eq!(out, "Cookie: sid=top-secret; theme=dark\n");
    let (_, out, _) = run_cookie(
        &dir,
        &[
            "header",
            "example.com",
            "--insecure",
            "--name",
            "site",
            "--dir",
            "jars",
            "--reveal",
            "--value-only",
        ],
    );
    assert_eq!(out, "theme=dark\n");
    let (code, _, err) = run_cookie(
        &dir,
        &["header", "nope.org", "--name", "site", "--dir", "jars"],
    );
    assert_eq!(code, 1);
    assert!(err.contains("no cookie in jar site applies"), "{err}");

    let (_, out, _) = run_cookie(
        &dir,
        &["get", "sid", "--name", "site", "--dir", "jars", "--reveal"],
    );
    assert_eq!(out, "top-secret\n");

    let (code, _, err) = run_cookie(
        &dir,
        &["import", "a=1; b=2", "--name", "site", "--dir", "jars"],
    );
    assert_eq!(code, 1);
    assert!(err.contains("--domain"), "{err}");
    let (code, out, _) = run_cookie(
        &dir,
        &[
            "import",
            "a=1; theme=light",
            "--domain",
            "example.com",
            "--name",
            "site",
            "--dir",
            "jars",
        ],
    );
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("(3 total)"), "{out}");
    let (_, out, _) = run_cookie(
        &dir,
        &[
            "get", "theme", "--name", "site", "--dir", "jars", "--reveal", "--all",
        ],
    );
    assert_eq!(out, "light\n");

    let (code, out, _) = run_cookie(&dir, &["check", "--name", "site", "--dir", "jars"]);
    assert_eq!(code, 0);
    assert!(
        out.contains("warning") && out.contains("3 cookies: 0 errors"),
        "{out}"
    );
    let (code, _, _) = run_cookie(
        &dir,
        &["check", "--name", "site", "--dir", "jars", "--strict"],
    );
    assert_eq!(code, 1);

    let (code, out, _) = run_cookie(
        &dir,
        &[
            "rm",
            "theme",
            "--name",
            "site",
            "--dir",
            "jars",
            "--domain",
            "example.com",
        ],
    );
    assert_eq!(code, 0, "{out}");
    assert!(
        out.contains("removed 1 cookies from jar site (2 left)"),
        "{out}"
    );
    let (_, out, _) = run_cookie(&dir, &["jars", "--dir", "jars"]);
    assert_eq!(out, "site  (2 cookies)\n");
    let (code, _, _) = run_cookie(&dir, &["rm", "--all", "--name", "site", "--dir", "jars"]);
    assert_eq!(code, 0);
    assert!(!jar_file.exists());
}

#[test]
fn cookie_cli_defaults_to_the_aphrody_home() {
    let dir = TempDir::new("cookiehome");
    let (code, out, err) = run_cookie(&dir, &["import", "a=1", "--domain", "example.com"]);
    assert_eq!((code, err.as_str()), (0, ""), "{out}");
    assert!(
        dir.path()
            .join(".aphrody")
            .join("cookies")
            .join("default.json")
            .is_file()
    );
}

#[test]
fn cookie_cli_rejects_bad_input() {
    let dir = TempDir::new("cookiebad");
    assert_eq!(run_cookie(&dir, &["bogus"]).0, 2);
    assert_eq!(run_cookie(&dir, &["import"]).0, 2);
    assert_eq!(run_cookie(&dir, &["list", "--name", "../x"]).0, 2);
    assert_eq!(run_cookie(&dir, &["list", "--name", "missing"]).0, 1);
    assert_eq!(
        run_cookie(&dir, &["import", "x=1", "--format", "yaml"]).0,
        2
    );
    dir.write("broken.json", "{");
    assert_eq!(
        run_cookie(&dir, &["import", "broken.json", "--dir", "j"]).0,
        1
    );
    assert_eq!(run_cookie(&dir, &["--help"]).0, 0);
}
