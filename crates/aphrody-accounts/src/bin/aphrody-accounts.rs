//! `aphrody-accounts`: sign in, list, switch and remove Google / Microsoft accounts.
//!
//! OAuth clients come from the environment (`APHRODY_GOOGLE_CLIENT_ID`, `APHRODY_GOOGLE_CLIENT_SECRET`,
//! `APHRODY_MS_CLIENT_ID`, `APHRODY_MS_TENANT`) or, with `--gcloud-project <id>`, from Secret Manager
//! (`ACCOUNTS_GOOGLE_DESKTOP_CLIENT_ID`, `ACCOUNTS_GOOGLE_DESKTOP_CLIENT_SECRET`,
//! `ACCOUNTS_MICROSOFT_CLIENT_ID`) through the `gcloud` CLI. Values are held in memory only and never printed.

use aphrody_accounts::scopes::{Access, Service, scopes_for};
use aphrody_accounts::{
    AccountManager, Provider, ProviderConfig, Tenant, TokenSource, UreqTransport,
};
use std::process::{Command, ExitCode};
use std::sync::Arc;
use std::time::Duration;

fn config_dir() -> std::path::PathBuf {
    if let Some(d) = std::env::var_os("APHRODY_ACCOUNTS_DIR") {
        return d.into();
    }
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(std::path::PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")));
    base.unwrap_or_else(|| ".".into()).join("aphrody")
}

fn secret_manager(project: &str, name: &str) -> Option<String> {
    let exe = if cfg!(windows) {
        "gcloud.cmd"
    } else {
        "gcloud"
    };
    let out = Command::new(exe)
        .args([
            "secrets",
            "versions",
            "access",
            "latest",
            "--secret",
            name,
            "--project",
            project,
        ])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
fn flags(args: &[String], name: &str) -> Vec<String> {
    args.iter()
        .enumerate()
        .filter(|(_, a)| *a == name)
        .filter_map(|(i, _)| args.get(i + 1).cloned())
        .collect()
}
fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

fn open_browser(url: &str) {
    eprintln!("Open this URL to sign in:\n{url}\n");
    #[cfg(windows)]
    let _ = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

fn services(args: &[String]) -> Vec<Service> {
    flag(args, "--service")
        .map(|s| {
            s.split(',')
                .filter_map(|n| match n.trim() {
                    "files" | "drive" | "onedrive" => Some(Service::Files),
                    "docs" => Some(Service::Docs),
                    "sheets" => Some(Service::Sheets),
                    "slides" => Some(Service::Slides),
                    "calendar" => Some(Service::Calendar),
                    "mail" | "gmail" => Some(Service::Mail),
                    "contacts" => Some(Service::Contacts),
                    "tasks" => Some(Service::Tasks),
                    "photos" => Some(Service::Photos),
                    "youtube" => Some(Service::YouTube),
                    "play" => Some(Service::PlayConsole),
                    "cloud" => Some(Service::CloudPlatform),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_manager(args: &[String]) -> Result<AccountManager, String> {
    let vault: Arc<dyn aphrody_accounts::TokenVault> = {
        #[cfg(feature = "os-keyring")]
        {
            Arc::new(aphrody_accounts::KeyringVault::new("aphrody-accounts"))
        }
        #[cfg(not(feature = "os-keyring"))]
        {
            return Err("built without the `os-keyring` feature: no persistent vault".into());
        }
    };
    let m = AccountManager::open(
        config_dir().join("accounts.json"),
        vault,
        Arc::new(UreqTransport::new()),
    )
    .map_err(|e| e.to_string())?;
    let project = flag(args, "--gcloud-project");
    let get = |env: &str, secret: &str| {
        std::env::var(env)
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| project.as_deref().and_then(|p| secret_manager(p, secret)))
    };
    if let Some(id) = get(
        "APHRODY_GOOGLE_CLIENT_ID",
        "ACCOUNTS_GOOGLE_DESKTOP_CLIENT_ID",
    ) {
        let secret = get(
            "APHRODY_GOOGLE_CLIENT_SECRET",
            "ACCOUNTS_GOOGLE_DESKTOP_CLIENT_SECRET",
        );
        m.register_client(ProviderConfig::google(id, secret));
    }
    if let Some(id) = get("APHRODY_MS_CLIENT_ID", "ACCOUNTS_MICROSOFT_CLIENT_ID") {
        let tenant = flag(args, "--tenant")
            .or_else(|| std::env::var("APHRODY_MS_TENANT").ok())
            .map_or(Tenant::Common, |t| Tenant::parse(&t));
        m.register_client(ProviderConfig::microsoft(id, tenant));
    }
    Ok(m)
}

fn run(args: &[String]) -> Result<(), String> {
    let cmd = args.first().map_or("help", String::as_str);
    let rest = &args[args.len().min(1)..];
    match cmd {
        "scopes" => {
            let p = rest
                .first()
                .and_then(|s| Provider::parse(s))
                .unwrap_or(Provider::Google);
            for (name, s) in [
                ("files", Service::Files),
                ("docs", Service::Docs),
                ("sheets", Service::Sheets),
                ("slides", Service::Slides),
                ("calendar", Service::Calendar),
                ("mail", Service::Mail),
                ("contacts", Service::Contacts),
                ("tasks", Service::Tasks),
                ("photos", Service::Photos),
                ("youtube", Service::YouTube),
                ("play", Service::PlayConsole),
                ("cloud", Service::CloudPlatform),
            ] {
                for a in [Access::Read, Access::Write] {
                    println!("{name:9} {a:5?} {}", scopes_for(p, &[s], a).join(" "));
                }
            }
            Ok(())
        }
        "list" => {
            let m = build_manager(rest)?;
            let active = m.active().map(|a| a.id);
            for a in m.list() {
                println!(
                    "{} {} {}{}",
                    if active.as_deref() == Some(a.id.as_str()) {
                        "*"
                    } else {
                        " "
                    },
                    a.id,
                    a.label,
                    if a.needs_reauth {
                        "  (sign-in required)"
                    } else {
                        ""
                    }
                );
            }
            Ok(())
        }
        "login" => {
            let provider = rest
                .first()
                .and_then(|s| Provider::parse(s))
                .ok_or("usage: login <google|microsoft> [options]")?;
            let m = build_manager(rest)?;
            let access = if flag(rest, "--access").as_deref() == Some("read") {
                Access::Read
            } else {
                Access::Write
            };
            let mut wanted: Vec<String> = scopes_for(provider, &services(rest), access)
                .into_iter()
                .map(str::to_owned)
                .collect();
            wanted.extend(flags(rest, "--scope"));
            let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
            let hint = flag(rest, "--hint");
            let acct = if has(rest, "--device") {
                let dc = m.begin_device(provider, &refs).map_err(|e| e.to_string())?;
                eprintln!(
                    "{}",
                    dc.message.clone().unwrap_or_else(|| format!(
                        "Go to {} and enter {}",
                        dc.verification_uri, dc.user_code
                    ))
                );
                m.finish_device(provider, &dc, &std::thread::sleep)
                    .map_err(|e| e.to_string())?
            } else {
                m.login_loopback(
                    provider,
                    &refs,
                    hint.as_deref(),
                    has(rest, "--consent"),
                    &open_browser,
                    Duration::from_secs(300),
                )
                .map_err(|e| e.to_string())?
            };
            println!("signed in: {} ({})", acct.label, acct.id);
            Ok(())
        }
        "switch" => {
            let m = build_manager(rest)?;
            m.set_active(rest.first().ok_or("usage: switch <account-id>")?)
                .map_err(|e| e.to_string())
        }
        "remove" => {
            let m = build_manager(rest)?;
            m.remove(
                rest.first()
                    .ok_or("usage: remove <account-id> [--revoke]")?,
                has(rest, "--revoke"),
            )
            .map_err(|e| e.to_string())
        }
        "exec" => {
            // exec --account ID --scope S ... -- cmd args: runs cmd with APHRODY_ACCESS_TOKEN set; the token is never printed.
            let split = rest
                .iter()
                .position(|a| a == "--")
                .ok_or("usage: exec --account <id> [--scope S]... -- <command> [args]")?;
            let (opts, cmdline) = (&rest[..split], &rest[split + 1..]);
            let m = build_manager(opts)?;
            let id = flag(opts, "--account")
                .or_else(|| m.active().map(|a| a.id))
                .ok_or("no account")?;
            let sc = flags(opts, "--scope");
            let refs: Vec<&str> = sc.iter().map(String::as_str).collect();
            let token = m.bearer(&id, &refs).map_err(|e| e.to_string())?;
            let (prog, pargs) = cmdline.split_first().ok_or("missing command")?;
            let status = Command::new(prog)
                .args(pargs)
                .env("APHRODY_ACCESS_TOKEN", token)
                .status()
                .map_err(|e| e.to_string())?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("command exited with {status}"))
            }
        }
        _ => {
            println!(
                "aphrody-accounts <scopes [provider] | list | login <google|microsoft> [--device] [--service files,docs,...] [--access read|write] [--scope S] [--tenant T] [--hint EMAIL] [--consent] [--gcloud-project ID] | switch ID | remove ID [--revoke] | exec --account ID [--scope S] -- CMD>"
            );
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
