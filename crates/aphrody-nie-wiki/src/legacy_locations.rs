//! Frozen Azalee shop/stadium contracts (rg 93aea3ba).
//! Canonical auxiliary DTOs remain unchanged. This boundary retains historical
//! raw scalar types, joins, stable ordering, and missing-source response shapes.

use crate::legacy_entities::rows;
use rusqlite::{Connection, types::Value as SqlValue};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

fn present(value: &Value) -> bool {
    !value.is_null() && value.as_str() != Some("")
}
fn first(values: &[&Value]) -> Value {
    values
        .iter()
        .find(|value| present(value))
        .map_or(Value::Null, |value| (*value).clone())
}
fn string(value: &Value) -> String {
    value
        .as_str()
        .map_or_else(|| value.to_string(), str::to_owned)
}
fn decimal_prefix(value: &str) -> Option<i64> {
    let value = value.trim_start();
    let end = value
        .char_indices()
        .find(|(i, ch)| !ch.is_ascii_digit() && !(*i == 0 && matches!(ch, '+' | '-')))
        .map_or(value.len(), |(i, _)| i);
    value[..end].parse().ok()
}
fn integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str()?.parse().ok())
}
fn shop_name(id: i64, source: &Value) -> String {
    let name = match id {
        1314944986 => "Centre commercial Chronique",
        2615185778 => "Boutique VS",
        1526934762 => "Marché aux esprits",
        1192581557 => "BB Mart",
        3908984051 => "Footech (Odaiba)",
        2683923557 => "Footech (Salle d'arcade)",
        2973445077 => "Boutique Kizuna",
        4019427562 => "Goal-Marché (Odaiba)",
        27130310 => "Goal-Marché (Salle d'arcade)",
        2559879292 => "Goal-Marché (Gare de Nagumohara)",
        1912016201 => "L'Étoffe des héros (Nagumo)",
        116407775 => "L'Étoffe des héros (Odaiba)",
        1723005414 => "Repaire des indomptables",
        485633447 => "Échange de jetons VS",
        1629770002 => "Récompenses Chronique",
        _ => "",
    };
    if !name.is_empty() {
        name.into()
    } else {
        source
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Boutique {id}"))
    }
}

const SHOP_COLUMNS: &str =
    "shop_id,name_fr,name_en,name_ja,item_db_id,item_name_fr,item_name_en,slot_index";
fn item_index(connection: &Connection) -> HashMap<String, Value> {
    rows(
        connection,
        "SELECT id,name_fr,name_en,category,image_url,internal_code FROM inagle_items",
        &[],
    )
    .unwrap_or_default()
    .into_iter()
    .filter_map(|row| Some((row["id"].as_str()?.to_owned(), row)))
    .collect()
}
fn increment(categories: &mut Vec<(String, usize)>, category: &Value) {
    if let Some(category) = category.as_str().filter(|v| !v.is_empty()) {
        if let Some((_, count)) = categories.iter_mut().find(|(key, _)| key == category) {
            *count += 1;
        } else {
            categories.push((category.into(), 1));
        }
    }
}
fn category_values(mut categories: Vec<(String, usize)>) -> Vec<Value> {
    categories.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    categories
        .into_iter()
        .map(|(category, count)| json!({"category":category,"count":count}))
        .collect()
}

/// Complete list; legacy query parameters were ignored, not pagination controls.
pub fn shops(connection: &Connection) -> anyhow::Result<Value> {
    let index = item_index(connection);
    let records = rows(
        connection,
        &format!("SELECT {SHOP_COLUMNS} FROM inagle_shops"),
        &[],
    )
    .unwrap_or_default();
    type ShopGroup = (i64, Value, usize, Vec<(String, usize)>);
    let mut groups: Vec<ShopGroup> = Vec::new();
    for row in records {
        let id = integer(&row["shop_id"]).unwrap_or_default();
        let position = groups
            .iter()
            .position(|group| group.0 == id)
            .unwrap_or_else(|| {
                groups.push((id, row.clone(), 0, Vec::new()));
                groups.len() - 1
            });
        let (_, _, count, categories) = &mut groups[position];
        *count += 1;
        if let Some(item) = row["item_db_id"].as_str().and_then(|id| index.get(id)) {
            increment(categories, &item["category"]);
        }
    }
    groups.sort_by_key(|(_, _, count, _)| std::cmp::Reverse(*count));
    Ok(Value::Array(groups.into_iter().map(|(id,row,count,categories)|json!({"shopId":id,"name":shop_name(id,&row["name_fr"]),"nameEn":first(&[&row["name_en"]]),"nameJa":first(&[&row["name_ja"]]),"itemCount":count,"categories":category_values(categories)})).collect()))
}

