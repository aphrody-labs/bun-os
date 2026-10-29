// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! `aphrody-discord-compiler` — Native Rust + Bun compiler and AST orchestrator for Aphrody Discord bots.
//!
//! Provides deterministic standalone binary compilation via `bun build --compile`,
//! Oxc-based AST syntax and decorator validation, reflection polyfill ordering,
//! and automated smoke testing without requiring external standalone scripts.

use aphrody_proc::NoWindow as _;
use std::{
    ffi::{CStr, CString, c_char},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};

use colored::Colorize;
use miette::{Context, IntoDiagnostic, Result, bail};
use serde::{Deserialize, Serialize};

/// Target Discord bot: a bot project directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BotTarget {
    Custom(PathBuf),
}

impl BotTarget {
    pub fn parse(s: &str) -> Option<Self> {
        let p = PathBuf::from(s);
        p.exists().then_some(Self::Custom(p))
    }

    pub fn id(&self) -> &str {
        "custom"
    }

    pub fn display_name(&self) -> &str {
        "Custom Discord Bot"
    }

    pub fn default_dir(&self, _root: &Path) -> PathBuf {
        match self {
            Self::Custom(p) => p.clone(),
        }
    }

    pub fn entrypoint(&self) -> &str {
        "src/entry-standalone.ts"
    }

    pub fn default_outfile(&self) -> &str {
        "dist/bot"
    }
}

/// Compilation options for `bun build --compile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilerOptions {
    pub minify: bool,
    pub sourcemap: bool,
    pub smoke_check: bool,
    pub target_triple: Option<String>,
}

impl Default for CompilerOptions {
    fn default() -> Self {
        Self {
            minify: true,
            sourcemap: true,
            smoke_check: true,
            target_triple: None,
        }
    }
}

/// Result of a standalone binary compilation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilationResult {
    pub bot_id: String,
    pub bot_name: String,
    pub binary_path: PathBuf,
    pub binary_size_bytes: u64,
    pub duration_ms: u128,
    pub smoke_passed: bool,
    pub smoke_output: String,
}

/// Bot inspection metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotInspection {
    pub bot_name: String,
    pub dir: PathBuf,
    pub package_json_exists: bool,
    pub tsconfig_json_exists: bool,
    pub has_standalone_entry: bool,
    pub uses_discord_kit: bool,
    pub commands_count: usize,
    pub oxc_diagnostics_errors: usize,
}

/// The Aphrody Discord Bot Compiler.
pub struct DiscordCompiler {
    root: PathBuf,
    bun_bin: PathBuf,
}

impl DiscordCompiler {
    /// Discover the repository root and resolve `bun` binary.
    pub fn new() -> Result<Self> {
        let root = Self::find_repo_root()?;
        let bun_bin = Self::resolve_bun_bin()?;
        Ok(Self { root, bun_bin })
    }

    fn find_repo_root() -> Result<PathBuf> {
        let mut cur = std::env::current_dir().into_diagnostic()?;
        loop {
            if cur.join("bun.lock").exists() && cur.join("Cargo.toml").exists() {
                return Ok(cur);
            }
            if !cur.pop() {
                break;
            }
        }
        // Fallback to current dir if not discovered
        std::env::current_dir().into_diagnostic()
    }

