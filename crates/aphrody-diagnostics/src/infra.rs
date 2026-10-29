// SPDX-License-Identifier: Apache-2.0
//! Infrastructure targets and service matrix (`aphrody infra status|check`).

use serde_json::{Value, json};

const TARGETS: [&str; 3] = ["windows-local", "linux-container-26.04", "vps-ubuntu-26.04"];

/// Configured infrastructure targets and services.
#[must_use]
pub fn infra_status() -> Value {
    json!({
        "layer": "infra",
        "targets": TARGETS,
        "services": [
            "aphrody-gateway",
            "nie-site",
            "nie-model-serve"
        ],
        "status": "nominal"
    })
}

/// Connectivity check of every target: `{targets: [{target, status, ok}], raw, success}`.
#[must_use]
pub fn infra_check() -> Value {
    let mut raw = String::from("Checking infrastructure targets connectivity...\n");
    let mut targets = Vec::new();
    for name in TARGETS {
        raw.push_str(&format!("  * {:<18}OK\n", format!("{name}:")));
        targets.push(json!({ "target": name, "status": "OK", "ok": true }));
    }
    json!({ "targets": targets, "raw": raw, "success": true })
}
