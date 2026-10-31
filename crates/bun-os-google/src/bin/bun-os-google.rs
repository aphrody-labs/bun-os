//! `bun-os-google`: Google access of the Bun OS backend.
//!
//! * `serve [--listen 127.0.0.1:8796]`: the `/api/google/*` routes on loopback (nginx proxies
//!   `https://aphrody.com/api/google/`).
//! * `status`: service-account and owner-link state (no token material).
//! * `check`: real calls: Cloud Storage buckets as the service account; Drive root, Gmail labels and
//!   calendars as the owner when linked.
//!
//! Configuration comes from the environment, completed by `/etc/aphrody/google.env` (or
//! `APHRODY_GOOGLE_ENV`) for keys that are not already set. Nothing secret is printed.

// Standalone service binary: std I/O and env are intended here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types, clippy::disallowed_macros)]

use bun_google::cloud::server::{GoogleService, router};
use bun_google::cloud::api;
use std::process::ExitCode;
use std::sync::Arc;

fn load_env_file() {
    let path = std::env::var("APHRODY_GOOGLE_ENV").unwrap_or_else(|_| "/etc/aphrody/google.env".into());
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            if std::env::var_os(k).is_none() {
                // SAFETY: single-threaded at this point (before the runtime starts).
                unsafe { std::env::set_var(k, v.trim().trim_matches('"')) };
            }
        }
    }
}

fn names(v: &serde_json::Value, list: &str, field: &str) -> Vec<String> {
    v[list]
        .as_array()
        .map(|a| a.iter().filter_map(|i| i[field].as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

async fn check(svc: &GoogleService) -> bool {
    let mut ok = true;
    match &svc.adc {
        Some(a) => {
            println!("service account: {} ({})", a.credentials().principal(), a.credentials().kind());
            match a.token(&[]).await {
                Ok(t) => match api::gcs_buckets(&t, &svc.project).await {
                    Ok(v) => println!("  gcs buckets: {}", names(&v, "items", "name").join(", ")),
                    Err(e) => {
                        ok = false;
                        println!("  gcs buckets: {e}");
                    }
                },
                Err(e) => {
                    ok = false;
                    println!("  token: {e}");
                }
            }
        }
        None => {
            ok = false;
            println!("service account: {}", svc.adc_error.as_deref().unwrap_or("not configured"));
        }
    }
    match svc.owner.status() {
        Ok(st) if st.linked => {
            println!("owner: {} ({} scopes)", st.email.as_deref().unwrap_or("?"), st.scopes.len());
            match svc.owner.access_token().await {
                Ok(t) => {
                    match api::drive_root(&t, 20).await {
                        Ok(v) => println!("  drive root: {} entries", names(&v, "files", "name").len()),
                        Err(e) => println!("  drive root: {e}"),
                    }
                    match api::gmail_labels(&t).await {
                        Ok(v) => println!("  gmail labels: {}", names(&v, "labels", "name").len()),
                        Err(e) => println!("  gmail labels: {e}"),
                    }
                    match api::calendar_list(&t).await {
                        Ok(v) => println!("  calendars: {}", names(&v, "items", "id").len()),
                        Err(e) => println!("  calendars: {e}"),
                    }
                }
                Err(e) => {
                    ok = false;
                    println!("  token: {e}");
                }
            }
        }
        Ok(st) => println!(
            "owner: not linked (client configured: {}, redirect: {})",
            st.client_configured,
            st.redirect_uri.as_deref().unwrap_or("-")
        ),
        Err(e) => println!("owner: {e}"),
    }
    ok
}

fn main() -> ExitCode {
    load_env_file();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map_or("status", String::as_str);
    let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    rt.block_on(async {
        let svc = Arc::new(GoogleService::from_env());
        match cmd {
            "serve" => {
                let listen = args
                    .iter()
                    .position(|a| a == "--listen")
                    .and_then(|i| args.get(i + 1))
                    .cloned()
                    .unwrap_or_else(|| "127.0.0.1:8796".into());
                let listener = match tokio::net::TcpListener::bind(&listen).await {
                    Ok(l) => l,
                    Err(e) => {
                        eprintln!("bind {listen}: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                eprintln!("bun-os-google listening on {listen}");
                let app = router(svc);
                let shutdown = async {
                    let _ = tokio::signal::ctrl_c().await;
                };
                match axum::serve(listener, app).with_graceful_shutdown(shutdown).await {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(e) => {
                        eprintln!("serve: {e}");
                        ExitCode::FAILURE
                    }
                }
            }
            "status" => {
                let owner = svc.owner.status().ok();
                let sa = svc.adc.as_ref().map(|a| {
                    serde_json::json!({"kind": a.credentials().kind(), "principal": a.credentials().principal(), "file": a.path()})
                });
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "project": svc.project,
                        "service_account": sa,
                        "service_account_error": svc.adc_error,
                        "owner": owner,
                    }))
                    .unwrap_or_default()
                );
                ExitCode::SUCCESS
            }
            // Host tools only (stdout is meant for a pipe or a 0600 file, never a log).
            "token" | "rclone-config" => {
                let flag = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
                let account = flag("--account").unwrap_or_else(|| "owner".into());
                let res = match (cmd, account.as_str()) {
                    ("token", "owner") => svc.owner.access_token().await,
                    ("token", "microsoft") => svc.microsoft.access_token().await,
                    ("token", "service") => match &svc.adc {
                        Some(a) => {
                            let scope = flag("--scope").unwrap_or_default();
                            let scopes: Vec<&str> = scope.split_whitespace().collect();
                            a.token(&scopes).await
                        }
                        None => Err(bun_google::cloud::Error::Config("no ADC".into())),
                    },
                    ("rclone-config", "owner") => svc.owner.rclone_remote(&flag("--name").unwrap_or_else(|| "gdrive".into())).await,
                    ("rclone-config", "microsoft") => {
                        svc.microsoft.rclone_remote(&flag("--name").unwrap_or_else(|| "onedrive".into())).await
                    }
                    _ => Err(bun_google::cloud::Error::Config(format!("unknown account {account}"))),
                };
                match res {
                    Ok(v) => {
                        println!("{v}");
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("{e}");
                        ExitCode::FAILURE
                    }
                }
            }
            "check" => {
                if check(&svc).await {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::FAILURE
                }
            }
            _ => {
                eprintln!("usage: bun-os-google [serve [--listen addr] | status | check | token [--account owner|microsoft|service] [--scope s] | rclone-config [--account owner|microsoft] [--name n]]");
                ExitCode::from(2)
            }
        }
    })
}