    fn resolve_bun_bin() -> Result<PathBuf> {
        if let Ok(path) = which::which("bun") {
            return Ok(path);
        }
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join(".bun/bin/bun");
            if p.exists() {
                return Ok(p);
            }
        }
        let system_bun = PathBuf::from("/usr/local/bin/bun");
        if system_bun.exists() {
            return Ok(system_bun);
        }
        bail!("Could not resolve `bun` executable in PATH or ~/.bun/bin/bun");
    }

    /// Inspect a bot's directory, checking configuration, decorators, and syntax with Oxc.
    pub fn inspect(&self, target: &BotTarget) -> Result<BotInspection> {
        let dir = target.default_dir(&self.root);
        let pkg_path = dir.join("package.json");
        let tsconfig_path = dir.join("tsconfig.json");
        let entry_path = dir.join(target.entrypoint());

        let pkg_exists = pkg_path.try_exists().into_diagnostic().wrap_err_with(|| {
            format!(
                "Failed to inspect Discord package file {}",
                pkg_path.display()
            )
        })?;
        let tsconfig_exists = tsconfig_path
            .try_exists()
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "Failed to inspect Discord TypeScript config {}",
                    tsconfig_path.display()
                )
            })?;
        let entry_exists = entry_path
            .try_exists()
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "Failed to inspect Discord bot entrypoint {}",
                    entry_path.display()
                )
            })?;

        let uses_discord_kit = if pkg_exists {
            let content = std::fs::read_to_string(&pkg_path)
                .into_diagnostic()
                .wrap_err_with(|| {
                    format!("Failed to read Discord package file {}", pkg_path.display())
                })?;
            content.contains("@aphrody/discord-kit")
        } else {
            false
        };

        let mut commands_count = 0;
        let mut oxc_errors = 0;
        let commands_dir = dir.join("src/commands");
        if commands_dir
            .try_exists()
            .into_diagnostic()
            .wrap_err_with(|| {
                format!(
                    "Failed to inspect Discord commands directory {}",
                    commands_dir.display()
                )
            })?
        {
            for entry in walkdir(&commands_dir)? {
                if entry.extension().and_then(|e| e.to_str()) != Some("ts") {
                    continue;
                }
                commands_count += 1;
                let source = std::fs::read_to_string(&entry)
                    .into_diagnostic()
                    .wrap_err_with(|| {
                        format!("Failed to read Discord command source {}", entry.display())
                    })?;
                let c_source = CString::new(source).into_diagnostic().wrap_err_with(|| {
                    format!(
                        "Discord command source contains a NUL byte: {}",
                        entry.display()
                    )
                })?;
                let filename = entry.to_str().ok_or_else(|| {
                    miette::miette!(
                        "Discord command path is not valid UTF-8: {}",
                        entry.display()
                    )
                })?;
                let c_filename = CString::new(filename).into_diagnostic().wrap_err_with(|| {
                    format!(
                        "Discord command path contains a NUL byte: {}",
                        entry.display()
                    )
                })?;

                // SAFETY: both C strings live through the call. The bridge returns an owned
                // C string, which `OxcLintResponse` releases on every success/error path.
                let response = unsafe {
                    aphrody_oxc_bridge::aphrody_oxc_lint(c_source.as_ptr(), c_filename.as_ptr())
                };
                oxc_errors += parse_oxc_lint_response(response, &entry)?.len();
            }
        }

        Ok(BotInspection {
            bot_name: target.display_name().to_string(),
            dir,
            package_json_exists: pkg_exists,
            tsconfig_json_exists: tsconfig_exists,
            has_standalone_entry: entry_exists,
            uses_discord_kit,
            commands_count,
            oxc_diagnostics_errors: oxc_errors,
        })
    }

    /// Compile a target bot into a standalone native binary via `bun build --compile`.
    pub fn compile(
        &self,
        target: &BotTarget,
        options: &CompilerOptions,
    ) -> Result<CompilationResult> {
        let dir = target.default_dir(&self.root);
        if !dir.exists() {
            bail!("Bot directory does not exist: {}", dir.display());
        }

        println!(
            "\n{}",
            "======================================================".cyan()
        );
        println!(
            "📦 {} {}",
            "Compiling standalone native binary for:".bold(),
            target.display_name().green()
        );
        println!("   Directory:  {}", dir.display());
        println!("   Entrypoint: {}", target.entrypoint());
        println!("   Output:     {}", target.default_outfile());
        println!(
            "{}",
            "======================================================".cyan()
        );

        let start = Instant::now();
        let outfile = target.default_outfile();
        let mut build_args = vec![
            "build".to_string(),
            target.entrypoint().to_string(),
            "--compile".to_string(),
        ];

        if options.minify {
            build_args.push("--minify".to_string());
        }
        if options.sourcemap {
            build_args.push("--sourcemap".to_string());
        }
        if let Some(target_triple) = &options.target_triple {
            build_args.push(format!("--target={target_triple}"));
        }
        build_args.push(format!("--outfile={outfile}"));

        println!(
            "  [bun] {} {}",
            self.bun_bin.display(),
            build_args.join(" ")
        );
        let status = Command::new(&self.bun_bin)
            .no_window()
            .args(&build_args)
            .current_dir(&dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .into_diagnostic()?;

        if !status.success() {
            bail!(
                "bun build --compile failed with exit code {:?}",
                status.code()
            );
        }

        let duration = start.elapsed();
        let binary_path = dir.join(outfile);
        if !binary_path.exists() {
            bail!(
                "Compiled binary was not created at {}",
                binary_path.display()
            );
        }

        let meta = std::fs::metadata(&binary_path).into_diagnostic()?;
        let size_bytes = meta.len();
        println!(
            "✓ {} in {:.2}s! (Size: {})",
            "Binary successfully compiled".green().bold(),
            duration.as_secs_f64(),
            format_bytes(size_bytes)
        );
        println!("  Path: {}", binary_path.display().to_string().cyan());

        // Smoke test
        let mut smoke_passed = false;
        let mut smoke_output = String::new();
        if options.smoke_check {
            println!("  [smoke] Testing standalone binary with --help...");
            let output = Command::new(&binary_path)
                .no_window()
                .arg("--help")
                .current_dir(&dir)
                .env("NODE_ENV", "production")
                .output()
                .into_diagnostic()?;

            smoke_output = String::from_utf8_lossy(&output.stdout).to_string();
            if smoke_output.is_empty() {
                smoke_output = String::from_utf8_lossy(&output.stderr).to_string();
            }
            smoke_output = validate_smoke_output(output.status.success(), smoke_output)?;
            smoke_passed = true;
            let sample = smoke_output.lines().next().unwrap_or("(clean boot)");
            println!("  [smoke sample]: {}", sample.dimmed());
            println!(
                "✓ {}",
                "Standalone binary smoke check passed cleanly".green()
            );
        }

        Ok(CompilationResult {
            bot_id: target.id().to_string(),
            bot_name: target.display_name().to_string(),
            binary_path,
            binary_size_bytes: size_bytes,
            duration_ms: duration.as_millis(),
            smoke_passed,
            smoke_output,
        })
    }

    /// Run full monorepo discord verification suite.
    pub fn verify_monorepo(&self) -> Result<()> {
        println!(
            "\n🔍 Running full Discord verification via `bun scripts/audit/discord-verify.ts --full --compile`...\n"
        );
        let status = Command::new(&self.bun_bin)
            .no_window()
            .args(["scripts/audit/discord-verify.ts", "--full", "--compile"])
            .current_dir(&self.root)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .into_diagnostic()?;

        if !status.success() {
            bail!(
                "Monorepo Discord verification failed with exit code {:?}",
                status.code()
            );
        }
        println!(
            "\n🎉 {}",
            "All Discord monorepo gates and native compilations verified successfully!"
                .green()
                .bold()
        );
        Ok(())
    }
}

