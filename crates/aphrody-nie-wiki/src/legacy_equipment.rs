//! Frozen Azalee skill/item wire contracts (rg 93aea3ba).
//!
//! Wire values deliberately retain the mirror's numeric strings. Domain consumers
//! use the typed `query` profiles; this boundary only selects and projects the old
//! public representation. Assets resolve against the imported manifest, never a
//! guessed container name. The historical missing-image URL is wire compatibility,
//! not a resource or a placeholder added to the native interface.

use std::sync::OnceLock;

use rusqlite::{Connection, types::Value as SqlValue};
use serde::Deserialize;
use serde_json::{Map, Value, json};

#[derive(Debug, Default, Deserialize)]
pub struct ListRequest {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub q: Option<String>,
    pub category: Option<String>,
    pub element: Option<String>,
    pub has_video: Option<String>,
    pub show_aura: Option<String>,
    pub overdrive: Option<String>,
    pub power_min: Option<String>,
    pub power_max: Option<String>,
    pub sort: Option<String>,
}

impl ListRequest {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.page.unwrap_or(1) > 0, "page must be positive");
        anyhow::ensure!(self.limit.unwrap_or(24) > 0, "limit must be positive");
        for value in [&self.q, &self.category, &self.element, &self.sort]
            .into_iter()
            .flatten()
        {
            anyhow::ensure!(
                value.len() <= 256 && !value.chars().any(char::is_control),
                "invalid filter"
            );
        }
        for value in [&self.power_min, &self.power_max].into_iter().flatten() {
            anyhow::ensure!(parse_integer(value).is_some(), "invalid power bound");
        }
        Ok(())
    }
    fn bounds(&self) -> (u32, u32, u64) {
        let page = self.page.unwrap_or(1);
        let limit = self.limit.unwrap_or(24).min(200);
        (page, limit, u64::from(page - 1) * u64::from(limit))
    }
}

fn parse_integer(value: &str) -> Option<i64> {
    let value = value.trim_start();
    let end = value
        .char_indices()
        .find(|(i, ch)| !ch.is_ascii_digit() && !(*i == 0 && matches!(ch, '+' | '-')))
        .map_or(value.len(), |(i, _)| i);
    value[..end].parse().ok()
}

const ITEM_COLUMNS: &str = "id,internal_code,name_fr,name_en,name_ja,description_fr,description_en,description_ja,category,rarity,image_url,sheet_data,data,shops";
const SKILL_COLUMNS: &str = "id,internal_code,name_fr,name_en,name_ja,description_fr,description_ja,category_id,category,element,power_min,power_max,tension_cost,image_url,video_url,poster_url,thumbnail_url,sheet_data,data";

fn rows(connection: &Connection, sql: &str, values: &[SqlValue]) -> anyhow::Result<Vec<Value>> {
    let mut statement = connection.prepare(sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    Ok(statement
        .query_map(rusqlite::params_from_iter(values), |row| {
            let mut result = crate::entities::ligne_en_json(row, &columns)?;
            for value in result.values_mut() {
                if let Some(raw) = value.as_str() {
                    if matches!(raw, "\\N" | "\\\\N") {
                        *value = Value::Null;
                    } else if (raw.starts_with('{') || raw.starts_with('['))
                        && let Ok(parsed) = serde_json::from_str(raw)
                    {
                        *value = parsed;
                    }
                }
            }
            Ok(Value::Object(result))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        _ => true,
    }
}

fn first(values: &[&Value]) -> Value {
    values
        .iter()
        .find(|value| truthy(value))
        .map_or(Value::Null, |value| (*value).clone())
}

fn enrichment() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    // Optional editorial enrichment has no bundled private game inventory.
    DATA.get_or_init(|| json!({}))
}

fn item_manifest() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| json!({}))
}

pub(crate) fn menu_manifest() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| json!({}))
}

fn cdn() -> String {
    format!("{}/dx11/menu", crate::cdn_base())
}

fn member(value: &Value, needle: &str) -> bool {
    value
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(needle)))
}

fn telop(code: &str) -> Option<String> {
    let cdn = cdn();
    for locale in ["fr", "en"] {
        if member(&menu_manifest()["telop"][locale], code) {
            return Some(format!("{cdn}/220_img/telop_waza/{locale}/{code}.png"));
        }
    }
    None
}

