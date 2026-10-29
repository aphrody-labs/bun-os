//! Exact frozen team wire projections. French collation ranks are imported source
//! data: unknown names fail explicitly instead of silently receiving an ASCII order.

use crate::legacy_entities::rows;
use rusqlite::{Connection, types::Value as SqlValue};
use serde::{
    Deserialize,
    de::{MapAccess, Visitor},
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

const COLUMNS: &str = "id,name_fr,name_en,name_ja,emblems,kits,data,description_fr,description_en";
fn cdn() -> String {
    format!("{}/dx11/menu", crate::cdn_base())
}

struct OrderedObject(Vec<(String, Value)>);
impl<'de> Deserialize<'de> for OrderedObject {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = OrderedObject;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("JSON object")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }
                Ok(OrderedObject(entries))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}

fn ordered(value: &Value) -> Vec<(String, Value)> {
    value
        .as_str()
        .and_then(|raw| serde_json::from_str::<OrderedObject>(raw).ok())
        .map(|object| object.0)
        .unwrap_or_default()
}
fn parsed(value: &Value) -> Value {
    value
        .as_str()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null)
}
fn present(value: &Value) -> bool {
    !value.is_null()
        && value.as_str() != Some("")
        && value.as_bool() != Some(false)
        && value.as_i64() != Some(0)
}
fn first(values: &[&Value]) -> Value {
    values
        .iter()
        .find(|value| present(value))
        .map_or(Value::Null, |value| (*value).clone())
}
fn name(row: &Value) -> Value {
    first(&[
        &row["name_fr"],
        &row["name_en"],
        &row["name_ja"],
        &row["id"],
    ])
}
fn series_label(series: &str) -> &str {
    match series {
        "v" => "Victory Road",
        "go" => "Galaxy / GO",
        "ie" => "Inazuma Eleven (1-3)",
        "aresOrion" => "Ares / Orion",
        other => other,
    }
}
fn rank(name: &str) -> anyhow::Result<u64> {
    static INDEX: OnceLock<Value> = OnceLock::new();
    INDEX.get_or_init(|| serde_json::from_str(include_str!("legacy_team_collation.json")).expect("tracked French ordering index"))["ranks"][name].as_u64().ok_or_else(|| anyhow::anyhow!("team name is absent from the frozen French collation corpus; regenerate the ordering index"))
}

fn emblem(row: &Value) -> Value {
    let cdn = cdn();
    static CRC: OnceLock<Value> = OnceLock::new();
    let map = CRC.get_or_init(|| json!({}));
    let entries = ordered(&row["emblems"]);
    let value = ["v", "ie", "go", "aresOrion"]
        .iter()
        .find_map(|series| {
            entries
                .iter()
                .find(|(key, value)| key == series && present(value))
                .map(|(_, value)| value)
        })
        .or_else(|| {
            entries
                .iter()
                .find(|(_, value)| present(value))
                .map(|(_, value)| value)
        });
    let Some(crc) = value.and_then(Value::as_str) else {
        return Value::Null;
    };
    let raw = crc
        .strip_prefix("0x")
        .or_else(|| crc.strip_prefix("0X"))
        .unwrap_or(crc);
    let Some(code) = map[format!("0x{}", raw.to_uppercase())].as_str() else {
        return Value::Null;
    };
    let known = crate::legacy_equipment::menu_manifest()["emblems"]
        .as_array()
        .is_some_and(|codes| codes.iter().any(|entry| entry == code));
    if known {
        json!(format!("{cdn}/200_icon/01_icon_emblem/{code}.png"))
    } else {
        Value::Null
    }
}

fn face(code: &str) -> String {
    let cdn = cdn();
    static CODES: OnceLock<HashSet<String>> = OnceLock::new();
    let codes = CODES.get_or_init(HashSet::new);
    let base = code
        .rsplit_once('_')
        .filter(|(_, suffix)| suffix.len() == 4 && suffix.bytes().all(|byte| byte.is_ascii_digit()))
        .map_or(code, |(base, _)| base);
    if codes.contains(base) {
        format!("{cdn}/200_icon/10_icon_chr/face/{base}_l.g4tx/{base}_1_l00.png")
    } else {
        "/ievr.webp".into()
    }
}

pub fn list(connection: &Connection) -> anyhow::Result<Value> {
    let mut rosters: HashMap<String, HashSet<String>> = HashMap::new();
    for row in rows(
        connection,
        "SELECT chara_id,team_id FROM inagle_characters",
        &[],
    )? {
        if let (Some(team), Some(character)) = (
            row["team_id"].as_str().filter(|v| !v.is_empty()),
            row["chara_id"].as_str().filter(|v| !v.is_empty()),
        ) {
            rosters
                .entry(team.into())
                .or_default()
                .insert(character.into());
        }
    }
    let mut result = Vec::new();
    for row in rows(
        connection,
        &format!("SELECT {COLUMNS} FROM inagle_teams"),
        &[],
    )? {
        let data = parsed(&row["data"]);
        let name = name(&row);
        let name_rank = rank(name.as_str().unwrap_or(""))?;
        let order = data["binderTeamOrderType"].as_f64().unwrap_or(9999.0);
        let order_value = if data["binderTeamOrderType"].is_number() {
            data["binderTeamOrderType"].clone()
        } else {
            json!(9999)
        };
        let seasons = data
            .get("seasons")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| json!({}));
        let count = row["id"]
            .as_str()
            .and_then(|id| rosters.get(id))
            .map_or(0, HashSet::len);
        result.push((order,name_rank,json!({"id":row["id"],"name":name,"nameJa":first(&[&row["name_ja"]]),"nameEn":first(&[&row["name_en"]]),"emblemUrl":emblem(&row),"seasons":seasons,"seriesKeys":ordered(&row["kits"]).into_iter().map(|(key,_)|key).collect::<Vec<_>>(),"rosterCount":count,"order":order_value})));
    }
    result.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    Ok(Value::Array(
        result.into_iter().map(|(_, _, row)| row).collect(),
    ))
}

