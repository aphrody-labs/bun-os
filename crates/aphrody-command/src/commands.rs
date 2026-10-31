// SPDX-License-Identifier: Apache-2.0
use aphrody_proc::NoWindow as _;
use std::{net::SocketAddr, path::PathBuf};

use async_trait::async_trait;
use colored::Colorize;

use crate::{
    context::{GoogleContext, TerminalCommand},
    nl_tokens::{BYPASS_ENGINES, CARGO_COMMANDS, SCRIPT_EXTS, STANDARD_ACTIONS, UV_COMMANDS},
};

/// A subprocess forwarded by aphrody exited with a non-zero status code.
///
/// This error is produced instead of calling `std::process::exit` directly in
/// library code.  The single authoritative `process::exit` call lives in
/// `main.rs` which downcasts `miette::Report` to this type and propagates the
/// exit code.
#[derive(Debug, miette::Diagnostic)]
pub(crate) struct SubprocessExit(pub(crate) i32);

impl std::fmt::Display for SubprocessExit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "subprocess exited with code {}", self.0)
    }
}

impl std::error::Error for SubprocessExit {}

pub(crate) struct VersionCommand {
    pub json: bool,
}

#[async_trait]
impl TerminalCommand for VersionCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        if self.json {
            let info = serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "commit": env!("APHRODY_GIT_SHA"),
                "built": env!("APHRODY_BUILD_UNIX"),
                "target": env!("APHRODY_TARGET"),
                "profile": env!("APHRODY_BUILD_PROFILE"),
                "repo": "https://github.com/aphrody-labs/aphrody",
                "license": "Apache-2.0",
                "a2a": "A2A v1.0 @ /.well-known/agent-card.json (coordination settings: ai.json)"
            });
            println!("{}", serde_json::to_string_pretty(&info).unwrap());
            return Ok(());
        }

        // Format mirrors `gh --version` / `rustc -Vv` — flat key:value, no
        // emoji, no styling (terminals downstream may pipe to grep).
        println!("aphrody {}", env!("CARGO_PKG_VERSION"));
        println!("commit:    {}", env!("APHRODY_GIT_SHA"));
        println!("built:     {} (unix epoch)", env!("APHRODY_BUILD_UNIX"));
        println!("target:    {}", env!("APHRODY_TARGET"));
        println!("profile:   {}", env!("APHRODY_BUILD_PROFILE"));
        println!();
        println!("repo:      https://github.com/aphrody-labs/aphrody");
        println!("license:   Apache-2.0");
        println!("a2a:       v1.0 Agent Card @ /.well-known/agent-card.json (coordination settings: ai.json)");
        Ok(())
    }
}

pub(crate) async fn dispatch_a2a(
    action: crate::A2aAction,
    _ctx: &GoogleContext,
) -> miette::Result<()> {
    use std::net::SocketAddr;

    use aphrody_a2a_coord::{
        ListenerConfig, PeerId, PeerInvoker,
        listener::{self, TickOptions},
    };

    let action = match dispatch_a2a_hub(action).await? {
        Some(action) => action,
        None => return Ok(()),
    };
    let (manifest, repo_root) =
        aphrody_a2a_coord::AiManifest::load_repo_default().map_err(|e| miette::miette!("{e}"))?;

    match action {
        crate::A2aAction::Serve {
            bind,
            unix,
            no_tcp,
            coord_dir,
        } => {
            let addr: SocketAddr = bind
                .parse()
                .map_err(|e| miette::miette!("invalid --bind: {e}"))?;
            let cfg = ListenerConfig {
                bind: addr,
                manifest,
                repo_root,
                dry_run: false,
            };
            let env_path = |k: &str| {
                std::env::var_os(k)
                    .filter(|v| !v.is_empty())
                    .map(Into::into)
            };
            let opts = listener::ServeOptions {
                unix: unix.or_else(|| env_path("A2A_SOCKET")),
                no_tcp,
                coord_dir: coord_dir.or_else(|| env_path("COORD_DIR")),
            };
            if !opts.no_tcp {
                println!(
                    "A2A coord on http://{addr} — agent card, /ping, /msg, JSON-RPC, HTTP+REST"
                );
            }
            if let Some(sock) = &opts.unix {
                println!("A2A coord on unix:{}", sock.display());
            }
            listener::serve_with_options(cfg, opts)
                .await
                .map_err(|e| miette::miette!("a2a serve failed: {e}"))?;
        }
        crate::A2aAction::Tick {
            iteration,
            side,
            peer,
            subject,
            body,
            kind,
        } => {
            let opts = TickOptions {
                iteration,
                side,
                peer: Some(peer),
                subject,
                body,
                kind: Some(kind),
            };
            let env = listener::run_tick(&manifest, &repo_root, &opts)
                .map_err(|e| miette::miette!("a2a tick: {e}"))?;
            println!("{}", serde_json::to_string_pretty(&env).unwrap_or_default());
        }
        crate::A2aAction::Invoke {
            prompt,
            peer,
            dry_run,
            claim,
        } => {
            let peer_id = PeerId::parse(&peer).ok_or_else(|| {
                miette::miette!("unknown peer {peer:?}; use grok|agy|claude|codex|bxc")
            })?;
            let _claims = claim
                .iter()
                .map(|path| {
                    aphrody_a2a_coord::claims::FileClaim::acquire(&repo_root, path)
                        .map_err(|e| miette::miette!("claim {}: {e}", path.display()))
                })
                .collect::<miette::Result<Vec<_>>>()?;
            let prompt = if claim.is_empty() {
                prompt
            } else {
                let paths = claim
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "Edit only these claimed file families: {paths}. Other workers share this checkout. Do not switch branches or commit.\n\n{prompt}"
                )
            };
            let invoker = PeerInvoker::new(&repo_root).with_dry_run(dry_run);
            let result = invoker
                .invoke_prompt(peer_id, &prompt)
                .map_err(|e| miette::miette!("peer invoke: {e}"))?;
            if !result.stderr.is_empty() {
                eprintln!("{}", result.stderr);
            }
            print!("{}", result.stdout);
            if result.exit_code != Some(0) {
                return Err(miette::miette!(
                    "peer {} exited {:?}",
                    peer_id.short(),
                    result.exit_code
                ));
            }
        }
        crate::A2aAction::Send {
            instruction,
            target,
            source,
            yolo,
        } => {
            let registry = aphrody_a2a_coord::PeerRegistry::from_env(&repo_root);
            let mailbox = aphrody_a2a_coord::mailbox::Mailbox::new(manifest.coord_dir(&repo_root));
            let source = source.unwrap_or_else(|| "aphrody".to_owned());
            let params = aphrody_a2a_coord::SendParams {
                target,
                source_agent: source,
                instruction,
                yolo,
            };
            let out = aphrody_a2a_coord::bridge::send(&registry, &mailbox, &params)
                .await
                .map_err(|e| miette::miette!("a2a send: {e}"))?;
            println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        }
        crate::A2aAction::Peers => {
            let registry = aphrody_a2a_coord::PeerRegistry::from_env(&repo_root);
            println!(
                "{}",
                serde_json::to_string_pretty(registry.peers()).unwrap_or_default()
            );
        }
        crate::A2aAction::Inbox { .. } | crate::A2aAction::Register => {
            return Err(miette::miette!(
                "a2a inbox/register need APHRODY_A2A_HUB_URL (and APHRODY_A2A_TOKEN_FILE)"
            ));
        }
    }
    Ok(())
}