pub fn shop(connection: &Connection, key: &str) -> anyhow::Result<Option<Value>> {
    let Some(id) = decimal_prefix(key) else {
        return Ok(None);
    };
    let records = rows(
        connection,
        &format!(
            "SELECT {SHOP_COLUMNS} FROM inagle_shops WHERE shop_id=?1 ORDER BY slot_index ASC"
        ),
        &[SqlValue::Integer(id)],
    )
    .unwrap_or_default();
    let Some(head) = records.first() else {
        return Ok(None);
    };
    let index = item_index(connection);
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut categories = Vec::new();
    for row in &records {
        let slot = if row["slot_index"].is_null() {
            String::new()
        } else {
            string(&row["slot_index"])
        };
        let fallback = json!(format!("{}:{slot}", string(&row["shop_id"])));
        let db_id = first(&[&row["item_db_id"], &row["item_name_fr"], &fallback]);
        if !seen.insert(format!("{}:{slot}", string(&db_id))) {
            continue;
        }
        let item = row["item_db_id"].as_str().and_then(|id| index.get(id));
        let empty = Value::Null;
        let detail = item.unwrap_or(&empty);
        let fallback = if present(&row["item_db_id"]) {
            json!(format!("Objet {}", string(&row["item_db_id"])))
        } else {
            json!("Objet inconnu")
        };
        let name = first(&[
            &detail["name_fr"],
            &detail["name_en"],
            &row["item_name_fr"],
            &row["item_name_en"],
            &fallback,
        ]);
        let category = first(&[&detail["category"]]);
        increment(&mut categories, &category);
        items.push(json!({"id":if present(&row["item_db_id"]){row["item_db_id"].clone()}else{json!("")},"name":name,"category":category,"icon":first(&[&detail["image_url"]]),"internalCode":first(&[&detail["internal_code"]]),"slotIndex":if row["slot_index"].is_null(){json!(0)}else{row["slot_index"].clone()},"resolved":item.is_some()}));
    }
    Ok(Some(
        json!({"shopId":id,"name":shop_name(id,&head["name_fr"]),"nameEn":first(&[&head["name_en"]]),"nameJa":first(&[&head["name_ja"]]),"itemCount":items.len(),"categories":category_values(categories),"items":items}),
    ))
}

