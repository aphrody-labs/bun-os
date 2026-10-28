// SPDX-License-Identifier: Apache-2.0
//! Thin CLI over the canonical request, cookie, transport and SERP owners.
use super::{
    SearchOptions, SearchTransport, parse_search_request, project_search_result, search_rich,
    search_url,
};
use serde_json::{Value, json};
use std::{ffi::OsString, path::PathBuf, time::Duration};

pub const HELP: &str = include_str!("help.txt");

pub struct SearchCommand {
    pub query: String,
    pub options: SearchOptions,
    pub rich: bool,
    pub json: bool,
    pub timeout: Duration,
}

pub fn parse(args: &[OsString]) -> Result<Option<SearchCommand>, &'static str> {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(None);
    }
    let mut request = json!({"num":10});
    let mut query = Vec::new();
    let mut json_output = false;
    let mut timeout = 30_000u64;
    let mut positional = false;
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].to_str().ok_or("Arguments must be UTF-8")?;
        index += 1;
        if !positional && arg == "--" {
            positional = true;
            continue;
        }
        if positional || !arg.starts_with('-') {
            query.push(arg);
            continue;
        }
        match arg {
            "--json" => json_output = true,
            "--anonymous" => request["anonymous"] = json!(true),
            "--rich" => request["rich"] = json!(true),
            "--num" | "--start" | "--timeout-ms" | "--hl" | "--gl" | "--domain" | "--safe" => {
                let value = args
                    .get(index)
                    .and_then(|value| value.to_str())
                    .ok_or("Option requires a value")?;
                index += 1;
                if matches!(arg, "--num" | "--start" | "--timeout-ms") {
                    let number = value
                        .parse::<u64>()
                        .map_err(|_| "Option requires an unsigned integer")?;
                    if arg == "--timeout-ms" {
                        timeout = number;
                    } else {
                        request[&arg[2..]] = json!(number);
                    }
                } else {
                    request[&arg[2..]] = json!(value);
                }
            }
            _ => return Err("Unknown search option"),
        }
    }
    if !(1..=120_000).contains(&timeout) {
        return Err("Search deadline must be between 1 and 120000 ms");
    }
    request["query"] = json!(query.join(" "));
    let (query, mut options, rich) =
        parse_search_request(&request).map_err(|_| "Invalid search request")?;
    search_url(&query, &options).map_err(|_| "Invalid Google search domain or options")?;
    options.transport = SearchTransport::Fetch;
    options.require_authenticated = !options.anonymous;
    if !options.anonymous {
        options.cookie_path = Some(canonical_cookie_path()?);
    }
    Ok(Some(SearchCommand {
        query,
        options,
        rich,
        json: json_output,
        timeout: Duration::from_millis(timeout),
    }))
}

fn canonical_cookie_path() -> Result<PathBuf, &'static str> {
    let path = if let Some(path) =
        std::env::var_os("APHRODY_GOOGLE_COOKIES_JSON").filter(|value| !value.is_empty())
    {
        PathBuf::from(path)
    } else {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .ok_or("Google cookie home is unavailable")?;
        PathBuf::from(home).join(".aphrody/google-cookies.json")
    };
    if !path.is_absolute() {
        return Err("Google cookie path must be absolute");
    }
    Ok(path)
}

pub async fn execute(command: &SearchCommand) -> Result<Value, &'static str> {
    execute_with(command, search_rich(&command.query, &command.options)).await
}

async fn execute_with<F>(command: &SearchCommand, request: F) -> Result<Value, &'static str>
where
    F: std::future::Future<Output = Result<super::RichSearchResult, String>>,
{
    let result = tokio::time::timeout(command.timeout, request)
        .await
        .map_err(|_| "Google search deadline exceeded")?
        .map_err(
            |_| "Google search failed; account cookies, network or consent may be unavailable",
        )?;
    Ok(project_search_result(&result, command.rich))
}

