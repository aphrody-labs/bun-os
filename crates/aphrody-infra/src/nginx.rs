// SPDX-License-Identifier: Apache-2.0
//! AST-typed Nginx configuration model, validation, and zero-downtime hot-reload controller.
//!
//! Provides a programmatic AST for generating clean, syntax-validated Nginx virtual host
//! and upstream configurations (supporting both loopback TCP and Unix domain sockets),
//! with mirror validation (`nginx -t -c <candidate> -q`) and atomic SIGHUP worker reload.

use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt::Write as _, path::Path};

/// Target upstream definition: loopback TCP or zero-copy Unix domain socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "target")]
pub enum UpstreamTarget {
    /// TCP host:port, e.g. "127.0.0.1:3004".
    Tcp(String),
    /// Unix domain socket path, e.g. "/run/aphrody/app-api.sock".
    UnixSocket(String),
}

impl UpstreamTarget {
    #[must_use]
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if let Some(path) = trimmed.strip_prefix("unix:") {
            Self::UnixSocket(path.to_string())
        } else if trimmed.starts_with('/') {
            Self::UnixSocket(trimmed.to_string())
        } else {
            Self::Tcp(trimmed.to_string())
        }
    }

    #[must_use]
    pub fn to_nginx_target(&self) -> String {
        match self {
            Self::Tcp(addr) => addr.clone(),
            Self::UnixSocket(path) => format!("unix:{path}"),
        }
    }
}

/// Upstream block definition in Nginx.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpstreamBlock {
    pub name: String,
    #[serde(default)]
    pub targets: Vec<UpstreamTarget>,
    #[serde(default)]
    pub keepalive: Option<u32>,
}

impl UpstreamBlock {
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            targets: Vec::new(),
            keepalive: None,
        }
    }

    #[must_use]
    pub fn with_target(mut self, target: UpstreamTarget) -> Self {
        self.targets.push(target);
        self
    }

    #[must_use]
    pub fn with_keepalive(mut self, keepalive: u32) -> Self {
        self.keepalive = Some(keepalive);
        self
    }
}

/// Location block routing requests to an upstream, static assets, or fastcgi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocationBlock {
    pub path: String,
    #[serde(default)]
    pub proxy_pass: Option<String>,
    #[serde(default)]
    pub proxy_http_version: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub custom_directives: Vec<String>,
}

impl LocationBlock {
    #[must_use]
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            proxy_pass: None,
            proxy_http_version: Some("1.1".to_string()),
            headers: Vec::new(),
            custom_directives: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_proxy(mut self, upstream: &str) -> Self {
        let trimmed = upstream.trim();
        let pass = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else {
            format!("http://{trimmed}")
        };
        self.proxy_pass = Some(pass);
        self.headers.push(("Host".into(), "$host".into()));
        self.headers
            .push(("X-Real-IP".into(), "$remote_addr".into()));
        self.headers.push((
            "X-Forwarded-For".into(),
            "$proxy_add_x_forwarded_for".into(),
        ));
        self.headers
            .push(("X-Forwarded-Proto".into(), "$scheme".into()));
        self
    }
}

/// Virtual host server block in Nginx.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerBlock {
    #[serde(default)]
    pub server_names: Vec<String>,
    pub listen_ports: Vec<String>,
    #[serde(default)]
    pub ssl_certificate: Option<String>,
    #[serde(default)]
    pub ssl_certificate_key: Option<String>,
    #[serde(default)]
    pub locations: Vec<LocationBlock>,
    #[serde(default)]
    pub custom_directives: Vec<String>,
}