fn models(value: &Value) -> Vec<Value> {
    parsed(value).as_array().into_iter().flatten().map(|model| {
        let mut result = json!({"typeId":model.get("typeId").filter(|v|v.is_number()).cloned().unwrap_or_else(||json!(0))});
        for key in ["uniformFielderModelIdCrc","uniformKeeperModelIdCrc","shoesFielderModelIdCrc","gloveModelIdCrc"] {
            result[key] = model.get(key).filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!("0x00000000"));
        }
        result
    }).collect()
}

pub fn detail(connection: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    let Some(row) = rows(
        connection,
        &format!("SELECT {COLUMNS} FROM inagle_teams WHERE id=?1"),
        &[SqlValue::Text(id.into())],
    )?
    .into_iter()
    .next() else {
        return Ok(None);
    };
    let emblems = ordered(&row["emblems"])
        .into_iter()
        .map(|(series, crc)| json!({"series":series,"seriesLabel":series_label(&series),"crc":crc}))
        .collect::<Vec<_>>();
    let mut kits = Vec::new();
    for (series, name_id) in ordered(&row["kits"])
        .into_iter()
        .filter(|(_, id)| present(id))
    {
        let uniforms = rows(
            connection,
            "SELECT models FROM inagle_uniforms WHERE name_id=?1",
            &[SqlValue::Text(name_id.as_str().unwrap_or("").into())],
        )?;
        kits.push(json!({"series":series,"seriesLabel":series_label(&series),"nameId":name_id,"models":uniforms.last().map(|row|models(&row["models"])).unwrap_or_default()}));
    }
    let mut seen = HashSet::new();
    let mut roster = Vec::new();
    for member in rows(
        connection,
        "SELECT chara_id,name_fr,name_ja,base_slug,slug,internal_code,position,element,rarity FROM inagle_characters WHERE team_id=?1",
        &[SqlValue::Text(id.into())],
    )? {
        let Some(character) = member["chara_id"].as_str().filter(|id| !id.is_empty()) else {
            continue;
        };
        if !seen.insert(character.to_owned()) {
            continue;
        }
        let name = first(&[&member["name_fr"], &member["name_ja"], &member["chara_id"]]);
        let order = rank(name.as_str().unwrap_or(""))?;
        let code = first(&[&member["internal_code"], &member["chara_id"]]);
        roster.push((order,json!({"charaId":character,"name":name,"nameJa":first(&[&member["name_ja"]]),"slug":first(&[&member["base_slug"],&member["slug"]]),"position":first(&[&member["position"]]),"element":first(&[&member["element"]]),"rarity":first(&[&member["rarity"]]),"imageUrl":face(code.as_str().unwrap_or(""))})));
    }
    roster.sort_by_key(|(order, _)| *order);
    let data = parsed(&row["data"]);
    Ok(Some(
        json!({"id":row["id"],"name":name(&row),"nameEn":first(&[&row["name_en"]]),"nameJa":first(&[&row["name_ja"]]),"descriptionFr":first(&[&row["description_fr"]]),"descriptionEn":first(&[&row["description_en"]]),"emblemUrl":emblem(&row),"emblems":emblems,"kits":kits,"seasons":data.get("seasons").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!({})),"roster":roster.into_iter().map(|(_,row)|row).collect::<Vec<_>>()}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_optional_asset_inventory_preserves_local_fallbacks() {
        assert_eq!(face("test-character_0001"), "/ievr.webp");
        assert_eq!(emblem(&json!({"emblems": {"v": "0x1234"}})), Value::Null);
    }

    #[test]
    fn ordering_index_rejects_unknown_names_and_json_retains_series_order() {
        assert!(rank("not in the imported corpus").is_err());
        assert_eq!(
            ordered(&json!("{\"v\":\"a\",\"ie\":\"b\",\"go\":\"c\"}"))
                .into_iter()
                .map(|(key, _)| key)
                .collect::<Vec<_>>(),
            ["v", "ie", "go"]
        );
        assert!(ordered(&json!("\\N")).is_empty());
        assert!(models(&json!("bad")).is_empty());
        assert_eq!(models(&json!("[{\"typeId\":\"1\"}]"))[0]["typeId"], 0);
    }
    #[test]
    #[ignore = "requires frozen complete team oracle and licensed mirror"]
    fn all_teams_match_historical_ordered_json() {
        let fixture = std::env::var("NIE_ENTITIES_PARITY_FIXTURE").expect("fixture");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        let mut count = 0;
        for case in cases {
            let actual = match case["kind"].as_str().unwrap() {
                "teams" => list(&connection).unwrap(),
                "team" => detail(&connection, case["request"]["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                _ => continue,
            };
            assert!(
                actual == case["expected"],
                "team contract differs at request {}",
                case["request"]
            );
            count += 1;
        }
        assert_eq!(count, 210);
    }
}
