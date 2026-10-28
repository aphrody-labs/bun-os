// SPDX-License-Identifier: Apache-2.0
//! Shared request validation and result projection for native Google Search surfaces.
use super::{GoogleVertical, RichSearchResult, SearchOptions, search_rich, search_vertical};
use serde_json::{Value, json};

fn optional_text(args: &Value, name: &str) -> Result<Option<String>, String> {
    args.get(name)
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| format!("{name} must be a string"))
        })
        .transpose()
}

/// Validate the shared JSON search contract without reading cookies or making network requests.
pub fn parse_search_request(args: &Value) -> Result<(String, SearchOptions, bool), String> {
    let object = args.as_object().ok_or("arguments must be an object")?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "query"
                | "num"
                | "hl"
                | "gl"
                | "domain"
                | "vertical"
                | "rich"
                | "anonymous"
                | "safe"
                | "start"
        )
    }) {
        return Err("unknown search argument".to_owned());
    }
    let query =
        args.get("query").and_then(Value::as_str).ok_or("query must be a string")?.to_owned();
    if query.trim().is_empty() || query.len() > 4096 {
        return Err("query must contain 1 to 4096 bytes of non-empty text".to_owned());
    }
    let mut options = SearchOptions::default();
    if let Some(num) = args.get("num") {
        let num = num
            .as_u64()
            .filter(|num| (1..=20).contains(num))
            .ok_or("num must be an integer from 1 to 20")?;
        options.num = Some(num as u8);
    }
    if let Some(hl) = optional_text(args, "hl")? {
        options.hl = hl;
    }
    if let Some(gl) = optional_text(args, "gl")? {
        options.gl = gl;
    }
    if let Some(domain) = optional_text(args, "domain")? {
        options.domain = domain;
    }
    let vertical = optional_text(args, "vertical")?.unwrap_or_else(|| "web".to_owned());
    let rich = args
        .get("rich")
        .map_or(Ok(false), |value| value.as_bool().ok_or("rich must be a boolean"))?;
    options.anonymous = args
        .get("anonymous")
        .map_or(Ok(false), |value| value.as_bool().ok_or("anonymous must be a boolean"))?;
    if let Some(safe) = optional_text(args, "safe")? {
        if !matches!(safe.as_str(), "active" | "off") {
            return Err("safe must be active or off".to_owned());
        }
        options.safe = Some(safe);
    }
    if let Some(start) = args.get("start") {
        options.start = Some(
            start
                .as_u64()
                .filter(|offset| *offset <= 1000)
                .ok_or("start must be an integer from 0 to 1000")? as u32,
        );
    }
    options.classic = !rich;
    options.udm = if rich && vertical == "web" {
        None
    } else {
        Some(match vertical.as_str() {
            "web" => 14,
            "images" => 2,
            "news" => 12,
            "videos" => 7,
            "books" => 36,
            _ => return Err("vertical must be web, images, news, videos or books".to_owned()),
        })
    };
    if rich && !matches!(vertical.as_str(), "web" | "images" | "news" | "videos" | "books") {
        return Err("vertical must be web, images, news, videos or books".to_owned());
    }
    Ok((query, options, rich))
}

/// Project native web results into the common CLI, MCP and app-server shape.
pub fn project_search_result(result: &RichSearchResult, rich: bool) -> Value {
    let mut value = serde_json::Map::new();
    value.insert("query".to_owned(), json!(result.content.query));
    value.insert("authenticated".to_owned(), json!(result.authenticated));
    value.insert("transport".to_owned(), json!(result.profile_used));
    value.insert("servedFromCache".to_owned(), json!(result.served_from_cache));
    if let Some(total) = result.content.total_results {
        value.insert("totalResults".to_owned(), json!(total));
    }
    if let Some(corrected) = &result.content.corrected_query {
        value.insert("correctedQuery".to_owned(), json!(corrected));
    }
    value.insert("organic".to_owned(), Value::Array(result.content.organic.iter().map(|hit| json!({
        "position": hit.position, "title": hit.title, "url": hit.url, "snippet": hit.snippet,
    })).collect()));
    if rich {
        if let Some(snippet) = &result.content.featured_snippet {
            value.insert("featuredSnippet".to_owned(), json!(snippet));
        }
        if let Some(panel) = &result.content.knowledge_panel {
            value.insert("knowledgePanel".to_owned(), json!(panel));
        }
        value.insert("peopleAlsoAsk".to_owned(), json!(result.content.people_also_ask));
        value.insert("relatedSearches".to_owned(), json!(result.content.related_searches));
    }
    Value::Object(value)
}

/// Execute a validated native search while preserving the requested vertical.
pub async fn execute_search_request(args: &Value) -> Result<Value, String> {
    let (query, options, rich) = parse_search_request(args)?;
    let vertical = match args.get("vertical").and_then(Value::as_str).unwrap_or("web") {
        "images" => Some(GoogleVertical::Images),
        "news" => Some(GoogleVertical::News),
        "videos" => Some(GoogleVertical::Videos),
        "books" => Some(GoogleVertical::Books),
        _ => None,
    };
    if let Some(vertical) = vertical {
        let records = search_vertical(&query, vertical, &options).await?;
        return project_vertical_result(&query, records);
    }
    let result = search_rich(&query, &options).await?;
    Ok(project_search_result(&result, rich))
}

/// Project native discovery records into common organic result entries.
pub fn project_vertical_result(query: &str, records: Value) -> Result<Value, String> {
    let records = records.as_array().ok_or("invalid native vertical records")?;
    let organic: Vec<_> = records
        .iter()
        .enumerate()
        .filter_map(|(index, record)| {
            let url = record
                .get("url")
                .and_then(Value::as_str)
                .or_else(|| record.get("imageUrl").and_then(Value::as_str))?;
            let title = record.get("title").and_then(Value::as_str).unwrap_or(query);
            let snippet = record
                .get("snippet")
                .and_then(Value::as_str)
                .or_else(|| record.get("source").and_then(Value::as_str))
                .unwrap_or("");
            Some(json!({"position":index + 1,"title":title,"url":url,"snippet":snippet}))
        })
        .collect();
    if organic.is_empty() {
        return Err("Google vertical returned no usable result URLs".to_owned());
    }
    Ok(
        json!({"query":query,"organic":organic,"transport":"native-discovery","servedFromCache":false}),
    )
}