/// Hub-backed actions, run without a repository manifest. Returns the action back
/// when it must go through the local file/catalog path.
async fn dispatch_a2a_hub(action: crate::A2aAction) -> miette::Result<Option<crate::A2aAction>> {
    use aphrody_a2a_coord::{EnvelopeKind, HubClient, SelfIdentity};

    let local = matches!(
        action,
        crate::A2aAction::Serve { .. }
            | crate::A2aAction::Tick { .. }
            | crate::A2aAction::Invoke { .. }
    );
    if local {
        return Ok(Some(action));
    }
    let hub = HubClient::from_env().map_err(|e| miette::miette!("a2a hub: {e}"))?;
    let Some(hub) = hub else {
        return Ok(Some(action));
    };
    let me = SelfIdentity::detect();
    let fail = |e: aphrody_a2a_coord::HubError| miette::miette!("a2a hub {}: {e}", hub.base());
    // Every hub command doubles as a heartbeat.
    hub.register(&me).await.map_err(fail)?;
    match action {
        crate::A2aAction::Peers => {
            let peers = hub.peers().await.map_err(fail)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&peers).unwrap_or_default()
            );
        }
        crate::A2aAction::Register => {
            println!("{}", serde_json::to_string_pretty(&me).unwrap_or_default());
        }
        crate::A2aAction::Send {
            instruction,
            target,
            source,
            ..
        } => {
            let from = source.unwrap_or_else(|| me.id.clone());
            let sent = hub
                .send(
                    &from,
                    &target,
                    EnvelopeKind::Ask,
                    "a2a.message",
                    &instruction,
                )
                .await
                .map_err(fail)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&sent).unwrap_or_default()
            );
        }
        crate::A2aAction::Inbox {
            id,
            limit,
            ack,
            all,
        } => {
            let mailbox = id.unwrap_or_else(|| me.id.clone());
            let envelopes = hub.inbox(&mailbox, limit).await.map_err(fail)?;
            let shown: Vec<_> = envelopes
                .into_iter()
                .filter(|e| all || e.get("kind").and_then(|k| k.as_str()) != Some("ack"))
                .collect();
            if ack {
                for envelope in &shown {
                    hub.acknowledge(&mailbox, envelope).await.map_err(fail)?;
                }
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&shown).unwrap_or_default()
            );
        }
        other => return Ok(Some(other)),
    }
    Ok(None)
}

