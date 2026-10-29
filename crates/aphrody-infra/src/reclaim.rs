//! Allowlisted disk reclamation on a remote target (`infra/config/disk-reclaim.json`).

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub targets: BTreeMap<String, Target>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub ssh_alias: String,
    pub paths: Vec<Entry>,
    pub tmp: Option<Tmp>,
    pub system: Option<System>,
}

/// Root-level reclamation run through `sudo -n`. Steps are fixed commands; only absolute
/// paths are data, validated by [`check_system_path`].
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct System {
    /// `docker image prune -af --filter until=168h` + `docker builder prune -af --filter
    /// until=168h`: images and build cache older than 7 days, so concurrent builds keep their
    /// layers; images referenced by any container (running or stopped) are kept.
    /// Containers and volumes are never pruned, so a stopped service keeps its image.
    #[serde(default)]
    pub docker: bool,
    /// `journalctl --vacuum-size=<size>`.
    pub journal_max_size: Option<String>,
    /// `apt-get clean` and `apt-get autoremove --purge`.
    #[serde(default)]
    pub apt: bool,
    /// Remove disabled snap revisions.
    #[serde(default)]
    pub snap: bool,
    /// Rotated logs under /var/log (`*.gz`, `*.[0-9]`, `*.old`).
    #[serde(default)]
    pub rotated_logs: bool,
    /// Core dumps (/var/crash, /var/lib/systemd/coredump).
    #[serde(default)]
    pub core_dumps: bool,
    /// Entries of /var/tmp older than this many days.
    pub var_tmp_older_than_days: Option<u32>,
    /// Absolute, rebuildable or discarded paths removed with `sudo rm -rf`.
    #[serde(default)]
    pub paths: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
pub struct Entry {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tmp {
    pub older_than_minutes: u32,
    pub keep_name_patterns: Vec<String>,
}

pub fn load(root: &Path) -> Result<Config> {
    let path = root.join("infra/config/disk-reclaim.json");
    let text = fs::read_to_string(&path).with_context(|| format!("lecture {}", path.display()))?;
    serde_json::from_str(&text).context("infra/config/disk-reclaim.json invalide")
}

fn safe_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '*' | '@'))
}

fn check_path(path: &str) -> Result<()> {
    if path.starts_with('/') || path.split('/').any(|part| part == ".." || part.is_empty()) {
        bail!("chemin refusé (absolu, vide ou '..'): {path}");
    }
    if !safe_token(path) || path.contains('*') {
        bail!("chemin refusé (caractères hors allowlist): {path}");
    }
    Ok(())
}

const PROTECTED: &[&str] = &[
    "/",
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/home",
    "/lib",
    "/lib64",
    "/opt",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
    "/var/lib",
    "/var/log",
    "/var/lib/docker",
    "/var/lib/postgresql",
];

/// Trees holding user data, configuration or live service state: nothing below them is removable.
const PROTECTED_TREES: &[&str] = &[
    "/boot",
    "/etc",
    "/home",
    "/root",
    "/var/lib/docker",
    "/var/lib/mysql",
    "/var/lib/postgresql",
];

fn check_system_path(path: &str) -> Result<()> {
    let Some(rest) = path.strip_prefix('/') else {
        bail!("chemin système refusé (relatif): {path}");
    };
    if rest
        .split('/')
        .any(|part| part == ".." || part == "." || part.is_empty())
    {
        bail!("chemin système refusé (vide ou '..'): {path}");
    }
    if !safe_token(path) || path.contains('*') {
        bail!("chemin système refusé (caractères hors allowlist): {path}");
    }
    if PROTECTED.contains(&path) || path.matches('/').count() < 2 {
        bail!("chemin système refusé (racine protégée): {path}");
    }
    if PROTECTED_TREES
        .iter()
        .any(|tree| path.starts_with(&format!("{tree}/")))
    {
        bail!("chemin système refusé (arbre de données ou de configuration): {path}");
    }
    Ok(())
}

/// Measure a step by the free-space delta of `/` (apply) or print its estimate (plan).
fn system_step(out: &mut String, label: &str, estimate: &str, command: &str, apply: bool) {
    if apply {
        out.push_str(&format!(
            "a=$(df -B1 --output=avail / | tail -1); {{ {command}; }} >/dev/null 2>&1 || true; b=$(df -B1 --output=avail / | tail -1); printf '%s\t%s\n' \"$((b > a ? b - a : 0))\" 'system:{label}'\n"
        ));
    } else {
        out.push_str(&format!(
            "printf '%s\t%s\n' \"$({{ {estimate}; }} 2>/dev/null || echo 0)\" 'system:{label}'\n"
        ));
    }
}