fn resolve_image(value: &Value) -> Value {
    let cdn = cdn();
    let Some(path) = value.as_str().filter(|path| !path.is_empty()) else {
        return Value::Null;
    };
    let path = if let Some(path) = path
        .strip_prefix("/storage/v1/object/public/menu/")
        .or_else(|| path.strip_prefix("/menu/"))
    {
        path
    } else if path.starts_with("http") || path.starts_with('/') {
        return value.clone();
    } else {
        path
    };
    for prefix in ["200_icon/02_icon_item/", "200_icon/25_icon_nameplate/"] {
        if let Some(code) = path
            .strip_prefix(prefix)
            .and_then(|path| path.strip_suffix(".webp"))
        {
            let entry = &item_manifest()["items"][code];
            let index = entry.as_u64().or_else(|| entry[0].as_u64());
            if let Some(container) =
                index.and_then(|index| item_manifest()["containers"][index as usize].as_str())
            {
                let texture = entry[1].as_str().unwrap_or(code);
                return Value::String(format!(
                    "{cdn}/{}.g4tx/{texture}.png",
                    container.strip_suffix(".g4tx").unwrap_or(container)
                ));
            }
        }
    }
    if let Some(code) = path
        .strip_prefix("200_icon/01_icon_emblem/")
        .and_then(|path| path.strip_suffix(".webp"))
        && member(&menu_manifest()["emblems"], code)
    {
        return Value::String(format!("{cdn}/200_icon/01_icon_emblem/{code}.png"));
    }
    if let Some(raw) = path
        .strip_prefix("220_img/telop_waza/")
        .and_then(|path| path.split_once('/'))
        .and_then(|(_, code)| code.strip_suffix(".webp"))
    {
        let code = raw
            .split_once('_')
            .filter(|(left, right)| left == right)
            .map_or_else(|| raw.strip_suffix("_0").unwrap_or(raw), |(left, _)| left);
        if let Some(url) = telop(code).or_else(|| {
            code.rsplit_once('_')
                .filter(|(_, suffix)| suffix.chars().all(|ch| ch.is_ascii_lowercase()))
                .and_then(|(base, _)| telop(base))
        }) {
            return Value::String(url);
        }
    }
    Value::String(if path.ends_with(".png") {
        format!("{cdn}/{path}")
    } else {
        "/ievr.webp".into()
    })
}

fn image_or_original(value: &Value) -> Value {
    let resolved = resolve_image(value);
    if truthy(&resolved) {
        resolved
    } else {
        value.clone()
    }
}

fn bonuses(sd: &Value, parsed: &Value, enrich: &Value) -> Value {
    [sd, parsed, enrich]
        .into_iter()
        .map(|value| &value["bonuses"])
        .find(|value| value.as_object().is_some_and(|map| !map.is_empty()))
        .cloned()
        .unwrap_or(Value::Null)
}