fn walkdir(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let entries = std::fs::read_dir(dir).into_diagnostic().wrap_err_with(|| {
        format!(
            "Failed to read Discord commands directory {}",
            dir.display()
        )
    })?;
    for entry in entries {
        let entry = entry.into_diagnostic().wrap_err_with(|| {
            format!(
                "Failed to enumerate Discord commands directory {}",
                dir.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().into_diagnostic().wrap_err_with(|| {
            format!("Failed to inspect Discord command path {}", path.display())
        })?;
        if file_type.is_dir() {
            files.extend(walkdir(&path)?);
        } else {
            files.push(path);
        }
    }
    Ok(files)
}

struct OxcLintResponse(*mut c_char);

impl Drop for OxcLintResponse {
    fn drop(&mut self) {
        // SAFETY: the pointer is owned by aphrody_oxc_lint and released exactly once here.
        unsafe { aphrody_oxc_bridge::aphrody_oxc_free(self.0) };
    }
}

fn parse_oxc_lint_response(pointer: *mut c_char, filename: &Path) -> Result<Vec<String>> {
    if pointer.is_null() {
        bail!(
            "Oxc lint returned a null response for {}",
            filename.display()
        );
    }
    let _owned_response = OxcLintResponse(pointer);
    // SAFETY: the bridge contract returns an owned, NUL-terminated UTF-8 JSON string.
    let json_text = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .into_diagnostic()
        .wrap_err_with(|| {
            format!(
                "Oxc lint returned non-UTF-8 JSON for {}",
                filename.display()
            )
        })?;
    let response: serde_json::Value = serde_json::from_str(json_text)
        .into_diagnostic()
        .wrap_err_with(|| {
            format!(
                "Oxc lint returned malformed JSON for {}",
                filename.display()
            )
        })?;
    match response.get("ok").and_then(serde_json::Value::as_bool) {
        Some(true) => {}
        Some(false) => {
            let detail = response
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown bridge error");
            bail!("Oxc lint failed for {}: {detail}", filename.display());
        }
        None => {
            bail!(
                "Oxc lint response is missing a boolean `ok` field for {}",
                filename.display()
            )
        }
    }
    let diagnostics = response.get("diagnostics").cloned().ok_or_else(|| {
        miette::miette!(
            "Oxc lint response is missing `diagnostics` for {}",
            filename.display()
        )
    })?;
    serde_json::from_value(diagnostics)
        .into_diagnostic()
        .wrap_err_with(|| {
            format!(
                "Oxc lint returned invalid diagnostics for {}",
                filename.display()
            )
        })
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let k = 1024.0;
    let sizes = ["B", "KB", "MB", "GB"];
    let i = (bytes as f64).log(k).floor() as usize;
    let i = i.min(sizes.len() - 1);
    format!("{:.2} {}", (bytes as f64) / k.powi(i as i32), sizes[i])
}

fn validate_smoke_output(exit_success: bool, output: String) -> Result<String> {
    if !exit_success {
        let detail = if output.is_empty() {
            "no output"
        } else {
            output.as_str()
        };
        bail!("Smoke check failed: binary exited unsuccessfully ({detail})");
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("aphrody-discord-{}-{id}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn owned_json(text: &str) -> *mut c_char {
        CString::new(text).unwrap().into_raw()
    }

    #[test]
    fn parse_bot_target() {
        let dir = std::env::temp_dir();
        assert_eq!(
            BotTarget::parse(dir.to_str().unwrap()),
            Some(BotTarget::Custom(dir))
        );
        assert_eq!(BotTarget::parse("/nonexistent/bot-fixture"), None);
    }

    #[test]
    fn default_compiler_options() {
        let opts = CompilerOptions::default();
        assert!(opts.minify);
        assert!(opts.sourcemap);
        assert!(opts.smoke_check);
    }

    #[test]
    fn smoke_check_rejects_nonzero_exit_even_when_binary_prints_output() {
        let result = validate_smoke_output(false, "panic while starting".to_string());
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("panic while starting")
        );
    }

    #[test]
    fn smoke_check_accepts_successful_silent_binary() {
        assert_eq!(validate_smoke_output(true, String::new()).unwrap(), "");
    }

    #[test]
    fn oxc_response_parser_rejects_null_malformed_missing_status_and_bridge_errors() {
        let filename = Path::new("command.ts");

        assert!(
            parse_oxc_lint_response(std::ptr::null_mut(), filename)
                .unwrap_err()
                .to_string()
                .contains("null response")
        );
        assert!(
            parse_oxc_lint_response(owned_json("not json"), filename)
                .unwrap_err()
                .to_string()
                .contains("malformed JSON")
        );
        assert!(
            parse_oxc_lint_response(owned_json(r#"{"diagnostics":[]}"#), filename)
                .unwrap_err()
                .to_string()
                .contains("boolean `ok`")
        );
        assert!(
            parse_oxc_lint_response(
                owned_json(r#"{"ok":false,"error":"bridge failed"}"#),
                filename
            )
            .unwrap_err()
            .to_string()
            .contains("bridge failed")
        );
        assert!(
            parse_oxc_lint_response(owned_json(r#"{"ok":true}"#), filename)
                .unwrap_err()
                .to_string()
                .contains("missing `diagnostics`")
        );
    }

    #[test]
    fn inspect_counts_oxc_diagnostics_from_valid_bridge_response() {
        let temp = TestDirectory::new();
        let commands = temp.0.join("src/commands");
        fs::create_dir_all(&commands).unwrap();
        fs::write(commands.join("invalid.ts"), "const = ;").unwrap();
        let compiler = DiscordCompiler {
            root: PathBuf::new(),
            bun_bin: PathBuf::new(),
        };

        let inspection = compiler
            .inspect(&BotTarget::Custom(temp.0.clone()))
            .unwrap();

        assert_eq!(inspection.commands_count, 1);
        assert!(inspection.oxc_diagnostics_errors > 0);
    }

    #[cfg(unix)]
    #[test]
    fn inspect_returns_a_contextual_error_when_command_source_cannot_be_read() {
        let temp = TestDirectory::new();
        let commands = temp.0.join("src/commands");
        fs::create_dir_all(&commands).unwrap();
        std::os::unix::fs::symlink(
            commands.join("missing-target.ts"),
            commands.join("unreadable.ts"),
        )
        .unwrap();
        let compiler = DiscordCompiler {
            root: PathBuf::new(),
            bun_bin: PathBuf::new(),
        };

        let error = compiler
            .inspect(&BotTarget::Custom(temp.0.clone()))
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("Failed to read Discord command source")
        );
        assert!(error.to_string().contains("unreadable.ts"));
    }
}
