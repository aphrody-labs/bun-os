// SPDX-License-Identifier: Apache-2.0
//! Google SERP parsing ported from aphrody-web commit bbeb5ef4.

use std::{collections::HashSet, sync::LazyLock};

use bun_browser_dom::{DomTree, NodeId, parse_html};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganicResult {
    pub position: usize,
    pub title: String,
    pub url: String,
    pub displayed_url: String,
    pub snippet: String,
    pub is_sponsored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeaturedSnippet {
    pub title: String,
    pub url: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePanel {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub description: String,
    pub metadata: std::collections::BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerpContent {
    pub query: String,
    pub organic: Vec<OrganicResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub featured_snippet: Option<FeaturedSnippet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge_panel: Option<KnowledgePanel>,
    pub people_also_ask: Vec<String>,
    pub related_searches: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_results: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_time_ms: Option<u64>,
    pub json_ld: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corrected_query: Option<String>,
}

fn select(tree: &DomTree, selector: &str) -> Vec<NodeId> {
    tree.query_selector_all(selector).unwrap_or_default()
}

fn first(tree: &DomTree, root: NodeId, selector: &str) -> Option<NodeId> {
    tree.query_selector_from(root, selector).ok().flatten()
}

fn attr(tree: &DomTree, node: NodeId, name: &str) -> Option<String> {
    tree.with_node(node, |node| node.get_attribute(name).map(str::to_owned)).flatten()
}

fn clean_text(text: &str) -> String {
    static TRAILING: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\s*(?:Read more|More results|More|En savoir plus|Plus de résultats)\s*$")
            .expect("static regex")
    });
    static WHITESPACE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\s+").expect("static regex"));
    let text = TRAILING.replace(text, "");
    WHITESPACE.replace_all(text.trim(), " ").into_owned()
}

fn clean_result_url(raw: &str) -> Option<String> {
    let mut href = raw.trim().to_owned();
    if href.starts_with("/url?") || href.starts_with("/url%3F") {
        let wrapper = Url::parse(&format!("https://www.google.com{href}")).ok()?;
        href = wrapper
            .query_pairs()
            .find_map(|(key, value)| (key == "q" || key == "url").then(|| value.into_owned()))?;
    }
    let parsed = Url::parse(&href).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let google_host = host == "google.com" || host.ends_with(".google.com");
    if google_host
        && (parsed.path() == "/search"
            || parsed.path().starts_with("/url")
            || matches!(
                host.as_str(),
                "accounts.google.com" | "policies.google.com" | "support.google.com"
            ))
    {
        return None;
    }
    Some(parsed.to_string())
}

fn total_results(html: &str) -> Option<u64> {
    static TOTAL: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:About|Environ|Ungefähr|Cerca de)\s+([\d.,\s\u{a0}]+)\s+(?:results|résultats|Ergebnisse|resultados)")
            .expect("static regex")
    });
    let digits = TOTAL
        .captures(html)?
        .get(1)?
        .as_str()
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    digits.parse().ok()
}

fn search_time_ms(html: &str) -> Option<u64> {
    static TIME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\(([\d.,]+)\s*(?:seconds|secondes|Sekunden|segundos)\)")
            .expect("static regex")
    });
    let seconds = TIME.captures(html)?.get(1)?.as_str().replace(',', ".").parse::<f64>().ok()?;
    if seconds.is_finite() && seconds >= 0.0 {
        Some((seconds * 1000.0).round() as u64)
    } else {
        None
    }
}