const SUM: &str = "awk '{s+=$1} END {print s+0}'";

fn system_script(system: &System, apply: bool, out: &mut String) -> Result<()> {
    const S: &str = "sudo -n";
    out.push_str(&format!(
        "{S} true || {{ echo 'sudo -n indisponible' >&2; exit 3; }}\n"
    ));
    if system.docker {
        let estimate = format!(
            "{S} docker system df --format '{{{{.Type}}}}|{{{{.Reclaimable}}}}' | awk -F'|' '$1==\"Images\" || $1==\"Build Cache\" {{v=$2; n=v+0; if (v ~ /GB/) n*=1e9; else if (v ~ /MB/) n*=1e6; else if (v ~ /kB/) n*=1e3; s+=n}} END {{printf \"%d\", s}}'"
        );
        let command = format!(
            "{S} docker image prune -af --filter until=168h; {S} docker builder prune -af --filter until=168h"
        );
        system_step(out, "docker", &estimate, &command, apply);
    }
    if let Some(size) = &system.journal_max_size {
        if size.is_empty() || !size.chars().all(|c| c.is_ascii_alphanumeric()) {
            bail!("journalMaxSize refusé: {size}");
        }
        let estimate = format!("{S} du -sb /var/log/journal | cut -f1");
        system_step(
            out,
            "journal",
            &estimate,
            &format!("{S} journalctl --vacuum-size={size}"),
            apply,
        );
    }
    if system.apt {
        let command = format!(
            "{S} apt-get clean; {S} env DEBIAN_FRONTEND=noninteractive apt-get autoremove --purge -y"
        );
        system_step(
            out,
            "apt",
            &format!("{S} du -sb /var/cache/apt | cut -f1"),
            &command,
            apply,
        );
    }
    if system.snap {
        let estimate = "snap list --all | awk '/disabled/{print \"/var/lib/snapd/snaps/\" $1 \"_\" $3 \".snap\"}' | xargs -r du -cb | tail -1 | cut -f1";
        let command = format!(
            "snap list --all | awk '/disabled/{{print $1, $3}}' | while read n r; do {S} snap remove \"$n\" --revision=\"$r\"; done"
        );
        system_step(out, "snap", estimate, &command, apply);
    }
    if system.rotated_logs {
        let logs = "/var/log -type f -regextype posix-extended -regex '.*[.](gz|[0-9]|old)$'";
        let estimate = format!("{S} find {logs} -printf '%s\\n' | {SUM}");
        system_step(
            out,
            "rotated-logs",
            &estimate,
            &format!("{S} find {logs} -delete"),
            apply,
        );
    }
    if system.core_dumps {
        let dirs = "/var/crash /var/lib/systemd/coredump -mindepth 1 -type f";
        let estimate = format!("{S} find {dirs} -printf '%s\\n' | {SUM}");
        system_step(
            out,
            "core-dumps",
            &estimate,
            &format!("{S} find {dirs} -delete"),
            apply,
        );
    }
    if let Some(days) = system.var_tmp_older_than_days {
        let filter = format!(
            "/var/tmp -mindepth 1 -maxdepth 1 -mtime +{days} ! -name 'systemd-private-*' ! -name 'cloud-init'"
        );
        let estimate = format!("{S} find {filter} -exec du -sb {{}} + | {SUM}");
        system_step(
            out,
            "var-tmp",
            &estimate,
            &format!("{S} find {filter} -exec rm -rf -- {{}} +"),
            apply,
        );
    }
    for entry in &system.paths {
        check_system_path(&entry.path)?;
        let p = &entry.path;
        out.push_str(&format!(
            "if {S} test -e '{p}'; then printf '%s\t%s\n' \"$({S} du -sb '{p}' 2>/dev/null | cut -f1)\" '{p}';"
        ));
        if apply {
            out.push_str(&format!(" {S} rm -rf -- '{p}';"));
        }
        out.push_str(" fi\n");
    }
    Ok(())
}

