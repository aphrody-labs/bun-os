// SPDX-License-Identifier: Apache-2.0
//! Public discovery surfaces migrated from BXC Google verticals/keyless clients
//! (0b2aec6c9^). Domain cookies and transport remain the native Google owner.

use super::{SearchOptions, network};
use bun_browser_dom::{DomTree, NodeId, parse_html};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::LazyLock};
use url::Url;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GoogleVertical {
    Books,
    News,
    Images,
    Videos,
    Scholar,
}

fn nodes(dom: &DomTree, selector: &str) -> Vec<NodeId> {
    dom.query_selector_all(selector).unwrap_or_default()
}
fn first(dom: &DomTree, root: NodeId, selector: &str) -> Option<NodeId> {
    dom.query_selector_from(root, selector).ok().flatten()
}
fn text(dom: &DomTree, root: NodeId, selector: &str) -> String {
    first(dom, root, selector)
        .map(|id| dom.text_content(id).trim().to_owned())
        .unwrap_or_default()
}
fn attribute(dom: &DomTree, root: NodeId, selector: &str, name: &str) -> Option<String> {
    first(dom, root, selector).and_then(|id| {
        dom.with_node(id, |node| node.get_attribute(name).map(str::to_owned))
            .flatten()
    })
}
fn clean_url(raw: &str) -> Option<String> {
    let url = if raw.starts_with("/url?") {
        let redirect = Url::parse(&format!("https://www.google.com{raw}")).ok()?;
        redirect.query_pairs().find_map(|(key, value)| {
            matches!(key.as_ref(), "q" | "url").then(|| value.into_owned())
        })?
    } else {
        raw.to_owned()
    };
    let parsed = Url::parse(&url).ok()?;
    (matches!(parsed.scheme(), "http" | "https")
        && parsed.username().is_empty()
        && parsed.password().is_none())
    .then_some(url)
}
static YEAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(1[5-9]\d{2}|20\d{2})\b").expect("year regex"));
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").expect("number regex"));
static IMAGE_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)https?://[^\"'<>\\\s]+"#).expect("image URL regex"));
static IMAGE_EXTENSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)").expect("image extension regex")
});

