// SPDX-License-Identifier: Apache-2.0
use aphrody_proc::NoWindow as _;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use thiserror::Error;

use crate::manifest::PeerDef;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerId {
    Claude,
    Codex,
    Grok,
    Agy,
    Bxc,
}

impl PeerId {
    #[must_use]
    pub const fn short(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Agy => "agy",
            Self::Bxc => "bxc",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "grok" | "grok-build" => Some(Self::Grok),
            "agy" | "agycli" | "gemini" | "antigravity" => Some(Self::Agy),
            "bxc" => Some(Self::Bxc),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PeerInvokeResult {
    pub peer: PeerId,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Error)]
pub enum PeerError {
    #[error("unknown peer: {0}")]
    UnknownPeer(String),
    #[error("invalid agent domain/profile: {0}")]
    InvalidDomain(String),
    #[error("binary not found: {0}")]
    BinaryNotFound(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("shared branch mismatch: expected {expected}, observed {observed}")]
    BranchMismatch { expected: String, observed: String },
    #[error("utf8")]
    Utf8(#[from] std::string::FromUtf8Error),
}

/// A domain profile is selected explicitly; native credential/session roots stay untouched.
#[derive(Debug, Clone)]
struct DomainContext {
    name: String,
    workspace: PathBuf,
}

impl DomainContext {
    fn from_env(repo: &Path) -> Result<Option<Self>, PeerError> {
        let configured = repo.join("tools/config/ai/agent-domains.json");
        let fallback = if configured.is_file() {
            let value: serde_json::Value = serde_json::from_slice(&std::fs::read(configured)?)
                .map_err(|error| PeerError::InvalidDomain(error.to_string()))?;
            Some(
                value
                    .get("defaultDomain")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| PeerError::InvalidDomain("defaultDomain missing".into()))?
                    .to_owned(),
            )
        } else {
            None
        };
        let Some(name) = std::env::var("APHRODY_AGENT_DOMAIN")
            .ok()
            .filter(|name| !name.is_empty())
            .or(fallback)
        else {
            return Ok(None);
        };
        let state = std::env::var_os("APHRODY_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(|home| PathBuf::from(home).join(".aphrody"))
            })
            .ok_or_else(|| PeerError::InvalidDomain("state root unavailable".into()))?;
        let canonical = state.join("workspaces").join(&name);
        let workspace = std::env::var_os("APHRODY_WORKSPACE")
            .map(PathBuf::from)
            .unwrap_or_else(|| canonical.clone());
        Self::validated(name, workspace, canonical).map(Some)
    }

    fn validated(name: String, workspace: PathBuf, canonical: PathBuf) -> Result<Self, PeerError> {
        if !matches!(name.as_str(), "aphrody" | "ie") {
            return Err(PeerError::InvalidDomain(name));
        }
        if workspace.canonicalize()? != canonical.canonicalize()?
            || !workspace.join("AGENTS.md").is_file()
        {
            return Err(PeerError::InvalidDomain(
                "workspace must match the selected domain profile".into(),
            ));
        }
        Ok(Self { name, workspace })
    }
}

#[derive(Debug, Clone)]
pub struct PeerInvoker {
    pub cwd: PathBuf,
    pub max_turns: u32,
    pub dry_run: bool,
}

impl PeerInvoker {
    #[must_use]
    pub fn new(cwd: impl AsRef<Path>) -> Self {
        Self {
            cwd: cwd.as_ref().to_path_buf(),
            max_turns: 40,
            dry_run: false,
        }
    }

    #[must_use]
    pub fn with_dry_run(mut self, dry_run: bool) -> Self {
        self.dry_run = dry_run;
        self
    }

    #[must_use]
    pub fn with_max_turns(mut self, max_turns: u32) -> Self {
        self.max_turns = max_turns;
        self
    }

    pub fn invoke_prompt(&self, peer: PeerId, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        self.verify_shared_branch()?;
        let domain = DomainContext::from_env(&self.cwd)?;
        let shared = self.shared_prompt(prompt, domain.as_ref());
        let prompt = shared.as_str();
        if self.dry_run {
            return Ok(PeerInvokeResult {
                peer,
                exit_code: Some(0),
                stdout: format!(
                    "[dry-run] would invoke {} with prompt len {}",
                    peer.short(),
                    prompt.len()
                ),
                stderr: String::new(),
            });
        }
        match peer {
            PeerId::Grok => self.invoke_grok(prompt),
            PeerId::Agy => self.invoke_agy(prompt),
            PeerId::Claude => self.invoke_claude(prompt),
            PeerId::Codex => self.invoke_codex(prompt),
            PeerId::Bxc => self.invoke_bxc(prompt),
        }
    }