fn item_value(row: &Value, detail: bool) -> Value {
    let sd = &row["sheet_data"];
    let parsed = &row["data"];
    let community = first(&[&sd["sheetData"], &json!({})]);
    let enrich = &enrichment()[row["id"].as_str().unwrap_or("")];
    let image = image_or_original(&row["image_url"]);
    let mut result = json!({
        "itemId":row["id"], "internalCode":row["internal_code"],
        "names":{"fr":row["name_fr"],"en":row["name_en"],"ja":row["name_ja"]},
        "name_FR":row["name_fr"], "category":row["category"], "rarity":row["rarity"], "image":image,
        "price":first(&[&sd["price"], &parsed["price"]]),
        "location":first(&[&community["location"]]), "stats":first(&[&community["stats"]]),
        "bonuses":bonuses(sd,parsed,enrich), "shops":first(&[&row["shops"],&sd["shops"]])
    });
    if detail {
        let object = result.as_object_mut().expect("object");
        let mut descriptions = Map::new();
        for locale in ["fr", "en", "ja"] {
            descriptions.insert(
                locale.into(),
                first(&[
                    &row[format!("description_{locale}")],
                    &sd["descriptions"][locale],
                    &parsed["descriptions"][locale],
                    &enrich["descriptions"][locale],
                ]),
            );
        }
        object.insert("description".into(), descriptions["fr"].clone());
        object.insert("description_EN".into(), descriptions["en"].clone());
        object.insert("description_JA".into(), descriptions["ja"].clone());
        object.insert("descriptions".into(), Value::Object(descriptions));
        object.insert("imageUrl".into(), image);
        object.insert(
            "shops".into(),
            first(&[&row["shops"], &sd["shops"], &parsed["shops"]]),
        );
        object.insert(
            "attributes".into(),
            first(&[&sd["attributes"], &parsed["attributes"]]),
        );
        object.insert("exchangeRecipes".into(), first(&[&sd["exchangeRecipes"]]));
        object.insert(
            "maxStack".into(),
            [sd, parsed, enrich]
                .into_iter()
                .map(|v| &v["maxStack"])
                .find(|v| !v.is_null())
                .cloned()
                .unwrap_or(Value::Null),
        );
        object.insert("sheetData".into(), community);
        let code = first(&[
            &row["internal_code"],
            &sd["internalCode"],
            &parsed["internalCode"],
        ]);
        if code.is_null() && parsed.get("internalCode").is_none() {
            object.remove("internalCode");
        } else {
            object.insert("internalCode".into(), code);
        }
        if !truthy(&row["name_ja"]) {
            if let Some(ja) = sd["names"].get("ja") {
                object["names"]["ja"] = ja.clone();
            } else {
                object
                    .get_mut("names")
                    .and_then(Value::as_object_mut)
                    .expect("names")
                    .remove("ja");
            }
        }
    }
    result
}

fn list_rows(
    connection: &Connection,
    input: &ListRequest,
    table: &str,
    columns: &str,
    filter: &str,
    order: &str,
    values: &[SqlValue],
) -> anyhow::Result<(Vec<Value>, usize)> {
    let (_, limit, offset) = input.bounds();
    let total = connection.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE {filter}"),
        rusqlite::params_from_iter(values),
        |row| row.get::<_, i64>(0).map(|v| v as usize),
    )?;
    let selected = rows(
        connection,
        &format!(
            "SELECT {columns} FROM {table} WHERE {filter} ORDER BY {order} LIMIT {limit} OFFSET {offset}"
        ),
        values,
    )?;
    Ok((selected, total))
}

fn search_filter(input: &ListRequest, filters: &mut Vec<String>, values: &mut Vec<SqlValue>) {
    if let Some(q) = input.q.as_deref().filter(|q| !q.is_empty()) {
        let pattern = format!("%{}%", crate::query::sanitize_filter(q));
        filters.push("(name_fr LIKE ? OR name_en LIKE ?)".into());
        values.extend([SqlValue::Text(pattern.clone()), SqlValue::Text(pattern)]);
    }
}

pub fn items(connection: &Connection, input: &ListRequest) -> anyhow::Result<Value> {
    input.validate()?;
    if input.category.as_deref() == Some("special_tactics") {
        return tactics(connection, input);
    }
    let mut filters = vec!["1".into()];
    let mut values = Vec::new();
    search_filter(input, &mut filters, &mut values);
    if let Some(category) = input.category.as_deref().filter(|value| !value.is_empty()) {
        filters.push("category = ?".into());
        values.push(category.to_owned().into());
    }
    let (selected, total) = list_rows(
        connection,
        input,
        "inagle_items",
        ITEM_COLUMNS,
        &filters.join(" AND "),
        "id",
        &values,
    )?;
    let (page, limit, _) = input.bounds();
    Ok(
        json!({"data":selected.iter().map(|row| item_value(row,false)).collect::<Vec<_>>(),"total":total,"page":page,"limit":limit}),
    )
}

pub fn item(connection: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    Ok(rows(
        connection,
        &format!("SELECT {ITEM_COLUMNS} FROM inagle_items WHERE id = ? LIMIT 1"),
        &[id.to_owned().into()],
    )?
    .first()
    .map(|row| item_value(row, true)))
}

