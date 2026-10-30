// SPDX-License-Identifier: Apache-2.0
use crate::wsl::{
    Artifact, Config, Error, Result, SourceState, Target, artifact, expected_artifacts, plan,
    sources,
};
use aphrody_proc::NoWindow as _;
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildReport {
    pub schema_version: u32,
    pub target: Target,
    pub state: String,
    pub started_unix_seconds: u64,
    pub elapsed_seconds: f64,
    pub sources: Vec<SourceState>,
    pub steps: Vec<crate::wsl::Step>,
    pub artifacts: Vec<Artifact>,
    pub error: Option<String>,
    pub log: PathBuf,
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn write_report(config: &Config, report: &BuildReport) -> Result<()> {
    let path = config
        .output_root
        .join(format!("{}-report.json", report.target.name()));
    let tmp = path.with_extension("json.new");
    fs::write(&tmp, serde_json::to_vec_pretty(report)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}
fn windows_path(path: &std::path::Path) -> Result<String> {
    let output = Command::new("wslpath")
        .no_window()
        .arg("-w")
        .arg(path)
        .output()?;
    if !output.status.success() {
        return Err(Error::Invalid("Windows path conversion failed".into()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
pub fn build(config: &Config, target: Target) -> Result<BuildReport> {
    config.validate()?;
    fs::create_dir_all(&config.output_root)?;
    let lock = config.output_root.join(format!(".{}.lock", target.name()));
    let mut handle = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|e| {
            Error::Invalid(format!(
                "{}: {e}; inspect an existing build lock before removing it",
                lock.display()
            ))
        })?;
    let _guard = Lock(lock);
    writeln!(handle, "{}", std::process::id())?;
    let source_states = sources(config)?;
    if source_states.iter().any(|s| !s.clean || !s.matches) {
        return Err(Error::Invalid(
            "source revisions must match pins and tracked checkouts must be clean".into(),
        ));
    }
    let mut steps = plan(config, target)?;
    if target == Target::Wsl {
        let replacements = [
            (
                "@WINDOWS_SCRIPT@",
                windows_path(&config.script("build-native-wsl.ps1"))?,
            ),
            (
                "@WINDOWS_SOURCE@",
                windows_path(&config.source_root.join("WSL"))?,
            ),
            (
                "@WINDOWS_OUTPUT@",
                windows_path(&config.output_root.join("wsl"))?,
            ),
        ];
        for arg in &mut steps[0].args {
            for (key, value) in &replacements {
                if arg == key {
                    *arg = value.clone();
                }
            }
        }
    }
    let mut report = BuildReport {
        schema_version: 1,
        target,
        state: "running".into(),
        started_unix_seconds: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        elapsed_seconds: 0.0,
        sources: source_states,
        steps,
        artifacts: vec![],
        error: None,
        log: config
            .output_root
            .join(format!("{}-build.log", target.name())),
    };
    write_report(config, &report)?;
    let started = Instant::now();
    let outcome = (|| -> Result<()> {
        let mut log = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&report.log)?;
        for step in &report.steps {
            eprintln!("Building {}: log {}", step.name, report.log.display());
            writeln!(log, "{} {:?}", step.program.display(), step.args)?;
            let mut command = Command::new(&step.program).no_window();
            command
                .args(&step.args)
                .current_dir(&step.cwd)
                .envs(&step.env)
                .stdin(Stdio::null())
                .stdout(log.try_clone()?)
                .stderr(log.try_clone()?);
            let mut child =
                aphrody_proc::spawn_group(&mut command, aphrody_proc::SpawnOptions::default())?;
            loop {
                if let Some(status) = child.try_wait()? {
                    if !status.success() {
                        return Err(Error::Invalid(format!(
                            "{} failed with {status}; see {}",
                            step.name,
                            report.log.display()
                        )));
                    }
                    break;
                }
                if started.elapsed() >= Duration::from_secs(config.timeout_seconds) {
                    child.kill_tree()?;
                    return Err(Error::Invalid(
                        "build timeout; child group terminated".into(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        for path in expected_artifacts(config, target) {
            report.artifacts.push(artifact(&path)?);
        }
        Ok(())
    })();
    report.elapsed_seconds = started.elapsed().as_secs_f64();
    report.state = if outcome.is_ok() {
        "complete"
    } else {
        "failed"
    }
    .into();
    report.error = outcome.as_ref().err().map(ToString::to_string);
    write_report(config, &report)?;
    outcome?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_sources_release_build_lock() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = Config::parse(
            include_bytes!("../../embedded/tools/aphrody/config/os/wsl-build.json"),
            &std::env::temp_dir().join("aphrody-workspace"),
        )
        .unwrap();
        c.source_root = dir.path().join("missing");
        c.output_root = dir.path().join("out");
        assert!(build(&c, Target::Kernel).is_err());
        assert!(!c.output_root.join(".kernel.lock").exists());
    }
}