/// Build the POSIX shell script run on the target. Prints `<bytes>\t<label>` per entry.
pub fn script(target: &Target, apply: bool) -> Result<String> {
    let mut out = String::from("set -u\ncd \"$HOME\" || exit 1\n");
    for entry in &target.paths {
        check_path(&entry.path)?;
        let p = &entry.path;
        out.push_str(&format!(
            "if [ -e '{p}' ]; then printf '%s\t%s\n' \"$(du -sb '{p}' 2>/dev/null | cut -f1)\" '{p}';"
        ));
        if apply {
            out.push_str(&format!(" rm -rf -- '{p}';"));
        }
        out.push_str(" fi\n");
    }
    if let Some(tmp) = &target.tmp {
        let mut filter = format!(
            "-mindepth 1 -maxdepth 1 -user \"$(id -u)\" -mmin +{}",
            tmp.older_than_minutes
        );
        for pattern in &tmp.keep_name_patterns {
            if !safe_token(pattern) || pattern.contains('/') {
                bail!("motif /tmp refusé: {pattern}");
            }
            filter.push_str(&format!(" ! -name '{pattern}'"));
        }
        out.push_str(&format!(
            "printf '%s\t%s\n' \"$(find /tmp {filter} -exec du -sb {{}} + 2>/dev/null | awk '{{s+=$1}} END {{print s+0}}')\" '/tmp (tmpfs, RAM)'\n"
        ));
        if apply {
            out.push_str(&format!(
                "find /tmp {filter} -exec rm -rf -- {{}} + 2>/dev/null || true\n"
            ));
        }
    }
    if let Some(system) = &target.system {
        system_script(system, apply, &mut out)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(path: &str) -> Target {
        Target {
            ssh_alias: "t".into(),
            paths: vec![Entry {
                path: path.into(),
                reason: "r".into(),
            }],
            tmp: Some(Tmp {
                older_than_minutes: 60,
                keep_name_patterns: vec!["systemd-private-*".into()],
            }),
            system: None,
        }
    }

    #[test]
    fn plan_never_deletes() {
        let plan = script(&target("iecode/target"), false).unwrap();
        assert!(!plan.contains("rm -rf"), "{plan}");
        assert!(plan.contains("du -sb 'iecode/target'"));
    }

    #[test]
    fn apply_deletes_only_allowlisted_paths() {
        let apply = script(&target("iecode/target"), true).unwrap();
        assert!(apply.contains("rm -rf -- 'iecode/target'"));
        assert!(apply.contains("! -name 'systemd-private-*'"));
        assert!(apply.contains("-user \"$(id -u)\""));
    }

    #[test]
    fn rejects_dangerous_paths() {
        for bad in ["/etc", "../x", "a//b", "a/../b", "", "x;rm", "a b", "*"] {
            assert!(script(&target(bad), false).is_err(), "{bad}");
        }
    }

    #[test]
    fn system_uses_sudo_and_guards_roots() {
        let mut t = target("iecode/target");
        t.system = Some(System {
            docker: true,
            journal_max_size: Some("200M".into()),
            paths: vec![Entry {
                path: "/var/cache/old".into(),
                reason: "r".into(),
            }],
            ..System::default()
        });
        let plan = script(&t, false).unwrap();
        assert!(!plan.contains("prune -af"), "{plan}");
        assert!(!plan.contains("rm -rf -- '/var"), "{plan}");
        let apply = script(&t, true).unwrap();
        assert!(apply.contains("sudo -n docker image prune -af --filter until=168h"));
        assert!(apply.contains("sudo -n docker builder prune -af --filter until=168h"));
        assert!(plan.contains("$1==\"Build Cache\""), "{plan}");
        assert!(!apply.contains("system prune"));
        assert!(!apply.contains("--volumes"));
        assert!(apply.contains("sudo -n journalctl --vacuum-size=200M"));
        assert!(apply.contains("sudo -n rm -rf -- '/var/cache/old'"));
        for bad in [
            "/",
            "/var",
            "/etc",
            "/var/lib/docker",
            "/home/ubuntu/apps/aphrody/shared",
            "/home/ubuntu/apps/aphrody/shared/db",
            "/home/ubuntu",
            "/var/lib/postgresql/16",
            "/etc/aphrody",
            "rel/x",
            "/a/../b",
            "/x;y",
            "/var/*",
        ] {
            t.system.as_mut().unwrap().paths = vec![Entry {
                path: bad.into(),
                reason: "r".into(),
            }];
            assert!(script(&t, true).is_err(), "{bad}");
        }
    }

    #[test]
    fn repository_config_is_valid() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for target in load(&root).unwrap().targets.values() {
            script(target, true).unwrap();
        }
    }
}
