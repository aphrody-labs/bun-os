#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "cef")]
type Runtime = tauri_runtime_cef::Cef;
#[cfg(not(feature = "cef"))]
type Runtime = tauri_runtime_wry::Wry;

#[cfg_attr(feature = "cef", tauri_runtime_cef::cef_entry_point)]
fn main() {
    if let Err(error) = tauri::Builder::default()
        .runtime(Runtime::default())
        .plugin(tauri_plugin_aphrody::init())
        .run(tauri::generate_context!())
    {
        eprintln!("Aphrody: {error}");
        std::process::exit(1);
    }
}
