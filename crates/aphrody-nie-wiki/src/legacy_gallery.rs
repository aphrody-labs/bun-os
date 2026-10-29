//! Historical Azalee gallery envelope (rg 93aea3ba).
//!
//! The default historical list contains only the mirror selection. Menu categories
//! contain only the shared manifest. The canonical editorial inventory combines both;
//! keeping these distinct is intentional compatibility, not an alternative inventory.

use rusqlite::{Connection, types::Value as SqlValue, types::ValueRef};
use serde::Deserialize;
use serde_json::{Value, json};

const MENU_CATEGORIES: &[&str] = &[
    "gallery_img2",
    "ev_pic",
    "stadium",
    "vsroute_map",
    "hlp",
    "telop_waza",
];
const SELECTION_CATEGORIES: &[&str] = &["story", "chronicle", "special", "kizuna", "other"];
fn image_root() -> String {
    format!("{}/dx11/menu/220_img", crate::cdn_base())
}

#[derive(Debug, Default, Deserialize)]
pub struct GalleryRequest {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub q: Option<String>,
    pub category: Option<String>,
}

impl GalleryRequest {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.page.unwrap_or(1) > 0, "page must be positive");
        anyhow::ensure!(self.limit.unwrap_or(60) > 0, "limit must be positive");
        for value in [&self.q, &self.category].into_iter().flatten() {
            anyhow::ensure!(
                value.len() <= 256 && !value.chars().any(char::is_control),
                "invalid gallery filter"
            );
        }
        Ok(())
    }

    fn bounds(&self) -> (u32, u32, u64) {
        let page = self.page.unwrap_or(1);
        let limit = self.limit.unwrap_or(60).min(300);
        (page, limit, u64::from(page - 1) * u64::from(limit))
    }
}

fn variants(image: Option<String>) -> Value {
    json!({
        "thumb":image.as_ref().map(|image| format!("{image}?w=400&format=webp&crop=bandes")),
        "full":image.as_ref().map(|image| format!("{image}?w=1600&format=webp&crop=bandes")),
        "image":image,
    })
}

fn title(stem: &str) -> String {
    let clean = stem.strip_prefix("img_").unwrap_or(stem).replace('_', " ");
    let mut previous_word = false;
    let mut result = String::new();
    for ch in clean.trim().chars() {
        let word = ch.is_ascii_alphanumeric();
        result.push(if word && !previous_word {
            ch.to_ascii_uppercase()
        } else {
            ch
        });
        previous_word = word;
    }
    if result.is_empty() {
        stem.to_owned()
    } else {
        result
    }
}

fn category(stem: &str) -> &str {
    let parsed = stem.strip_prefix("img_").unwrap_or_default();
    let end = parsed
        .find(|ch: char| !ch.is_ascii_lowercase())
        .unwrap_or(parsed.len());
    let parsed = &parsed[..end];
    if SELECTION_CATEGORIES.contains(&parsed) || MENU_CATEGORIES.contains(&parsed) {
        parsed
    } else {
        "other"
    }
}