    fn verify_shared_branch(&self) -> Result<(), PeerError> {
        let marker = self.cwd.join(".coord/shared/branch");
        if !marker.exists() {
            return Ok(());
        }
        let expected = std::fs::read_to_string(marker)?.trim().to_owned();
        let output = Command::new("git")
            .no_window()
            .args(["branch", "--show-current"])
            .current_dir(&self.cwd)
            .output()?;
        let observed = String::from_utf8(output.stdout)?.trim().to_owned();
        if !output.status.success() || expected.is_empty() || observed != expected {
            return Err(PeerError::BranchMismatch { expected, observed });
        }
        Ok(())
    }

    fn shared_prompt(&self, task: &str, domain: Option<&DomainContext>) -> String {
        let mut context = String::new();
        let paths = if let Some(domain) = domain {
            vec![
                self.cwd.join("AGENTS.md"),
                domain.workspace.join("AGENTS.md"),
                domain.workspace.join("SOUL.md"),
                domain.workspace.join("MEMORY.md"),
                domain.workspace.join("TOOLS.md"),
                domain.workspace.join("CONVERSATIONS.md"),
                domain.workspace.join(".coord/shared/TRANSCRIPTS.md"),
            ]
        } else {
            [
                "AGENTS.md",
                ".coord/shared/MEMORY.md",
                ".coord/shared/CONVERSATIONS.md",
                ".coord/shared/TRANSCRIPTS.md",
                ".coord/shared/LIVE.md",
            ]
            .iter()
            .map(|path| self.cwd.join(path))
            .collect()
        };
        for path in paths {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let bounded: String = text.chars().take(16_384).collect();
                context.push_str(&format!(
                    "\nRepository/profile context ({}):\n{bounded}\n",
                    path.display()
                ));
            }
        }
        let marker = domain.map_or(String::new(), |domain| {
            format!("[APHRODY_AGENT_DOMAIN={}]\n", domain.name)
        });
        format!(
            "{marker}{task}\n\nShared repository context; follow the current task and repository rules:\n{context}"
        )
    }

    pub fn invoke_peer_def(
        &self,
        def: &PeerDef,
        prompt: &str,
    ) -> Result<PeerInvokeResult, PeerError> {
        if let Some(id) = def.id.split('@').next().and_then(PeerId::parse) {
            return self.invoke_prompt(id, prompt);
        }
        Err(PeerError::UnknownPeer(def.id.clone()))
    }

    fn resolve_bin(env_key: &str, default: &str) -> PathBuf {
        std::env::var_os(env_key)
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| which::which(default).ok())
            .unwrap_or_else(|| PathBuf::from(default))
    }

    fn invoke_grok(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("GROK_BIN", "grok");
        if !bin.is_file() && which::which("grok").is_err() {
            return Err(PeerError::BinaryNotFound(bin.display().to_string()));
        }
        let prompt_file =
            std::env::temp_dir().join(format!("aphrody-grok-{}.txt", std::process::id()));
        std::fs::write(&prompt_file, prompt)?;
        let mut cmd = Command::new(&bin).no_window();
        cmd.args([
            "--prompt-file",
            prompt_file.to_str().unwrap_or("prompt.txt"),
            "--always-approve",
            "--permission-mode",
            "bypassPermissions",
            "--max-turns",
            &self.max_turns.to_string(),
            "--cwd",
        ]);
        cmd.arg(&self.cwd);
        cmd.args(["--output-format", "json"]);
        // Do NOT pass --effort or --reasoning-effort (grok-build HTTP 400).
        self.run(PeerId::Grok, cmd)
    }

    fn invoke_agy(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("APHRODY_AGY_BIN", "agy");
        let mut cmd = Command::new(&bin).no_window();
        cmd.args([
            "-p",
            prompt,
            "--dangerously-skip-permissions",
            "--print-timeout",
            "10m",
            "--add-dir",
        ]);
        cmd.arg(&self.cwd);
        self.run(PeerId::Agy, cmd)
    }

    fn invoke_claude(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("CLAUDE_BIN", "claude");
        let mut cmd = Command::new(&bin).no_window();
        cmd.args([
            "-p",
            prompt,
            "--dangerously-skip-permissions",
            "--output-format",
            "text",
        ]);
        cmd.current_dir(&self.cwd);
        self.run(PeerId::Claude, cmd)
    }

    fn invoke_codex(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("CODEX_BIN", "codex");
        let mut cmd = Command::new(&bin).no_window();
        cmd.args([
            "exec",
            "--dangerously-bypass-approvals-and-sandbox",
            "--json",
            "-C",
        ]);
        cmd.arg(&self.cwd);
        cmd.arg(prompt);
        self.run(PeerId::Codex, cmd)
    }

    /// The `bxc` peer is the web-search surface of the single `aphrody` binary (`bxc` is only a
    /// name of it): it runs `aphrody web search`, never a separate executable.
    fn invoke_bxc(&self, prompt: &str) -> Result<PeerInvokeResult, PeerError> {
        let bin = Self::resolve_bin("APHRODY_BIN", "aphrody");
        let mut cmd = Command::new(&bin).no_window();
        cmd.args(["web", "search", prompt, "--num", "3", "--json"]);
        cmd.current_dir(&self.cwd);
        self.run(PeerId::Bxc, cmd)
    }

    fn run(&self, peer: PeerId, mut cmd: Command) -> Result<PeerInvokeResult, PeerError> {
        cmd.current_dir(&self.cwd);
        let domain = DomainContext::from_env(&self.cwd)?;
        if let Some(domain) = &domain {
            cmd.env("APHRODY_AGENT_DOMAIN", &domain.name);
            cmd.env("APHRODY_WORKSPACE", &domain.workspace);
            cmd.env("APHRODY_PROFILE", &domain.name);
        }
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let run_id = format!(
            "{}-{}-{}",
            chrono::Utc::now().timestamp_micros(),
            crate::envelope::new_id("run"),
            std::process::id()
        );
        cmd.env("APHRODY_RUN_ID", &run_id);
        let mut child = cmd.spawn()?;
        let mut trace = match crate::run_trace::RunTrace::start(
            &self.cwd,
            peer.short(),
            child.id(),
            run_id,
            domain.as_ref().map(|domain| domain.name.as_str()),
            domain.as_ref().map(|domain| domain.workspace.as_path()),
        ) {
            Ok(trace) => trace,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        tracing::debug!(run_id = %trace.id, peer = peer.short(), "peer launched");
        let out = child.wait_with_output()?;
        trace.finish(
            &self.cwd,
            out.status.code(),
            &String::from_utf8_lossy(&out.stdout),
        )?;
        Ok(PeerInvokeResult {
            peer,
            exit_code: out.status.code(),
            stdout: String::from_utf8(out.stdout)?,
            stderr: String::from_utf8(out.stderr)?,
        })
    }
}