impl ServerBlock {
    #[must_use]
    pub fn new(server_name: impl Into<String>) -> Self {
        Self {
            server_names: vec![server_name.into()],
            listen_ports: vec!["80".to_string()],
            ssl_certificate: None,
            ssl_certificate_key: None,
            locations: Vec::new(),
            custom_directives: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_tls(mut self, cert_path: impl Into<String>, key_path: impl Into<String>) -> Self {
        self.listen_ports = vec!["443 ssl http2".to_string()];
        self.ssl_certificate = Some(cert_path.into());
        self.ssl_certificate_key = Some(key_path.into());
        self
    }

    #[must_use]
    pub fn with_location(mut self, location: LocationBlock) -> Self {
        self.locations.push(location);
        self
    }
}

/// Complete Nginx virtual host or site configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NginxConfig {
    #[serde(default)]
    pub upstreams: Vec<UpstreamBlock>,
    #[serde(default)]
    pub servers: Vec<ServerBlock>,
}

impl NginxConfig {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_upstream(mut self, upstream: UpstreamBlock) -> Self {
        self.upstreams.push(upstream);
        self
    }

    #[must_use]
    pub fn with_server(mut self, server: ServerBlock) -> Self {
        self.servers.push(server);
        self
    }

    /// Renders the configuration to standard Nginx syntax.
    #[must_use]
    pub fn render(&self) -> String {
        let mut out = String::new();

        // Render Upstreams
        for upstream in &self.upstreams {
            writeln!(out, "upstream {} {{", upstream.name).unwrap();
            for target in &upstream.targets {
                writeln!(out, "    server {};", target.to_nginx_target()).unwrap();
            }
            if let Some(keepalive) = upstream.keepalive {
                writeln!(out, "    keepalive {keepalive};").unwrap();
            }
            writeln!(out, "}}\n").unwrap();
        }

        // Render Servers
        for server in &self.servers {
            writeln!(out, "server {{").unwrap();
            for port in &server.listen_ports {
                writeln!(out, "    listen {port};").unwrap();
            }
            if !server.server_names.is_empty() {
                writeln!(out, "    server_name {};", server.server_names.join(" ")).unwrap();
            }
            if let Some(cert) = &server.ssl_certificate {
                writeln!(out, "    ssl_certificate {cert};").unwrap();
            }
            if let Some(key) = &server.ssl_certificate_key {
                writeln!(out, "    ssl_certificate_key {key};").unwrap();
            }
            for directive in &server.custom_directives {
                writeln!(out, "    {directive};").unwrap();
            }

            for loc in &server.locations {
                writeln!(out, "\n    location {} {{", loc.path).unwrap();
                if let Some(pass) = &loc.proxy_pass {
                    writeln!(out, "        proxy_pass {pass};").unwrap();
                }
                if let Some(version) = &loc.proxy_http_version {
                    writeln!(out, "        proxy_http_version {version};").unwrap();
                }
                for (h_name, h_val) in &loc.headers {
                    writeln!(out, "        proxy_set_header {h_name} {h_val};").unwrap();
                }
                for directive in &loc.custom_directives {
                    writeln!(out, "        {directive};").unwrap();
                }
                writeln!(out, "    }}").unwrap();
            }
            writeln!(out, "}}\n").unwrap();
        }

        out
    }

    /// Perform a syntax check on a candidate configuration file via `nginx -t -c <path> -q`.
    pub fn test_syntax(candidate_path: &Path) -> Result<(), String> {
        #[cfg(unix)]
        {
            let output = std::process::Command::new("nginx")
                .no_window()
                .arg("-t")
                .arg("-c")
                .arg(candidate_path)
                .arg("-q")
                .output()
                .map_err(|e| format!("failed to spawn nginx binary: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Nginx syntax check failed:\n{}", stderr.trim()))
            }
        }
        #[cfg(not(unix))]
        {
            let _ = candidate_path;
            Err("Nginx syntax validation is only supported on Unix".to_string())
        }
    }

    /// Perform zero-downtime hot-reload of Nginx workers by sending SIGHUP to the master process.
    pub fn reload_hot(pid_file: Option<&Path>) -> Result<(), String> {
        #[cfg(unix)]
        {
            let default_pid_path = Path::new("/run/nginx.pid");
            let path = pid_file.unwrap_or(default_pid_path);

            let raw_pid = std::fs::read_to_string(path).map_err(|e| {
                format!(
                    "failed to read Nginx master PID from {}: {e}",
                    path.display()
                )
            })?;

            let pid: i32 = raw_pid
                .trim()
                .parse()
                .map_err(|e| format!("invalid PID format in {}: {e}", path.display()))?;

            if pid <= 0 {
                return Err(format!(
                    "Nginx master PID must be positive in {}",
                    path.display()
                ));
            }
            let pid = rustix::process::Pid::from_raw(pid)
                .ok_or_else(|| "Nginx master PID must be positive".to_string())?;
            rustix::process::kill_process(pid, rustix::process::Signal::HUP).map_err(|error| {
                format!("failed to send SIGHUP to Nginx master PID {pid}: {error}")
            })
        }
        #[cfg(not(unix))]
        {
            let _ = pid_file;
            Err("Nginx hot-reload is only supported on Unix".to_string())
        }
    }
}

