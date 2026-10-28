// SPDX-License-Identifier: Apache-2.0
//! Shared native Google Search API.

pub mod cli;
mod discovery;
mod network;
mod request;
mod serp;

pub(crate) mod output {
    use std::io::Write;
    pub(crate) fn print(args: std::fmt::Arguments<'_>) {
        let _ = std::io::stdout().write_fmt(args);
    }
    pub(crate) fn print_errorln(args: std::fmt::Arguments<'_>) {
        let _ = writeln!(std::io::stderr(), "{args}");
    }
}

pub use discovery::{
    GoogleVertical, autocomplete, parse_vertical, resolve_dns, search_books, search_vertical,
};

pub use network::{
    RichSearchResult, SearchOptions, SearchTransport, is_blocked_serp_html, is_google_domain,
    search_rich, search_url,
};
pub use request::{
    execute_search_request, parse_search_request, project_search_result, project_vertical_result,
};
pub use serp::{FeaturedSnippet, KnowledgePanel, OrganicResult, SerpContent, parse_serp};