pub(crate) struct AutoCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for AutoCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // Policy 100% Rust (memory `feedback_aphrody_rust_only`) :
        // `AutoCommand` n'auto-spawn JAMAIS `bun` implicitement. Les
        // utilisateurs qui veulent invoquer bun passent par BYPASS_ENGINES
        // (`aphrody bun add foo`). Le runtime par défaut est `cargo`.
        if self.args.is_empty() {
            return crate::pillars_cmd::handle_shell(crate::pillars_cmd::ShellAction::Start {
                args: Vec::new(),
            });
        }

        let first_arg = &self.args[0];

        // All category lists (BYPASS_ENGINES, UV_COMMANDS, CARGO_COMMANDS,
        // STANDARD_ACTIONS, SCRIPT_EXTS) come from `crate::nl_tokens` so
        // the NL detector in `main.rs` and this dispatcher cannot drift.
        //
        // Note (Phase 5, 2026-05-18) : `BUN_COMMANDS` a été retiré du
        // dispatcher implicite — bun reste accessible via BYPASS_ENGINES.

        // Explicit engine bypass (`bun`, `uv`, `cargo`, `npm`, …)
        if BYPASS_ENGINES.contains(&first_arg.as_str()) {
            return Self::run_process(first_arg, &self.args[1..]);
        }
        // Specific commands
        else if UV_COMMANDS.contains(&first_arg.as_str()) {
            return Self::run_process("uv", &self.args[..]);
        } else if CARGO_COMMANDS.contains(&first_arg.as_str()) {
            return Self::run_process("cargo", &self.args[..]);
        }

        let is_known_technical_command = STANDARD_ACTIONS.contains(&first_arg.as_str());
        let is_script_file = SCRIPT_EXTS.iter().any(|ext| first_arg.ends_with(ext));

        // Overlapping Universal Commands (run, install, add, remove, test, build...)
        let is_run_script = first_arg == "run" || first_arg == "exec";

        // Default engine = `cargo` (Rust-first policy). Bun/Node ne sont
        // jamais sélectionnés implicitement par le dispatcher.
        let mut target_engine = "cargo";

        if !is_known_technical_command && !is_script_file {
            let prompt = self.args.join(" ");
            println!("✨ [Aphrody] Requête locale : {prompt}");
            let opts = crate::auto_command::AutoCommand::new(&prompt);
            if let Ok(0) = crate::auto_command::run(opts).await {
                return Ok(());
            }
            #[cfg(feature = "rag")]
            {
                println!("🔍 [RAG] Recherche locale pour : {prompt}");
                return crate::rag_cmd::run(
                    crate::rag_cmd::RagArgs {
                        db: None,
                        action: crate::rag_cmd::RagAction::Search {
                            query: prompt,
                            limit: 5,
                            mode: None,
                            lang: None,
                            json: false,
                            min_score: None,
                        },
                    },
                    _ctx.overrides(),
                )
                .await;
            }
            #[cfg(not(feature = "rag"))]
            {
                println!("✨ Exécuter `aphrody ai status` ou `aphrody shell` pour interagir.");
                return Ok(());
            }
        }

        if is_run_script && self.args.len() > 1 && self.args[1].ends_with(".py") {
            target_engine = "uv";
        } else if first_arg.ends_with(".py") {
            let mut new_args = vec!["run".to_string()];
            new_args.extend(self.args.clone());
            return Self::run_process("uv", new_args);
        } else if first_arg.ends_with(".js")
            || first_arg.ends_with(".ts")
            || first_arg.ends_with(".jsx")
            || first_arg.ends_with(".tsx")
        {
            // Policy 100% Rust : aucun spawn implicite vers un runtime JS.
            // L'utilisateur doit passer par le BYPASS explicite
            // (`aphrody bun run X.ts`) ou installer un runtime tiers.
            eprintln!(
                "⚠️  [Auto] `{first_arg}` est un script JS/TS — le dispatcher 100% Rust ne spawn \
                 pas de runtime JS implicitement.\n   Utiliser le bypass explicite : `aphrody bun \
                 run {first_arg}` (ou `aphrody node {first_arg}`, `aphrody deno run {first_arg}`)."
            );
            return Err(miette::Report::new(SubprocessExit(2)));
        } else if first_arg.ends_with(".rs") {
            let mut new_args = vec!["run".to_string()];
            new_args.extend(self.args.clone());
            return Self::run_process("cargo", new_args);
        } else {
            // Contextual ecosystem detection. Note : `package.json` ne
            // sélectionne plus `bun` implicitement (policy 100% Rust) ;
            // l'utilisateur passe par `aphrody bun <cmd>` au besoin.
            let has_cargo = std::path::Path::new("Cargo.toml").exists();
            let has_uv = std::path::Path::new("pyproject.toml").exists()
                || std::path::Path::new("requirements.txt").exists();
            let has_go = std::path::Path::new("go.mod").exists();

            if has_cargo {
                target_engine = "cargo";
            } else if has_uv {
                target_engine = "uv";
            } else if has_go {
                target_engine = "go";
            } else {
                // No project file. If it's a global install (e.g. `google install git`), fallback
                // to system manager
                let is_install_like =
                    first_arg == "install" || first_arg == "i" || first_arg == "add";
                if is_install_like && self.args.len() > 1 && !self.args[1].starts_with('-') {
                    #[cfg(target_os = "windows")]
                    {
                        target_engine = "winget";
                    }
                    #[cfg(target_os = "linux")]
                    {
                        target_engine = "apt";
                    }
                    #[cfg(target_os = "macos")]
                    {
                        target_engine = "brew";
                    }
                }
            }
        }

        // Command syntax translation for universal compatibility
        let mut final_args = self.args.clone();
        if target_engine == "cargo" {
            if final_args[0] == "install" || final_args[0] == "i" {
                // In Cargo, adding to a project is 'cargo add', global install is 'cargo install'
                if std::path::Path::new("Cargo.toml").exists() {
                    final_args[0] = "add".to_string();
                } else {
                    final_args[0] = "install".to_string();
                }
            } else if final_args[0] == "rm" || final_args[0] == "remove" {
                final_args[0] = "remove".to_string();
            }
        } else if target_engine == "uv" {
            if final_args[0] == "install" || final_args[0] == "i" {
                final_args[0] = "add".to_string();
            }
        } else if target_engine == "winget" && (final_args[0] == "add" || final_args[0] == "i") {
            final_args[0] = "install".to_string();
        }

        Self::run_process(target_engine, final_args)
    }
}

