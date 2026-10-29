// SPDX-License-Identifier: Apache-2.0 OR MIT
//! End-to-end through real IPC: each module is registered on a `MockRuntime` app, the ACL is
//! resolved from the permission files the build script generated, and commands are invoked as
//! the webview would (`plugin:<name>|<command>`), so the ACL check, argument decoding and the
//! command itself all run. Modules that need a display or a desktop session (dialog, clipboard,
//! global-shortcut, opener) are out of this suite.
use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, RuntimeAuthority};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};
use tauri_utils::acl::capability::Capability;
use tauri_utils::acl::manifest::{Manifest, PermissionFile};
use tauri_utils::acl::resolved::Resolved;
use tauri_utils::platform::Target;

const MEMBERS: &[&str] = &[
    "aphrody",
    "deep-link",
    "fs",
    "log",
    "notification",
    "os",
    "store",
    "window-state",
    "autostart",
];

fn manifests() -> BTreeMap<String, Manifest> {
    let mut acl = BTreeMap::new();
    for name in MEMBERS {
        let list = PathBuf::from(env!("OUT_DIR"))
            .join("bundle")
            .join(name)
            .join(format!("bundle-{name}-permission-files"));
        let paths: Vec<PathBuf> =
            serde_json::from_str(&std::fs::read_to_string(&list).unwrap()).unwrap();
        // entries inside the out dir are listed relative to the list file
        let dir = list.parent().unwrap();
        let files = paths
            .iter()
            .filter(|p| p.extension().is_some_and(|e| e == "toml"))
            .map(|p| {
                toml::from_str::<PermissionFile>(&std::fs::read_to_string(dir.join(p)).unwrap())
                    .unwrap()
            })
            .collect();
        acl.insert(name.to_string(), Manifest::new(files, None));
    }
    acl
}

fn app(
    permissions: Value,
    plugins: Value,
    register: impl FnOnce(tauri::Builder<MockRuntime>) -> tauri::Builder<MockRuntime>,
) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let acl = manifests();
    let capability: Capability = serde_json::from_value(
        json!({ "identifier": "e2e", "windows": ["main"], "permissions": permissions }),
    )
    .unwrap();
    let resolved = Resolved::resolve(
        &acl,
        BTreeMap::from([("e2e".to_string(), capability)]),
        Target::current(),
    )
    .unwrap();
    let mut context = mock_context(noop_assets());
    context.config_mut().identifier = "dev.aphrody.tauri.e2e".into();
    if let Value::Object(map) = plugins {
        context.config_mut().plugins.0.extend(map);
    }
    *context.runtime_authority_mut() = RuntimeAuthority::new(acl, resolved);
    let app = register(mock_builder()).build(context).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, window)
}

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<Value>().unwrap())
}

#[test]
fn acl_denies_commands_without_permission() {
    let (_app, w) = app(json!(["os:allow-locale"]), json!({}), |b| {
        b.plugin(tauri_plugin_aphrody::os::init())
    });
    assert!(invoke(&w, "plugin:os|locale", json!({})).is_ok());
    let denied = invoke(&w, "plugin:os|hostname", json!({})).unwrap_err();
    assert!(denied.to_string().contains("not allowed"), "{denied}");
}

#[test]
fn os() {
    let (_app, w) = app(json!(["os:default", "os:allow-hostname"]), json!({}), |b| {
        b.plugin(tauri_plugin_aphrody::os::init())
    });
    let host = invoke(&w, "plugin:os|hostname", json!({})).unwrap();
    assert!(!host.as_str().unwrap().is_empty());
}

#[test]
fn fs_inside_scope_only() {
    let dir = tempfile::Builder::new().prefix("tp-fs-").tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    std::fs::write(root.join("a.txt"), "bun").unwrap();
    let allow =
        json!([{ "path": root.to_string_lossy() }, { "path": root.join("**").to_string_lossy() }]);
    let (_app, w) = app(
        json!(
            [
                "fs:allow-mkdir",
                "fs:allow-read-dir",
                "fs:allow-stat",
                "fs:allow-exists"
            ]
            .iter()
            .map(|id| json!({ "identifier": id, "allow": allow }))
            .collect::<Vec<_>>()
        ),
        json!({}),
        |b| b.plugin(tauri_plugin_aphrody::fs::init()),
    );
    let sub = root.join("sub");
    invoke(
        &w,
        "plugin:fs|mkdir",
        json!({ "path": sub.to_string_lossy(), "options": {} }),
    )
    .unwrap();
    assert!(sub.is_dir());
    assert_eq!(
        invoke(
            &w,
            "plugin:fs|exists",
            json!({ "path": sub.to_string_lossy() })
        )
        .unwrap(),
        json!(true)
    );
    let mut names: Vec<String> = invoke(
        &w,
        "plugin:fs|read_dir",
        json!({ "path": root.to_string_lossy() }),
    )
    .unwrap()
    .as_array()
    .unwrap()
    .iter()
    .map(|e| e["name"].as_str().unwrap().to_string())
    .collect();
    names.sort();
    assert_eq!(names, ["a.txt", "sub"]);
    let info = invoke(
        &w,
        "plugin:fs|stat",
        json!({ "path": root.join("a.txt").to_string_lossy() }),
    )
    .unwrap();
    assert_eq!(
        (info["isFile"].clone(), info["size"].clone()),
        (json!(true), json!(3))
    );
    let outside = std::env::temp_dir().join("tauri-plugin-aphrody-outside");
    let err = invoke(
        &w,
        "plugin:fs|exists",
        json!({ "path": outside.to_string_lossy() }),
    )
    .unwrap_err();
    assert!(err.to_string().contains("forbidden"), "{err}");
}

