use serde::Serialize;

#[derive(Serialize)]
struct SystemStats {
  os: &'static str,
  arch: &'static str,
}

#[tauri::command]
fn system_stats() -> SystemStats {
  SystemStats {
    os: std::env::consts::OS,
    arch: std::env::consts::ARCH,
  }
}

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {name}! (Tauri 3)")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![greet, system_stats])
    .run(tauri::generate_context!())
    .expect("error while running the tauri application");
}
