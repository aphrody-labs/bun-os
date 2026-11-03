// SPDX-License-Identifier: Apache-2.0
//! `bunos-win11`: the Bun OS Windows 11 optimiser.
//!
//! Two faces over one engine (`bun-windows-winclean::tweaks`) and one catalog:
//!   - the running Windows (live): an archinstall-style installer — a guided TUI, or a non-interactive
//!     `--config profile.toml` run — with detect / plan / apply / verify / undo, a System Restore point, a
//!     per-key registry export and a journal so everything is reversible;
//!   - a Windows 11 ISO (offline): `iso` applies the same declarative profile to a mounted install.wim and writes
//!     a new, debloated ISO (the Bun OS, Rust-first tiny11; vendor/tiny11builder is credited).
//!
//! Desktop profiles (`cosmic`, `cosmic-comp`, `hyprland`, `omarchy`, `gnome`, `windows-native`) are emitted as
//! launch plans; the Linux ones run from the Bun OS WSL bundle through WSLg, `windows-native` is a one-shot apply of the
//! catalog's `look` and `shell` modules (nothing resident; docs/WINDOWS-ARCHITECTURE.md).

mod desktop;
mod iso;
mod tui;

use anyhow::{Context, Result};
use bun_windows_winclean::tweaks::{Catalog, Level, Profile, TargetKind};
use clap::{Args as ClapArgs, Parser, Subcommand};

use desktop::Desktop;

#[derive(Parser)]
#[command(name = "bunos-win11", version, about = "Optimise and debloat Windows 11: live (archinstall-style) and ISO")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List the tweak catalog (modules and tweaks).
    Catalog {
        /// Only tweaks of this module.
        #[arg(long)]
        module: Option<String>,
    },
    /// Guided installer (interactive TUI).
    Guided,
    /// Build a plan for the running Windows and save it (no changes).
    Plan(ProfileArgs),
    /// Apply a plan or profile to the running Windows (restore point + registry export + journal).
    Apply {
        #[command(flatten)]
        profile: ProfileArgs,
        /// Path of a plan produced by `plan`. Overrides the profile.
        #[arg(long)]
        plan: Option<String>,
        /// Required to make changes.
        #[arg(long)]
        yes: bool,
    },
    /// Re-detect journaled changes and report drift.
    Verify {
        #[arg(long)]
        journal: Option<String>,
    },
    /// Revert a journal (newest by default).
    Undo {
        #[arg(long)]
        journal: Option<String>,
    },
    /// List or describe desktop profiles.
    Desktop {
        /// A profile id to describe (cosmic, cosmic-comp, hyprland, omarchy, gnome, windows-native).
        name: Option<String>,
        /// Print the session manifest (factory/desktop/sessions.json) instead.
        #[arg(long)]
        json: bool,
    },
    /// Build a debloated Windows 11 ISO from an official ISO (offline target).
    Iso(IsoArgs),
}

#[derive(ClapArgs, Clone)]
struct ProfileArgs {
    /// Profile TOML file. Omit for the default conservative live profile.
    #[arg(long)]
    config: Option<String>,
    /// Override the level (conservative|standard|aggressive).
    #[arg(long)]
    level: Option<String>,
    /// Restrict to these modules (repeatable).
    #[arg(long)]
    module: Vec<String>,
}

#[derive(ClapArgs, Clone)]
pub struct IsoArgs {
    /// Source Windows 11 ISO.
    #[arg(long)]
    source: String,
    /// Output ISO path.
    #[arg(long)]
    output: String,
    /// Offline profile TOML. Omit for the default standard offline profile.
    #[arg(long)]
    config: Option<String>,
    /// install.wim edition index (default 1).
    #[arg(long)]
    index: Option<u32>,
}

impl ProfileArgs {
    fn load(&self, default_target: TargetKind) -> Result<Profile> {
        let mut profile = match &self.config {
            Some(path) => {
                let text = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
                Profile::parse(&text).map_err(|e| anyhow::anyhow!("profile: {e}"))?
            }
            None => Profile { target: default_target, ..Default::default() },
        };
        if let Some(level) = &self.level {
            profile.level = parse_level(level)?;
        }
        if !self.module.is_empty() {
            profile.modules.clone_from(&self.module);
        }
        Ok(profile)
    }
}

fn parse_level(s: &str) -> Result<Level> {
    Ok(match s {
        "conservative" => Level::Conservative,
        "standard" => Level::Standard,
        "aggressive" => Level::Aggressive,
        other => anyhow::bail!("unknown level '{other}'"),
    })
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Catalog { module } => catalog(module.as_deref()),
        Command::Guided => tui::run(),
        Command::Plan(args) => plan(&args),
        Command::Apply { profile, plan, yes } => apply(&profile, plan.as_deref(), yes),
        Command::Verify { journal } => verify(journal.as_deref()),
        Command::Undo { journal } => undo(journal.as_deref()),
        Command::Desktop { name, json } => {
            if json {
                print!("{}", desktop::manifest_json());
                Ok(())
            } else {
                desktop_cmd(name.as_deref())
            }
        }
        Command::Iso(args) => iso::build(&args),
    }
}

