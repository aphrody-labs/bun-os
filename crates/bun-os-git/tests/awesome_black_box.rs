// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use bun_git::{parse_awesome_markdown, resolve_preset};

const SAMPLE_AWESOME_MARKDOWN: &str = r#"
# Awesome Bun [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> A curated list of awesome things related to Bun.

## Contents

- [Frameworks](#frameworks)
- [Utilities](#utilities)
- [Terminal & TUI](#terminal--tui)

## Frameworks

- [Elysia](https://github.com/elysiajs/elysia) - Ergonomic Framework for Humans.
- [Hono](https://github.com/honojs/hono) — Fast, lightweight, Web-standards based web framework.

### Fullstack

- [Next.js](https://github.com/vercel/next.js) : The React Framework for the Web.

## Terminal & TUI

* [Ratatui](https://github.com/ratatui/ratatui) - Rust library for cooking up terminal user interfaces.
* [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) - A collection of common interactive command line user interfaces.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.
"#;

#[test]
fn test_parse_awesome_markdown() {
    let index =
        parse_awesome_markdown("awesome-bun", "oven-sh/awesome-bun", SAMPLE_AWESOME_MARKDOWN);

    assert_eq!(index.name, "awesome-bun");
    assert_eq!(index.repository, "oven-sh/awesome-bun");
    assert_eq!(index.total_items, 5);

    // Categories: Contents and Contributing are ignored
    let cat_names: Vec<&str> = index.categories.iter().map(|c| c.name.as_str()).collect();
    assert!(cat_names.contains(&"Frameworks"));
    assert!(cat_names.contains(&"Fullstack"));
    assert!(cat_names.contains(&"Terminal & TUI"));
    assert!(!cat_names.contains(&"Contents"));
    assert!(!cat_names.contains(&"Contributing"));

    // Find Elysia
    let elysia = index
        .categories
        .iter()
        .flat_map(|c| &c.items)
        .find(|i| i.title == "Elysia")
        .expect("Elysia found");

    assert_eq!(elysia.url, "https://github.com/elysiajs/elysia");
    assert_eq!(elysia.description, "Ergonomic Framework for Humans");
    assert_eq!(elysia.github_repo, Some("elysiajs/elysia".to_string()));
    assert_eq!(elysia.category, "Frameworks");

    // Find Ratatui
    let ratatui = index
        .categories
        .iter()
        .flat_map(|c| &c.items)
        .find(|i| i.title == "Ratatui")
        .expect("Ratatui found");

    assert_eq!(ratatui.github_repo, Some("ratatui/ratatui".to_string()));
    assert_eq!(ratatui.category, "Terminal & TUI");
}

#[test]
fn test_search_awesome_index() {
    let index =
        parse_awesome_markdown("awesome-bun", "oven-sh/awesome-bun", SAMPLE_AWESOME_MARKDOWN);

    // Search by title
    let res1 = index.search("elysia");
    assert_eq!(res1.len(), 1);
    assert_eq!(res1[0].title, "Elysia");

    // Search by description keyword
    let res2 = index.search("terminal");
    assert_eq!(res2.len(), 2); // Ratatui (desc and cat) & Inquirer (desc)

    // Search by repo owner
    let res3 = index.search("honojs");
    assert_eq!(res3.len(), 1);
    assert_eq!(res3[0].title, "Hono");
}

#[test]
fn test_presets_resolution() {
    let (owner, repo, branch) = resolve_preset("bun");
    assert_eq!(owner, "oven-sh");
    assert_eq!(repo, "awesome-bun");
    assert_eq!(branch, "main");

    let (owner, repo, branch) = resolve_preset("rust");
    assert_eq!(owner, "rust-unofficial");
    assert_eq!(repo, "awesome-rust");
    assert_eq!(branch, "main");

    let (owner, repo, branch) = resolve_preset("tauri");
    assert_eq!(owner, "tauri-apps");
    assert_eq!(repo, "awesome-tauri");
    assert_eq!(branch, "dev");

    let (owner, repo, branch) = resolve_preset("awesome");
    assert_eq!(owner, "sindresorhus");
    assert_eq!(repo, "awesome");
    assert_eq!(branch, "main");

    let (owner, repo, branch) = resolve_preset("custom-org/awesome-custom");
    assert_eq!(owner, "custom-org");
    assert_eq!(repo, "awesome-custom");
    assert_eq!(branch, "main");
}

#[test]
fn test_to_markdown_formatting() {
    let mut index = parse_awesome_markdown("test", "test/test", SAMPLE_AWESOME_MARKDOWN);
    index.categories[0].items[0].stars = Some(15200);
    index.categories[0].items[0].has_llms_txt = Some(true);

    let md = index.to_markdown();
    assert!(md.contains("# Awesome List: test"));
    assert!(md.contains("(⭐ 15200)"));
    assert!(md.contains("`[llms.txt]`"));
}
