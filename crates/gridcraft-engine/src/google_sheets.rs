//! Offline import of the values in a Google Sheets API `ValueRange` response.
//!
//! This is a values-only interchange, not a Sheets API server or a cloud sync.
//! Formatting, formula interpretation, and spreadsheet metadata are not included.

use gridcraft_core::{CellRef, MAX_COLS, MAX_ROWS, RangeRef, Value};
use gridcraft_model::{Cell, Formula, Sheet, Workbook};
use serde_json::Value as Json;

use crate::{EngineError, Result};

/// Import a ValueRange into a new workbook at the caller-supplied zero-based origin.
///
/// Strings, including strings beginning with `=`, remain literal text. JSON nulls
/// are skipped, consistent with the Sheets values API. `range` is descriptive:
/// the caller resolves it and supplies the origin explicitly.
pub fn import_value_range(input: &[u8], origin: CellRef) -> Result<Workbook> {
    import_value_range_with_formulas(input, origin, false)
}

/// Opt-in formula import for a response obtained with `valueRenderOption=FORMULA`.
/// Other strings remain literal. The caller must distinguish this response from
/// formatted or unformatted values, where a leading `=` may be literal text.
pub fn import_value_range_with_formulas(
    input: &[u8],
    origin: CellRef,
    formulas: bool,
) -> Result<Workbook> {
    const MAX_INPUT: usize = 8 * 1024 * 1024;
    const MAX_CELLS: usize = 100_000;
    let bad = |message: &str| EngineError::Other(format!("Google Sheets ValueRange: {message}"));
    if input.len() > MAX_INPUT || origin.row >= MAX_ROWS || origin.col >= MAX_COLS {
        return Err(bad("input or origin exceeds the supported limits"));
    }
    let json: Json = serde_json::from_slice(input).map_err(|_| bad("invalid JSON"))?;
    let object = json.as_object().ok_or_else(|| bad("expected an object"))?;
    let columns = match object.get("majorDimension") {
        None => false,
        Some(Json::String(s)) if s == "ROWS" => false,
        Some(Json::String(s)) if s == "COLUMNS" => true,
        _ => return Err(bad("majorDimension must be ROWS or COLUMNS")),
    };
    let mut cells = Vec::new();
    if let Some(values) = object.get("values") {
        let outer = values
            .as_array()
            .ok_or_else(|| bad("values must be an array"))?;
        for (i, row) in outer.iter().enumerate() {
            let row = row
                .as_array()
                .ok_or_else(|| bad("each values entry must be an array"))?;
            for (j, item) in row.iter().enumerate() {
                if cells.len() >= MAX_CELLS {
                    return Err(bad("too many cells"));
                }
                let (r, c) = if columns { (j, i) } else { (i, j) };
                let row = u32::try_from(r)
                    .ok()
                    .and_then(|n| origin.row.checked_add(n));
                let col = u32::try_from(c)
                    .ok()
                    .and_then(|n| origin.col.checked_add(n));
                let (Some(row), Some(col)) = (row, col) else {
                    return Err(bad("range is too large"));
                };
                if row >= MAX_ROWS || col >= MAX_COLS {
                    return Err(bad("range is outside the grid"));
                }
                let cell = match item {
                    Json::Null => continue,
                    Json::Bool(v) => Cell::value(Value::Bool(*v)),
                    Json::Number(v) => Cell::value(Value::Number(
                        v.as_f64().ok_or_else(|| bad("invalid number"))?,
                    )),
                    Json::String(v) if formulas && v.starts_with('=') => {
                        Cell::formula(Formula::new(v))
                    }
                    Json::String(v) => Cell::value(Value::text(v.as_str())),
                    _ => return Err(bad("cell values must be scalars")),
                };
                cells.push((CellRef::new(row, col), cell));
            }
        }
    }
    let mut workbook = Workbook::new();
    let sheet = workbook
        .sheet_mut(0)
        .ok_or_else(|| bad("missing initial sheet"))?;
    for (address, cell) in cells {
        sheet.set_cell(address, cell);
    }
    Ok(workbook)
}

