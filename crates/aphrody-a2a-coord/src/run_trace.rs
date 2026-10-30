// SPDX-License-Identifier: Apache-2.0
//! Launcher evidence; observed Git heads are never commit authorship evidence.
use aphrody_proc::NoWindow as _;
use chrono::Utc;
use serde_json::{Value, json};
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) struct RunTrace {
    path: PathBuf,
    pub(crate) id: String,
    value: Value,
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .no_window()
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

impl RunTrace {
    pub(crate) fn start(
        root: &Path,
        agent: &str,
        pid: u32,
        id: String,
        domain: Option<&str>,
        profile: Option<&Path>,
    ) -> io::Result<Self> {
        let path = root.join(".coord/shared/runs").join(format!("{id}.json"));
        let trace = Self {
            path,
            id: id.clone(),
            value: json!({
                "schema_version": 1, "run_id": id, "agent": agent, "pid": pid,
                "launcher_pid": std::process::id(), "workspace": root,
                "agent_domain": domain,
                "agent_home_workspace": profile,
                "started_at": Utc::now().to_rfc3339(), "ended_at": null,
                "branch": git(root, &["branch", "--show-current"]),
                "head_at_start": git(root, &["rev-parse", "HEAD"]),
                "relation": "observed_launcher_child", "session_id": null,
            }),
        };
        trace.save()?;
        Ok(trace)
    }

    pub(crate) fn finish(
        &mut self,
        root: &Path,
        exit: Option<i32>,
        stdout: &str,
    ) -> io::Result<()> {
        self.value["ended_at"] = json!(Utc::now().to_rfc3339());
        self.value["exit_code"] = json!(exit);
        self.value["head_at_end"] = json!(git(root, &["rev-parse", "HEAD"]));
        // Codex emits its own ID in --json; do not infer it from cwd or mtime.
        if self.value["agent"] == "codex" {
            self.value["session_id"] = json!(codex_thread_id(stdout));
            self.value["session_relation"] = json!("native_thread_started_event");
        }
        self.save()
    }

    fn save(&self) -> io::Result<()> {
        fs::create_dir_all(self.path.parent().expect("run trace has parent"))?;
        let temporary = self.path.with_extension("tmp");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        use std::io::Write;
        file.write_all(&serde_json::to_vec(&self.value)?)?;
        file.sync_all()?;
        fs::rename(temporary, &self.path)
    }
}

fn codex_thread_id(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find_map(|event| {
            (event["type"] == "thread.started")
                .then(|| event["thread_id"].as_str().map(str::to_owned))
                .flatten()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captures_native_id_without_storing_output_or_claiming_commits() {
        let root = tempfile::tempdir().unwrap();
        let mut trace = RunTrace::start(
            root.path(),
            "codex",
            42,
            "run-fixture".into(),
            Some("ie"),
            Some(root.path()),
        )
        .unwrap();
        trace
            .finish(
                root.path(),
                Some(0),
                "{\"type\":\"thread.started\",\"thread_id\":\"native-123\"}\nsecret output",
            )
            .unwrap();
        let bytes = fs::read_to_string(trace.path).unwrap();
        let value: Value = serde_json::from_str(&bytes).unwrap();
        assert_eq!(value["session_id"], "native-123");
        assert_eq!(value["pid"], 42);
        assert_eq!(value["agent_domain"], "ie");
        assert!(!bytes.contains("secret output"));
        assert!(value.get("commits_authored").is_none());
        assert!(value["ended_at"].is_string());
    }
}