impl AutoCommand {
    fn run_process<I, S>(cmd: &str, args: I) -> miette::Result<()>
    where
        I: IntoIterator<Item = S> + Clone,
        S: AsRef<std::ffi::OsStr>,
    {
        println!(
            "{}",
            format!(
                "⚡ Route native: {} {:?}",
                cmd,
                args.clone()
                    .into_iter()
                    .map(|s| s.as_ref().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            )
            .bright_black()
        );

        let status = std::process::Command::new(cmd)
            .no_window()
            .args(args)
            .status()
            .map_err(|e| miette::miette!("Erreur lors de l'appel au moteur {}: {}", cmd, e))?;

        if !status.success() {
            return Err(miette::Report::new(SubprocessExit(
                status.code().unwrap_or(1),
            )));
        }
        Ok(())
    }
}

// ===========================================================================
// `aphrody agy` — forward to the native Antigravity CLI (`agy`) binary.
// ===========================================================================

/// Forwards `aphrody google <args…>` to the native Google/Gemini ecosystem or executes native DoH / Suggest / Languages in-process.
pub(crate) struct GoogleCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for GoogleCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let first = self.args.first().map(|s| s.as_str()).unwrap_or("");

        match first {
            "" | "help" | "--help" | "-h" => {
                println!("{}", "Écosystème Google branché via Aphrody (DoH, Suggest, Translate, Gemini Web, Runtime)".bold().blue());
                println!();
                println!("Usage: aphrody google <COMMAND> [OPTIONS]");
                println!();
                println!("Commands:");
                println!(
                    "  routes               Print public Google routes and official web guidance as JSON"
                );
                println!(
                    "  dns <NAME> [TYPE]    Query Google Public DNS-over-HTTPS (A, AAAA, MX, TXT...)"
                );
                println!(
                    "  suggest <QUERY>      Get real-time Google Autocomplete query suggestions"
                );
                println!(
                    "  languages [TARGET]   List 195 official supported Google Cloud Translation languages"
                );
                println!(
                    "  status               Print resolved Google/Gemini runtime contract as JSON"
                );
                println!(
                    "  env                  Print shell exports for the Google Cloud / Gemini runtime"
                );
                println!(
                    "  doctor               Validate Google project mapping and local configuration"
                );
                println!("  login                Sign in to Google with the OAuth PKCE flow");
                println!("  auth-status          Report Google AI authentication status");
                println!("  whoami               Print the signed-in Google account profile");
                println!(
                    "  models               List Gemini models available to the authenticated account"
                );
                println!("  generate             Generate one Gemini response with Antigravity");
                println!("  generate-stream      Stream one Gemini response from stdin");
                return Ok(());
            }
            "routes" => {
                if self.args.len() > 1 && self.args[1..] != ["--json"] {
                    return Err(miette::miette!("Usage: aphrody google routes [--json]"));
                }
                println!(
                    "{}",
                    serde_json::to_string_pretty(&aphrody_google::routes::catalog())
                        .map_err(|error| miette::miette!("{error}"))?
                );
                return Ok(());
            }
            "dns" => {
                let name = self.args.get(1).map(|s| s.as_str()).ok_or_else(|| {
                    miette::miette!("Usage: aphrody google dns <domain> [record_type] [--json]")
                })?;
                let mut record_type = "A";
                let mut json = false;
                for arg in &self.args[2..] {
                    if arg == "--json" {
                        json = true;
                    } else if !arg.starts_with('-') {
                        record_type = arg.as_str();
                    }
                }

                let mut url = reqwest::Url::parse("https://dns.google/resolve").unwrap();
                url.query_pairs_mut()
                    .append_pair("name", name)
                    .append_pair("type", record_type);

                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .map_err(|e| miette::miette!("HTTP client error: {e}"))?;

                let res =
                    client.get(url).send().await.map_err(|e| {
                        miette::miette!("Erreur lors de la requête DoH Google: {e}")
                    })?;

                let body: serde_json::Value = res
                    .json()
                    .await
                    .map_err(|e| miette::miette!("Réponse DoH JSON invalide: {e}"))?;

                if json {
                    println!("{}", serde_json::to_string_pretty(&body).unwrap());
                } else {
                    let status = body.get("Status").and_then(|s| s.as_i64()).unwrap_or(-1);
                    if status != 0 {
                        println!("{} Status: {}", "DNS Query Failed:".bold().red(), status);
                    } else if let Some(answers) = body.get("Answer").and_then(|a| a.as_array()) {
                        println!(
                            "{} {} ({})",
                            "🔍 Google Public DNS:".bold().green(),
                            name,
                            record_type
                        );
                        for ans in answers {
                            let data = ans.get("data").and_then(|d| d.as_str()).unwrap_or("");
                            let ttl = ans.get("TTL").and_then(|t| t.as_i64()).unwrap_or(0);
                            let t = ans.get("type").and_then(|t| t.as_i64()).unwrap_or(0);
                            println!(
                                "  {} {} (type {}, TTL {}s)",
                                "->".bold().cyan(),
                                data.bold(),
                                t,
                                ttl
                            );
                        }
                    } else {
                        println!(
                            "{} Aucun enregistrement trouvé pour {} ({})",
                            "ℹ".bold().yellow(),
                            name,
                            record_type
                        );
                    }
                }
                return Ok(());
            }
            "suggest" => {
                let query = self.args[1..]
                    .iter()
                    .filter(|a| !a.starts_with('-'))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ");
                if query.trim().is_empty() {
                    return Err(miette::miette!(
                        "Usage: aphrody google suggest <query> [--json]"
                    ));
                }
                let json = self.args.iter().any(|a| a == "--json");

                let mut url =
                    reqwest::Url::parse("https://suggestqueries.google.com/complete/search")
                        .unwrap();
                url.query_pairs_mut()
                    .append_pair("client", "chrome")
                    .append_pair("q", &query);

                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .map_err(|e| miette::miette!("HTTP client error: {e}"))?;

                let res = client.get(url).send().await.map_err(|e| {
                    miette::miette!("Erreur lors de la requête Google Suggest: {e}")
                })?;

                let body: serde_json::Value = res
                    .json()
                    .await
                    .map_err(|e| miette::miette!("Réponse Suggest JSON invalide: {e}"))?;

                let suggestions = body
                    .as_array()
                    .and_then(|a| a.get(1))
                    .and_then(|s| s.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.as_str().map(String::from))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                if json {
                    println!("{}", serde_json::to_string_pretty(&suggestions).unwrap());
                } else {
                    println!(
                        "{} {} ({} suggestions)",
                        "💡 Suggestions pour :".bold().blue(),
                        query,
                        suggestions.len()
                    );
                    for (i, s) in suggestions.iter().enumerate() {
                        println!("  {:2}. {}", i + 1, s.cyan());
                    }
                }
                return Ok(());
            }
            "languages" | "langs" => {
                let target = self
                    .args
                    .get(1)
                    .map(|s| s.as_str())
                    .filter(|s| !s.starts_with('-'));
                let json = self.args.iter().any(|a| a == "--json");
                let langs = aphrody_google::languages::supported_languages(target);
                if json {
                    println!("{}", serde_json::to_string_pretty(&langs).unwrap());
                } else {
                    println!(
                        "{} {} langues supportées",
                        "🌐 Google Translation:".bold().green(),
                        langs.data.languages.len()
                    );
                    for lang in &langs.data.languages {
                        if let Some(name) = &lang.name {
                            println!("  {:8} -> {}", lang.language.cyan().bold(), name);
                        } else {
                            println!("  {:8}", lang.language.cyan().bold());
                        }
                    }
                }
                return Ok(());
            }
            _ => {}
        }