fn catalog(module: Option<&str>) -> Result<()> {
    let catalog = Catalog::embedded().context("catalog")?;
    for m in &catalog.modules {
        if module.is_some_and(|only| only != m.id) {
            continue;
        }
        println!("\n{} — {}", m.id, m.title);
        for t in catalog.tweaks.iter().filter(|t| t.module == m.id) {
            let targets: Vec<&str> =
                t.targets.iter().map(|x| if *x == TargetKind::Live { "live" } else { "offline" }).collect();
            println!("  {:<28} [{:?}] {:<8} {}", t.id, t.level, targets.join("+"), t.title);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn plan(args: &ProfileArgs) -> Result<()> {
    use bun_windows_winclean::tweaks::{live::LiveBackend, runner};
    let profile = args.load(TargetKind::Live)?;
    let mut backend = LiveBackend;
    let (plan, path) = runner::make_plan(&profile, &mut backend).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("{} changes planned (plan saved to {})", plan.changes(), path.display());
    for (module, (change, ok, other)) in plan.summary() {
        println!("  {module:<14} change {change:<3} ok {ok:<3} skip/refused {other}");
    }
    for s in plan.steps.iter().filter(|s| s.action == "refused") {
        println!("  refused {}: {}", s.tweak, s.reason.as_deref().unwrap_or("?"));
    }
    Ok(())
}

#[cfg(windows)]
fn apply(args: &ProfileArgs, plan_path: Option<&str>, yes: bool) -> Result<()> {
    use bun_windows_winclean::tweaks::{live::LiveBackend, runner, Plan};
    if !yes {
        anyhow::bail!("refusing to apply without --yes (run `plan` first to preview)");
    }
    let plan: Plan = match plan_path {
        Some(p) => serde_json::from_slice(&std::fs::read(p).with_context(|| format!("read {p}"))?)?,
        None => {
            let profile = args.load(TargetKind::Live)?;
            let mut backend = LiveBackend;
            runner::make_plan(&profile, &mut backend).map_err(|e| anyhow::anyhow!("{e}"))?.0
        }
    };
    let (journal, path) = runner::apply_live(&plan, "Bun OS Tweaks").map_err(|e| anyhow::anyhow!("{e}"))?;
    let applied = journal.entries.iter().filter(|e| e.result == "applied").count();
    println!("applied {applied} changes; restore point {:?}; journal {}", journal.restore_point, path.display());
    for e in journal.entries.iter().filter(|e| e.result != "applied") {
        println!("  not applied {}: {} ({})", e.tweak, e.result, e.error.as_deref().unwrap_or(""));
    }
    println!("undo with: bunos-win11 undo");
    Ok(())
}

#[cfg(windows)]
fn verify(journal: Option<&str>) -> Result<()> {
    use bun_windows_winclean::tweaks::runner;
    let path = resolve_journal(journal)?;
    let j = serde_json::from_slice(&std::fs::read(&path)?)?;
    let drift = runner::verify_journal(&j);
    if drift.is_empty() {
        println!("all {path:?} changes still in place", path = path.display());
    } else {
        println!("drift: {}", drift.join(", "));
    }
    Ok(())
}

#[cfg(windows)]
fn undo(journal: Option<&str>) -> Result<()> {
    use bun_windows_winclean::tweaks::runner;
    let path = resolve_journal(journal)?;
    let report = runner::undo_journal(&path).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("restored {} changes", report.restored);
    if !report.skipped_irreversible.is_empty() {
        println!("not reversible: {}", report.skipped_irreversible.join("; "));
    }
    for e in &report.errors {
        println!("  error: {e}");
    }
    Ok(())
}

#[cfg(windows)]
fn resolve_journal(journal: Option<&str>) -> Result<std::path::PathBuf> {
    use bun_windows_winclean::tweaks::runner;
    match journal {
        Some(p) => Ok(p.into()),
        None => runner::latest_journal().context("no journal under %LOCALAPPDATA%\\bunos\\win11\\journal"),
    }
}

#[cfg(not(windows))]
fn plan(_: &ProfileArgs) -> Result<()> {
    anyhow::bail!("live plan runs on Windows")
}
#[cfg(not(windows))]
fn apply(_: &ProfileArgs, _: Option<&str>, _: bool) -> Result<()> {
    anyhow::bail!("live apply runs on Windows")
}
#[cfg(not(windows))]
fn verify(_: Option<&str>) -> Result<()> {
    anyhow::bail!("verify runs on Windows")
}
#[cfg(not(windows))]
fn undo(_: Option<&str>) -> Result<()> {
    anyhow::bail!("undo runs on Windows")
}

fn desktop_cmd(name: Option<&str>) -> Result<()> {
    match name {
        None => {
            println!("desktop profiles:");
            for d in Desktop::ALL {
                println!("  {:<17} {}", d.id(), d.title());
            }
            Ok(())
        }
        Some(id) => {
            let d = Desktop::parse(id).with_context(|| format!("unknown desktop '{id}'"))?;
            println!("{} — {}", d.id(), d.title());
            println!("runtime: {}", if d.is_wsl() { "Bun OS WSL bundle via WSLg" } else { "native Windows" });
            if !d.packages().is_empty() {
                println!("packages: {}", d.packages().join(" "));
            }
            if !d.vendored().is_empty() {
                println!("from: {}", d.vendored().join(", "));
            }
            println!("launch plan:");
            for (i, step) in d.launch_plan().into_iter().enumerate() {
                println!("  {}. {step}", i + 1);
            }
            Ok(())
        }
    }
}