/// Root of the certbot layout the repository server files refer to.
const LETSENCRYPT: &str = "/etc/letsencrypt/";

/// RFC 7919 `ffdhe2048` group: public, standard parameters standing in for `ssl-dhparams.pem`.
const FFDHE2048_PEM: &str = "-----BEGIN DH PARAMETERS-----
MIIBCAKCAQEA//////////+t+FRYortKmq/cViAnPTzx2LnFg84tNpWp4TZBFGQz
+8yTnc4kmz75fS/jY2MMddj2gbICrsRhetPfHtXV/WVhJDP1H18GbtCFY2VVPe0a
87VXE15/V8k1mE8McODmi3fipona8+/och3xWKE2rec1MKzKT0g6eXq8CrGCsyT7
YdEIqUuyyOP7uWrat2DX9GgdT0Kj3jlN9K5W7edjcrsZCwenyO4KbXCeAvzhzffi
7MA0BM0oNC9hkXL+nOmFg/+OTxIy7vKBg8P+OxtMb61zO7X8vC7CIAXFjvGDfRaD
ssbzSibBsu/6iGtCOGEoXJf//////////wIBAg==
-----END DH PARAMETERS-----
";

/// A file a server configuration loads from `/etc/letsencrypt/`, relative to that root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsFixture {
    /// `ssl_certificate` or `ssl_trusted_certificate`.
    Certificate(String),
    /// `ssl_certificate_key`.
    Key(String),
    /// `ssl_dhparam`.
    DhParams(String),
    /// `include` (certbot's `options-ssl-nginx.conf`).
    Include(String),
}

/// Lists the `/etc/letsencrypt/` files named by `ssl_certificate`, `ssl_trusted_certificate`,
/// `ssl_certificate_key`, `ssl_dhparam` and `include`, ignoring comments, variables and any
/// path that is empty or climbs out of the root.
#[must_use]
pub fn letsencrypt_fixtures(conf: &str) -> Vec<TlsFixture> {
    let mut fixtures = Vec::new();
    for line in conf.lines() {
        let line = line.split('#').next().unwrap_or_default();
        for statement in line.split(';') {
            let mut words = statement.split_whitespace();
            let (Some(directive), Some(value), None) = (words.next(), words.next(), words.next())
            else {
                continue;
            };
            let value = value.trim_matches(['"', '\'']);
            let Some(relative) = value.strip_prefix(LETSENCRYPT) else {
                continue;
            };
            if relative.contains('$')
                || relative
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            {
                continue;
            }
            let fixture = match directive {
                "ssl_certificate" | "ssl_trusted_certificate" => {
                    TlsFixture::Certificate(relative.to_owned())
                }
                "ssl_certificate_key" => TlsFixture::Key(relative.to_owned()),
                "ssl_dhparam" => TlsFixture::DhParams(relative.to_owned()),
                "include" => TlsFixture::Include(relative.to_owned()),
                _ => continue,
            };
            if !fixtures.contains(&fixture) {
                fixtures.push(fixture);
            }
        }
    }
    fixtures
}