fn translation(value: &Value, category: bool) -> Value {
    let (en, ja, fr) = if category {
        match value.as_str().unwrap_or("") {
            "Tir" => ("Shoot", "シュート", "Tir"),
            "Dribble" => ("Dribble", "ドリブル", "Dribble"),
            "Défense" => ("Block", "ブロック", "Défense"),
            "Arrêt" => ("Catch", "キャッチ", "Arrêt"),
            _ => ("None", "なし", "Aucun"),
        }
    } else {
        match value.as_str().unwrap_or("") {
            "Feu" => ("Fire", "火", "Feu"),
            "Vent" => ("Wind", "風", "Vent"),
            "Forêt" => ("Forest", "林", "Forêt"),
            "Montagne" => ("Mountain", "山", "Montagne"),
            _ => ("Void", "無", "Néant"),
        }
    };
    json!({"en":en,"ja":ja,"fr":fr})
}

fn shop(value: &Value) -> Value {
    let Some(name) = value.as_str().filter(|value| !value.is_empty()) else {
        return Value::Null;
    };
    Value::String(
        match name {
            "Chronicle" | "Chronicle Department Store" => "Galerie Chronique",
            "G-Mart (Arcade Branch)" => "G-Mart (Succursale Arcade)",
            "Kool Kit (Odaiba Branch)" => "Kool Kit (Succursale Odaiba)",
            "Legendary Chest" => "Coffre légendaire",
            "Magic Moves (Odaiba Branch)" => "Super Techniques (Succursale Odaiba)",
            "Special Training Booth" => "Stand d'entraînement spécial",
            "Spirit" | "Spirit Market" => "Marché des Esprits",
            "VS" | "Vs Store" => "Boutique VS",
            _ => name,
        }
        .to_owned(),
    )
}

fn skill_value(row: &Value, detail: bool) -> Value {
    let mut result = json!({
        "skillId":row["id"],"internalCode":row["internal_code"],"names":{"en":row["name_en"],"fr":row["name_fr"],"ja":row["name_ja"]},
        "displayName":first(&[&row["name_fr"],&row["name_en"],&json!("Inconnu")]), "name_FR":row["name_fr"],"name_EN":row["name_en"],
        "power_min":row["power_min"],"power_max":row["power_max"],"consumeTp":row["tension_cost"],"elementName":translation(&row["element"],false),"categoryName":translation(&row["category"],true),
        "image":image_or_original(&row["image_url"]),"videoUrl":first(&[&row["video_url"]]),"posterUrl":first(&[&row["poster_url"]]),"thumbnailUrl":first(&[&row["thumbnail_url"]])
    });
    let object = result.as_object_mut().expect("object");
    if detail {
        let merged = crate::mirror::merge_data_sheet(
            Some(&row["data"].to_string()),
            Some(&row["sheet_data"].to_string()),
        );
        let mut output = merged.as_object().cloned().unwrap_or_default();
        // Extraction metadata is not gameplay and must not disclose local paths.
        for key in ["source", "source_path", "sourcePath", "extraction_path"] {
            output.remove(key);
        }
        output.append(object);
        output.insert("name_JA".into(), row["name_ja"].clone());
        output.insert(
            "descriptions".into(),
            json!({"fr":row["description_fr"],"ja":row["description_ja"]}),
        );
        if truthy(&row["description_fr"]) {
            output.insert("desc_FR".into(), row["description_fr"].clone());
        } else if let Some(value) = merged.get("desc_FR") {
            output.insert("desc_FR".into(), value.clone());
        } else {
            output.remove("desc_FR");
        }
        if let Some(value) = merged.get("desc_EN") {
            output.insert("desc_EN".into(), value.clone());
        } else {
            output.remove("desc_EN");
        }
        let sheet = if truthy(&merged["sheetData"]) {
            merged["sheetData"].clone()
        } else {
            Value::Object(
                [
                    "matchedName",
                    "shop",
                    "type",
                    "subType",
                    "power",
                    "tension",
                    "duration",
                ]
                .into_iter()
                .filter_map(|key| merged.get(key).map(|value| (key.to_owned(), value.clone())))
                .collect(),
            )
        };
        output.insert("sheetData".into(), sheet);
        Value::Object(output)
    } else {
        object.insert("skillID".into(), row["id"].clone());
        object.insert(
            "skillIDStr".into(),
            first(&[&row["internal_code"], &row["id"]]),
        );
        object.insert("category".into(), row["category_id"].clone());
        object.insert("shop".into(), shop(&row["sheet_data"]["shop"]));
        object.insert("sheetData".into(), row["sheet_data"].clone());
        result
    }
}