/// Parse organic hits and rich SERP features from static HTML using the shared Obscura DOM.
pub fn parse_serp(html: &str, query: &str) -> SerpContent {
    let tree = parse_html(html);
    let mut organic = Vec::new();
    let mut seen = HashSet::new();
    for selector in ["div.MjjYud", "div.g"] {
        for block in select(&tree, selector) {
            let Some(title_node) = first(&tree, block, "h3") else { continue };
            let title = tree.text_content(title_node);
            if title.trim().is_empty() {
                continue;
            }
            let link = first(&tree, block, "div.yuRUbf a[href]")
                .or_else(|| first(&tree, block, "a[jsname][href]"))
                .or_else(|| first(&tree, block, "a[href]"));
            let Some(url) = link
                .and_then(|node| attr(&tree, node, "href"))
                .and_then(|href| clean_result_url(&href))
            else {
                continue;
            };
            let dedupe =
                url.split(['?', '#']).next().unwrap_or(&url).trim_end_matches('/').to_owned();
            if !seen.insert(dedupe) {
                continue;
            }
            let snippet = first(&tree, block, "div.VwiC3b, div[data-sncf], div.kb0Bf, .st")
                .map(|node| tree.text_content(node))
                .unwrap_or_default();
            let displayed_url = Url::parse(&url)
                .ok()
                .and_then(|url| {
                    url.host_str().map(|host| host.trim_start_matches("www.").to_owned())
                })
                .unwrap_or_else(|| url.clone());
            organic.push(OrganicResult {
                position: organic.len() + 1,
                title: clean_text(&title),
                url,
                displayed_url,
                snippet: clean_text(&snippet),
                is_sponsored: tree.outer_html(block).contains("data-text-ad"),
            });
        }
    }

    let people_also_ask =
        select(&tree, "div.related-question-pair, .iDP60e, .CS59e, div[jsname='Cpkphb']")
            .into_iter()
            .map(|node| tree.text_content(node).trim().to_owned())
            .filter(|text| !text.is_empty() && text.chars().count() < 250)
            .collect();
    let related_searches = select(&tree, "div.nv67Ub, .y676u, .RES9nd, a.k8XOCe")
        .into_iter()
        .map(|node| tree.text_content(node).trim().to_owned())
        .filter(|text| !text.is_empty() && text.chars().count() < 120)
        .collect();

    let featured_snippet =
        tree.query_selector("div.kp-blk, .LGOjbe, .c29vbe, div.xpdopen").ok().flatten().and_then(
            |block| {
                let title = first(&tree, block, "h3")?;
                let link = first(&tree, block, "a[href]")?;
                Some(FeaturedSnippet {
                    title: tree.text_content(title).trim().to_owned(),
                    url: attr(&tree, link, "href").unwrap_or_default(),
                    content: first(&tree, block, ".LGOjbe, .hgKElc, .V3FYCf, .Z0LcW")
                        .map(|node| tree.text_content(node).trim().to_owned())
                        .unwrap_or_default(),
                    source: nonempty(tree.text_content(link)),
                })
            },
        );

    let knowledge_panel = tree
        .query_selector(
            "div.kp-wholepage, div.knowledge-panel, div[data-attrid='kc:/common/topic']",
        )
        .ok()
        .flatten()
        .map(|block| {
            let title = first(&tree, block, "h2, h3, span[role='heading']")
                .map(|node| tree.text_content(node).trim().to_owned())
                .unwrap_or_default();
            let r#type = first(&tree, block, "div.wwUB2c span, div.YhemCb")
                .and_then(|node| nonempty(tree.text_content(node)));
            let description = first(&tree, block, "div.kno-rdesc span, div.PZPZlf span")
                .map(|node| tree.text_content(node).trim().to_owned())
                .unwrap_or_default();
            let mut metadata = std::collections::BTreeMap::new();
            for row in tree
                .query_selector_all_from(block, "div.rVusze, div[data-attrid] div.zloOqf")
                .unwrap_or_default()
            {
                let text = tree.text_content(row);
                if let Some((key, value)) = text.split_once(':')
                    && text.find(':').is_some_and(|index| index > 0 && index < 60)
                    && !key.trim().is_empty()
                    && !value.trim().is_empty()
                {
                    metadata.insert(key.trim().to_owned(), value.trim().to_owned());
                }
            }
            let image_url = first(&tree, block, "img")
                .and_then(|node| attr(&tree, node, "src"))
                .and_then(nonempty);
            let url = first(&tree, block, "a.ab_button, a.LV6jFe")
                .and_then(|node| attr(&tree, node, "href"))
                .and_then(nonempty);
            KnowledgePanel { title, r#type, description, metadata, image_url, url }
        });

    let mut json_ld = Vec::new();
    for script in select(&tree, "script[type='application/ld+json']") {
        if let Ok(value) = serde_json::from_str::<Value>(tree.text_content(script).trim()) {
            if let Value::Array(items) = value {
                json_ld.extend(items);
            } else {
                json_ld.push(value);
            }
        }
    }
    let corrected_query = tree
        .query_selector("a.gL9Hy, span.aIIZGf, p.gqLncc i")
        .ok()
        .flatten()
        .and_then(|node| nonempty(tree.text_content(node)));
    SerpContent {
        query: query.to_owned(),
        organic,
        featured_snippet,
        knowledge_panel,
        people_also_ask,
        related_searches,
        total_results: total_results(html),
        search_time_ms: search_time_ms(html),
        json_ld,
        corrected_query,
    }
}

fn nonempty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODERN: &str = r#"<div id="rso">
      <div class="MjjYud"><div class="yuRUbf"><a href="https://bun.com/"><h3>Bun &amp; the fast runtime</h3></a></div>
      <div class="VwiC3b">A drop-in replacement for Node.js using JSC &lt;3.Read more</div></div>
      <div class="MjjYud"><div class="yuRUbf"><a href="https://github.com/oven-sh/bun"><h3>oven-sh/bun</h3></a></div><div class="VwiC3b">All-in-one toolkit.</div></div>
      <div class="MjjYud"><a href="/search?q=related"><h3>Internal nav</h3></a></div></div>"#;
    const CLASSIC: &str = r#"<div class="g"><a href="/url?q=https://example.org/page&amp;sa=U"><h3>Example via redirect</h3></a><div class="VwiC3b">Snippet text.</div></div><div class="g"><a href="https://bun.com/"><h3>Bun duplicate</h3></a></div>"#;

    #[test]
    fn modern_and_classic_hits_match_source_fixture() {
        let result = parse_serp(&format!("{MODERN}{CLASSIC}"), "bun");
        assert_eq!(result.organic.len(), 3);
        assert_eq!(result.organic[0].title, "Bun & the fast runtime");
        assert_eq!(result.organic[0].displayed_url, "bun.com");
        assert_eq!(result.organic[0].snippet, "A drop-in replacement for Node.js using JSC <3.");
        assert_eq!(result.organic[2].url, "https://example.org/page");
        assert_eq!(
            result.organic.iter().map(|hit| hit.position).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn rich_features_and_metadata_follow_source_shape() {
        let html = r#"About 1,234 results (0.42 seconds)
          <div class="kp-blk"><h3>Answer</h3><a href="https://example.org">Source</a><span class="hgKElc">42</span></div>
          <div class="knowledge-panel"><h2>Rust</h2><div class="kno-rdesc"><span>Language</span></div><div class="rVusze">Created: 2010</div></div>
          <div class="related-question-pair">What is Rust?</div><a class="k8XOCe">Rust tutorial</a>
          <script type="application/ld+json">[{"@type":"Thing"}]</script><a class="gL9Hy">rust language</a>"#;
        let result = parse_serp(html, "rust");
        assert_eq!(result.total_results, Some(1234));
        assert_eq!(result.search_time_ms, Some(420));
        assert_eq!(result.featured_snippet.as_ref().unwrap().content, "42");
        assert_eq!(result.knowledge_panel.as_ref().unwrap().metadata["Created"], "2010");
        assert_eq!(result.people_also_ask, ["What is Rust?"]);
        assert_eq!(result.related_searches, ["Rust tutorial"]);
        assert_eq!(result.json_ld, vec![serde_json::json!({"@type": "Thing"})]);
        assert_eq!(result.corrected_query.as_deref(), Some("rust language"));
    }
}