/// Throwaway stand-ins for `fixtures`, as `(path relative to /etc/letsencrypt, content)`: one
/// self-signed pair per directory (certificates and keys of a directory match; the name is the
/// directory, e.g. `aphrody.com`), the `ffdhe2048` group and comment-only includes. Test
/// material only: generated per check, never written to the host nor served.
pub fn letsencrypt_stand_ins(fixtures: &[TlsFixture]) -> Result<Vec<(String, String)>, String> {
    let mut pairs: BTreeMap<String, (String, String)> = BTreeMap::new();
    let mut files = Vec::with_capacity(fixtures.len());
    for fixture in fixtures {
        let (relative, content) = match fixture {
            TlsFixture::Certificate(relative) | TlsFixture::Key(relative) => {
                let directory = relative
                    .rsplit_once('/')
                    .map_or("", |(directory, _)| directory);
                if !pairs.contains_key(directory) {
                    let name = directory.rsplit('/').next().filter(|name| !name.is_empty());
                    let name = name.unwrap_or("localhost").to_owned();
                    let pair = rcgen::generate_simple_self_signed(vec![name])
                        .map_err(|error| format!("certificat de test : {error}"))?;
                    pairs.insert(
                        directory.to_owned(),
                        (pair.cert.pem(), pair.signing_key.serialize_pem()),
                    );
                }
                let (certificate, key) = &pairs[directory];
                let content = if matches!(fixture, TlsFixture::Key(_)) {
                    key
                } else {
                    certificate
                };
                (relative, content.clone())
            }
            TlsFixture::DhParams(relative) => (relative, FFDHE2048_PEM.to_owned()),
            TlsFixture::Include(relative) => (relative, "# syntax check only\n".to_owned()),
        };
        files.push((relative.clone(), content));
    }
    Ok(files)
}

/// `include` targets of `conf` below `/etc/nginx` (relative, or absolute under `/etc/nginx/`),
/// ignoring comments, globs, variables and paths that climb out.
#[must_use]
pub fn nginx_includes(conf: &str) -> Vec<String> {
    let mut includes = Vec::new();
    for line in conf.lines() {
        let line = line.split('#').next().unwrap_or_default();
        for statement in line.split(';') {
            let mut words = statement.split_whitespace();
            let (Some("include"), Some(value), None) = (words.next(), words.next(), words.next())
            else {
                continue;
            };
            let value = value.trim_matches(['"', '\'']);
            let relative = match value.strip_prefix("/etc/nginx/") {
                Some(relative) => relative,
                None if value.starts_with('/') => continue,
                None => value,
            };
            if relative.contains(['*', '?', '[', '$'])
                || relative
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            {
                continue;
            }
            if !includes.iter().any(|known| known == relative) {
                includes.push(relative.to_owned());
            }
        }
    }
    includes
}

/// Tar stream unpacked at `/` of the check container from `(path below /, content, mode)`;
/// directory entries come first for every new ancestor (depth 2 or more, `etc/nginx` excluded).
fn check_archive(files: &[(String, Vec<u8>, u32)]) -> std::io::Result<Vec<u8>> {
    let mut archive = tar::Builder::new(Vec::new());
    let mut entry = |path: &str, mode: u32, content: Option<&[u8]>| {
        let mut header = tar::Header::new_ustar();
        header.set_entry_type(if content.is_some() {
            tar::EntryType::Regular
        } else {
            tar::EntryType::Directory
        });
        header.set_mode(mode);
        header.set_uid(0);
        header.set_gid(0);
        header.set_size(content.map_or(0, |bytes| bytes.len() as u64));
        archive.append_data(&mut header, path, content.unwrap_or_default())
    };
    let mut directories = std::collections::BTreeSet::new();
    for (path, _, _) in files {
        let parts: Vec<&str> = path.split('/').collect();
        for depth in 2..parts.len() {
            let directory = parts[..depth].join("/");
            if directory != "etc/nginx" {
                directories.insert(directory);
            }
        }
    }
    for directory in &directories {
        entry(directory, 0o755, None)?;
    }
    for (path, content, mode) in files {
        entry(path, *mode, Some(content))?;
    }
    archive.into_inner()
}

