// SPDX-License-Identifier: Apache-2.0
//! JSON <-> nushell `Value`.

use nu_protocol::{Record, Span, Value};
use serde_json::{Map, Number, Value as Json};

#[must_use]
pub fn to_nu(json: &Json, span: Span) -> Value {
    match json {
        Json::Null => Value::nothing(span),
        Json::Bool(b) => Value::bool(*b, span),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::int(i, span),
            None => Value::float(n.as_f64().unwrap_or_default(), span),
        },
        Json::String(s) => Value::string(s.clone(), span),
        Json::Array(items) => Value::list(items.iter().map(|v| to_nu(v, span)).collect(), span),
        Json::Object(map) => {
            let mut record = Record::with_capacity(map.len());
            for (k, v) in map {
                record.push(k.clone(), to_nu(v, span));
            }
            Value::record(record, span)
        }
    }
}

#[must_use]
pub fn to_json(value: &Value) -> Json {
    match value {
        Value::Nothing { .. } => Json::Null,
        Value::Bool { val, .. } => Json::Bool(*val),
        Value::Int { val, .. } => Json::from(*val),
        Value::Float { val, .. } => Number::from_f64(*val).map_or(Json::Null, Json::Number),
        Value::Filesize { val, .. } => Json::from(val.get()),
        Value::Duration { val, .. } => Json::from(*val),
        Value::String { val, .. } | Value::Glob { val, .. } => Json::String(val.clone()),
        Value::Date { val, .. } => Json::String(val.to_rfc3339()),
        Value::List { vals, .. } => Json::Array(vals.iter().map(to_json).collect()),
        Value::Record { val, .. } => {
            let mut map = Map::new();
            for (k, v) in val.iter() {
                map.insert(k.clone(), to_json(v));
            }
            Json::Object(map)
        }
        Value::Binary { val, .. } => Json::Array(val.iter().map(|b| Json::from(*b)).collect()),
        other => Json::String(other.to_expanded_string(", ", &nu_protocol::Config::default())),
    }
}