#[test]
fn store_set_get_save() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("e2e.json");
    let (_app, w) = app(json!(["store:default"]), json!({}), |b| {
        b.plugin(tauri_plugin_aphrody::store::Builder::default().build())
    });
    let rid = invoke(
        &w,
        "plugin:store|load",
        json!({ "path": file.to_string_lossy(), "options": {} }),
    )
    .unwrap();
    invoke(
        &w,
        "plugin:store|set",
        json!({ "rid": rid, "key": "k", "value": { "v": 1 } }),
    )
    .unwrap();
    assert_eq!(
        invoke(&w, "plugin:store|get", json!({ "rid": rid, "key": "k" })).unwrap(),
        json!([{ "v": 1 }, true])
    );
    invoke(&w, "plugin:store|save", json!({ "rid": rid })).unwrap();
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved, json!({ "k": { "v": 1 } }));
}

#[test]
fn log_window_state_notification_deep_link() {
    let (_app, w) = app(
        json!([
            "log:default",
            "window-state:default",
            "notification:default",
            "deep-link:default"
        ]),
        json!({}),
        |b| {
            b.plugin(
                tauri_plugin_aphrody::log::Builder::new()
                    .skip_logger()
                    .build(),
            )
            .plugin(tauri_plugin_aphrody::window_state::Builder::default().build())
            .plugin(tauri_plugin_aphrody::notification::init())
            .plugin(tauri_plugin_aphrody::deep_link::init())
        },
    );
    invoke(&w, "plugin:log|log", json!({ "level": 3, "message": "e2e", "location": null, "file": null, "line": null, "keyValues": null })).unwrap();
    assert_eq!(
        invoke(&w, "plugin:window-state|filename", json!({})).unwrap(),
        json!(".window-state.json")
    );
    assert!(
        invoke(&w, "plugin:notification|is_permission_granted", json!({}))
            .unwrap()
            .is_boolean()
    );
    assert_eq!(
        invoke(&w, "plugin:deep-link|get_current", json!({})).unwrap(),
        Value::Null
    );
}

#[test]
fn bun_server_over_ipc() {
    let bun = std::env::var("BUN_TAURI_BUN").ok().or_else(|| which("bun"));
    let Some(bun) = bun else {
        eprintln!("bun not on PATH: skipped");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("server.ts"),
        "Bun.serve({ fetch: async (req) => Response.json({ method: req.method, path: new URL(req.url).pathname, body: await req.text(), runtime: `bun ${Bun.version}`, port: process.env.BUN_TAURI_PORT }) });\n",
    )
    .unwrap();
    let config = json!({ "aphrody": { "bun": { "entry": "server.ts", "binary": bun, "cwd": dir.path().to_string_lossy(), "autostart": false } } });
    let (_app, w) = app(
        json!(["aphrody:default", "aphrody:allow-bun-restart"]),
        config,
        |b| b.plugin(tauri_plugin_aphrody::init()),
    );

    assert_eq!(
        invoke(&w, "plugin:aphrody|bun_info", json!({})).unwrap()["running"],
        json!(false)
    );
    let info = invoke(&w, "plugin:aphrody|bun_restart", json!({})).unwrap();
    assert_eq!(info["running"], json!(true));
    let port = info["port"].as_u64().unwrap();

    let res = invoke(&w, "plugin:aphrody|bun_request", json!({ "request": { "method": "POST", "path": "/echo", "headers": [["content-type", "text/plain"]], "body": "hi" } })).unwrap();
    assert_eq!(res["status"], json!(200));
    let body: Value = serde_json::from_str(res["body"].as_str().unwrap()).unwrap();
    assert_eq!(
        (
            body["method"].clone(),
            body["path"].clone(),
            body["body"].clone()
        ),
        (json!("POST"), json!("/echo"), json!("hi"))
    );
    assert_eq!(body["port"], json!(port.to_string()));
    assert!(body["runtime"].as_str().unwrap().starts_with("bun "));

    let again = invoke(&w, "plugin:aphrody|bun_restart", json!({})).unwrap();
    assert_ne!(again["pid"], info["pid"]);
}

#[test]
fn bun_restart_needs_its_permission() {
    let (_app, w) = app(json!(["aphrody:default"]), json!({}), |b| {
        b.plugin(tauri_plugin_aphrody::init())
    });
    assert!(
        invoke(&w, "plugin:aphrody|bun_restart", json!({}))
            .unwrap_err()
            .to_string()
            .contains("not allowed")
    );
}

fn which(name: &str) -> Option<String> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(&exe))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}