pub fn skills(connection: &Connection, input: &ListRequest) -> anyhow::Result<Value> {
    input.validate()?;
    let mut filters = vec![
        "(internal_code LIKE 'wh%' OR internal_code LIKE 'rh%')".into(),
        "id NOT LIKE '%_or'".into(),
    ];
    let mut values = Vec::new();
    search_filter(input, &mut filters, &mut values);
    for (column, value) in [("element", &input.element), ("category", &input.category)] {
        if let Some(value) = value.as_deref().filter(|value| !value.is_empty()) {
            let mapped = match (column, value.to_lowercase().as_str()) {
                ("element", "fire") => "Feu",
                ("element", "wind") => "Vent",
                ("element", "forest") => "Forêt",
                ("element", "mountain") => "Montagne",
                ("element", "void") => "Néant",
                ("category", "shoot") => "Tir",
                ("category", "block") => "Défense",
                ("category", "dribble") => "Dribble",
                ("category", "catch") => "Arrêt",
                _ => value,
            };
            filters.push(format!("{column} = ?"));
            values.push(mapped.to_owned().into());
        }
    }
    if input.has_video.as_deref().is_some_and(|s| !s.is_empty()) {
        filters.push("(video_url IS NOT NULL AND video_url != '\\\\N')".into());
    }
    if !input.show_aura.as_deref().is_some_and(|s| !s.is_empty()) {
        filters.push("(is_hyper = 0 OR is_hyper = 'f' OR is_hyper = 'false')".into());
    }
    for (operator, value) in [(">=", &input.power_min), ("<=", &input.power_max)] {
        if let Some(number) = value.as_deref().and_then(parse_integer) {
            filters.push(format!("power_max {operator} ?"));
            values.push(number.into());
        }
    }
    if input.overdrive.as_deref().is_some_and(|s| !s.is_empty()) {
        filters.push("json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END, '$.skillID') IN (SELECT json_extract(required.value,'$.skill_id') FROM inagle_override_skills o, json_each(CASE WHEN json_valid(o.conditions) THEN o.conditions ELSE '[]' END) condition, json_each(condition.value,'$.required_skills') required)".into());
    }
    let order = match input.sort.as_deref() {
        Some("power") => {
            "CASE WHEN power_max IS NULL OR power_max = '\\\\N' THEN 1 ELSE 0 END, power_max DESC"
        }
        Some("tension_asc") => {
            "CASE WHEN tension_cost IS NULL OR tension_cost = '\\\\N' THEN 1 ELSE 0 END, tension_cost ASC"
        }
        _ => {
            "CASE WHEN video_url IS NULL OR video_url = '\\\\N' THEN 1 ELSE 0 END, video_url ASC, CASE WHEN tension_cost IS NULL OR tension_cost = '\\\\N' THEN 1 ELSE 0 END, tension_cost DESC"
        }
    };
    let (selected, total) = list_rows(
        connection,
        input,
        "inagle_skills",
        SKILL_COLUMNS,
        &filters.join(" AND "),
        order,
        &values,
    )?;
    let (page, limit, _) = input.bounds();
    Ok(
        json!({"data":selected.iter().map(|row| skill_value(row,false)).collect::<Vec<_>>(),"total":total,"page":page,"limit":limit}),
    )
}

pub fn skill(connection: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    let safe = crate::query::sanitize_filter(id);
    let condition = if id.starts_with("0x") {
        "id = ?1 OR json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.skillID') = ?1 OR json_extract(CASE WHEN json_valid(sheet_data) THEN sheet_data ELSE '{}' END,'$.skillID') = ?1"
    } else {
        "internal_code = ?1 OR name_en = ?1 OR name_fr = ?1"
    };
    Ok(rows(
        connection,
        &format!("SELECT {SKILL_COLUMNS} FROM inagle_skills WHERE {condition} LIMIT 1"),
        &[safe.into()],
    )?
    .first()
    .map(|row| skill_value(row, true)))
}