fn scalar(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Value> {
    Ok(match row.get_ref(index)? {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => {
            let text = String::from_utf8_lossy(value);
            if matches!(text.as_ref(), "\\N" | "\\\\N") {
                Value::Null
            } else {
                json!(text)
            }
        }
        ValueRef::Blob(_) => {
            return Err(rusqlite::Error::InvalidColumnType(
                index,
                "gallery value".into(),
                rusqlite::types::Type::Blob,
            ));
        }
    })
}

fn selection(connection: &Connection, input: &GalleryRequest) -> anyhow::Result<(Vec<Value>, u64)> {
    let image_root = image_root();
    let mut filter = vec!["1".to_owned()];
    let mut values = Vec::<SqlValue>::new();
    if let Some(category) = input
        .category
        .as_deref()
        .filter(|category| SELECTION_CATEGORIES.contains(category))
    {
        filter.push("img_path LIKE ?".into());
        values.push(format!("img_{category}_%").into());
    }
    if let Some(query) = input.q.as_deref().filter(|query| !query.is_empty()) {
        filter.push("img_path LIKE ?".into());
        values.push(format!("%{}%", crate::query::sanitize_filter(query)).into());
    }
    let filter = filter.join(" AND ");
    let (_, limit, offset) = input.bounds();
    let snapshot = connection.unchecked_transaction()?;
    let total = snapshot.query_row(
        &format!("SELECT COUNT(*) FROM inagle_gallery WHERE {filter}"),
        rusqlite::params_from_iter(&values),
        |row| row.get::<_, i64>(0).map(|v| v as u64),
    )?;
    let records = {
        let mut statement = snapshot.prepare(&format!("SELECT id,img_path,need_token_num,flg_no FROM inagle_gallery WHERE {filter} ORDER BY CASE WHEN flg_no IS NULL OR flg_no = '\\\\N' THEN 1 ELSE 0 END, flg_no ASC LIMIT {limit} OFFSET {offset}"))?;
        statement
            .query_map(rusqlite::params_from_iter(&values), |row| {
                let raw_path = scalar(row, 1)?;
                let path = raw_path.as_str().unwrap_or_default();
                let token = scalar(row, 2)?;
                let flag = scalar(row, 3)?;
                let mut result = variants(
                    (!path.is_empty()).then(|| format!("{image_root}/gallery_img2/{path}.png")),
                );
                let object = result.as_object_mut().expect("gallery object");
                object.insert("id".into(), scalar(row, 0)?);
                object.insert("imgPath".into(), json!(path));
                object.insert("category".into(), json!(category(path)));
                object.insert("title".into(), json!(title(path)));
                object.insert(
                    "needTokenNum".into(),
                    if token.is_null() { json!(0) } else { token },
                );
                object.insert("flgNo".into(), if flag.is_null() { json!(0) } else { flag });
                Ok(result)
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    snapshot.commit()?;
    Ok((records, total))
}

fn menu(input: &GalleryRequest) -> anyhow::Result<(Vec<Value>, u64)> {
    let image_root = image_root();
    // One inventory reconstruction, independent of page size and the presence of a mirror table.
    let inventory = crate::gallery::manifest_records()?;
    let search = input.q.as_deref().unwrap_or_default().trim().to_lowercase();
    let mut records = Vec::new();
    for record in inventory {
        if input
            .category
            .as_deref()
            .is_some_and(|category| category != "menu" && category != record.category)
        {
            continue;
        }
        let native = record
            .vfs_path
            .as_deref()
            .and_then(|path| path.strip_prefix("data/dx11/menu/220_img/"))
            .and_then(|path| path.strip_suffix(".g4tx"))
            .ok_or_else(|| anyhow::anyhow!("gallery manifest record has no native image path"))?;
        let path = format!("{native}.png");
        let file = path.rsplit('/').next().unwrap_or(&path);
        let title = record.title.unwrap_or_default();
        if !search.is_empty()
            && !title.to_lowercase().contains(&search)
            && !file.to_lowercase().contains(&search)
        {
            continue;
        }
        records.push((record.id, record.category, title, path));
    }
    let total = records.len() as u64;
    let (_, limit, offset) = input.bounds();
    Ok((
        records
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(usize::MAX))
            .take(limit as usize)
            .map(|(id, category, title, path)| {
                // Materialize image variants only for the requested page, not all 3,579 entries.
                let mut value = variants(Some(format!("{image_root}/{path}")));
                let object = value.as_object_mut().expect("gallery object");
                object.insert("id".into(), json!(id));
                object.insert("imgPath".into(), json!(path));
                object.insert("category".into(), json!(category));
                object.insert("title".into(), json!(title));
                object.insert("needTokenNum".into(), json!(0));
                object.insert("flgNo".into(), json!(0));
                value
            })
            .collect(),
        total,
    ))
}

pub fn list(connection: &Connection, input: &GalleryRequest) -> anyhow::Result<Value> {
    input.validate()?;
    let (data, total) = if input
        .category
        .as_deref()
        .is_some_and(|category| category == "menu" || MENU_CATEGORIES.contains(&category))
    {
        menu(input)?
    } else {
        selection(connection, input)?
    };
    let (page, limit, _) = input.bounds();
    Ok(json!({"data":data,"total":total,"page":page,"limit":limit}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_without_external_inventory_or_selection_table_is_empty() {
        assert!(
            std::env::var_os("NIE_GALLERY_MANIFEST").is_none(),
            "run offline tests without NIE_GALLERY_MANIFEST"
        );
        let connection = Connection::open_in_memory().unwrap();
        let menu = list(
            &connection,
            &GalleryRequest {
                category: Some("menu".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(menu["total"], 0);
        assert!(menu["data"].as_array().unwrap().is_empty());
    }

    #[test]
    fn selection_preserves_text_order_nulls_titles_and_literal_legacy_patterns() {
        let image_root = image_root();
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE inagle_gallery(id TEXT,img_path TEXT,need_token_num TEXT,flg_no TEXT);
            INSERT INTO inagle_gallery VALUES ('two','img_story_two','2','2'),('ten','img_story_ten','10','10'),('null','img_other_null',NULL,NULL);").unwrap();
        let page = list(
            &connection,
            &GalleryRequest {
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page["total"], 3);
        assert_eq!(page["data"][0]["id"], "ten");
        assert_eq!(page["data"][0]["needTokenNum"], "10");
        assert_eq!(page["data"][0]["title"], "Story Ten");
        assert_eq!(
            page["data"][0]["full"],
            format!("{image_root}/gallery_img2/img_story_ten.png?w=1600&format=webp&crop=bandes")
        );
        let second = list(
            &connection,
            &GalleryRequest {
                category: Some("story".into()),
                page: Some(2),
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(second["total"], 2);
        assert_eq!(second["data"][0]["id"], "two");
        let all = list(
            &connection,
            &GalleryRequest {
                category: Some("unknown".into()),
                q: Some("%_".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(all["total"], 3);
        assert_eq!(all["data"][2]["needTokenNum"], 0);
        assert_eq!(all["data"][2]["flgNo"], 0);
    }

    #[test]
    #[ignore = "requires explicit NIE_GALLERY_MANIFEST with the qualified 3579-item inventory"]
    fn menu_uses_shared_inventory_once_without_requiring_selection_table() {
        let connection = Connection::open_in_memory().unwrap();
        let menu = list(
            &connection,
            &GalleryRequest {
                category: Some("menu".into()),
                limit: Some(999),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(menu["total"], 3579);
        assert_eq!(menu["limit"], 300);
        assert_eq!(menu["data"].as_array().unwrap().len(), 300);
        let images = list(
            &connection,
            &GalleryRequest {
                category: Some("gallery_img2".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(images["total"], 363);
        let no_directory_search = list(
            &connection,
            &GalleryRequest {
                category: Some("menu".into()),
                q: Some("telop_waza/".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(no_directory_search["total"], 0);
        assert!(list(&connection, &GalleryRequest::default()).is_err());
    }

    #[test]
    #[ignore = "requires private mirror and captured rg93aea3ba gallery responses"]
    fn real_mirror_matches_captured_gallery_contract() {
        let fixture = std::env::var("NIE_GALLERY_PARITY_FIXTURE").expect("fixture path");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        assert!(cases.len() >= 20);
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        for (index, case) in cases.iter().enumerate() {
            let actual = list(
                &connection,
                &serde_json::from_value(case["input"].clone()).unwrap(),
            )
            .unwrap();
            assert!(
                actual == case["expected"],
                "historical gallery JSON differs at fixture {index}"
            );
        }
        let editorial = crate::gallery::query(
            &connection,
            &crate::gallery::GalleryRequest {
                view: Some("editorial".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(editorial.total, 3939);
        assert_eq!(
            editorial
                .categories
                .iter()
                .map(|category| category.count)
                .sum::<u64>(),
            3939
        );
    }
}
