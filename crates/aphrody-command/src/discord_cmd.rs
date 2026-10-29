// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! `aphrody discord …` — Sovereign Discord compilation, bot verification, and runtime tools.

use std::path::PathBuf;

use crate::discord_compiler::{BotTarget, CompilerOptions, DiscordCompiler};
use aphrody_discord::{
    AphrodyDiscordBot, BotConfig, build_shell_embed, build_web_embed, fetch_and_extract_web,
    run_bounded_shell,
};
use clap::Subcommand;
use colored::Colorize;
use miette::{IntoDiagnostic, Result};

/// Convert an `aphrody-discord` (anyhow) error into a miette report, keeping its context chain.
fn diag(error: impl std::fmt::Display) -> miette::Report {
    miette::miette!("{error:#}")
}

/// Subcommands for `aphrody discord`.
#[derive(Debug, Subcommand)]
pub(crate) enum DiscordAction {
    /// Show Discord bot identity, guild and operational status.
    Status {
        /// Optional path to environment file (e.g. .env or /etc/aphrody-discord.env)
        #[arg(long)]
        env_file: Option<PathBuf>,
    },
    /// Send a message or upload a file directly to a Discord channel.
    Send {
        /// Destination Discord channel ID
        channel_id: String,
        /// Message text content (`-` reads it from stdin)
        #[arg(long, short)]
        message: Option<String>,
        /// Optional file to attach
        #[arg(long, short)]
        file: Option<PathBuf>,
        /// Optional path to environment file (e.g. .env or /etc/aphrody-discord.env)
        #[arg(long)]
        env_file: Option<PathBuf>,
    },
    /// Extract a web page using Aphrody Web engine and post the rich summary Embed to Discord.
    Web {
        /// Destination Discord channel ID
        channel_id: String,
        /// URL of the web page to extract
        url: String,
    },
    /// Execute a bounded shell command and post the execution receipt into Discord.
    Exec {
        /// Destination Discord channel ID
        channel_id: String,
        /// Shell command line to execute
        command: String,
    },
    /// Compile a Discord bot project into a native standalone binary via Bun + Oxc.
    Compile {
        /// Path of the bot project directory
        #[arg(default_value = ".")]
        target: String,
        /// Run smoke check after compilation
        #[arg(long, default_value_t = true)]
        smoke: bool,
        /// Disable code minification
        #[arg(long)]
        no_minify: bool,
        /// Disable sourcemaps
        #[arg(long)]
        no_sourcemap: bool,
        /// Cross-compilation target (e.g. bun-linux-x64, bun-windows-x64, bun-linux-arm64)
        #[arg(long)]
        target_triple: Option<String>,
    },
    /// Inspect a Discord bot configuration, TypeScript decorators, and Oxc AST syntax.
    Inspect {
        /// Path of the bot project directory
        #[arg(default_value = ".")]
        target: String,
        /// Output inspection as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run the comprehensive Discord monorepo verification gate (catalog, kit, messaging, bots, compile).
    Verify,
}

fn load_bot(env_file: Option<&PathBuf>) -> Result<AphrodyDiscordBot> {
    let config = if let Some(path) = env_file {
        BotConfig::from_file(path).map_err(diag)?
    } else if std::path::Path::new(".env").exists() {
        BotConfig::from_file(".env").map_err(diag)?
    } else {
        BotConfig::from_env().map_err(diag)?
    };
    Ok(AphrodyDiscordBot::new(config))
}

pub(crate) async fn run_discord(action: DiscordAction) -> Result<()> {
    match action {
        DiscordAction::Status { env_file } => {
            let bot = load_bot(env_file.as_ref())?;
            println!("\n🔍 Querying Discord Bot status via native REST API...");
            let status = bot.check_status().await.map_err(diag)?;
            println!("   Bot ID:        {}", status.bot_user.id.bold());
            println!("   Username:      {}", status.bot_user.username.bold());
            println!("   Operational:   {}", "HEALTHY".green().bold());
            if let Some(ref guild) = status.guild_id {
                println!("   Default Guild: {}", guild);
            }
            println!(
                "   Public Key:    {}",
                if status.public_key_configured {
                    "Configured".green()
                } else {
                    "None".yellow()
                }
            );
            Ok(())
        }
        DiscordAction::Send {
            channel_id,
            message,
            file,
            env_file,
        } => {
            let bot = load_bot(env_file.as_ref())?;
            let message = match message.as_deref() {
                Some("-") => Some(std::io::read_to_string(std::io::stdin()).into_diagnostic()?),
                _ => message,
            };
            if let Some(file_path) = file {
                let filename = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file.dat");
                let bytes = std::fs::read(&file_path).into_diagnostic()?;
                println!("📤 Uploading file `{filename}` to channel `{channel_id}`...");
                let msg = bot
                    .upload_file(&channel_id, message.as_deref(), filename, &bytes)
                    .await
                    .map_err(diag)?;
                println!("✅ Message posted with file! ID: {}", msg.id.green().bold());
            } else if let Some(content) = message {
                println!("📤 Sending message to channel `{channel_id}`...");
                let msg = bot.send_text(&channel_id, &content).await.map_err(diag)?;
                println!("✅ Message posted! ID: {}", msg.id.green().bold());
            } else {
                miette::bail!("Either --message or --file must be specified");
            }
            Ok(())
        }
        DiscordAction::Web { channel_id, url } => {
            let bot = load_bot(None)?;
            println!("🌐 Extracting web content from `{url}` via Aphrody Obscura...");
            let summary = fetch_and_extract_web(&url).await.map_err(diag)?;
            let embed = build_web_embed(&summary);
            let msg = bot.send_embed(&channel_id, embed).await.map_err(diag)?;
            println!(
                "✅ Web extraction embed posted to Discord! ID: {}",
                msg.id.green().bold()
            );
            Ok(())
        }
        DiscordAction::Exec {
            channel_id,
            command,
        } => {
            let bot = load_bot(None)?;
            println!("⚡ Executing bounded shell command: `{command}`...");
            let res = run_bounded_shell(&command).await.map_err(diag)?;
            let embed = build_shell_embed(&res);
            let msg = bot.send_embed(&channel_id, embed).await.map_err(diag)?;
            println!(
                "✅ Shell execution receipt posted to Discord! ID: {}",
                msg.id.green().bold()
            );
            Ok(())
        }
        DiscordAction::Compile {
            target,
            smoke,
            no_minify,
            no_sourcemap,
            target_triple,
        } => {
            let compiler = DiscordCompiler::new()?;
            let options = CompilerOptions {
                minify: !no_minify,
                sourcemap: !no_sourcemap,
                smoke_check: smoke,
                target_triple,
            };
            let bot_target =
                BotTarget::parse(&target).unwrap_or(BotTarget::Custom(PathBuf::from(&target)));
            compiler.compile(&bot_target, &options)?;
            Ok(())
        }
        DiscordAction::Inspect { target, json } => {
            let compiler = DiscordCompiler::new()?;
            let bot_target =
                BotTarget::parse(&target).unwrap_or(BotTarget::Custom(PathBuf::from(&target)));
            let inspection = compiler.inspect(&bot_target)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&inspection).unwrap());
            } else {
                println!(
                    "\n🔍 {}",
                    format!("Bot Inspection: {}", inspection.bot_name).bold()
                );
                println!("   Directory:                {}", inspection.dir.display());
                println!(
                    "   package.json:             {}",
                    inspection.package_json_exists
                );
                println!(
                    "   tsconfig.json:            {}",
                    inspection.tsconfig_json_exists
                );
                println!(
                    "   Standalone entry:         {}",
                    inspection.has_standalone_entry
                );
                println!(
                    "   Uses @aphrody/discord-kit: {}",
                    inspection.uses_discord_kit
                );
                println!("   Command files scanned:    {}", inspection.commands_count);
                println!(
                    "   Oxc diagnostics errors:   {}",
                    inspection.oxc_diagnostics_errors
                );
            }
            Ok(())
        }
        DiscordAction::Verify => {
            let compiler = DiscordCompiler::new()?;
            compiler.verify_monorepo()
        }
    }
}