/// Element-scoped parsers preserve the historical fields without inferring facts.
pub fn parse_vertical(html: &str, query: &str, vertical: GoogleVertical, limit: usize) -> Value {
    let dom = parse_html(html);
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    if matches!(vertical, GoogleVertical::Images) {
        for id in nodes(&dom, "img") {
            let src = dom
                .with_node(id, |node| node.get_attribute("src").map(str::to_owned))
                .flatten();
            let title = dom
                .with_node(id, |node| node.get_attribute("alt").map(str::to_owned))
                .flatten();
            if let (Some(src), Some(title)) = (src, title)
                && !src.starts_with("data:")
                && !title.trim().is_empty()
            {
                records.push(json!({"thumbnail": src,"source":"","title":title.trim(),"imageUrl":Value::Null}));
            }
        }
        let decoded = html
            .replace("\\/", "/")
            .replace("\\u003d", "=")
            .replace("\\u0026", "&")
            .replace("&amp;", "&");
        let images: Vec<String> = IMAGE_URL
            .find_iter(&decoded)
            .filter_map(|item| {
                let raw = item.as_str().trim_end_matches([')', ',', ';']);
                if !IMAGE_EXTENSION.is_match(raw) {
                    return None;
                }
                let url = Url::parse(raw).ok()?;
                if url.host_str().is_some_and(|host| {
                    host.ends_with("gstatic.com") || host.ends_with("googleusercontent.com")
                }) {
                    return None;
                }
                let clean = clean_url(raw)?;
                seen.insert(clean.clone()).then_some(clean)
            })
            .collect();
        for (index, url) in images.into_iter().enumerate() {
            if let Some(record) = records.get_mut(index) {
                record["imageUrl"] = json!(url);
            } else {
                records.push(json!({"thumbnail":url,"source":"","title":query,"imageUrl":url}));
            }
        }
    } else {
        let selector = match vertical {
            GoogleVertical::Books => "div.MjjYud, div.Yr5TG",
            GoogleVertical::News => "div.SoaBEf, div.WlydOe, g-card",
            GoogleVertical::Videos => "div.MjjYud, div.g, div.RzdJxc",
            GoogleVertical::Scholar => "div.gs_r.gs_or, div.gs_ri",
            GoogleVertical::Images => unreachable!(),
        };
        for root in nodes(&dom, selector) {
            let (title, raw) = match vertical {
                GoogleVertical::News => (
                    text(&dom, root, "div.MBeuO, div.n0jPhd, h3"),
                    attribute(&dom, root, "a[href]", "href"),
                ),
                GoogleVertical::Scholar => (
                    text(&dom, root, "h3.gs_rt a, h3 a"),
                    attribute(&dom, root, "h3.gs_rt a, h3 a", "href"),
                ),
                GoogleVertical::Books => (
                    text(&dom, root, "h3, .DKV0Md"),
                    attribute(&dom, root, "a[href*='books.google']", "href"),
                ),
                _ => (
                    text(&dom, root, "h3"),
                    attribute(&dom, root, "a[href]", "href"),
                ),
            };
            let Some(url) = raw.as_deref().and_then(clean_url) else {
                continue;
            };
            if title.is_empty() || !seen.insert(url.clone()) {
                continue;
            }
            let record = match vertical {
                GoogleVertical::News => {
                    json!({"title":title,"url":url,"source":text(&dom,root,"div.NUnG9d span, div.MgUUmf span"),"snippet":text(&dom,root,"div.GI74Re, div.Y3v8qd"),"publishedAt": nonempty(text(&dom,root,"div.OSrXXb span, span.WG9SHc"))})
                }
                GoogleVertical::Videos => {
                    json!({"title":title,"url":url,"source":text(&dom,root,"cite"),"duration":nonempty(text(&dom,root,"div.J1mWY, span.fGsHV")),"thumbnail":attribute(&dom,root,"img","src")})
                }
                GoogleVertical::Books => {
                    let meta = text(&dom, root, "div.fl, .qLRx3b");
                    let year = YEAR.find(&meta);
                    json!({"title":title,"url":url,"author":year.as_ref().map_or(meta.as_str(), |year| &meta[..year.start()]).trim(),"year":year.and_then(|year| year.as_str().parse::<u32>().ok()),"snippet":text(&dom,root,"div.VwiC3b, .cmlJmd")})
                }
                GoogleVertical::Scholar => {
                    let meta = text(&dom, root, "div.gs_a");
                    let parts: Vec<_> = meta.split('-').map(str::trim).collect();
                    let mut cited = None;
                    let mut pdf = None;
                    for id in dom.query_selector_all_from(root, "a").unwrap_or_default() {
                        let label = dom.text_content(id);
                        if label.to_ascii_lowercase().contains("cited by") {
                            cited = NUMBER
                                .find(&label)
                                .and_then(|number| number.as_str().parse::<u32>().ok());
                        }
                        let href = dom
                            .with_node(id, |node| node.get_attribute("href").map(str::to_owned))
                            .flatten();
                        if href
                            .as_ref()
                            .is_some_and(|url| url.to_ascii_lowercase().ends_with(".pdf"))
                        {
                            pdf = href.and_then(|url| clean_url(&url));
                        }
                    }
                    json!({"title":title,"url":url,"authors":parts.first().copied().unwrap_or_default(),"venue":parts.get(1).copied().unwrap_or_default(),"snippet":text(&dom,root,"div.gs_rs"),"citedBy":cited,"year":YEAR.find(&meta).and_then(|year|year.as_str().parse::<u32>().ok()),"pdfUrl":pdf})
                }
                GoogleVertical::Images => unreachable!(),
            };
            records.push(record);
        }
    }
    records.truncate(limit);
    json!(records)
}
fn nonempty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn vertical_url(
    query: &str,
    vertical: GoogleVertical,
    options: &SearchOptions,
) -> Result<Url, String> {
    let mut clean = options.clone();
    clean.classic = false;
    clean.udm = None;
    let mut url = super::search_url(query, &clean)?;
    if matches!(vertical, GoogleVertical::Scholar) {
        url =
            Url::parse("https://scholar.google.com/scholar").map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair("hl", &options.hl);
        if let Some(start) = options.start {
            url.query_pairs_mut()
                .append_pair("start", &start.to_string());
        }
    } else {
        let code = match vertical {
            GoogleVertical::Books => "bks",
            GoogleVertical::News => "nws",
            GoogleVertical::Images => "isch",
            GoogleVertical::Videos => "vid",
            GoogleVertical::Scholar => unreachable!(),
        };
        url.query_pairs_mut().append_pair("tbm", code);
    }
    Ok(url)
}

pub async fn search_vertical(
    query: &str,
    vertical: GoogleVertical,
    options: &SearchOptions,
) -> Result<Value, String> {
    let url = vertical_url(query, vertical, options)?;
    let html = network::discovery_html(&url, options).await?;
    let records = parse_vertical(
        &html,
        query,
        vertical,
        usize::from(options.num.unwrap_or(50)),
    );
    if records.as_array().is_none_or(Vec::is_empty) {
        return Err(
            "Google vertical returned no parseable results; no empty success inferred".into(),
        );
    }
    Ok(records)
}

