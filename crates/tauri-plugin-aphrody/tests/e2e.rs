// SPDX-License-Identifier: Apache-2.0 OR MIT
//! End-to-end through real IPC: the `aphrody` plugin is registered on a `MockRuntime` app, the ACL
//! is resolved from the permission files the build script generated, and commands are invoked as
//! the webview would (`plugin:aphrody|<command>`), so the ACL check, argument decoding and the
//! command itself all run.
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

const MEMBERS: &[&str] = &["aphrody"];

fn manifests() -> BTreeMap<String, Manifest> {
    let mut acl = BTreeMap::new();
    for name in MEMBERS {
        let list =
            PathBuf::from(env!("OUT_DIR")).join(format!("tauri-plugin-{name}-permission-files"));
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
