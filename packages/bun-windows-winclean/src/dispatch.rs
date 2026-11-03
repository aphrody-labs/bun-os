// SPDX-License-Identifier: Apache-2.0
//! Concrete Rust dispatch for the WinClean compatibility catalog.

use crate::SubsystemError;
use base64::Engine;
use serde_json::Value;

use crate::{coordination, gaming, notification, ocr, record, snapshot, speech, steam, winml};

pub(crate) fn failed(error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(error.to_string())
}

pub(crate) fn string_arg<'a>(
    args: &'a Value,
    name: &str,
    tool: &str,
) -> Result<&'a str, SubsystemError> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires string {name}")))
}

fn save_bmp(png: &[u8], requested: Option<&str>, stem: &str) -> Result<Value, SubsystemError> {
    let path = requested
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("aphrody-{stem}-{}.bmp", std::process::id()))
        });
    let image = image::load_from_memory(png).map_err(failed)?;
    image
        .save_with_format(&path, image::ImageFormat::Bmp)
        .map_err(failed)?;
    Ok(
        serde_json::json!({"success":true,"path":path.to_string_lossy(),"width":image.width(),"height":image.height()}),
    )
}

fn scrape_url(url: &str) -> Result<Value, SubsystemError> {
    if !(url.starts_with("http://") || url.starts_with("https://"))
        || url.chars().any(|c| c.is_control())
    {
        return Err(SubsystemError::InvalidArguments(
            "scrape requires an absolute http:// or https:// URL".into(),
        ));
    }
    // reqwest is built with rustls-no-provider: install ring once or Client::build panics.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(failed)?;
    let response = client.get(url).send().map_err(failed)?;
    let status = response.status();
    let bytes = response.bytes().map_err(failed)?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(SubsystemError::Failed(
            "scrape response exceeds 4 MiB".into(),
        ));
    }
    let body = String::from_utf8_lossy(&bytes);
    let mut text = String::with_capacity(body.len());
    let mut suppressed = false;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '>' {
                    break;
                }
                tag.push(next);
            }
            let normalized = tag.trim().to_ascii_lowercase();
            let closing = normalized.starts_with('/');
            let name = normalized
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or_default();
            if closing && matches!(name, "script" | "style" | "noscript") {
                suppressed = false;
            }
            if !closing && matches!(name, "script" | "style" | "noscript") {
                suppressed = true;
            }
            if matches!(
                name,
                "p" | "br" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "section"
            ) {
                text.push('\n');
            }
        } else if !suppressed {
            text.push(c);
        }
    }
    let mut clean = String::with_capacity(text.len().min(200_000));
    for line in text.lines() {
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !line.is_empty() {
            if !clean.is_empty() {
                clean.push('\n');
            }
            clean.push_str(&line);
            if clean.len() >= 200_000 {
                break;
            }
        }
    }
    clean.truncate(200_000);
    Ok(
        serde_json::json!({"success":status.is_success(),"status":status.as_u16(),"url":url,"text":clean}),
    )
}

fn process_by_name(name: &str) -> Option<u32> {
    system::list_processes(Some(name), "name", 100)
        .processes
        .into_iter()
        .find(|p| {
            p.name
                .trim_end_matches(".exe")
                .eq_ignore_ascii_case(name.trim_end_matches(".exe"))
        })
        .map(|p| p.pid)
}

fn memory_pid(args: &Value, tool: &str) -> Result<u32, SubsystemError> {
    Ok(args
        .get("pid")
        .and_then(Value::as_u64)
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires pid")))?
        as u32)
}
fn memory_address(args: &Value, tool: &str) -> Result<u64, SubsystemError> {
    memory::parse_address(
        args.get("address")
            .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires address")))?,
    )
    .map_err(failed)
}
fn memory_read(args: &Value, tool: &str, len: usize) -> Result<Vec<u8>, SubsystemError> {
    memory::read_bytes(memory_pid(args, tool)?, memory_address(args, tool)?, len).map_err(failed)
}