/// The legacy Books response remains the public API projection. A native books
/// HTML fallback is used only when the public catalog endpoint is unavailable.
pub async fn search_books(
    query: &str,
    max_results: u8,
    options: &SearchOptions,
) -> Result<Value, String> {
    if max_results == 0 || max_results > 40 {
        return Err("Books maxResults must be 1..40".into());
    }
    let mut url = Url::parse("https://www.googleapis.com/books/v1/volumes")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("maxResults", &max_results.to_string())
        .append_pair("startIndex", &options.start.unwrap_or(0).to_string());
    match network::public_json(url).await {
        Ok(value) if value.get("totalItems").is_some_and(Value::is_u64) => Ok(value),
        result => {
            let error = result
                .err()
                .unwrap_or_else(|| "invalid Books API payload".into());
            let mut options = options.clone();
            options.num = Some(max_results);
            let records = search_vertical(query, GoogleVertical::Books, &options)
                .await
                .map_err(|fallback| format!("Books API: {error}; native vertical: {fallback}"))?;
            let items:Vec<_>=records.as_array().ok_or("invalid book records")?.iter().map(|book|json!({"id":book["url"],"volumeInfo":{"title":book["title"],"authors":[book["author"]],"publishedDate":book["year"].as_u64().map(|year|year.to_string()),"description":book["snippet"],"infoLink":book["url"]}})).collect();
            Ok(
                json!({"totalItems":items.len(),"items":items,"nativeFallback":true,"apiError":error}),
            )
        }
    }
}

pub async fn autocomplete(query: &str, hl: &str) -> Result<Vec<String>, String> {
    let mut url = Url::parse("https://suggestqueries.google.com/complete/search")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("client", "firefox")
        .append_pair("q", query)
        .append_pair("hl", hl);
    let result = network::public_json(url).await?;
    let items = result
        .get(1)
        .and_then(Value::as_array)
        .ok_or("invalid Google autocomplete response")?;
    Ok(items
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect())
}

pub async fn resolve_dns(domain: &str) -> Result<Value, String> {
    let mut url = Url::parse("https://dns.google/resolve").map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("name", domain)
        .append_pair("type", "A");
    let result = network::public_json(url).await?;
    if result.get("Status").and_then(Value::as_u64) != Some(0) {
        return Err("Google DNS resolution failed or malformed response".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrated_verticals_preserve_scoped_facts_and_no_cross_card_fields() {
        let html = r#"<html><body><div class="SoaBEf"><a href="/url?q=https%3A%2F%2Fdragon-ball-official.com%2Fnews"><h3>Official news</h3></a><div class="NUnG9d"><span>Publisher</span></div><div class="GI74Re">Actual synopsis</div><span class="WG9SHc">Yesterday</span></div><div class="SoaBEf"><a href="https://www.toei-anim.co.jp/next"><h3>Second</h3></a></div><div class="gs_r gs_or"><div class="gs_ri"><h3 class="gs_rt"><a href="https://example.org/paper">Study</a></h3><div class="gs_a">Author - Journal, 2025</div><div class="gs_rs">Abstract</div><a href="https://example.org/citations">Cited by 12</a><a href="https://example.org/paper.pdf">PDF</a></div></div></body></html>"#;
        let news = parse_vertical(html, "Dragon Ball", GoogleVertical::News, 50);
        assert_eq!(news[0]["url"], "https://dragon-ball-official.com/news");
        assert_eq!(news[0]["publishedAt"], "Yesterday");
        assert_eq!(news[1]["source"], "");
        let scholar = parse_vertical(html, "Dragon Ball", GoogleVertical::Scholar, 50);
        assert_eq!(scholar.as_array().unwrap().len(), 1);
        assert_eq!(scholar[0]["citedBy"], 12);
        assert_eq!(scholar[0]["year"], 2025);
        assert_eq!(scholar[0]["pdfUrl"], "https://example.org/paper.pdf");
    }
    #[test]
    fn image_payload_retains_original_media_urls_and_excludes_branding() {
        let html = r#"<html><img src="https://encrypted-tbn0.gstatic.com/thumbnail.jpg" alt="Cover"><script>https:\/\/source.example\/cover.png?x\u003d1\u0026y\u003d2 https://www.gstatic.com/images/branding/logo.png</script></html>"#;
        let result = parse_vertical(html, "Dragon Ball", GoogleVertical::Images, 50);
        assert_eq!(
            result[0]["imageUrl"],
            "https://source.example/cover.png?x=1&y=2"
        );
        assert_eq!(result.as_array().unwrap().len(), 1);
    }
    #[test]
    fn vertical_endpoints_preserve_legacy_query_and_language_contract() {
        let options = SearchOptions {
            hl: "ja".into(),
            num: Some(50),
            anonymous: true,
            ..Default::default()
        };
        let news = vertical_url("ドラゴンボール", GoogleVertical::News, &options).unwrap();
        assert!(
            news.query_pairs()
                .any(|(key, value)| key == "tbm" && value == "nws")
        );
        assert!(!news.query_pairs().any(|(key, _)| key == "udm"));
        let scholar = vertical_url("Dragon Ball", GoogleVertical::Scholar, &options).unwrap();
        assert_eq!(scholar.host_str(), Some("scholar.google.com"));
        assert_eq!(scholar.path(), "/scholar");
    }
}