        // Every other command (status, env, doctor, login, whoami, models, generate, …) is the
        // former aphrody-google CLI, run in process on its own thread (it builds its own runtime).
        let mut argv = vec![std::ffi::OsString::from("aphrody-google")];
        argv.extend(self.args.iter().map(std::ffi::OsString::from));
        match crate::multicall::run_isolated(aphrody_google::cli_main, argv) {
            0 => Ok(()),
            code => Err(miette::Report::new(SubprocessExit(code))),
        }
    }
}

/// Implementation of `aphrody translate [text]` with the configured translation backends.
pub(crate) struct TranslateCommand {
    pub text: Option<String>,
    pub source: String,
    pub target: String,
    pub backend: String,
    pub file: Option<PathBuf>,
    pub json: bool,
}

#[async_trait]
impl TerminalCommand for TranslateCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let cache_path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".aphrody-translate-cache.json");

        let backend = aphrody_translate::Backend::from_str_loose(&self.backend);
        let translator = aphrody_translate::Translator::new(cache_path, None)
            .map_err(|e| miette::miette!("{e}"))?
            .with_backend(backend);

        if self.json {
            let text = match (&self.text, &self.file) {
                (Some(text), None) => text.clone(),
                (None, Some(path)) => std::fs::read_to_string(path)
                    .map_err(|error| miette::miette!("Lecture {}: {error}", path.display()))?,
                _ => {
                    return Err(miette::miette!(
                        "Provide exactly one text or --file for JSON translation"
                    ));
                }
            };
            let translated = translator
                .translate_with_lang_strict(&text, &self.source, &self.target)
                .await
                .map_err(|error| miette::miette!("{error}"))?;
            println!(
                "{}",
                serde_json::json!({
                    "translatedText": translated,
                    "detectedSource": self.source,
                    "target": self.target,
                    "provider": "aphrody-translate",
                })
            );
            translator
                .persist()
                .map_err(|error| miette::miette!("{error}"))?;
            return Ok(());
        }

        if let Some(ref text) = self.text {
            let is_jp = self.source == "ja" || aphrody_translate::Translator::is_japanese(text);
            let res = if is_jp {
                translator
                    .translate_with_lang(text, "ja", &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            } else {
                let src = if self.source == "auto" {
                    "en"
                } else {
                    &self.source
                };
                translator
                    .translate_with_lang(text, src, &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            };

            println!("\n{}", "Traduction :".bold().green());
            println!("{res}\n");
            translator.persist().ok();
            return Ok(());
        }

        if let Some(ref path) = self.file {
            let content = std::fs::read_to_string(path)
                .map_err(|e| miette::miette!("Lecture {}: {e}", path.display()))?;
            let is_jp = self.source == "ja" || aphrody_translate::Translator::is_japanese(&content);
            let res = if is_jp {
                translator
                    .translate_with_lang(&content, "ja", &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            } else {
                let src = if self.source == "auto" {
                    "en"
                } else {
                    &self.source
                };
                translator
                    .translate_with_lang(&content, src, &self.target)
                    .await
                    .map_err(|e| miette::miette!("{e}"))?
            };
            println!("{res}");
            translator.persist().ok();
            return Ok(());
        }

        println!(
            "{}",
            "Veuillez fournir un texte à traduire ou un fichier (--help pour les options)".yellow()
        );
        Ok(())
    }
}

/// Implementation of `aphrody n2b <args…>` using the integrated N2B crate.
pub(crate) struct N2bCommand {
    pub args: Vec<String>,
}

#[async_trait]
impl TerminalCommand for N2bCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let mut args = vec!["n2b".to_string()];
        args.extend(self.args.iter().cloned());
        let status = aphrody_n2b::run_from(args).map_err(|e| miette::miette!("n2b: {e:#}"))?;
        if status != std::process::ExitCode::SUCCESS {
            return Err(miette::miette!("n2b a terminé avec un statut non nul"));
        }
        Ok(())
    }
}