/// Files of a check: the server file as `etc/nginx/conf.d/<name>.conf`, the includes found in
/// `nginx_root` (the repository mirror of `/etc/nginx`, followed recursively) as
/// `etc/nginx/<include>`, and the [`letsencrypt_stand_ins`] all of them need.
fn check_files(
    candidate: &Path,
    nginx_root: Option<&Path>,
) -> Result<Vec<(String, Vec<u8>, u32)>, String> {
    let read = |path: &Path| {
        std::fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))
    };
    let conf = read(candidate)?;
    let name = candidate
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{}: pas un fichier", candidate.display()))?;
    let name = if name.ends_with(".conf") {
        name
    } else {
        format!("{name}.conf")
    };
    let mut fixtures = letsencrypt_fixtures(&conf);
    let mut pending = nginx_includes(&conf);
    let mut files = vec![(format!("etc/nginx/conf.d/{name}"), conf.into_bytes(), 0o644)];
    let mut seen = std::collections::BTreeSet::new();
    while let Some(relative) = pending.pop() {
        let Some(path) = nginx_root.map(|root| root.join(&relative)) else {
            continue;
        };
        if !seen.insert(relative.clone()) || !path.is_file() {
            continue;
        }
        let text = read(&path)?;
        pending.extend(nginx_includes(&text));
        for fixture in letsencrypt_fixtures(&text) {
            if !fixtures.contains(&fixture) {
                fixtures.push(fixture);
            }
        }
        files.push((format!("etc/nginx/{relative}"), text.into_bytes(), 0o644));
    }
    for (relative, content) in letsencrypt_stand_ins(&fixtures)? {
        files.push((
            format!("etc/letsencrypt/{relative}"),
            content.into_bytes(),
            0o600,
        ));
    }
    Ok(files)
}