#[cfg(test)]
mod coordination_tests {
    use super::*;
    #[test]
    fn branch_guard_rejects_switched_checkout_before_launch() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            Command::new("git")
                .args(["init", "--quiet", "-b", "main"])
                .arg(dir.path())
                .status()
                .unwrap()
                .success()
        );
        std::fs::create_dir_all(dir.path().join(".coord/shared")).unwrap();
        std::fs::write(dir.path().join(".coord/shared/branch"), "main\n").unwrap();
        let invoker = PeerInvoker::new(dir.path()).with_dry_run(true);
        assert!(invoker.invoke_prompt(PeerId::Codex, "task").is_ok());
        assert!(
            Command::new("git")
                .args(["symbolic-ref", "HEAD", "refs/heads/other"])
                .current_dir(dir.path())
                .status()
                .unwrap()
                .success()
        );
        assert!(matches!(
            invoker.invoke_prompt(PeerId::Codex, "task"),
            Err(PeerError::BranchMismatch { .. })
        ));
    }

    #[test]
    fn common_coding_peers_are_routable() {
        assert_eq!(PeerId::parse("codex"), Some(PeerId::Codex));
        assert_eq!(PeerId::parse("agycli"), Some(PeerId::Agy));
        let directory = tempfile::tempdir().unwrap();
        let invoker = PeerInvoker::new(directory.path()).with_dry_run(true);
        for peer in [PeerId::Claude, PeerId::Codex, PeerId::Agy] {
            assert_eq!(
                invoker
                    .invoke_prompt(peer, "shared task")
                    .unwrap()
                    .exit_code,
                Some(0)
            );
        }
    }
}

#[cfg(test)]
mod domain_tests {
    use super::*;
    #[test]
    fn selected_domain_excludes_shared_and_other_domain_context() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let profile = root.path().join("ie");
        std::fs::create_dir_all(repo.join(".coord/shared")).unwrap();
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::write(repo.join("AGENTS.md"), "repository rules").unwrap();
        std::fs::write(
            repo.join(".coord/shared/MEMORY.md"),
            "aphrody private memory",
        )
        .unwrap();
        std::fs::write(profile.join("AGENTS.md"), "ie rules").unwrap();
        std::fs::write(profile.join("MEMORY.md"), "ie private memory").unwrap();
        let context =
            DomainContext::validated("ie".into(), profile.clone(), profile.clone()).unwrap();
        let prompt = PeerInvoker::new(&repo).shared_prompt("task", Some(&context));
        assert!(prompt.starts_with("[APHRODY_AGENT_DOMAIN=ie]"));
        assert!(prompt.starts_with("[APHRODY_AGENT_DOMAIN=ie]\ntask\n"));
        assert!(prompt.find("task").unwrap() < prompt.find("repository rules").unwrap());
        assert!(prompt.contains("repository rules") && prompt.contains("ie rules"));
        assert!(prompt.contains("ie private memory"));
        assert!(!prompt.contains("aphrody private memory"));
        assert!(DomainContext::validated("ie".into(), repo, profile).is_err());
    }
}