/// Implementation of `aphrody ssh <args…>` — forwarder to aphrody-ssh operator.
pub(crate) struct SshCommand {
    pub args: Vec<String>,
}

pub(crate) fn is_openssh_config_dump(args: &[String]) -> bool {
    matches!(args, [flag, _host] if flag == "-G")
}

#[async_trait]
impl TerminalCommand for SshCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        // `ssh -G <host>` is OpenSSH's read-only resolved-config probe. Keep
        // Aphrody's structured operator subcommands as the default, while
        // preserving this essential diagnostic used before remote operations.
        if is_openssh_config_dump(&self.args) {
            let ssh = which::which("ssh")
                .map_err(|_| miette::miette!("OpenSSH `ssh` introuvable dans PATH"))?;
            let status = std::process::Command::new(&ssh)
                .no_window()
                .args(&self.args)
                .status()
                .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", ssh.display()))?;
            if !status.success() {
                return Err(miette::Report::new(SubprocessExit(
                    status.code().unwrap_or(1),
                )));
            }
            return Ok(());
        }

        if let Ok(explicit) = std::env::var("APHRODY_SSH_BIN") {
            let p = std::path::PathBuf::from(explicit.trim());
            if !explicit.trim().is_empty() && p.exists() {
                let status = std::process::Command::new(&p)
                    .no_window()
                    .args(&self.args)
                    .status()
                    .map_err(|e| miette::miette!("Échec du spawn `{}`: {e}", p.display()))?;
                if !status.success() {
                    return Err(miette::Report::new(SubprocessExit(
                        status.code().unwrap_or(1),
                    )));
                }
                return Ok(());
            }
        }

        let mut full_args = vec!["aphrody-ssh".to_string()];
        full_args.extend(self.args.clone());
        aphrody_ssh::run_from_args(full_args)
            .await
            .map_err(|e| miette::miette!("{e}"))?;
        Ok(())
    }
}

/// `aphrody search <query…>` — web search through the native SERP client of `aphrody web search`.
///
/// The hand-rolled DuckDuckGo scraper this command once carried is gone, and so is the delegation
/// to an external `bxc` executable: the query goes through [`aphrody_google::search`] in process.
/// A blocked anonymous query and a genuinely empty one are told apart: the first is an error that
/// names the cookie-authenticated route, the second prints an explicit "no result" line with the
/// profile that answered. There is no fallback to another scraper: it would bring the silent
/// failure back.
pub(crate) struct SearchCommand {
    pub provider: String,
    pub count: Option<u16>,
    pub offset: Option<u16>,
    pub freshness: Option<String>,
    pub country: Option<String>,
    pub json: bool,
    pub query: Vec<String>,
}

impl SearchCommand {
    async fn brave(&self, q: String) -> miette::Result<()> {
        use crate::brave_search as brave;
        let freshness = self
            .freshness
            .as_deref()
            .map(brave::validate_freshness)
            .transpose()
            .map_err(|e| miette::miette!("--freshness : {e}"))?;
        let key = brave::api_key(&aphrody_secrets::EnvSecretStore::new()).await?;
        let query = brave::WebQuery {
            q,
            count: self.count,
            offset: self.offset,
            freshness,
            country: self.country.clone(),
        };
        let hits = brave::web_search(&brave::base_url(), &key, &query).await?;
        if self.json {
            let out = serde_json::json!({ "provider": "brave", "query": query.q, "results": hits });
            println!(
                "{}",
                serde_json::to_string_pretty(&out).map_err(|e| miette::miette!("{e}"))?
            );
            return Ok(());
        }
        for hit in &hits {
            println!(
                "
{}",
                hit.title.bold().green()
            );
            println!("{}", hit.url.cyan().underline());
            if !hit.snippet.is_empty() {
                println!("{}", hit.snippet);
            }
        }
        println!(
            "
{}",
            "via Brave Search API".dimmed()
        );
        Ok(())
    }
}