fn stadium_value(row: &Value) -> Value {
    let code = row["image_path"]
        .as_str()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("");
    // TEXT indices intentionally retain the frozen JavaScript typeof behavior.
    let title = row["field_index"]
        .as_f64()
        .map(|index| format!("Terrain {}", index + 1.0))
        .unwrap_or_else(|| {
            if code.is_empty() {
                "Terrain".into()
            } else {
                code.into()
            }
        });
    let image = format!("{}/dx11/menu/220_img/stadium/{code}.png", crate::cdn_base());
    json!({"id":row["id"],"code":code,"index":row["field_index"],"title":title,"image":image,"thumb":format!("{image}?w=400&format=webp&crop=bandes"),"full":format!("{image}?w=1600&format=webp&crop=bandes")})
}
fn stadium_order(value: &Value) -> f64 {
    if value.is_null() {
        9_007_199_254_740_991.0
    } else if value.as_str().is_some_and(|value| value.trim().is_empty()) {
        0.0
    } else {
        value
            .as_f64()
            .or_else(|| value.as_str()?.trim().parse().ok())
            .unwrap_or(f64::NAN)
    }
}
pub fn stadiums(connection: &Connection, query: Option<&str>) -> anyhow::Result<Value> {
    let query = query.unwrap_or("").trim().to_lowercase();
    let mut records = rows(
        connection,
        "SELECT id,field_index,image_path,condition FROM inagle_stadiums",
        &[],
    )
    .unwrap_or_default()
    .iter()
    .map(stadium_value)
    .filter(|row| {
        query.is_empty()
            || row["code"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
            || row["title"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
    })
    .collect::<Vec<_>>();
    records.sort_by(|a, b| {
        if a["index"] == b["index"] {
            a["id"].as_str().cmp(&b["id"].as_str())
        } else {
            (stadium_order(&a["index"]) - stadium_order(&b["index"]))
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    Ok(json!({"total":records.len(),"data":records}))
}
pub fn stadium(connection: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    Ok(rows(
        connection,
        "SELECT id,field_index,image_path,condition FROM inagle_stadiums WHERE id=?1 LIMIT 1",
        &[SqlValue::Text(id.into())],
    )
    .unwrap_or_default()
    .first()
    .map(stadium_value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shop_counts_keep_duplicates_until_detail_and_preserve_raw_slot_order() {
        let connection = Connection::open_in_memory().unwrap();
        let columns = SHOP_COLUMNS
            .split(',')
            .map(|name| format!("{name} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection.execute_batch(&format!("CREATE TABLE inagle_shops({columns});
            CREATE TABLE inagle_items(id TEXT,name_fr TEXT,name_en TEXT,category TEXT,image_url TEXT,internal_code TEXT);
            INSERT INTO inagle_items VALUES('item','Joined',NULL,'category',NULL,'code');
            INSERT INTO inagle_shops(shop_id,name_fr,item_db_id,slot_index) VALUES('99','Source','item','2'),('99','Source','item','10'),('99','Source','item','2'),('99','Source',NULL,NULL);")).unwrap();
        let list = shops(&connection).unwrap();
        assert_eq!(list[0]["itemCount"], 4);
        assert_eq!(list[0]["categories"][0]["count"], 3);
        let detail = shop(&connection, "99tail").unwrap().unwrap();
        assert_eq!(detail["itemCount"], 3);
        assert_eq!(detail["items"][0]["id"], "");
        assert_eq!(detail["items"][0]["resolved"], false);
        assert_eq!(detail["items"][0]["slotIndex"], 0);
        assert_eq!(detail["items"][1]["slotIndex"], "10");
        assert_eq!(detail["items"][2]["slotIndex"], "2");
        assert_eq!(detail["items"][1]["name"], "Joined");
        assert_eq!(detail["categories"][0]["count"], 2);
        assert_eq!(detail["shopId"], 99);
    }
    #[test]
    fn missing_sources_and_raw_indices_keep_legacy_responses() {
        let connection = Connection::open_in_memory().unwrap();
        assert_eq!(shops(&connection).unwrap(), json!([]));
        assert!(shop(&connection, "1").unwrap().is_none());
        assert_eq!(
            stadiums(&connection, None).unwrap(),
            json!({"data":[],"total":0})
        );
        assert!(stadium(&connection, "missing").unwrap().is_none());
        let raw = stadium_value(
            &json!({"id":"field","field_index":"2","image_path":"stadium/img_native"}),
        );
        assert_eq!(raw["index"], "2");
        assert_eq!(raw["title"], "img_native");
        assert_eq!(
            stadium_value(&json!({"id":"field","field_index":2,"image_path":null}))["title"],
            "Terrain 3"
        );
        assert_eq!(decimal_prefix(" +123tail"), Some(123));
        assert_eq!(decimal_prefix("0x10"), Some(0));
        assert_eq!(decimal_prefix("bad"), None);
    }
    #[test]
    #[ignore = "requires frozen complete locations oracle and licensed mirror"]
    fn locations_match_complete_historical_oracle() {
        let fixture = std::env::var("NIE_LOCATIONS_PARITY_FIXTURE").expect("fixture");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        let mut count = 0;
        for case in cases {
            let actual = match case["kind"].as_str().unwrap() {
                "shops" => shops(&connection).unwrap(),
                "shop" => shop(&connection, case["request"]["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                "stadiums" => stadiums(&connection, case["request"]["q"].as_str()).unwrap(),
                "stadium" => stadium(&connection, case["request"]["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                _ => panic!("unknown fixture"),
            };
            assert!(
                actual == case["expected"],
                "locations contract differs at {} {}",
                case["kind"],
                case["request"]
            );
            count += 1;
        }
        assert_eq!(count, 112);
    }
}