pub fn call_rust(tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
    let path = |name: &str| string_arg(&arguments, name, tool);
    match tool {
        "scrape" => scrape_url(path("url")?),
        "send_notification" => notification::send_notification(&arguments),
        "computer_speak" => speech::computer_speak(
            path("text")?,
            arguments.get("audioPath").and_then(Value::as_str),
        )
        .map_err(failed),
        "computer_ocr" => ocr::computer_ocr(&arguments).map_err(failed),
        "computer_record_clip" => record::computer_record_clip(&arguments).map_err(failed),
        "coord_report_status" => coordination::report_status(&arguments),
        "coord_read_status" => coordination::read_status(&arguments),
        "coord_assign_task" => coordination::assign_task(&arguments),
        "coord_read_task" => coordination::read_task(),
        "coord_query_stop" => coordination::query_stop(),
        "computer_capture_screen" => {
            let png = aphrody_capture::capture_primary_screen().map_err(failed)?;
            Ok(
                serde_json::json!({"mimeType":"image/png","dataBase64":base64::engine::general_purpose::STANDARD.encode(png)}),
            )
        }
        "snapshot" => snapshot::capture(&arguments),
        "computer_click_element" => snapshot::click_element(&arguments),
        "multi_select" => snapshot::multi_select(&arguments),
        "multi_edit" => snapshot::multi_edit(&arguments),
        "screenshot" => {
            let png = aphrody_capture::capture_primary_screen().map_err(failed)?;
            save_bmp(
                &png,
                arguments.get("outputPath").and_then(Value::as_str),
                "screenshot",
            )
        }
        "computer_observe" => {
            let requested = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let windows = aphrody_capture::list_detailed_windows();
            let window = if requested == 0 {
                windows.iter().find(|w| w.is_foreground)
            } else {
                windows.iter().find(|w| w.handle == requested as usize)
            };
            let window = window.ok_or_else(|| {
                SubsystemError::Failed(format!("window handle {requested} not found"))
            })?;
            let png = aphrody_capture::capture_window(window.handle).map_err(failed)?;
            let ui_tree = if arguments
                .get("includeUiTree")
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                let mut target = arguments.clone();
                target["windowHandle"] = Value::from(window.handle);
                Some(snapshot::capture(&target)?)
            } else {
                None
            };
            if let Some(path) = arguments.get("outputPath").and_then(Value::as_str) {
                std::fs::write(path, &png).map_err(failed)?;
            }
            let w = window;
            let metadata = serde_json::json!({"Handle":w.handle,"ProcessId":w.process_id,"Title":w.title,"X":w.x,"Y":w.y,"Width":w.width,"Height":w.height,"IsForeground":w.is_foreground});
            Ok(
                serde_json::json!({"window":metadata,"uiTree":ui_tree,"pid":w.process_id,"text":format!("PID {} / HWND {} / {} / native unscaled capture", w.process_id, w.handle, w.title),"image":{"mimeType":"image/png","dataBase64":base64::engine::general_purpose::STANDARD.encode(png)}}),
            )
        }
        "window_capture" => {
            let handle = arguments
                .get("hwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_capture requires hwnd".into())
                })?;
            let window = aphrody_capture::list_detailed_windows()
                .into_iter()
                .find(|w| w.handle == handle as usize)
                .ok_or_else(|| {
                    SubsystemError::Failed(format!("window handle {handle} not found"))
                })?;
            let png = aphrody_capture::capture_window(window.handle).map_err(failed)?;
            let mut saved = save_bmp(
                &png,
                arguments.get("outputPath").and_then(Value::as_str),
                "window",
            )?;
            if let Some(object) = saved.as_object_mut() {
                object.insert("hwnd".into(), Value::from(handle));
                object.insert("pid".into(), Value::from(window.process_id));
            }
            Ok(saved)
        }
        "steam_open_uri" => steam::open_steam_uri(path("steamUri")?),
        "steam_get_game" => steam::steam_get_game(&arguments),
        "steam_get_game_status" => steam::steam_get_game_status(&arguments),
        "steam_vault_status" => steam::steam_vault_status(&arguments),
        "steam_list_games" => steam::steam_list_games(&arguments),
        "steam_list_libraries" => steam::steam_list_libraries(&arguments),
        "steam_scan_summary" => steam::steam_scan_summary(&arguments),
        "steam_launch_by_app_id" => {
            steam::open_steam_uri(&steam::rungameid(&arguments, "steam_launch_by_app_id")?)
        }
        "steam_kill_game" => {
            let name = path("executableName")?;
            let pid = process_by_name(name);
            if let Some(pid) = pid {
                aphrody_proc::terminate_process(pid).map_err(failed)?;
                Ok(serde_json::json!({"success":true,"pid":pid,"killed":1}))
            } else {
                Ok(serde_json::json!({"success":false,"error":"not running"}))
            }
        }
        "steam_wait_for_launch" => {
            let name = path("executableName")?;
            let timeout = arguments
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(60_000)
                .min(600_000);
            let poll = arguments
                .get("pollMs")
                .and_then(Value::as_u64)
                .unwrap_or(500)
                .clamp(50, 10_000);
            let started = std::time::Instant::now();
            loop {
                if let Some(pid) = process_by_name(name) {
                    return Ok(
                        serde_json::json!({"success":true,"pid":pid,"elapsedMs":started.elapsed().as_millis()}),
                    );
                }
                if started.elapsed().as_millis() as u64 >= timeout {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(poll));
            }
            Ok(
                serde_json::json!({"success":false,"error":"timeout","elapsedMs":started.elapsed().as_millis()}),
            )
        }
        "steam_launch_and_wait" => {
            let uri = steam::rungameid(&arguments, "steam_launch_and_wait")?;
            let name = path("executableName")?;
            steam::open_steam_uri(&uri)?;
            let timeout = arguments
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(60_000)
                .min(600_000);
            let started = std::time::Instant::now();
            loop {
                if let Some(pid) = process_by_name(name) {
                    return Ok(
                        serde_json::json!({"success":true,"pid":pid,"elapsedMs":started.elapsed().as_millis()}),
                    );
                }
                if started.elapsed().as_millis() as u64 >= timeout {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Ok(
                serde_json::json!({"success":false,"error":"timeout","elapsedMs":started.elapsed().as_millis()}),
            )
        }
        "list_windows" => {
            let windows = aphrody_capture::list_detailed_windows();
            Ok(
                serde_json::json!({"Count":windows.len(),"Windows":windows.into_iter().map(|w| serde_json::json!({"Handle":w.handle,"ProcessId":w.process_id,"Title":w.title,"X":w.x,"Y":w.y,"Width":w.width,"Height":w.height,"IsForeground":w.is_foreground})).collect::<Vec<_>>()}),
            )
        }
        "window_enum_all" => {
            let pid = arguments.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
            let title_filter = arguments
                .get("titleFilter")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let rows = aphrody_capture::list_detailed_windows().into_iter().filter(|w| (pid == 0 || w.process_id == pid) && (title_filter.is_empty() || w.title.to_ascii_lowercase().contains(&title_filter))).map(|w| serde_json::json!({"hwnd":w.handle,"pid":w.process_id,"className":"","title":w.title,"x":w.x,"y":w.y,"width":w.width,"height":w.height,"visible":true,"minimised":false,"maximised":false})).collect::<Vec<_>>();
            Ok(serde_json::json!({"count":rows.len(),"windows":rows}))
        }
        "window_enum_children" => {
            let parent = arguments
                .get("parentHwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments(
                        "window_enum_children requires parentHwnd".into(),
                    )
                })? as usize;
            let rows = aphrody_capture::enum_children(parent)
                .into_iter()
                .map(|(hwnd, title)| serde_json::json!({"hwnd":hwnd,"title":title}))
                .collect::<Vec<_>>();
            Ok(serde_json::json!({"count":rows.len(),"windows":rows}))
        }
        "window_find_by_class" => {
            let class = path("className")?;
            let title = arguments
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let hwnd = aphrody_capture::list_detailed_windows()
                .into_iter()
                .find_map(|w| {
                    aphrody_capture::window_class(w.handle)
                        .ok()
                        .filter(|c| c == class)
                        .and_then(|_| {
                            if title.is_empty() || w.title == title {
                                Some(w.handle)
                            } else {
                                None
                            }
                        })
                })
                .unwrap_or(0);
            Ok(serde_json::json!({"hwnd":hwnd}))
        }
        "window_post_message" => {
            let h = arguments
                .get("hwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_post_message requires hwnd".into())
                })? as usize;
            let msg = arguments
                .get("msg")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_post_message requires msg".into())
                })? as u32;
            aphrody_capture::post_message(
                h,
                msg,
                arguments.get("wParam").and_then(Value::as_u64).unwrap_or(0) as usize,
                arguments.get("lParam").and_then(Value::as_i64).unwrap_or(0) as isize,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "window_send_message" => {
            let h = arguments
                .get("hwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_send_message requires hwnd".into())
                })? as usize;
            let msg = arguments
                .get("msg")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_send_message requires msg".into())
                })? as u32;
            let result = aphrody_capture::send_message(
                h,
                msg,
                arguments.get("wParam").and_then(Value::as_u64).unwrap_or(0) as usize,
                arguments.get("lParam").and_then(Value::as_i64).unwrap_or(0) as isize,
            );
            Ok(serde_json::json!({"success":true,"result":result}))
        }
        "window_minimise_all" => {
            aphrody_capture::minimize_all().map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "window_set_opacity" => {
            let alpha = arguments
                .get("alpha")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_set_opacity requires alpha".into())
                })?;
            if alpha > 255 {
                return Err(SubsystemError::InvalidArguments(
                    "alpha must be 0..255".into(),
                ));
            }
            let h = arguments
                .get("hwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_set_opacity requires hwnd".into())
                })? as usize;
            aphrody_capture::set_opacity(
                h,
                alpha as u8,
                arguments
                    .get("clickThrough")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"alpha":alpha}))
        }
        "click" => {
            let x = arguments
                .get("x")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("click requires x".into()))?
                as i32;
            let y = arguments
                .get("y")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("click requires y".into()))?
                as i32;
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            let clicks = arguments.get("clicks").and_then(Value::as_u64).unwrap_or(1) as u32;
            if clicks > 0 {
                aphrody_capture::mouse_click(
                    arguments
                        .get("button")
                        .and_then(Value::as_str)
                        .unwrap_or("left"),
                    clicks,
                )
                .map_err(failed)?;
            }
            Ok(serde_json::json!({"success":true,"x":x,"y":y}))
        }
        "computer_click" => {
            let h = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let w = if h == 0 {
                None
            } else {
                aphrody_capture::list_detailed_windows()
                    .into_iter()
                    .find(|w| w.handle == h)
            };
            if arguments
                .get("activate")
                .and_then(Value::as_bool)
                .unwrap_or(true)
                && let Some(ref w) = w
            {
                aphrody_capture::switch_to_window(w.handle).map_err(failed)?;
            }
            let x = arguments.get("x").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_click requires x".into())
            })? as i32
                + w.as_ref().map(|v| v.x).unwrap_or(0);
            let y = arguments.get("y").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_click requires y".into())
            })? as i32
                + w.as_ref().map(|v| v.y).unwrap_or(0);
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            aphrody_capture::mouse_click(
                arguments
                    .get("button")
                    .and_then(Value::as_str)
                    .unwrap_or("left"),
                arguments.get("clicks").and_then(Value::as_u64).unwrap_or(1) as u32,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"x":x,"y":y}))
        }
        "scroll" => {
            let x = arguments
                .get("x")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("scroll requires x".into()))?
                as i32;
            let y = arguments
                .get("y")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("scroll requires y".into()))?
                as i32;
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            aphrody_capture::mouse_scroll(
                arguments
                    .get("axis")
                    .and_then(Value::as_str)
                    .unwrap_or("vertical"),
                arguments
                    .get("direction")
                    .and_then(Value::as_str)
                    .unwrap_or("down"),
                arguments
                    .get("wheelTimes")
                    .and_then(Value::as_u64)
                    .unwrap_or(1) as u32,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "computer_scroll" => {
            let h = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let w = if h == 0 {
                None
            } else {
                aphrody_capture::list_detailed_windows()
                    .into_iter()
                    .find(|w| w.handle == h)
            };
            let x = arguments.get("x").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_scroll requires x".into())
            })? as i32
                + w.as_ref().map(|v| v.x).unwrap_or(0);
            let y = arguments.get("y").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_scroll requires y".into())
            })? as i32
                + w.as_ref().map(|v| v.y).unwrap_or(0);
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            aphrody_capture::mouse_scroll(
                arguments
                    .get("axis")
                    .and_then(Value::as_str)
                    .unwrap_or("vertical"),
                arguments
                    .get("direction")
                    .and_then(Value::as_str)
                    .unwrap_or("down"),
                arguments
                    .get("wheelTimes")
                    .and_then(Value::as_u64)
                    .unwrap_or(1) as u32,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "mouse_move_smooth" | "move" => {
            let x =
                arguments.get("x").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse move requires x".into())
                })? as i32;
            let y =
                arguments.get("y").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse move requires y".into())
                })? as i32;
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            Ok(serde_json::json!({"success":true,"x":x,"y":y}))
        }
        "type" => {
            let text = path("text")?;
            let x = arguments
                .get("x")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("type requires x".into()))?
                as i32;
            let y = arguments
                .get("y")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("type requires y".into()))?
                as i32;
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            aphrody_capture::mouse_click("left", 1).map_err(failed)?;
            if arguments
                .get("clear")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Err(SubsystemError::InvalidArguments(
                    "clear is not supported by the Rust input backend yet".into(),
                ));
            }
            aphrody_capture::type_unicode(text).map_err(failed)?;
            if arguments
                .get("pressEnter")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                aphrody_capture::type_unicode("\n").map_err(failed)?;
            }
            Ok(serde_json::json!({"success":true,"characters":text.chars().count()}))
        }
        "keyboard_scan_code" => {
            let scan = arguments
                .get("scanCode")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("keyboard_scan_code requires scanCode".into())
                })?;
            if scan > 0xffff {
                return Err(SubsystemError::InvalidArguments(
                    "scanCode out of range".into(),
                ));
            }
            aphrody_capture::key_scan(
                scan as u16,
                arguments
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("tap"),
                arguments
                    .get("extended")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "keyboard_hold" => {
            let vk = arguments.get("vk").and_then(Value::as_u64).ok_or_else(|| {
                SubsystemError::InvalidArguments("keyboard_hold requires vk".into())
            })?;
            if vk > 255 {
                return Err(SubsystemError::InvalidArguments("vk out of range".into()));
            }
            aphrody_capture::key_vk(vk as u8, true).map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "keyboard_release" => {
            let vk = arguments.get("vk").and_then(Value::as_u64).ok_or_else(|| {
                SubsystemError::InvalidArguments("keyboard_release requires vk".into())
            })?;
            if vk > 255 {
                return Err(SubsystemError::InvalidArguments("vk out of range".into()));
            }
            aphrody_capture::key_vk(vk as u8, false).map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "mouse_drag_to" => {
            aphrody_capture::mouse_drag(
                arguments.get("x1").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse_drag_to requires x1".into())
                })? as i32,
                arguments.get("y1").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse_drag_to requires y1".into())
                })? as i32,
                arguments.get("x2").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse_drag_to requires x2".into())
                })? as i32,
                arguments.get("y2").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("mouse_drag_to requires y2".into())
                })? as i32,
                arguments
                    .get("button")
                    .and_then(Value::as_str)
                    .unwrap_or("left"),
                arguments.get("steps").and_then(Value::as_u64).unwrap_or(20) as u32,
                arguments
                    .get("durationMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(250),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "computer_drag" => {
            let h = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let w = if h == 0 {
                None
            } else {
                aphrody_capture::list_detailed_windows()
                    .into_iter()
                    .find(|w| w.handle == h)
            };
            if arguments
                .get("activate")
                .and_then(Value::as_bool)
                .unwrap_or(true)
                && let Some(ref v) = w
            {
                aphrody_capture::switch_to_window(v.handle).map_err(failed)?;
            }
            let ox = w.as_ref().map(|v| v.x).unwrap_or(0);
            let oy = w.as_ref().map(|v| v.y).unwrap_or(0);
            aphrody_capture::mouse_drag(
                arguments
                    .get("fromX")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("computer_drag requires fromX".into())
                    })? as i32
                    + ox,
                arguments
                    .get("fromY")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("computer_drag requires fromY".into())
                    })? as i32
                    + oy,
                arguments
                    .get("toX")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("computer_drag requires toX".into())
                    })? as i32
                    + ox,
                arguments
                    .get("toY")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("computer_drag requires toY".into())
                    })? as i32
                    + oy,
                arguments
                    .get("button")
                    .and_then(Value::as_str)
                    .unwrap_or("left"),
                arguments.get("steps").and_then(Value::as_u64).unwrap_or(20) as u32,
                arguments
                    .get("durationMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(250),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "computer_key" => {
            let h = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            if arguments
                .get("activate")
                .and_then(Value::as_bool)
                .unwrap_or(true)
                && h != 0
            {
                aphrody_capture::switch_to_window(h).map_err(failed)?;
            }
            aphrody_capture::key_shortcut(path("shortcut")?).map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "shortcut" => {
            let shortcut = path("shortcut")?;
            aphrody_capture::key_shortcut_unrestricted(shortcut).map_err(failed)?;
            Ok(serde_json::json!({"success":true,"shortcut":shortcut}))
        }
        "computer_type" => {
            let text = path("text")?;
            let h = arguments
                .get("windowHandle")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let w = if h == 0 {
                None
            } else {
                aphrody_capture::list_detailed_windows()
                    .into_iter()
                    .find(|w| w.handle == h)
            };
            if arguments
                .get("activate")
                .and_then(Value::as_bool)
                .unwrap_or(true)
                && h != 0
            {
                aphrody_capture::switch_to_window(h).map_err(failed)?;
            }
            let x = arguments.get("x").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_type requires x".into())
            })? as i32
                + w.as_ref().map(|v| v.x).unwrap_or(0);
            let y = arguments.get("y").and_then(Value::as_i64).ok_or_else(|| {
                SubsystemError::InvalidArguments("computer_type requires y".into())
            })? as i32
                + w.as_ref().map(|v| v.y).unwrap_or(0);
            aphrody_capture::mouse_move(x, y).map_err(failed)?;
            aphrody_capture::mouse_click("left", 1).map_err(failed)?;
            if arguments
                .get("clear")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                aphrody_capture::key_shortcut("ctrl+a").map_err(failed)?;
                aphrody_capture::key_shortcut("delete").map_err(failed)?;
            }
            aphrody_capture::type_unicode(text).map_err(failed)?;
            if arguments
                .get("pressEnter")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                aphrody_capture::key_shortcut("enter").map_err(failed)?;
            }
            Ok(serde_json::json!({"success":true,"characters":text.chars().count()}))
        }
        "window_get_text" => Ok(Value::String(
            aphrody_capture::window_text(arguments.get("hwnd").and_then(Value::as_u64).ok_or_else(
                || SubsystemError::InvalidArguments("window_get_text requires hwnd".into()),
            )? as usize)
            .map_err(failed)?,
        )),
        "window_close" => {
            aphrody_capture::close_window(
                arguments
                    .get("hwnd")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("window_close requires hwnd".into())
                    })? as usize,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "window_move" => {
            let h = arguments
                .get("hwnd")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_move requires hwnd".into())
                })? as usize;
            let x =
                arguments.get("x").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_move requires x".into())
                })? as i32;
            let y =
                arguments.get("y").and_then(Value::as_i64).ok_or_else(|| {
                    SubsystemError::InvalidArguments("window_move requires y".into())
                })? as i32;
            let current = aphrody_capture::list_detailed_windows()
                .into_iter()
                .find(|w| w.handle == h)
                .ok_or_else(|| SubsystemError::Failed("window handle not found".into()))?;
            let w = arguments
                .get("width")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .unwrap_or(current.width as i64) as i32;
            let hh = arguments
                .get("height")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .unwrap_or(current.height as i64) as i32;
            aphrody_capture::move_window(h, x, y, w, hh).map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "resize_window" => {
            let needle = path("titleSubstring")?.to_ascii_lowercase();
            let w = aphrody_capture::list_detailed_windows()
                .into_iter()
                .find(|w| w.title.to_ascii_lowercase().contains(&needle))
                .ok_or_else(|| SubsystemError::Failed("window not found".into()))?;
            let width = arguments
                .get("width")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .unwrap_or(w.width as i64) as i32;
            let height = arguments
                .get("height")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .unwrap_or(w.height as i64) as i32;
            aphrody_capture::move_window(
                w.handle,
                arguments
                    .get("x")
                    .and_then(Value::as_i64)
                    .unwrap_or(w.x as i64) as i32,
                arguments
                    .get("y")
                    .and_then(Value::as_i64)
                    .unwrap_or(w.y as i64) as i32,
                width,
                height,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"hwnd":w.handle}))
        }
        "window_set_text" => {
            aphrody_capture::set_window_text(
                arguments
                    .get("hwnd")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("window_set_text requires hwnd".into())
                    })? as usize,
                path("text")?,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "window_set_topmost" => {
            aphrody_capture::set_topmost(
                arguments
                    .get("hwnd")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("window_set_topmost requires hwnd".into())
                    })? as usize,
                arguments
                    .get("topmost")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "switch_to_window" => {
            let needle = path("titleSubstring")?.to_ascii_lowercase();
            let w = aphrody_capture::list_detailed_windows()
                .into_iter()
                .find(|w| w.title.to_ascii_lowercase().contains(&needle))
                .ok_or_else(|| SubsystemError::Failed("window not found".into()))?;
            aphrody_capture::switch_to_window(w.handle).map_err(failed)?;
            Ok(serde_json::json!({"success":true,"hwnd":w.handle}))
        }
        "get_cpu_info" => serde_json::to_value(system::get_cpu_info()).map_err(failed),
        "get_cpu_usage" => serde_json::to_value(system::get_cpu_usage(
            arguments
                .get("intervalMs")
                .and_then(Value::as_u64)
                .unwrap_or(250),
        ))
        .map_err(failed),
        "get_memory_info" | "perf_memory_status" => {
            serde_json::to_value(system::get_memory_info()).map_err(failed)
        }
        "gamepad_environment" => system::gamepad_environment().map_err(failed),
        "gaming_capture_window" => gaming::capture_window(&arguments),
        "gaming_capture_benchmark" => gaming::capture_benchmark(&arguments),
        "gaming_frame_pacing" => gaming::frame_pacing(&arguments),
        "gaming_mouse_delta" => gaming::mouse_delta(&arguments),
        "gaming_mouse_button" => gaming::mouse_button(&arguments),
        "gaming_key" => gaming::key(&arguments),
        "gaming_input_sequence" => gaming::input_sequence(&arguments),
        "gaming_environment" => gaming::environment(),
        "gaming_steam_launch" => gaming::steam_launch(&arguments),
        "gaming_get_game_mode" => gaming::game_mode(),
        "gaming_get_background_apps" => gaming::background_apps(),
        "gaming_get_game_bar_capture" => gaming::game_bar_capture(),
        "gaming_get_timer_resolution" => gaming::timer_resolution(),
        "gaming_get_gpu_info" => gaming::gpu_info(),
        "gaming_profile_status" => gaming::profile_status(),
        "gaming_profile_apply" => gaming::profile_apply(&arguments),
        "gamepad_create_xbox360" => gamepad::create(
            arguments
                .get("slotIndex")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        )
        .map_err(failed),
        "gamepad_destroy" => gamepad::destroy(
            arguments
                .get("slot")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("gamepad_destroy requires slot".into())
                })?,
        )
        .map_err(failed),
        "gamepad_destroy_all" => gamepad::destroy_all().map_err(failed),
        "gamepad_press_button" => gamepad::press_button(
            arguments
                .get("slot")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("gamepad_press_button requires slot".into())
                })?,
            arguments
                .get("buttonMask")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments(
                        "gamepad_press_button requires buttonMask".into(),
                    )
                })?,
            arguments
                .get("holdMs")
                .and_then(Value::as_i64)
                .unwrap_or(100),
        )
        .map_err(failed),
        "gamepad_send_xbox360_state" => gamepad::send_state(
            arguments
                .get("slot")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments(
                        "gamepad_send_xbox360_state requires slot".into(),
                    )
                })?,
            arguments
                .get("buttons")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments(
                        "gamepad_send_xbox360_state requires buttons".into(),
                    )
                })?,
            arguments.get("lx").and_then(Value::as_i64).unwrap_or(0),
            arguments.get("ly").and_then(Value::as_i64).unwrap_or(0),
            arguments.get("rx").and_then(Value::as_i64).unwrap_or(0),
            arguments.get("ry").and_then(Value::as_i64).unwrap_or(0),
            arguments.get("lt").and_then(Value::as_i64).unwrap_or(0),
            arguments.get("rt").and_then(Value::as_i64).unwrap_or(0),
        )
        .map_err(failed),
        "perf_dwm_flush" => system::perf_dwm_flush().map_err(failed),
        "perf_empty_working_sets" => system::empty_working_sets().map_err(failed),
        "perf_purge_standby_list" => system::purge_standby_list(
            arguments
                .get("lowPriorityOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .map_err(failed),
        "perf_set_eco_mode" => system::perf_set_eco_mode(
            memory_pid(&arguments, tool)?,
            arguments
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("on"),
        )
        .map_err(failed),
        "get_disk_info" => serde_json::to_value(system::get_disk_info()).map_err(failed),
        "get_os_info" => serde_json::to_value(system::get_os_info()).map_err(failed),
        "get_system_profile" => Ok(system::get_system_profile()),
        "get_network_adapters" => {
            serde_json::to_value(system::get_network_adapters()).map_err(failed)
        }
        "list_tcp_connections" => serde_json::to_value(
            system::list_tcp_connections(arguments.get("stateFilter").and_then(Value::as_str))
                .map_err(failed)?,
        )
        .map_err(failed),
        "list_listening_ports" => {
            serde_json::to_value(system::list_listening_ports().map_err(failed)?).map_err(failed)
        }
        "list_processes" => serde_json::to_value(system::list_processes(
            arguments.get("name").and_then(Value::as_str),
            arguments
                .get("sortBy")
                .and_then(Value::as_str)
                .unwrap_or("memory"),
            arguments.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize,
        ))
        .map_err(failed),
        "mem_list_processes" => {
            let filter = arguments
                .get("nameFilter")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty());
            let rows = system::list_processes(filter, "name", 512)
                .processes
                .into_iter()
                .map(|p| serde_json::json!({"pid":p.pid,"name":p.name,"sessionId":p.session_id}))
                .collect::<Vec<_>>();
            Ok(serde_json::json!({"count":rows.len(),"processes":rows}))
        }
        "trim_process_working_set" => {
            system::trim_process_working_set(memory_pid(&arguments, tool)?).map_err(failed)
        }
        "set_process_affinity" => system::set_process_affinity(
            memory_pid(&arguments, tool)?,
            arguments
                .get("mask")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("set_process_affinity requires mask".into())
                })? as usize,
        )
        .map_err(failed),
        "set_process_priority" => {
            system::set_process_priority(memory_pid(&arguments, tool)?, path("priority")?)
                .map_err(failed)
        }
        "mem_read_bytes" => {
            let len = arguments
                .get("length")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_read_bytes requires length".into())
                })? as usize;
            let bytes = memory_read(&arguments, tool, len)?;
            Ok(
                serde_json::json!({"hex":bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),"bytesRead":bytes.len()}),
            )
        }
        "mem_write_bytes" => {
            let bytes = memory::parse_hex(path("hex")?).map_err(failed)?;
            let written = memory::write_bytes(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                &bytes,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"bytesWritten":written}))
        }
        "mem_read_int32" => {
            let b = memory_read(&arguments, tool, 4)?;
            if b.len() != 4 {
                return Err(SubsystemError::Failed("short memory read".into()));
            };
            Ok(serde_json::json!({"value":i32::from_le_bytes(b.try_into().unwrap())}))
        }
        "mem_read_int64" => {
            let b = memory_read(&arguments, tool, 8)?;
            if b.len() != 8 {
                return Err(SubsystemError::Failed("short memory read".into()));
            };
            Ok(serde_json::json!({"value":i64::from_le_bytes(b.try_into().unwrap())}))
        }
        "mem_read_float" => {
            let b = memory_read(&arguments, tool, 4)?;
            if b.len() != 4 {
                return Err(SubsystemError::Failed("short memory read".into()));
            };
            Ok(serde_json::json!({"value":f32::from_le_bytes(b.try_into().unwrap())}))
        }
        "mem_read_double" => {
            let b = memory_read(&arguments, tool, 8)?;
            if b.len() != 8 {
                return Err(SubsystemError::Failed("short memory read".into()));
            };
            Ok(serde_json::json!({"value":f64::from_le_bytes(b.try_into().unwrap())}))
        }
        "mem_read_c_string" => {
            let max = arguments
                .get("maxLength")
                .and_then(Value::as_u64)
                .unwrap_or(4096)
                .min(65_536) as usize;
            let b = memory_read(&arguments, tool, max)?;
            let end = b.iter().position(|v| *v == 0).unwrap_or(b.len());
            Ok(serde_json::json!({"value":String::from_utf8_lossy(&b[..end]),"length":end}))
        }
        "mem_read_utf16" => {
            let max = arguments
                .get("maxChars")
                .and_then(Value::as_u64)
                .unwrap_or(2048)
                .min(32_768) as usize;
            let b = memory_read(&arguments, tool, max.saturating_mul(2))?;
            let units = b
                .as_chunks::<2>()
                .0
                .iter()
                .map(|x| u16::from_le_bytes([x[0], x[1]]))
                .take_while(|v| *v != 0)
                .collect::<Vec<_>>();
            Ok(serde_json::json!({"value":String::from_utf16_lossy(&units),"length":units.len()}))
        }
        "mem_write_int32" => {
            let v = arguments
                .get("value")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_write_int32 requires value".into())
                })? as i32;
            let n = memory::write_bytes(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                &v.to_le_bytes(),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"bytesWritten":n}))
        }
        "mem_write_int64" => {
            let v = arguments
                .get("value")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_write_int64 requires value".into())
                })?;
            let n = memory::write_bytes(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                &v.to_le_bytes(),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"bytesWritten":n}))
        }
        "mem_write_float" => {
            let v = arguments
                .get("value")
                .and_then(Value::as_f64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_write_float requires value".into())
                })? as f32;
            let n = memory::write_bytes(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                &v.to_le_bytes(),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"bytesWritten":n}))
        }
        "mem_write_double" => {
            let v = arguments
                .get("value")
                .and_then(Value::as_f64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_write_double requires value".into())
                })?;
            let n = memory::write_bytes(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                &v.to_le_bytes(),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"bytesWritten":n}))
        }
        "mem_allocate" => {
            let address = memory::allocate(
                memory_pid(&arguments, tool)?,
                arguments
                    .get("size")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("mem_allocate requires size".into())
                    })? as usize,
                arguments
                    .get("protect")
                    .and_then(Value::as_str)
                    .unwrap_or("rw"),
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"address":address}))
        }
        "mem_free" => {
            memory::free(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true}))
        }
        "mem_protect" => {
            let old = memory::protect(
                memory_pid(&arguments, tool)?,
                memory_address(&arguments, tool)?,
                arguments
                    .get("size")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("mem_protect requires size".into())
                    })? as usize,
                path("protect")?,
            )
            .map_err(failed)?;
            Ok(serde_json::json!({"success":true,"previousProtect":old}))
        }
        "mem_query_region" => memory::query(
            memory_pid(&arguments, tool)?,
            memory_address(&arguments, tool)?,
        )
        .map_err(failed),
        "mem_suspend_process" => {
            memory::suspend_resume(memory_pid(&arguments, tool)?, false).map_err(failed)
        }
        "mem_resume_process" => {
            memory::suspend_resume(memory_pid(&arguments, tool)?, true).map_err(failed)
        }
        "mem_dump_region" => {
            let pid = memory_pid(&arguments, tool)?;
            let address = memory_address(&arguments, tool)?;
            let size = arguments
                .get("size")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_dump_region requires size".into())
                })?
                .min(4 * 1024 * 1024) as usize;
            if size == 0 {
                return Err(SubsystemError::InvalidArguments(
                    "size must be positive".into(),
                ));
            }
            let suspended = arguments
                .get("suspend")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if suspended {
                memory::suspend_resume(pid, false).map_err(failed)?;
            }
            let mut data = Vec::with_capacity(size);
            let mut offset = 0usize;
            while offset < size {
                let n = (size - offset).min(65_536);
                let chunk = memory::read_bytes(pid, address + offset as u64, n).map_err(failed)?;
                if chunk.is_empty() {
                    break;
                }
                data.extend_from_slice(&chunk);
                offset += chunk.len();
                if chunk.len() < n {
                    break;
                }
            }
            if suspended {
                let _ = memory::suspend_resume(pid, true);
            }
            let path = arguments
                .get("outputPath")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::env::temp_dir().join(format!("winclean_mcp_dump_{pid}_{address:x}.bin"))
                });
            std::fs::write(&path, &data).map_err(failed)?;
            use sha2::{Digest, Sha256};
            let hash = Sha256::digest(&data);
            Ok(
                serde_json::json!({"path":path.to_string_lossy(),"bytes":data.len(),"sha256":hash.iter().map(|b| format!("{b:02x}")).collect::<String>()}),
            )
        }
        "mem_enable_debug_privilege" => memory::enable_debug_privilege().map_err(failed),
        "mem_list_modules" => {
            let pid = memory_pid(&arguments, tool)?;
            let modules = memory::list_modules(pid).map_err(failed)?;
            Ok(serde_json::json!({"pid":pid,"count":modules.len(),"modules":modules}))
        }
        "mem_get_module_base" => {
            let pid = memory_pid(&arguments, tool)?;
            let name = arguments
                .get("moduleName")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments(
                        "mem_get_module_base requires moduleName".into(),
                    )
                })?;
            memory::get_module_base(pid, name).map_err(failed)
        }
        "mem_scan_value_int32" => {
            let pid = memory_pid(&arguments, tool)?;
            let value = arguments
                .get("value")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_scan_value_int32 requires value".into())
                })?;
            if !(i32::MIN as i64..=i32::MAX as i64).contains(&value) {
                return Err(SubsystemError::InvalidArguments(
                    "value must fit int32".into(),
                ));
            }
            let max_hits = arguments
                .get("maxHits")
                .and_then(Value::as_u64)
                .unwrap_or(200)
                .min(5_000) as usize;
            let hits = memory::scan_value_int32(pid, value as i32, max_hits).map_err(failed)?;
            Ok(serde_json::json!({"pid":pid,"value":value,"count":hits.len(),"addresses":hits}))
        }
        "mem_scan_aob" => {
            let pid = memory_pid(&arguments, tool)?;
            let module_name = arguments
                .get("moduleName")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_scan_aob requires moduleName".into())
                })?;
            let pattern = arguments
                .get("pattern")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("mem_scan_aob requires pattern".into())
                })?;
            let max_hits = arguments
                .get("maxHits")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .min(100) as usize;
            let hits =
                memory::scan_module_aob(pid, module_name, pattern, max_hits).map_err(failed)?;
            Ok(
                serde_json::json!({"pid":pid,"moduleName":module_name,"count":hits.len(),"addresses":hits}),
            )
        }
        "kill_process" => {
            let pid = arguments
                .get("pid")
                .and_then(Value::as_u64)
                .map(|v| v as u32);
            if let Some(pid) = pid.filter(|p| aphrody_proc::process_alive(*p)) {
                aphrody_proc::terminate_process(pid).map_err(failed)?;
                Ok(Value::String(format!("Terminated process {pid}.")))
            } else {
                Ok(Value::String(system::kill_process(
                    pid,
                    arguments.get("name").and_then(Value::as_str),
                    arguments
                        .get("force")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                )))
            }
        }
        "launch_app" => Ok(Value::String(
            system::launch_app(
                path("target")?,
                arguments.get("args").and_then(Value::as_str),
                arguments.get("workingDirectory").and_then(Value::as_str),
            )
            .map_err(failed)?,
        )),
        "wait" => Ok(Value::String(system::wait_seconds(
            arguments
                .get("seconds")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("wait requires integer seconds".into())
                })?,
        ))),
        name if crate::dotnet_windows::method(name).is_some() => {
            crate::dotnet_windows::dispatch(name, &arguments)
        }
        "power_shell" => system::power_shell(
            path("command")?,
            arguments
                .get("timeoutSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(30),
        )
        .map_err(failed),
        "list_power_plans" => {
            serde_json::to_value(system::list_power_plans().map_err(failed)?).map_err(failed)
        }
        "get_active_power_plan" => {
            serde_json::to_value(system::get_active_power_plan().map_err(failed)?).map_err(failed)
        }
        "set_active_power_plan" => Ok(Value::String(
            system::set_active_power_plan(path("guid")?).map_err(failed)?,
        )),
        "list_services" => serde_json::to_value(
            system::list_services(
                arguments.get("nameFilter").and_then(Value::as_str),
                arguments.get("statusFilter").and_then(Value::as_str),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "start_service" | "stop_service" | "restart_service" => {
            let action = match tool {
                "start_service" => "start",
                "stop_service" => "stop",
                _ => "restart",
            };
            Ok(Value::String(
                system::control_service(action, path("name")?).map_err(failed)?,
            ))
        }
        "list_scheduled_tasks" => serde_json::to_value(
            system::list_scheduled_tasks(
                arguments
                    .get("folder")
                    .and_then(Value::as_str)
                    .unwrap_or("\\"),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "run_scheduled_task" | "enable_scheduled_task" | "disable_scheduled_task" => {
            let action = match tool {
                "run_scheduled_task" => "run",
                "enable_scheduled_task" => "enable",
                _ => "disable",
            };
            Ok(Value::String(
                system::control_scheduled_task(action, path("path")?).map_err(failed)?,
            ))
        }
        "query_event_log" => system::query_event_log(
            path("channel")?,
            arguments
                .get("maxEvents")
                .and_then(Value::as_u64)
                .unwrap_or(50) as u32,
            arguments.get("xpathFilter").and_then(Value::as_str),
        )
        .map_err(failed),
        "get_defender_status" => system::get_defender_status().map_err(failed),
        "get_clipboard_text" => Ok(Value::String(system::get_clipboard_text().map_err(failed)?)),
        "set_clipboard_text" => Ok(Value::String(
            system::set_clipboard_text(path("text")?).map_err(failed)?,
        )),
        "wsl_get_status" => Ok(system::wsl_get_status()),
        "wsl_list_distributions" => Ok(system::wsl_list_distributions()),
        "wsl_list_processes" => system::wsl_list_processes(path("distribution")?).map_err(failed),
        "wsl_read_only_probe" => {
            system::wsl_read_only_probe(path("distribution")?, path("probe")?).map_err(failed)
        }
        "wsl_execute" => {
            let command = arguments
                .get("command")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("wsl_execute requires command array".into())
                })?
                .iter()
                .map(|v| {
                    v.as_str().map(str::to_owned).ok_or_else(|| {
                        SubsystemError::InvalidArguments(
                            "wsl_execute command entries must be strings".into(),
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            system::wsl_execute(path("distribution")?, &command).map_err(failed)
        }
        "wsl_send_signal" => system::wsl_send_signal(
            path("distribution")?,
            arguments
                .get("processId")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    SubsystemError::InvalidArguments("wsl_send_signal requires processId".into())
                })? as u32,
            path("signal")?,
        )
        .map_err(failed),
        "list_registry_key" => registry::list_key(path("path")?).map_err(failed),
        "get_registry_value" => registry::get_value(path("path")?, path("name")?).map_err(failed),
        "get_hags_mode" => registry::get_hags_mode().map_err(failed),
        "get_gpu_preferences" => registry::get_gpu_preferences().map_err(failed),
        "set_hags_mode" => {
            registry::set_hags_mode(arguments.get("mode").and_then(Value::as_u64).ok_or_else(
                || SubsystemError::InvalidArguments("set_hags_mode requires mode".into()),
            )? as u32)
            .map_err(failed)
        }
        "set_gpu_preference" => {
            registry::set_gpu_preference(path("exePath")?, path("preference")?).map_err(failed)
        }
        "set_registry_value" => Ok(Value::String(
            registry::set_value(
                path("path")?,
                arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("(default)"),
                path("value")?,
                arguments
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("String"),
            )
            .map_err(failed)?,
        )),
        "delete_registry_entry" => Ok(Value::String(
            registry::delete_entry(path("path")?, arguments.get("name").and_then(Value::as_str))
                .map_err(failed)?,
        )),
        "get_file_info" => {
            serde_json::to_value(filesystem::get_file_info(path("path")?).map_err(failed)?)
                .map_err(failed)
        }
        "list_directory" => {
            let exclude = match arguments.get("exclude") {
                None => Vec::new(),
                Some(Value::Array(patterns)) => patterns
                    .iter()
                    .map(|pattern| {
                        pattern
                            .as_str()
                            .filter(|pattern| !pattern.is_empty())
                            .map(str::to_owned)
                            .ok_or_else(|| {
                                SubsystemError::InvalidArguments(
                                    "list_directory exclude entries must be non-empty strings"
                                        .into(),
                                )
                            })
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                Some(_) => {
                    return Err(SubsystemError::InvalidArguments(
                        "list_directory exclude must be an array of strings".into(),
                    ));
                }
            };
            serde_json::to_value(
                filesystem::list_directory_excluding(
                    path("path")?,
                    arguments.get("pattern").and_then(Value::as_str),
                    arguments
                        .get("recursive")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    arguments
                        .get("showHidden")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    &exclude,
                )
                .map_err(failed)?,
            )
            .map_err(failed)
        }
        "search_files" => {
            let p = path("path")?;
            let pattern = path("pattern")?;
            let exclude = match arguments.get("exclude") {
                None => Vec::new(),
                Some(Value::Array(patterns)) => patterns
                    .iter()
                    .map(|pattern| {
                        pattern
                            .as_str()
                            .filter(|pattern| !pattern.is_empty())
                            .map(str::to_owned)
                            .ok_or_else(|| {
                                SubsystemError::InvalidArguments(
                                    "search_files exclude entries must be non-empty strings".into(),
                                )
                            })
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                Some(_) => {
                    return Err(SubsystemError::InvalidArguments(
                        "search_files exclude must be an array of strings".into(),
                    ));
                }
            };
            if exclude.is_empty()
                && !pattern.contains('*')
                && !pattern.contains('?')
                && let Some(v) = filesystem::search_files_indexed(p, pattern).map_err(failed)?
            {
                return serde_json::to_value(v).map_err(failed);
            }
            serde_json::to_value(
                filesystem::search_files_excluding(
                    p,
                    pattern,
                    arguments
                        .get("recursive")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    &exclude,
                )
                .map_err(failed)?,
            )
            .map_err(failed)
        }
        "search_windows" => {
            #[cfg(windows)]
            {
                crate::windows_search::call(path("query")?).map_err(failed)
            }
            #[cfg(not(windows))]
            {
                Err(SubsystemError::Failed(
                    "search_windows is Windows-only; use search_files on this target".into(),
                ))
            }
        }
        "winml_get_version" => winml::get_version().map_err(failed),
        "winml_inspect_onnx" => winml::inspect_onnx(path("modelPath")?).map_err(failed),
        "winml_list_providers" => winml::list_providers().map_err(failed),
        "winml_run_float32" => winml::run_float32(
            path("modelPath")?,
            path("inputsJson")?,
            arguments
                .get("executionProvider")
                .and_then(Value::as_str)
                .unwrap_or("cpu"),
        )
        .map_err(failed),
        "read_file" => Ok(Value::String(
            filesystem::read_file(
                path("path")?,
                arguments.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize,
                arguments.get("limit").and_then(Value::as_u64).unwrap_or(0) as usize,
            )
            .map_err(failed)?,
        )),
        "write_file" => Ok(Value::String(
            filesystem::write_file(
                path("path")?,
                path("content")?,
                arguments
                    .get("append")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?,
        )),
        "copy_path" => Ok(Value::String(
            filesystem::copy_path(
                path("path")?,
                path("destination")?,
                arguments
                    .get("overwrite")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?,
        )),
        "move_path" => Ok(Value::String(
            filesystem::move_path(
                path("path")?,
                path("destination")?,
                arguments
                    .get("overwrite")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?,
        )),
        "delete_path" => Ok(Value::String(
            filesystem::delete_path(
                path("path")?,
                arguments
                    .get("recursive")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .map_err(failed)?,
        )),
        "binary_entropy_map" => serde_json::to_value(
            aphrody_re::entropy_map_file(
                std::path::Path::new(path("path")?),
                arguments
                    .get("blockSize")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "binary_hash_multi" => serde_json::to_value(
            aphrody_re::hash_file(std::path::Path::new(path("path")?)).map_err(failed)?,
        )
        .map_err(failed),
        "binary_extract_strings" => serde_json::to_value(
            aphrody_re::extract_strings_file(
                std::path::Path::new(path("path")?),
                arguments
                    .get("minLength")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize),
                arguments
                    .get("maxResults")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "binary_xor_decrypt" => serde_json::to_value(
            aphrody_re::xor_file(
                std::path::Path::new(path("inputPath")?),
                std::path::Path::new(path("outputPath")?),
                path("keyHex")?,
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "binary_aes_ctr_decrypt" => serde_json::to_value(
            aphrody_re::aes_ctr_file(
                std::path::Path::new(path("inputPath")?),
                std::path::Path::new(path("outputPath")?),
                path("keyHex")?,
                path("ivHex")?,
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "binary_section_dump" => serde_json::to_value(
            aphrody_re::section_dump_file(
                std::path::Path::new(path("path")?),
                path("sectionName")?,
                arguments
                    .get("outputPath")
                    .and_then(Value::as_str)
                    .map(std::path::Path::new),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "binary_parse_pe_header" => serde_json::to_value(
            aphrody_re::parse_pe_header_file(std::path::Path::new(path("path")?))
                .map_err(failed)?,
        )
        .map_err(failed),
        "analyze_pe" => serde_json::to_value(
            aphrody_re::analyze_pe_file(std::path::Path::new(path("path")?)).map_err(failed)?,
        )
        .map_err(failed),
        "binary_list_cpk" => serde_json::to_value(
            aphrody_re::list_cpk_file(
                std::path::Path::new(path("path")?),
                arguments
                    .get("maxEntries")
                    .and_then(Value::as_u64)
                    .unwrap_or(500) as usize,
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "aob_scan" => serde_json::to_value(
            aphrody_re::aob_scan_file(
                std::path::Path::new(path("path")?),
                path("pattern")?,
                arguments
                    .get("maxMatches")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize),
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        "asar_list" => serde_json::to_value(
            aphrody_re::asar::list_file(std::path::Path::new(path("path")?)).map_err(failed)?,
        )
        .map_err(failed),
        "golang_scan" => serde_json::to_value(
            aphrody_re::golang::scan_file(
                std::path::Path::new(path("path")?),
                arguments
                    .get("maxSymbols")
                    .and_then(Value::as_u64)
                    .unwrap_or(200) as usize,
            )
            .map_err(failed)?,
        )
        .map_err(failed),
        other => {
            if let Some(result) = crate::tweaks::dispatch::call(other, &arguments) {
                return result;
            }
            if let Some(result) = crate::shell::dispatch::call(other, &arguments) {
                return result;
            }
            if let Some(result) = crate::nt::call(other, &arguments) {
                return result;
            }
            Err(SubsystemError::UnknownTool(tool.to_owned()))
        }
    }
}

use crate::{filesystem, gamepad, memory, registry, system};