#[async_trait]
impl TerminalCommand for SearchCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let q = self.query.join(" ");
        if q.trim().is_empty() {
            return Err(miette::miette!("requête vide"));
        }
        if self.provider == "brave" {
            return self.brave(q).await;
        }
        if !self.json {
            println!("{}", format!("🔍 Recherche : {}", q).bold().blue());
        }

        let num = u8::try_from(self.count.unwrap_or(10)).unwrap_or(u8::MAX);
        let options = aphrody_google::search::SearchOptions {
            num: Some(num),
            start: self.offset.map(u32::from),
            ..Default::default()
        };
        let results = match aphrody_google::search::search_rich(&q, &options).await {
            Ok(res) => res,
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("blocked")
                    || err_str.contains("interstitial")
                    || err_str.contains("organic")
                {
                    println!(
                        "\n{} {}",
                        "⚠️  Google a présenté un interstitiel anti-bot pour cette requête anonyme.".bold().yellow(),
                        "Utilisez `aphrody web search --cookies <cookies.json>` ou connectez-vous avec `aphrody google login`.".dimmed()
                    );
                    println!("\n{}", "Alternatives disponibles sans blocage :".bold());
                    println!(
                        "  • `aphrody docs search \"{}\"` pour la documentation technique",
                        q.cyan()
                    );
                    println!(
                        "  • `aphrody google suggest \"{}\"` pour les suggestions de complétion Google",
                        q.cyan()
                    );
                    return Ok(());
                }
                return Err(miette::miette!("{e}"));
            }
        };

        if self.json {
            let hits: Vec<_> = results
                .content
                .organic
                .iter()
                .take(usize::from(num))
                .map(|h| crate::brave_search::Hit {
                    title: h.title.clone(),
                    url: h.url.clone(),
                    snippet: h.snippet.clone(),
                })
                .collect();
            let out = serde_json::json!({ "provider": "google", "query": q, "results": hits });
            println!(
                "{}",
                serde_json::to_string_pretty(&out).map_err(|e| miette::miette!("{e}"))?
            );
            return Ok(());
        }
        for hit in results.content.organic.iter().take(usize::from(num)) {
            println!("\n{}", hit.title.bold().green());
            if !hit.url.is_empty() {
                println!("{}", hit.url.cyan().underline());
            }
            if !hit.snippet.is_empty() {
                println!("{}", hit.snippet);
            }
        }

        // The provenance line: which profile answered and whether a cookie jar was in play.
        // Without it a blocked anonymous query and a genuinely empty one look identical.
        println!(
            "\n{}",
            format!(
                "via Aphrody Web Rust · profil {:?} · {}",
                results.profile_used,
                if results.authenticated {
                    "authentifié"
                } else {
                    "anonyme"
                }
            )
            .dimmed()
        );

        if results.content.organic.is_empty() {
            println!(
                "{}",
                "Aucun résultat. Un profil anonyme est souvent bloqué : fournir un jar de cookies \
                 (`aphrody web search --cookies <fichier>`, `~/.aphrody/cookies/google.json`) \
                 pour de meilleurs résultats."
                    .red()
            );
        }

        Ok(())
    }
}

// ── aphrody doctor ───────────────────────────────────────────────────────────

use aphrody_diagnostics::doctor::DoctorReport;

pub(crate) struct DoctorCommand {
    pub json_output: bool,
}

#[async_trait]
impl TerminalCommand for DoctorCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let report = aphrody_diagnostics::doctor::collect_diagnostics(binary_version()).await;

        if self.json_output {
            println!(
                "{}",
                serde_json::to_string_pretty(&report.to_json())
                    .map_err(|e| miette::miette!("JSON serialization error: {e}"))?
            );
        } else {
            print_text(&report);
        }

        if report.verdict() == "UNHEALTHY" {
            return Err(miette::Report::new(SubprocessExit(1)));
        }
        Ok(())
    }
}

fn binary_version() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let sha = env!("APHRODY_GIT_SHA");
    let built_unix: u64 = env!("APHRODY_BUILD_UNIX").parse().unwrap_or(0);
    let target = env!("APHRODY_TARGET");
    let built_date = if built_unix > 0 {
        epoch_to_date(built_unix)
    } else {
        "unknown".to_string()
    };
    format!("{version} (commit {sha}, built {built_date}, target {target})")
}

fn print_text(r: &DoctorReport) {
    println!("aphrody doctor — environment + integration diagnostics");
    println!();
    println!("[runtime]");
    println!("  binary version: {}", r.binary_version);
    println!("  rustls CryptoProvider: {}", r.rustls_provider);
    println!("  reqwest TLS backend: {}", r.reqwest_tls);
    println!("  mimalloc allocator: {}", r.allocator);
    println!("  tokio runtime: {}", r.tokio_runtime);
    println!("{}", r.ai_json.line("ai.json"));
    println!("{}", r.agent_card.line("/.well-known/agent-card.json"));

    println!();
    println!("[peer A2A coord]");
    println!("{}", r.peer_heartbeat.line("peer winclean"));
    println!("{}", r.inbox.line("inbox-from-winclean.jsonl"));
    println!("{}", r.http_listener.line("HTTP listener"));

    println!();
    println!("[supply chain]");
    println!("  cargo-deny: not present at runtime — use the dev tool for CI");
    println!("{}", r.cargo_vet.line("cargo-vet audits"));

    println!();
    println!("[agent workspace]");
    println!("{}", r.workspace.line("agent home"));

    println!();
    println!("[environment]");
    for (var, val) in &r.env_vars {
        println!("  {var}: {val}");
    }

    println!();
    let verdict = r.verdict();
    let detail = match verdict {
        "UNHEALTHY" => "(one or more critical checks failed)",
        "DEGRADED" => "(peer offline or non-critical resource missing)",
        _ => "(all critical checks pass)",
    };
    println!("Verdict: {verdict} {detail}");
}