/// Export an explicit range as a Sheets `ValueRange` using row-major ordering.
///
/// Empty cells are empty strings (which clear cells in a Sheets values update).
/// With `formulas`, formula text is emitted instead of the cached value. This
/// does not recalculate the workbook or preserve styles and other metadata.
pub fn export_value_range(sheet: &Sheet, range: RangeRef, formulas: bool) -> Result<Vec<u8>> {
    if !range.start.is_valid()
        || !range.end.is_valid()
        || range.start.row > range.end.row
        || range.start.col > range.end.col
        || range.count() > 100_000
    {
        return Err(EngineError::Other(
            "Google Sheets ValueRange: range exceeds supported limits".into(),
        ));
    }
    let mut rows = Vec::new();
    for row in range.start.row..=range.end.row {
        let mut values = Vec::new();
        for col in range.start.col..=range.end.col {
            let cell = CellRef::new(row, col);
            if formulas && let Some(formula) = sheet.cell(cell).and_then(|c| c.formula.as_ref()) {
                values.push(Json::String(format!("={}", formula.text)));
                continue;
            }
            let value = match sheet.value(cell) {
                Value::Empty => Json::String(String::new()),
                Value::Bool(v) => Json::Bool(v),
                Value::Number(v) => {
                    Json::Number(serde_json::Number::from_f64(v).ok_or_else(|| {
                        EngineError::Other("Google Sheets ValueRange: non-finite number".into())
                    })?)
                }
                Value::Text(v) => Json::String(v.to_string()),
                Value::Error(v) => Json::String(v.to_string()),
                Value::Array(_) => {
                    return Err(EngineError::Other(
                        "Google Sheets ValueRange: array cell cannot be exported".into(),
                    ));
                }
            };
            values.push(value);
        }
        rows.push(values);
    }
    serde_json::to_vec(&serde_json::json!({"majorDimension": "ROWS", "values": rows}))
        .map_err(|e| EngineError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_columns_at_origin_and_keeps_formulas_literal() {
        let book = import_value_range(
            br#"{"majorDimension":"COLUMNS","values":[[1,true],["=A1",null]]}"#,
            CellRef::new(2, 3),
        )
        .unwrap();
        let sheet = book.sheet(0).unwrap();
        assert_eq!(sheet.value(CellRef::new(2, 3)), Value::Number(1.0));
        assert_eq!(sheet.value(CellRef::new(3, 3)), Value::Bool(true));
        assert_eq!(sheet.value(CellRef::new(2, 4)), Value::text("=A1"));
        assert_eq!(sheet.value(CellRef::new(3, 4)), Value::Empty);
    }

    #[test]
    fn rejects_invalid_cells_and_out_of_bounds() {
        assert!(import_value_range(br#"{"values":[[{}]]}"#, CellRef::new(0, 0)).is_err());
        assert!(
            import_value_range(br#"{"values":[[1,2]]}"#, CellRef::new(0, MAX_COLS - 1)).is_err()
        );
    }

    #[test]
    fn formula_import_is_explicit() {
        let book =
            import_value_range_with_formulas(br#"{"values":[["=1+1"]]}"#, CellRef::new(0, 0), true)
                .unwrap();
        assert_eq!(
            book.sheet(0)
                .unwrap()
                .cell(CellRef::new(0, 0))
                .unwrap()
                .input_text(),
            "=1+1"
        );
        assert!(
            book.sheet(0)
                .unwrap()
                .cell(CellRef::new(0, 0))
                .unwrap()
                .formula
                .is_some()
        );
    }

    #[test]
    fn export_values_and_formulas() {
        use gridcraft_model::{Cell, Formula};
        let mut sheet = Sheet::new("Sheet1");
        sheet.set_value(CellRef::new(0, 0), Value::Number(3.0));
        sheet.set_cell(CellRef::new(0, 1), Cell::formula(Formula::new("A1+1")));
        let range = RangeRef::new(CellRef::new(0, 0), CellRef::new(1, 1));
        let data = export_value_range(&sheet, range, true).unwrap();
        let json: Json = serde_json::from_slice(&data).unwrap();
        assert_eq!(
            json["values"],
            serde_json::json!([[3.0, "=A1+1"], ["", ""]])
        );
    }
}