fn tactics(connection: &Connection, input: &ListRequest) -> anyhow::Result<Value> {
    let page = crate::tactics::list_tactics(
        connection,
        &crate::tactics::TacticListRequest {
            query: None,
            page: Some(1),
            limit: Some(200),
        },
    )?;
    anyhow::ensure!(
        page.total <= 200,
        "tactic compatibility inventory exceeds bounded owner page"
    );
    let mut output = Vec::new();
    for tactic in page.data {
        let primary = tactic.source == "inagle_tactics";
        let code = tactic.internal_code.as_deref().unwrap_or("");
        let sql = if primary {
            "SELECT name,name_fr,name_ja,description_fr,description_ja,image_url,shop,effect1,effect2,effect3,duration,cooldown FROM inagle_tactics WHERE internal_code = ? LIMIT 1"
        } else {
            "SELECT name_en,name_fr,name_ja,description_fr,description_ja,recast_time FROM inagle_special_tactics WHERE internal_code = ? LIMIT 1"
        };
        let raw = rows(connection, sql, &[code.to_owned().into()])?
            .pop()
            .unwrap_or(Value::Null);
        let name = if primary {
            raw["name"].clone()
        } else {
            first(&[&raw["name_en"], &raw["name_fr"], &json!(code)])
        };
        let fr = first(&[&raw["name_fr"], &name]);
        let ja = first(&[&raw["name_ja"], &name]);
        let value = json!({"itemId":code,"internalCode":code,"names":{"en":name,"fr":fr,"ja":ja},"name_FR":fr,"description":raw["description_fr"],"description_JA":raw["description_ja"],"category":"special_tactics","rarity":3,"image":if primary { resolve_image(&raw["image_url"]) } else { Value::Null },"price":null,"location":if primary { raw["shop"].clone() } else { Value::Null },"stats":{"effect1":raw["effect1"],"effect2":raw["effect2"],"effect3":raw["effect3"],"duration":raw["duration"],"cooldown":if primary { raw["cooldown"].clone() } else { raw["recast_time"].clone() }},"shops":if primary && truthy(&raw["shop"]) { vec![raw["shop"].clone()] } else { Vec::new() }});
        if input.q.as_ref().is_none_or(|q| {
            name.as_str()
                .unwrap_or_default()
                .to_lowercase()
                .contains(&q.to_lowercase())
                || fr
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&q.to_lowercase())
        }) {
            output.push(value);
        }
    }
    output.sort_by_cached_key(|row| row["names"]["en"].as_str().unwrap_or("").to_lowercase());
    let total = output.len();
    let (page, limit, offset) = input.bounds();
    Ok(
        json!({"data":output.into_iter().skip(usize::try_from(offset).unwrap_or(usize::MAX)).take(limit as usize).collect::<Vec<_>>(),"total":total,"page":page,"limit":limit}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_filters_keep_pagination_aliases_and_missing_details() {
        let connection = Connection::open_in_memory().unwrap();
        let columns = SKILL_COLUMNS
            .split(',')
            .map(|column| format!("{column} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection.execute_batch(&format!("CREATE TABLE inagle_skills ({columns}, is_hyper TEXT);
            INSERT INTO inagle_skills (id,internal_code,name_fr,name_en,category,element,power_max,tension_cost,is_hyper) VALUES
            ('one','wh001','One','One','Tir','Forêt','70','20','f'),
            ('two','wh002','Two','Two','Tir','Forêt','90','30','f'),
            ('three_or','wh003','Three','Three','Tir','Forêt','99','40','f'),
            ('four','rh004','Four','Four','Dribble','Feu','60','10','t');")).unwrap();
        let input = ListRequest {
            category: Some("shoot".into()),
            element: Some("Forest".into()),
            sort: Some("power".into()),
            page: Some(2),
            limit: Some(1),
            ..Default::default()
        };
        let result = skills(&connection, &input).unwrap();
        assert_eq!(result["total"], 2);
        assert_eq!(result["data"][0]["skillId"], "one");
        assert_eq!(result["page"], 2);
        assert_eq!(result["limit"], 1);
        assert_eq!(
            skills(
                &connection,
                &ListRequest {
                    show_aura: Some("1".into()),
                    ..Default::default()
                }
            )
            .unwrap()["total"],
            3
        );
        assert!(skill(&connection, "missing").unwrap().is_none());
        assert_eq!(
            skill(&connection, "One").unwrap().unwrap()["skillId"],
            "one"
        );
        let columns = ITEM_COLUMNS
            .split(',')
            .map(|column| format!("{column} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection.execute_batch(&format!("CREATE TABLE inagle_items ({columns}); INSERT INTO inagle_items (id,internal_code,name_fr,category) VALUES ('a','boots','Shoes','equipment'),('b','ball','Ball','consumable');")).unwrap();
        let page = items(
            &connection,
            &ListRequest {
                category: Some("equipment".into()),
                q: Some("Shoes".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page["total"], 1);
        assert_eq!(page["data"][0]["itemId"], "a");
        assert!(item(&connection, "boots").unwrap().is_none());
        assert_eq!(
            item(&connection, "a").unwrap().unwrap()["internalCode"],
            "boots"
        );
    }

    #[test]
    fn item_projection_uses_real_prices_enrichment_and_nullable_omission() {
        let row = json!({"id":"test","internal_code":"boots","name_fr":"Boots","name_en":"Boots","name_ja":null,"price":"99999","sheet_data":{"price":120,"sheetData":{"location":"shop"}},"data":{"maxStack":0,"bonuses":{"kick":6},"descriptions":{"en":"description"}},"shops":["shop"]});
        let list = item_value(&row, false);
        let detail = item_value(&row, true);
        assert_eq!(list["price"], 120);
        assert_eq!(list["bonuses"]["kick"], 6);
        assert_eq!(detail["maxStack"], 0);
        assert_eq!(detail["description_EN"], "description");
        assert!(detail["names"].get("ja").is_none());
        let capped = ListRequest {
            limit: Some(201),
            ..Default::default()
        };
        assert!(capped.validate().is_ok());
        assert_eq!(capped.bounds().1, 200);
        assert!(
            ListRequest {
                power_min: Some("bad".into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn skill_projection_keeps_public_data_and_removes_private_source() {
        let row = json!({"id":"id","internal_code":"wh001","power_max":"100","name_en":"Skill","data":{"source":"/private/extraction","tags":["gameplay"],"foulRate":5},"sheet_data":{"foulRate":7}});
        let detail = skill_value(&row, true);
        assert_eq!(detail["foulRate"], 7);
        assert_eq!(detail["power_max"], "100");
        assert_eq!(detail["tags"], json!(["gameplay"]));
        assert!(detail.get("source").is_none());
        assert!(detail.get("desc_EN").is_none());
        assert_eq!(detail["sheetData"], json!({}));
    }

    #[test]
    #[ignore = "requires private mirror and captured rg93aea3ba JSON; no game dump is committed"]
    fn real_mirror_matches_captured_equipment_contract() {
        let fixture = std::env::var("NIE_EQUIPMENT_PARITY_FIXTURE").expect("fixture path");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        assert!(cases.len() >= 17);
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        for (index, case) in cases.iter().enumerate() {
            let actual = match case["family"].as_str().unwrap() {
                "items" => items(
                    &connection,
                    &serde_json::from_value(case["input"].clone()).unwrap(),
                )
                .unwrap(),
                "skills" => skills(
                    &connection,
                    &serde_json::from_value(case["input"].clone()).unwrap(),
                )
                .unwrap(),
                "items_detail" => item(&connection, case["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                "skills_detail" => skill(&connection, case["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                _ => panic!("unknown fixture family"),
            };
            if actual != case["expected"] {
                let differences = differences(&actual, &case["expected"], "");
                panic!("fixture {index} differs at {}", differences.join(", "));
            }
        }
    }

    fn differences(actual: &Value, expected: &Value, path: &str) -> Vec<String> {
        if actual == expected {
            return Vec::new();
        }
        match (actual, expected) {
            (Value::Object(a), Value::Object(b)) => a
                .keys()
                .chain(b.keys())
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .flat_map(|key| {
                    differences(
                        &a.get(key).cloned().unwrap_or(json!("<absent>")),
                        &b.get(key).cloned().unwrap_or(json!("<absent>")),
                        &format!("{path}/{key}"),
                    )
                })
                .take(12)
                .collect(),
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => a
                .iter()
                .zip(b)
                .enumerate()
                .flat_map(|(index, (a, b))| differences(a, b, &format!("{path}/{index}")))
                .take(12)
                .collect(),
            _ => vec![path.to_owned()],
        }
    }
}