/// Convert a Unix epoch (seconds) to a YYYY-MM-DD string without external deps.
fn epoch_to_date(unix: u64) -> String {
    // Days since 1970-01-01.  Zeller / proleptic Gregorian.
    let days = unix / 86400;
    // Algorithm from https://www.researchgate.net/publication/316558298
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

// ── aphrody term ─────────────────────────────────────────────────────────────

/// Arguments for the `term` subcommand, mirroring the clap variant fields.
pub(crate) struct TermCommand {
    /// WebSocket bind address as a raw string (parsed at runtime).
    pub addr: String,
    /// Optional shell override forwarded to the backend.
    pub shell: Option<String>,
    /// Optional working directory forwarded to the backend.
    pub cwd: Option<PathBuf>,
    /// Optional authentication token for WebSocket clients.
    pub token: Option<String>,
}

impl TermCommand {
    pub(crate) fn validate_and_configure(
        &self,
    ) -> miette::Result<(SocketAddr, aphrody_terminal_backend::PtyConfig)> {
        let addr: SocketAddr = self
            .addr
            .parse()
            .map_err(|e| miette::miette!("invalid --addr '{}': {e}", self.addr))?;

        let env_token = std::env::var("APHRODY_OS_AUTH_TOKEN")
            .ok()
            .filter(|s| !s.is_empty());
        let explicit_token = self.token.clone().or(env_token);

        // Require authentication token when binding to non-loopback addresses (e.g. 0.0.0.0)
        if !addr.ip().is_loopback() && explicit_token.is_none() {
            return Err(miette::miette!(
                "binding aphrody term to non-loopback address '{addr}' requires authentication; specify --token or set APHRODY_OS_AUTH_TOKEN"
            ));
        }

        let token = explicit_token.unwrap_or_else(aphrody_terminal_backend::generate_token);

        let cfg = aphrody_terminal_backend::PtyConfig {
            cols: 80,
            rows: 24,
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            auth_token: Some(token),
            ..aphrody_terminal_backend::PtyConfig::default()
        };

        Ok((addr, cfg))
    }
}

#[async_trait]
impl TerminalCommand for TermCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let (addr, cfg) = self.validate_and_configure()?;
        let token = cfg.auth_token.as_deref().unwrap_or("");

        eprintln!("aphrody term: auth token: {token}");
        eprintln!("aphrody term: ws://{addr}/?token={token} (open the WASM UI to connect)");

        tokio::select! {
            res = aphrody_terminal_backend::serve(addr, cfg) => {
                res.map_err(|e| miette::miette!("terminal server error: {e:#}"))?;
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\naphrody term: received Ctrl-C, shutting down");
            }
        }

        Ok(())
    }
}

// ── aphrody notify ───────────────────────────────────────────────────────────
//
// Thin facade over `aphrody-channels` (Slack / Telegram / Matrix). Reads
// credentials + destination from environment variables; returns a clean
// `miette::Report` (exit code 1) when any required variable is missing rather
// than panicking.

#[cfg(test)]
mod term_command_tests {
    use super::*;

    #[test]
    fn term_command_rejects_non_loopback_without_auth() {
        // Ensure env var is absent for this test
        let _env_guard = std::env::var("APHRODY_OS_AUTH_TOKEN").ok();
        unsafe {
            std::env::remove_var("APHRODY_OS_AUTH_TOKEN");
        }

        let cmd = TermCommand {
            addr: "0.0.0.0:8788".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let res = cmd.validate_and_configure();
        assert!(res.is_err(), "non-loopback without token must be rejected");
        let err_str = res.unwrap_err().to_string();
        assert!(
            err_str.contains("non-loopback address"),
            "unexpected error: {err_str}"
        );

        if let Some(tok) = _env_guard {
            unsafe {
                std::env::set_var("APHRODY_OS_AUTH_TOKEN", tok);
            }
        }
    }

    #[test]
    fn term_command_accepts_non_loopback_with_explicit_token() {
        let cmd = TermCommand {
            addr: "0.0.0.0:8788".to_string(),
            shell: None,
            cwd: None,
            token: Some("custom-token-secret-1234567890".to_string()),
        };

        let (addr, cfg) = cmd
            .validate_and_configure()
            .expect("should accept with explicit token");
        assert_eq!(addr, "0.0.0.0:8788".parse().unwrap());
        assert_eq!(
            cfg.auth_token.as_deref(),
            Some("custom-token-secret-1234567890")
        );
    }

    #[test]
    fn term_command_generates_token_for_loopback_when_unset() {
        let _env_guard = std::env::var("APHRODY_OS_AUTH_TOKEN").ok();
        unsafe {
            std::env::remove_var("APHRODY_OS_AUTH_TOKEN");
        }

        let cmd = TermCommand {
            addr: "127.0.0.1:8788".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let (addr, cfg) = cmd
            .validate_and_configure()
            .expect("loopback should succeed");
        assert_eq!(addr, "127.0.0.1:8788".parse().unwrap());
        let token = cfg.auth_token.expect("token should be generated");
        assert_eq!(token.len(), 32);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));

        if let Some(tok) = _env_guard {
            unsafe {
                std::env::set_var("APHRODY_OS_AUTH_TOKEN", tok);
            }
        }
    }

    #[test]
    fn term_command_rejects_invalid_addr() {
        let cmd = TermCommand {
            addr: "not-a-valid-addr".to_string(),
            shell: None,
            cwd: None,
            token: None,
        };

        let res = cmd.validate_and_configure();
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("invalid --addr"));
    }
}