/// Runs before the JS VM, with a bounded native future and SIGINT cancellation.
pub fn main(args: Vec<OsString>) -> i32 {
    let command = match parse(&args) {
        Ok(None) => {
            crate::search::output::print(format_args!("{HELP}"));
            return 0;
        }
        Ok(Some(command)) => command,
        Err(error) => {
            crate::search::output::print_errorln(format_args!("bun search: {error}"));
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            crate::search::output::print_errorln(format_args!("bun search: native executor unavailable"));
            return 2;
        }
    };
    runtime.block_on(async {
        tokio::select! {
            result = execute(&command) => match result {
                Ok(value) => {
                    if command.json { crate::search::output::print(format_args!("{value}\n")); }
                    else if let Some(rows) = value["organic"].as_array() {
                        for row in rows { crate::search::output::print(format_args!("{}\n{}\n{}\n\n", row["title"].as_str().unwrap_or_default(), row["url"].as_str().unwrap_or_default(), row["snippet"].as_str().unwrap_or_default())); }
                    }
                    0
                },
                Err(error) => { crate::search::output::print_errorln(format_args!("bun search: {error}")); 2 },
            },
            _ = tokio::signal::ctrl_c() => { crate::search::output::print_errorln(format_args!("bun search: cancelled")); 130 },
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn help_never_reads_credentials_and_options_reuse_native_validation() {
        assert!(parse(&args(&["--help"])).unwrap().is_none());
        let command = parse(&args(&[
            "--anonymous",
            "--json",
            "--hl",
            "fr",
            "--num",
            "3",
            "rust & bun",
        ]))
        .unwrap()
        .unwrap();
        assert!(command.options.anonymous);
        assert!(!command.options.require_authenticated);
        assert!(command.options.cookie_path.is_none());
        assert_eq!(command.options.num, Some(3));
        assert_eq!(command.query, "rust & bun");
        assert!(command.json);
        for values in [
            vec!["--anonymous", "--num", "0", "query"],
            vec!["--anonymous", "--domain", "evil.example", "query"],
            vec!["--timeout-ms", "0", "query"],
            vec!["--cookies", "secret"],
        ] {
            assert!(parse(&args(&values)).is_err());
        }
    }

    #[test]
    fn authenticated_cli_selects_only_the_canonical_owner_and_has_no_cache() {
        let command = parse(&args(&["--json", "query"])).unwrap().unwrap();
        assert!(command.options.require_authenticated);
        assert!(!command.options.anonymous);
        assert_eq!(command.options.transport, SearchTransport::Fetch);
        assert_eq!(
            command.options.cookie_path,
            Some(canonical_cookie_path().unwrap())
        );
        assert!(command.options.cache_ttl_ms.is_none());
    }
    #[tokio::test]
    async fn native_fixture_projection_and_deadline_do_not_expose_private_request_state() {
        let mut command = parse(&args(&["--anonymous", "--json", "fixture"]))
            .unwrap()
            .unwrap();
        let html = r#"<div class="g"><a href="https://example.org/evidence"><h3>Fixture evidence</h3></a><div class="VwiC3b">Public snippet.</div></div>"#;
        let content = super::super::parse_serp(html, "fixture");
        let result = execute_with(&command, async {
            Ok(super::super::RichSearchResult {
                content,
                served_from_cache: false,
                profile_used: SearchTransport::Fetch,
                authenticated: false,
            })
        })
        .await
        .unwrap();
        assert_eq!(result["organic"][0]["url"], "https://example.org/evidence");
        assert_eq!(result["organic"][0]["title"], "Fixture evidence");
        assert_eq!(result["authenticated"], false);
        assert!(result.get("cookie_path").is_none());
        command.timeout = Duration::from_millis(5);
        assert_eq!(
            execute_with(&command, std::future::pending())
                .await
                .unwrap_err(),
            "Google search deadline exceeded"
        );
        assert_eq!(
            execute_with(&command, async { Err("synthetic private failure".into()) })
                .await
                .unwrap_err(),
            "Google search failed; account cookies, network or consent may be unavailable"
        );
    }
}