/// Checks a server file (`http`-context content, as installed in `conf.d`) with `nginx -t`
/// in a disposable `image` container, on any host with Docker and without a local nginx.
/// Nothing is bind-mounted (no Docker file sharing needed): the file, its includes found in
/// the parent of its directory (the repository mirror of `/etc/nginx`, e.g.
/// `infra/config/host/nginx/snippets/`) and the [`letsencrypt_stand_ins`] reach the container
/// as a tar stream on stdin. Returns the nginx report.
pub fn test_in_container(candidate: &Path, image: &str) -> Result<String, String> {
    use std::io::Write as _;
    let files = check_files(candidate, candidate.parent().and_then(Path::parent))?;
    let archive = check_archive(&files).map_err(|error| format!("archive : {error}"))?;
    let mut child = std::process::Command::new("docker")
        .no_window()
        .args(["run", "--rm", "-i", "--entrypoint", "sh", image])
        .args(["-c", "tar -xf - -C / && exec nginx -t"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("docker introuvable : {error}"))?;
    let mut stdin = child.stdin.take().ok_or("stdin de docker indisponible")?;
    let writer = std::thread::spawn(move || stdin.write_all(&archive));
    let output = child
        .wait_with_output()
        .map_err(|error| format!("docker : {error}"))?;
    let written = writer
        .join()
        .map_err(|_| "écriture de l'archive interrompue".to_owned())?;
    let report = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if output.status.success() {
        written.map_err(|error| format!("archive : {error}"))?;
        Ok(report)
    } else {
        Err(format!("nginx -t ({image}) :\n{report}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_upstream_targets() {
        assert_eq!(
            UpstreamTarget::parse("127.0.0.1:8800"),
            UpstreamTarget::Tcp("127.0.0.1:8800".to_string())
        );
        assert_eq!(
            UpstreamTarget::parse("unix:/run/aphrody/app-api.sock"),
            UpstreamTarget::UnixSocket("/run/aphrody/app-api.sock".to_string())
        );
        assert_eq!(
            UpstreamTarget::parse("/run/aphrody/app.sock"),
            UpstreamTarget::UnixSocket("/run/aphrody/app.sock".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn reload_hot_rejects_nonpositive_and_invalid_pids_before_signalling() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nginx.pid");
        for pid in ["0", "-1", "-123", "not-a-pid", "2147483648"] {
            std::fs::write(&path, pid).unwrap();
            assert!(NginxConfig::reload_hot(Some(&path)).is_err());
        }
    }

    #[test]
    fn render_virtual_host_with_unix_socket() {
        let config = NginxConfig::new()
            .with_upstream(
                UpstreamBlock::new("app_api_upstream")
                    .with_target(UpstreamTarget::UnixSocket(
                        "/run/aphrody/app-api.sock".to_string(),
                    ))
                    .with_keepalive(32),
            )
            .with_server(
                ServerBlock::new("api.example.org")
                    .with_tls(
                        "/etc/letsencrypt/live/api.example.org/fullchain.pem",
                        "/etc/letsencrypt/live/api.example.org/privkey.pem",
                    )
                    .with_location(LocationBlock::new("/").with_proxy("app_api_upstream")),
            );

        let rendered = config.render();
        assert!(rendered.contains("upstream app_api_upstream {"));
        assert!(rendered.contains("server unix:/run/aphrody/app-api.sock;"));
        assert!(rendered.contains("keepalive 32;"));
        assert!(rendered.contains("listen 443 ssl http2;"));
        assert!(rendered.contains("server_name api.example.org;"));
        assert!(rendered.contains("proxy_pass http://app_api_upstream;"));
        assert!(rendered.contains("proxy_set_header Host $host;"));
    }

    #[test]
    fn letsencrypt_fixtures_follow_the_server_file() {
        let conf = "server {\n    ssl_certificate /etc/letsencrypt/live/aphrody.com/fullchain.pem;\n    ssl_certificate_key \"/etc/letsencrypt/live/aphrody.com/privkey.pem\";\n    include /etc/letsencrypt/options-ssl-nginx.conf; ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;\n    # ssl_certificate /etc/letsencrypt/live/commented/fullchain.pem;\n    ssl_certificate /etc/letsencrypt/live/$ssl_server_name/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/../shadow;\n    include /etc/nginx/snippets/proxy.conf;\n    ssl_certificate /etc/letsencrypt/live/aphrody.com/fullchain.pem;\n}\n";
        assert_eq!(
            letsencrypt_fixtures(conf),
            [
                TlsFixture::Certificate("live/aphrody.com/fullchain.pem".into()),
                TlsFixture::Key("live/aphrody.com/privkey.pem".into()),
                TlsFixture::Include("options-ssl-nginx.conf".into()),
                TlsFixture::DhParams("ssl-dhparams.pem".into()),
            ]
        );
    }

    #[test]
    fn letsencrypt_stand_ins_pair_certificate_and_key() {
        use base64::Engine as _;
        let conf = "ssl_certificate /etc/letsencrypt/live/aphrody.com/fullchain.pem;\nssl_certificate_key /etc/letsencrypt/live/aphrody.com/privkey.pem;\nssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;\ninclude /etc/letsencrypt/options-ssl-nginx.conf;\n";
        let stand_ins = letsencrypt_stand_ins(&letsencrypt_fixtures(conf)).unwrap();
        let read = |relative: &str| {
            stand_ins
                .iter()
                .find(|(path, _)| path == relative)
                .unwrap()
                .1
                .clone()
        };
        let certificate = read("live/aphrody.com/fullchain.pem");
        let key = read("live/aphrody.com/privkey.pem");
        let decode = |pem: &str| {
            let body: String = pem
                .lines()
                .filter(|line| !line.starts_with("-----"))
                .collect();
            base64::engine::general_purpose::STANDARD
                .decode(body)
                .unwrap()
        };
        assert!(certificate.starts_with("-----BEGIN CERTIFICATE-----"));
        // The certificate embeds the key's SubjectPublicKeyInfo: nginx accepts the pair.
        let spki =
            rcgen::PublicKeyData::subject_public_key_info(&rcgen::KeyPair::from_pem(&key).unwrap());
        assert!(
            decode(&certificate)
                .windows(spki.len())
                .any(|window| window == spki)
        );
        assert_eq!(read("options-ssl-nginx.conf"), "# syntax check only\n");
        let der = decode(&read("ssl-dhparams.pem"));
        // SEQUENCE { INTEGER p (2048 bits), INTEGER g = 2 }
        assert_eq!(der.len(), 268);
        assert_eq!(&der[der.len() - 3..], [0x02, 0x01, 0x02]);
    }

    #[test]
    fn check_archive_ships_the_file_its_includes_and_stand_ins() {
        let root = tempfile::tempdir().unwrap();
        let write = |relative: &str, text: &str| {
            let path = root.path().join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        write(
            "aphrody/site",
            "server {\n  include snippets/a.inc;\n  include /etc/nginx/mime.types;\n  include /etc/nginx/snippets/*.inc;\n}\n",
        );
        write(
            "snippets/a.inc",
            "include snippets/b.inc;\nssl_certificate /etc/letsencrypt/live/x.org/fullchain.pem;\n",
        );
        write("snippets/b.inc", "proxy_set_header Host $host;\n");
        let candidate = root.path().join("aphrody/site");
        let files = check_files(&candidate, candidate.parent().and_then(Path::parent)).unwrap();
        let archive = check_archive(&files).unwrap();
        let mut entries = tar::Archive::new(archive.as_slice());
        let listed: Vec<(String, bool, u32)> = entries
            .entries()
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                let path = entry.path().unwrap().to_string_lossy().into_owned();
                let header = entry.header();
                (
                    path.trim_end_matches('/').to_owned(),
                    header.entry_type().is_dir(),
                    header.mode().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            listed,
            [
                ("etc/letsencrypt".to_owned(), true, 0o755),
                ("etc/letsencrypt/live".to_owned(), true, 0o755),
                ("etc/letsencrypt/live/x.org".to_owned(), true, 0o755),
                ("etc/nginx/conf.d".to_owned(), true, 0o755),
                ("etc/nginx/snippets".to_owned(), true, 0o755),
                ("etc/nginx/conf.d/site.conf".to_owned(), false, 0o644),
                ("etc/nginx/snippets/a.inc".to_owned(), false, 0o644),
                ("etc/nginx/snippets/b.inc".to_owned(), false, 0o644),
                (
                    "etc/letsencrypt/live/x.org/fullchain.pem".to_owned(),
                    false,
                    0o600
                ),
            ]
        );
    }

    /// Live check of the repository apex server file (`cargo test -- --ignored`, needs Docker).
    #[test]
    #[ignore = "needs Docker and the nginx:alpine image"]
    fn repository_apex_passes_nginx_in_a_container() {
        let apex = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../infra/config/host/nginx/aphrody/aphrody-apex.conf");
        let report = test_in_container(&apex, "nginx:alpine").unwrap();
        assert!(report.contains("test is successful"), "{report}");
        let broken = tempfile::tempdir().unwrap();
        let path = broken.path().join("broken.conf");
        std::fs::write(
            &path,
            "server { listen 80; location / { bogus_directive on; } }\n",
        )
        .unwrap();
        assert!(
            test_in_container(&path, "nginx:alpine")
                .unwrap_err()
                .contains("bogus_directive")
        );
    }

    #[test]
    fn json_with_omitted_fields_renders() {
        let config: NginxConfig = serde_json::from_str(
            r#"{
              "upstreams": [{ "name": "app", "targets": [{ "type": "Tcp", "target": "127.0.0.1:3000" }], "keepalive": 16 }],
              "servers": [{
                "listen_ports": ["127.0.0.1:8080"],
                "server_names": ["_"],
                "custom_directives": ["client_max_body_size 2m"],
                "locations": [
                  { "path": "/", "proxy_pass": "http://app", "proxy_http_version": "1.1",
                    "headers": [["Connection", "\"\""]], "custom_directives": ["proxy_read_timeout 30s"] },
                  { "path": "= /down", "custom_directives": ["return 503"] }
                ]
              }]
            }"#,
        )
        .unwrap();
        assert_eq!(
            config.render(),
            "upstream app {\n    server 127.0.0.1:3000;\n    keepalive 16;\n}\n\nserver {\n    listen 127.0.0.1:8080;\n    server_name _;\n    client_max_body_size 2m;\n\n    location / {\n        proxy_pass http://app;\n        proxy_http_version 1.1;\n        proxy_set_header Connection \"\";\n        proxy_read_timeout 30s;\n    }\n\n    location = /down {\n        return 503;\n    }\n}\n\n"
        );
    }
}
