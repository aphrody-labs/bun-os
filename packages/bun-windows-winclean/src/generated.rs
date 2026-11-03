// SPDX-License-Identifier: Apache-2.0
// @generated from the canonical Rust tool catalog — do not edit by hand.
#![allow(clippy::doc_markdown, clippy::too_many_lines, missing_docs)]

use serde::Serialize;

use crate::{Result, ToolResult, Winclean};

/// Every tool name exposed by the Rust WinClean compatibility surface.
pub const TOOL_NAMES: [&str; 211] = [
    "analyze_pe",
    "aob_scan",
    "asar_list",
    "binary_aes_ctr_decrypt",
    "binary_entropy_map",
    "binary_extract_strings",
    "binary_hash_multi",
    "binary_list_cpk",
    "binary_parse_pe_header",
    "binary_section_dump",
    "binary_xor_decrypt",
    "click",
    "computer_capture_screen",
    "computer_click",
    "computer_click_element",
    "computer_drag",
    "computer_key",
    "computer_observe",
    "computer_ocr",
    "computer_record_clip",
    "computer_scroll",
    "computer_speak",
    "computer_type",
    "coord_assign_task",
    "coord_query_stop",
    "coord_read_status",
    "coord_read_task",
    "coord_report_status",
    "copy_path",
    "delete_path",
    "delete_registry_entry",
    "disable_scheduled_task",
    "enable_scheduled_task",
    "gamepad_create_xbox360",
    "gamepad_destroy",
    "gamepad_destroy_all",
    "gamepad_environment",
    "gamepad_press_button",
    "gamepad_send_xbox360_state",
    "gaming_capture_benchmark",
    "gaming_capture_window",
    "gaming_environment",
    "gaming_frame_pacing",
    "gaming_get_background_apps",
    "gaming_get_game_bar_capture",
    "gaming_get_game_mode",
    "gaming_get_gpu_info",
    "gaming_get_timer_resolution",
    "gaming_input_sequence",
    "gaming_key",
    "gaming_mouse_button",
    "gaming_mouse_delta",
    "gaming_profile_apply",
    "gaming_profile_status",
    "gaming_steam_launch",
    "get_active_power_plan",
    "get_clipboard_text",
    "get_cpu_info",
    "get_cpu_usage",
    "get_defender_status",
    "get_disk_info",
    "get_file_info",
    "get_gpu_preferences",
    "get_hags_mode",
    "get_memory_info",
    "get_network_adapters",
    "get_os_info",
    "get_registry_value",
    "get_system_profile",
    "golang_scan",
    "keyboard_hold",
    "keyboard_release",
    "keyboard_scan_code",
    "kill_process",
    "launch_app",
    "list_directory",
    "list_listening_ports",
    "list_power_plans",
    "list_processes",
    "list_registry_key",
    "list_scheduled_tasks",
    "list_services",
    "list_tcp_connections",
    "list_windows",
    "mem_allocate",
    "mem_dump_region",
    "mem_enable_debug_privilege",
    "mem_free",
    "mem_get_module_base",
    "mem_list_modules",
    "mem_list_processes",
    "mem_protect",
    "mem_query_region",
    "mem_read_bytes",
    "mem_read_c_string",
    "mem_read_double",
    "mem_read_float",
    "mem_read_int32",
    "mem_read_int64",
    "mem_read_utf16",
    "mem_resume_process",
    "mem_scan_aob",
    "mem_scan_value_int32",
    "mem_suspend_process",
    "mem_write_bytes",
    "mem_write_double",
    "mem_write_float",
    "mem_write_int32",
    "mem_write_int64",
    "mouse_drag_to",
    "mouse_move_smooth",
    "move",
    "move_path",
    "multi_edit",
    "multi_select",
    "perf_dwm_flush",
    "perf_empty_working_sets",
    "perf_memory_status",
    "perf_purge_standby_list",
    "perf_set_eco_mode",
    "power_shell",
    "query_event_log",
    "read_file",
    "resize_window",
    "restart_service",
    "run_scheduled_task",
    "scrape",
    "screenshot",
    "scroll",
    "search_files",
    "search_windows",
    "send_notification",
    "set_active_power_plan",
    "set_clipboard_text",
    "set_gpu_preference",
    "set_hags_mode",
    "set_process_affinity",
    "set_process_priority",
    "set_registry_value",
    "shortcut",
    "snapshot",
    "start_service",
    "steam_get_game",
    "steam_get_game_status",
    "steam_kill_game",
    "steam_launch_and_wait",
    "steam_launch_by_app_id",
    "steam_list_games",
    "steam_list_libraries",
    "steam_open_uri",
    "steam_scan_summary",
    "steam_vault_status",
    "steam_wait_for_launch",
    "stop_service",
    "switch_to_window",
    "trim_process_working_set",
    "type",
    "wait",
    "window_capture",
    "window_close",
    "window_enum_all",
    "window_enum_children",
    "window_find_by_class",
    "window_get_text",
    "window_minimise_all",
    "window_move",
    "window_post_message",
    "window_send_message",
    "window_set_opacity",
    "window_set_text",
    "window_set_topmost",
    "winml_get_version",
    "winml_inspect_onnx",
    "winml_list_providers",
    "winml_run_float32",
    "write_file",
    "wsl_execute",
    "wsl_get_status",
    "wsl_list_distributions",
    "wsl_list_processes",
    "wsl_read_only_probe",
    "wsl_send_signal",
    "tweak_catalog",
    "tweak_plan",
    "tweak_apply",
    "tweak_verify",
    "tweak_undo",
    "nt_status",
    "nt_events_start",
    "nt_events_read",
    "nt_events_stop",
    "nt_handles",
    "nt_kernel_modules",
    "wmi_query",
    "com_invoke",
    "shell_known_folders",
    "shell_drives",
    "shell_file_operation",
    "shell_recycle_bin",
    "shell_context_menu",
    "shell_properties",
    "shell_thumbnail",
    "shell_open_with",
    "shell_reveal",
    "winget_sources",
    "winget_search",
    "winget_list",
    "winget_show",
    "winget_install",
    "winget_upgrade",
    "winget_uninstall",
];

/// Arguments for [`Winclean::analyze_pe`] (`analyze_pe`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct AnalyzePeArgs {
    /// Absolute path to the target PE executable or DLL file.
    #[serde(rename = "path")]
    pub path: String,
}

impl AnalyzePeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::aob_scan`] (`aob_scan`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct AobScanArgs {
    /// Absolute path to the target binary.
    #[serde(rename = "path")]
    pub path: String,
    /// AOB pattern with hex bytes and wildcards, e.g. '48 89 5C 24 ? 48 89 74 24 ?'.
    #[serde(rename = "pattern")]
    pub pattern: String,
    /// Max matches to return (default 50, max 1000).
    ///
    /// Default: `50`.
    #[serde(rename = "maxMatches", skip_serializing_if = "Option::is_none")]
    pub max_matches: Option<i64>,
}

impl AobScanArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `pattern`.
    #[must_use]
    pub fn pattern(mut self, value: impl Into<String>) -> Self {
        self.pattern = value.into();
        self
    }

    /// Sets `maxMatches`.
    #[must_use]
    pub fn max_matches(mut self, value: i64) -> Self {
        self.max_matches = Some(value);
        self
    }
}

/// Arguments for [`Winclean::asar_list`] (`asar_list`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct AsarListArgs {
    /// Absolute path to the .asar archive.
    #[serde(rename = "path")]
    pub path: String,
}

impl AsarListArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::binary_aes_ctr_decrypt`] (`binary_aes_ctr_decrypt`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryAesCtrDecryptArgs {
    /// Absolute path to the ciphertext.
    #[serde(rename = "inputPath")]
    pub input_path: String,
    /// Absolute path of the plaintext output.
    #[serde(rename = "outputPath")]
    pub output_path: String,
    /// AES key in hex (32 or 64 hex chars).
    #[serde(rename = "keyHex")]
    pub key_hex: String,
    /// Initial counter (IV) in hex (32 hex chars).
    #[serde(rename = "ivHex")]
    pub iv_hex: String,
}

impl BinaryAesCtrDecryptArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `inputPath`.
    #[must_use]
    pub fn input_path(mut self, value: impl Into<String>) -> Self {
        self.input_path = value.into();
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = value.into();
        self
    }

    /// Sets `keyHex`.
    #[must_use]
    pub fn key_hex(mut self, value: impl Into<String>) -> Self {
        self.key_hex = value.into();
        self
    }

    /// Sets `ivHex`.
    #[must_use]
    pub fn iv_hex(mut self, value: impl Into<String>) -> Self {
        self.iv_hex = value.into();
        self
    }
}

/// Arguments for [`Winclean::binary_entropy_map`] (`binary_entropy_map`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryEntropyMapArgs {
    /// Absolute path to the file.
    #[serde(rename = "path")]
    pub path: String,
    /// Block size in bytes (default 4096, min 256, max 1048576).
    ///
    /// Default: `4096`.
    #[serde(rename = "blockSize", skip_serializing_if = "Option::is_none")]
    pub block_size: Option<i64>,
}

impl BinaryEntropyMapArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `blockSize`.
    #[must_use]
    pub fn block_size(mut self, value: i64) -> Self {
        self.block_size = Some(value);
        self
    }
}

/// Arguments for [`Winclean::binary_extract_strings`] (`binary_extract_strings`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryExtractStringsArgs {
    /// Absolute path to the file.
    #[serde(rename = "path")]
    pub path: String,
    /// Minimum string length (default 4, capped at 256).
    ///
    /// Default: `4`.
    #[serde(rename = "minLength", skip_serializing_if = "Option::is_none")]
    pub min_length: Option<i64>,
    /// Maximum strings to return (default 1000, capped at 50000).
    ///
    /// Default: `1000`.
    #[serde(rename = "maxResults", skip_serializing_if = "Option::is_none")]
    pub max_results: Option<i64>,
}

impl BinaryExtractStringsArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `minLength`.
    #[must_use]
    pub fn min_length(mut self, value: i64) -> Self {
        self.min_length = Some(value);
        self
    }

    /// Sets `maxResults`.
    #[must_use]
    pub fn max_results(mut self, value: i64) -> Self {
        self.max_results = Some(value);
        self
    }
}

/// Arguments for [`Winclean::binary_hash_multi`] (`binary_hash_multi`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryHashMultiArgs {
    /// Absolute path to the file.
    #[serde(rename = "path")]
    pub path: String,
}

impl BinaryHashMultiArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::binary_list_cpk`] (`binary_list_cpk`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryListCpkArgs {
    /// Absolute path to the .cpk archive.
    #[serde(rename = "path")]
    pub path: String,
    /// Max entries to return (default 500, capped at 50000).
    ///
    /// Default: `500`.
    #[serde(rename = "maxEntries", skip_serializing_if = "Option::is_none")]
    pub max_entries: Option<i64>,
}

impl BinaryListCpkArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `maxEntries`.
    #[must_use]
    pub fn max_entries(mut self, value: i64) -> Self {
        self.max_entries = Some(value);
        self
    }
}

/// Arguments for [`Winclean::binary_parse_pe_header`] (`binary_parse_pe_header`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryParsePeHeaderArgs {
    /// Absolute path to the PE file (.exe / .dll / .sys / .efi).
    #[serde(rename = "path")]
    pub path: String,
}

impl BinaryParsePeHeaderArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::binary_section_dump`] (`binary_section_dump`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinarySectionDumpArgs {
    /// Absolute path to the PE file.
    #[serde(rename = "path")]
    pub path: String,
    /// Section name (e.g. '.text').
    #[serde(rename = "sectionName")]
    pub section_name: String,
    /// Output binary path. Empty = auto in %TEMP%.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

impl BinarySectionDumpArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `sectionName`.
    #[must_use]
    pub fn section_name(mut self, value: impl Into<String>) -> Self {
        self.section_name = value.into();
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::binary_xor_decrypt`] (`binary_xor_decrypt`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct BinaryXorDecryptArgs {
    /// Absolute path to the encrypted file.
    #[serde(rename = "inputPath")]
    pub input_path: String,
    /// Absolute path of the decrypted output.
    #[serde(rename = "outputPath")]
    pub output_path: String,
    /// Hex key (e.g. 'A5' or 'DEADBEEF').
    #[serde(rename = "keyHex")]
    pub key_hex: String,
}

impl BinaryXorDecryptArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `inputPath`.
    #[must_use]
    pub fn input_path(mut self, value: impl Into<String>) -> Self {
        self.input_path = value.into();
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = value.into();
        self
    }

    /// Sets `keyHex`.
    #[must_use]
    pub fn key_hex(mut self, value: impl Into<String>) -> Self {
        self.key_hex = value.into();
        self
    }
}

/// Arguments for [`Winclean::click`] (`click`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ClickArgs {
    /// X coordinate in screen pixels.
    #[serde(rename = "x")]
    pub x: i64,
    /// Y coordinate in screen pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Mouse button: left | right | middle.
    ///
    /// Default: `"left"`.
    #[serde(rename = "button", skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    /// 0 = hover, 1 = single, 2 = double.
    ///
    /// Default: `1`.
    #[serde(rename = "clicks", skip_serializing_if = "Option::is_none")]
    pub clicks: Option<i64>,
}

impl ClickArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `button`.
    #[must_use]
    pub fn button(mut self, value: impl Into<String>) -> Self {
        self.button = Some(value.into());
        self
    }

    /// Sets `clicks`.
    #[must_use]
    pub fn clicks(mut self, value: i64) -> Self {
        self.clicks = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_capture_screen`] (`computer_capture_screen`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerCaptureScreenArgs {}

/// Arguments for [`Winclean::computer_click`] (`computer_click`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerClickArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Window-relative X coordinate in pixels.
    #[serde(rename = "x")]
    pub x: i64,
    /// Window-relative Y coordinate in pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Mouse button: left | right | middle.
    ///
    /// Default: `"left"`.
    #[serde(rename = "button", skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    /// Number of clicks: 1 or 2.
    ///
    /// Default: `1`.
    #[serde(rename = "clicks", skip_serializing_if = "Option::is_none")]
    pub clicks: Option<i64>,
    /// Restore and focus the target window before input.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerClickArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `button`.
    #[must_use]
    pub fn button(mut self, value: impl Into<String>) -> Self {
        self.button = Some(value.into());
        self
    }

    /// Sets `clicks`.
    #[must_use]
    pub fn clicks(mut self, value: i64) -> Self {
        self.clicks = Some(value);
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_click_element`] (`computer_click_element`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerClickElementArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Exact UIA AutomationId, when available.
    ///
    /// Default: `null`.
    #[serde(rename = "automationId", skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    /// Exact UIA Name, case-insensitive.
    ///
    /// Default: `null`.
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Exact UIA className, case-insensitive.
    ///
    /// Default: `null`.
    #[serde(rename = "className", skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    /// Exact UIA controlType, case-insensitive.
    ///
    /// Default: `null`.
    #[serde(rename = "controlType", skip_serializing_if = "Option::is_none")]
    pub control_type: Option<String>,
    /// Zero-based match to click when more than one element matches.
    ///
    /// Default: `-1`.
    #[serde(rename = "occurrence", skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<i64>,
    /// Restore and focus the target window before clicking.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerClickElementArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `automationId`.
    #[must_use]
    pub fn automation_id(mut self, value: impl Into<String>) -> Self {
        self.automation_id = Some(value.into());
        self
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }

    /// Sets `className`.
    #[must_use]
    pub fn class_name(mut self, value: impl Into<String>) -> Self {
        self.class_name = Some(value.into());
        self
    }

    /// Sets `controlType`.
    #[must_use]
    pub fn control_type(mut self, value: impl Into<String>) -> Self {
        self.control_type = Some(value.into());
        self
    }

    /// Sets `occurrence`.
    #[must_use]
    pub fn occurrence(mut self, value: i64) -> Self {
        self.occurrence = Some(value);
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_drag`] (`computer_drag`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerDragArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Window-relative start X.
    #[serde(rename = "fromX")]
    pub from_x: i64,
    /// Window-relative start Y.
    #[serde(rename = "fromY")]
    pub from_y: i64,
    /// Window-relative end X.
    #[serde(rename = "toX")]
    pub to_x: i64,
    /// Window-relative end Y.
    #[serde(rename = "toY")]
    pub to_y: i64,
    /// Mouse button: left | right | middle.
    ///
    /// Default: `"left"`.
    #[serde(rename = "button", skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    /// Intermediate movement steps (8..200).
    ///
    /// Default: `20`.
    #[serde(rename = "steps", skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
    /// Total drag duration in milliseconds (50..5000).
    ///
    /// Default: `250`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    /// Restore and focus the target window before input.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerDragArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `fromX`.
    #[must_use]
    pub fn from_x(mut self, value: i64) -> Self {
        self.from_x = value;
        self
    }

    /// Sets `fromY`.
    #[must_use]
    pub fn from_y(mut self, value: i64) -> Self {
        self.from_y = value;
        self
    }

    /// Sets `toX`.
    #[must_use]
    pub fn to_x(mut self, value: i64) -> Self {
        self.to_x = value;
        self
    }

    /// Sets `toY`.
    #[must_use]
    pub fn to_y(mut self, value: i64) -> Self {
        self.to_y = value;
        self
    }

    /// Sets `button`.
    #[must_use]
    pub fn button(mut self, value: impl Into<String>) -> Self {
        self.button = Some(value.into());
        self
    }

    /// Sets `steps`.
    #[must_use]
    pub fn steps(mut self, value: i64) -> Self {
        self.steps = Some(value);
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_key`] (`computer_key`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerKeyArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Shortcut string such as ctrl+s, alt+f4, enter or f5.
    #[serde(rename = "shortcut")]
    pub shortcut: String,
    /// Restore and focus the target window before input.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerKeyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `shortcut`.
    #[must_use]
    pub fn shortcut(mut self, value: impl Into<String>) -> Self {
        self.shortcut = value.into();
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_observe`] (`computer_observe`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerObserveArgs {
    /// Exact HWND to inspect (0 = foreground window).
    ///
    /// Default: `0`.
    #[serde(rename = "windowHandle", skip_serializing_if = "Option::is_none")]
    pub window_handle: Option<i64>,
    /// Maximum UI Automation elements (1..1000, default 160).
    ///
    /// Default: `160`.
    #[serde(rename = "maxElements", skip_serializing_if = "Option::is_none")]
    pub max_elements: Option<i64>,
    /// Include the UI Automation tree in the text block.
    ///
    /// Default: `true`.
    #[serde(rename = "includeUiTree", skip_serializing_if = "Option::is_none")]
    pub include_ui_tree: Option<bool>,
    /// Optional PNG export path. When set, the captured observation is also written there.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

impl ComputerObserveArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = Some(value);
        self
    }

    /// Sets `maxElements`.
    #[must_use]
    pub fn max_elements(mut self, value: i64) -> Self {
        self.max_elements = Some(value);
        self
    }

    /// Sets `includeUiTree`.
    #[must_use]
    pub fn include_ui_tree(mut self, value: bool) -> Self {
        self.include_ui_tree = Some(value);
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::computer_ocr`] (`computer_ocr`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerOcrArgs {
    /// Exact HWND from the latest observation (0 = foreground window).
    ///
    /// Default: `0`.
    #[serde(rename = "windowHandle", skip_serializing_if = "Option::is_none")]
    pub window_handle: Option<i64>,
    /// json or markdown.
    ///
    /// Default: `"json"`.
    #[serde(rename = "format", skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// Windows OCR language tag, for example fr-FR or en-US. Null uses the user profile languages.
    ///
    /// Default: `null`.
    #[serde(rename = "language", skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Region X relative to the captured window image (0 for full image).
    ///
    /// Default: `0`.
    #[serde(rename = "regionX", skip_serializing_if = "Option::is_none")]
    pub region_x: Option<i64>,
    /// Region Y relative to the captured window image (0 for full image).
    ///
    /// Default: `0`.
    #[serde(rename = "regionY", skip_serializing_if = "Option::is_none")]
    pub region_y: Option<i64>,
    /// Region width; 0 means the remaining image width.
    ///
    /// Default: `0`.
    #[serde(rename = "regionWidth", skip_serializing_if = "Option::is_none")]
    pub region_width: Option<i64>,
    /// Region height; 0 means the remaining image height.
    ///
    /// Default: `0`.
    #[serde(rename = "regionHeight", skip_serializing_if = "Option::is_none")]
    pub region_height: Option<i64>,
    /// Play the recognized text through the installed local Windows voice.
    ///
    /// Default: `false`.
    #[serde(rename = "speak", skip_serializing_if = "Option::is_none")]
    pub speak: Option<bool>,
    /// Optional JSON/Markdown export path.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Optional WAV export path when speak=true; otherwise a temporary WAV is created.
    ///
    /// Default: `null`.
    #[serde(rename = "audioPath", skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
}

impl ComputerOcrArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = Some(value);
        self
    }

    /// Sets `format`.
    #[must_use]
    pub fn format(mut self, value: impl Into<String>) -> Self {
        self.format = Some(value.into());
        self
    }

    /// Sets `language`.
    #[must_use]
    pub fn language(mut self, value: impl Into<String>) -> Self {
        self.language = Some(value.into());
        self
    }

    /// Sets `regionX`.
    #[must_use]
    pub fn region_x(mut self, value: i64) -> Self {
        self.region_x = Some(value);
        self
    }

    /// Sets `regionY`.
    #[must_use]
    pub fn region_y(mut self, value: i64) -> Self {
        self.region_y = Some(value);
        self
    }

    /// Sets `regionWidth`.
    #[must_use]
    pub fn region_width(mut self, value: i64) -> Self {
        self.region_width = Some(value);
        self
    }

    /// Sets `regionHeight`.
    #[must_use]
    pub fn region_height(mut self, value: i64) -> Self {
        self.region_height = Some(value);
        self
    }

    /// Sets `speak`.
    #[must_use]
    pub fn speak(mut self, value: bool) -> Self {
        self.speak = Some(value);
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }

    /// Sets `audioPath`.
    #[must_use]
    pub fn audio_path(mut self, value: impl Into<String>) -> Self {
        self.audio_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::computer_record_clip`] (`computer_record_clip`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerRecordClipArgs {
    /// Exact HWND from the latest observation; 0 records the primary desktop.
    ///
    /// Default: `0`.
    #[serde(rename = "windowHandle", skip_serializing_if = "Option::is_none")]
    pub window_handle: Option<i64>,
    /// Output AVI path; null creates a timestamped file in the user temp directory.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Clip duration in milliseconds (100..30000).
    ///
    /// Default: `5000`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    /// Frames per second (1..30).
    ///
    /// Default: `10`.
    #[serde(rename = "fps", skip_serializing_if = "Option::is_none")]
    pub fps: Option<i64>,
}

impl ComputerRecordClipArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = Some(value);
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }

    /// Sets `fps`.
    #[must_use]
    pub fn fps(mut self, value: i64) -> Self {
        self.fps = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_scroll`] (`computer_scroll`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerScrollArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Window-relative X coordinate.
    #[serde(rename = "x")]
    pub x: i64,
    /// Window-relative Y coordinate.
    #[serde(rename = "y")]
    pub y: i64,
    /// vertical or horizontal.
    ///
    /// Default: `"vertical"`.
    #[serde(rename = "axis", skip_serializing_if = "Option::is_none")]
    pub axis: Option<String>,
    /// up, down, left or right.
    ///
    /// Default: `"down"`.
    #[serde(rename = "direction", skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// Number of wheel notches (1..40).
    ///
    /// Default: `1`.
    #[serde(rename = "wheelTimes", skip_serializing_if = "Option::is_none")]
    pub wheel_times: Option<i64>,
    /// Restore and focus the target window before input.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerScrollArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `axis`.
    #[must_use]
    pub fn axis(mut self, value: impl Into<String>) -> Self {
        self.axis = Some(value.into());
        self
    }

    /// Sets `direction`.
    #[must_use]
    pub fn direction(mut self, value: impl Into<String>) -> Self {
        self.direction = Some(value.into());
        self
    }

    /// Sets `wheelTimes`.
    #[must_use]
    pub fn wheel_times(mut self, value: i64) -> Self {
        self.wheel_times = Some(value);
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::computer_speak`] (`computer_speak`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerSpeakArgs {
    /// Text to speak, maximum 32768 characters.
    #[serde(rename = "text")]
    pub text: String,
    /// Optional WAV export path; otherwise a temporary WAV is created.
    ///
    /// Default: `null`.
    #[serde(rename = "audioPath", skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
}

impl ComputerSpeakArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }

    /// Sets `audioPath`.
    #[must_use]
    pub fn audio_path(mut self, value: impl Into<String>) -> Self {
        self.audio_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::computer_type`] (`computer_type`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComputerTypeArgs {
    /// Exact HWND from the latest observation (0 = current foreground window).
    #[serde(rename = "windowHandle")]
    pub window_handle: i64,
    /// Text to type.
    #[serde(rename = "text")]
    pub text: String,
    /// Window-relative X coordinate in pixels.
    #[serde(rename = "x")]
    pub x: i64,
    /// Window-relative Y coordinate in pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Select all and delete existing field contents first.
    ///
    /// Default: `false`.
    #[serde(rename = "clear", skip_serializing_if = "Option::is_none")]
    pub clear: Option<bool>,
    /// Press Enter after typing.
    ///
    /// Default: `false`.
    #[serde(rename = "pressEnter", skip_serializing_if = "Option::is_none")]
    pub press_enter: Option<bool>,
    /// Restore and focus the target window before input.
    ///
    /// Default: `true`.
    #[serde(rename = "activate", skip_serializing_if = "Option::is_none")]
    pub activate: Option<bool>,
}

impl ComputerTypeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = value;
        self
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `clear`.
    #[must_use]
    pub fn clear(mut self, value: bool) -> Self {
        self.clear = Some(value);
        self
    }

    /// Sets `pressEnter`.
    #[must_use]
    pub fn press_enter(mut self, value: bool) -> Self {
        self.press_enter = Some(value);
        self
    }

    /// Sets `activate`.
    #[must_use]
    pub fn activate(mut self, value: bool) -> Self {
        self.activate = Some(value);
        self
    }
}

/// Arguments for [`Winclean::coord_assign_task`] (`coord_assign_task`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CoordAssignTaskArgs {
    /// Markdown content for the new CURRENT_TASK.md (overwrites the existing file).
    #[serde(rename = "markdown")]
    pub markdown: String,
}

impl CoordAssignTaskArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `markdown`.
    #[must_use]
    pub fn markdown(mut self, value: impl Into<String>) -> Self {
        self.markdown = value.into();
        self
    }
}

/// Arguments for [`Winclean::coord_query_stop`] (`coord_query_stop`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CoordQueryStopArgs {}

/// Arguments for [`Winclean::coord_read_status`] (`coord_read_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CoordReadStatusArgs {
    /// Agent name to read. Case-insensitive.
    #[serde(rename = "agent")]
    pub agent: String,
}

impl CoordReadStatusArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `agent`.
    #[must_use]
    pub fn agent(mut self, value: impl Into<String>) -> Self {
        self.agent = value.into();
        self
    }
}

/// Arguments for [`Winclean::coord_read_task`] (`coord_read_task`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CoordReadTaskArgs {}

/// Arguments for [`Winclean::coord_report_status`] (`coord_report_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CoordReportStatusArgs {
    /// Agent name (e.g. 'claude', 'gemini', 'aphrody-claude'). Case-insensitive on disk.
    #[serde(rename = "agent")]
    pub agent: String,
    /// Full multi-line status block. Trailing newline is normalised.
    #[serde(rename = "status")]
    pub status: String,
}

impl CoordReportStatusArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `agent`.
    #[must_use]
    pub fn agent(mut self, value: impl Into<String>) -> Self {
        self.agent = value.into();
        self
    }

    /// Sets `status`.
    #[must_use]
    pub fn status(mut self, value: impl Into<String>) -> Self {
        self.status = value.into();
        self
    }
}

/// Arguments for [`Winclean::copy_path`] (`copy_path`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CopyPathArgs {
    /// Source path (absolute or relative to Desktop).
    #[serde(rename = "path")]
    pub path: String,
    /// Destination path (absolute or relative to Desktop).
    #[serde(rename = "destination")]
    pub destination: String,
    /// Overwrite existing destination.
    ///
    /// Default: `false`.
    #[serde(rename = "overwrite", skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

impl CopyPathArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `destination`.
    #[must_use]
    pub fn destination(mut self, value: impl Into<String>) -> Self {
        self.destination = value.into();
        self
    }

    /// Sets `overwrite`.
    #[must_use]
    pub fn overwrite(mut self, value: bool) -> Self {
        self.overwrite = Some(value);
        self
    }
}

/// Arguments for [`Winclean::delete_path`] (`delete_path`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct DeletePathArgs {
    /// Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
    #[serde(rename = "path")]
    pub path: String,
    /// Recurse into directory contents.
    ///
    /// Default: `false`.
    #[serde(rename = "recursive", skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
}

impl DeletePathArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `recursive`.
    #[must_use]
    pub fn recursive(mut self, value: bool) -> Self {
        self.recursive = Some(value);
        self
    }
}

/// Arguments for [`Winclean::delete_registry_entry`] (`delete_registry_entry`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct DeleteRegistryEntryArgs {
    /// Key path including hive prefix.
    #[serde(rename = "path")]
    pub path: String,
    /// Value name; null/empty deletes the entire key.
    ///
    /// Default: `null`.
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl DeleteRegistryEntryArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::disable_scheduled_task`] (`disable_scheduled_task`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct DisableScheduledTaskArgs {
    /// Absolute task path.
    #[serde(rename = "path")]
    pub path: String,
}

impl DisableScheduledTaskArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::enable_scheduled_task`] (`enable_scheduled_task`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct EnableScheduledTaskArgs {
    /// Absolute task path, e.g. '\Microsoft\Windows\Defender\Windows Defender Scheduled Scan'.
    #[serde(rename = "path")]
    pub path: String,
}

impl EnableScheduledTaskArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::gamepad_create_xbox360`] (`gamepad_create_xbox360`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadCreateXbox360Args {
    /// Slot index (0–7) used to reference this controller in subsequent calls.
    ///
    /// Default: `0`.
    #[serde(rename = "slotIndex", skip_serializing_if = "Option::is_none")]
    pub slot_index: Option<i64>,
}

impl GamepadCreateXbox360Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `slotIndex`.
    #[must_use]
    pub fn slot_index(mut self, value: i64) -> Self {
        self.slot_index = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gamepad_destroy`] (`gamepad_destroy`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadDestroyArgs {
    /// Slot index to destroy.
    #[serde(rename = "slot")]
    pub slot: i64,
}

impl GamepadDestroyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `slot`.
    #[must_use]
    pub fn slot(mut self, value: i64) -> Self {
        self.slot = value;
        self
    }
}

/// Arguments for [`Winclean::gamepad_destroy_all`] (`gamepad_destroy_all`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadDestroyAllArgs {}

/// Arguments for [`Winclean::gamepad_environment`] (`gamepad_environment`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadEnvironmentArgs {}

/// Arguments for [`Winclean::gamepad_press_button`] (`gamepad_press_button`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadPressButtonArgs {
    /// Slot index from GamepadCreateXbox360.
    #[serde(rename = "slot")]
    pub slot: i64,
    /// Button bitmask to press (e.g. 4096 for A).
    #[serde(rename = "buttonMask")]
    pub button_mask: i64,
    /// Hold duration in milliseconds [1, 5000].
    ///
    /// Default: `100`.
    #[serde(rename = "holdMs", skip_serializing_if = "Option::is_none")]
    pub hold_ms: Option<i64>,
}

impl GamepadPressButtonArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `slot`.
    #[must_use]
    pub fn slot(mut self, value: i64) -> Self {
        self.slot = value;
        self
    }

    /// Sets `buttonMask`.
    #[must_use]
    pub fn button_mask(mut self, value: i64) -> Self {
        self.button_mask = value;
        self
    }

    /// Sets `holdMs`.
    #[must_use]
    pub fn hold_ms(mut self, value: i64) -> Self {
        self.hold_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gamepad_send_xbox360_state`] (`gamepad_send_xbox360_state`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamepadSendXbox360StateArgs {
    /// Slot index from GamepadCreateXbox360.
    #[serde(rename = "slot")]
    pub slot: i64,
    /// Button bitmask (see description for values).
    #[serde(rename = "buttons")]
    pub buttons: i64,
    /// Left stick X axis [-32768, 32767].
    ///
    /// Default: `0`.
    #[serde(rename = "lx", skip_serializing_if = "Option::is_none")]
    pub lx: Option<i64>,
    /// Left stick Y axis [-32768, 32767].
    ///
    /// Default: `0`.
    #[serde(rename = "ly", skip_serializing_if = "Option::is_none")]
    pub ly: Option<i64>,
    /// Right stick X axis [-32768, 32767].
    ///
    /// Default: `0`.
    #[serde(rename = "rx", skip_serializing_if = "Option::is_none")]
    pub rx: Option<i64>,
    /// Right stick Y axis [-32768, 32767].
    ///
    /// Default: `0`.
    #[serde(rename = "ry", skip_serializing_if = "Option::is_none")]
    pub ry: Option<i64>,
    /// Left trigger [0, 255].
    ///
    /// Default: `0`.
    #[serde(rename = "lt", skip_serializing_if = "Option::is_none")]
    pub lt: Option<i64>,
    /// Right trigger [0, 255].
    ///
    /// Default: `0`.
    #[serde(rename = "rt", skip_serializing_if = "Option::is_none")]
    pub rt: Option<i64>,
}

impl GamepadSendXbox360StateArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `slot`.
    #[must_use]
    pub fn slot(mut self, value: i64) -> Self {
        self.slot = value;
        self
    }

    /// Sets `buttons`.
    #[must_use]
    pub fn buttons(mut self, value: i64) -> Self {
        self.buttons = value;
        self
    }

    /// Sets `lx`.
    #[must_use]
    pub fn lx(mut self, value: i64) -> Self {
        self.lx = Some(value);
        self
    }

    /// Sets `ly`.
    #[must_use]
    pub fn ly(mut self, value: i64) -> Self {
        self.ly = Some(value);
        self
    }

    /// Sets `rx`.
    #[must_use]
    pub fn rx(mut self, value: i64) -> Self {
        self.rx = Some(value);
        self
    }

    /// Sets `ry`.
    #[must_use]
    pub fn ry(mut self, value: i64) -> Self {
        self.ry = Some(value);
        self
    }

    /// Sets `lt`.
    #[must_use]
    pub fn lt(mut self, value: i64) -> Self {
        self.lt = Some(value);
        self
    }

    /// Sets `rt`.
    #[must_use]
    pub fn rt(mut self, value: i64) -> Self {
        self.rt = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_capture_benchmark`] (`gaming_capture_benchmark`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingCaptureBenchmarkArgs {
    /// Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground
    /// window.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive substring of the target window title, used when hwnd is absent.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Measurement window in ms [100, 30000].
    ///
    /// Default: `3000`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    /// Also measure the GDI PNG capture rate (Windows).
    ///
    /// Default: `true`.
    #[serde(rename = "compareGdi", skip_serializing_if = "Option::is_none")]
    pub compare_gdi: Option<bool>,
}

impl GamingCaptureBenchmarkArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }

    /// Sets `compareGdi`.
    #[must_use]
    pub fn compare_gdi(mut self, value: bool) -> Self {
        self.compare_gdi = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_capture_window`] (`gaming_capture_window`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingCaptureWindowArgs {
    /// Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground
    /// window.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive substring of the target window title, used when hwnd is absent.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Optional PNG path written in addition to the returned image.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Return the PNG inline as base64.
    ///
    /// Default: `true`.
    #[serde(rename = "includeImage", skip_serializing_if = "Option::is_none")]
    pub include_image: Option<bool>,
}

impl GamingCaptureWindowArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }

    /// Sets `includeImage`.
    #[must_use]
    pub fn include_image(mut self, value: bool) -> Self {
        self.include_image = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_environment`] (`gaming_environment`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingEnvironmentArgs {}

/// Arguments for [`Winclean::gaming_frame_pacing`] (`gaming_frame_pacing`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingFramePacingArgs {
    /// Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground
    /// window.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive substring of the target window title, used when hwnd is absent.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Observation window in ms [100, 30000].
    ///
    /// Default: `3000`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

impl GamingFramePacingArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_get_background_apps`] (`gaming_get_background_apps`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingGetBackgroundAppsArgs {}

/// Arguments for [`Winclean::gaming_get_game_bar_capture`] (`gaming_get_game_bar_capture`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingGetGameBarCaptureArgs {}

/// Arguments for [`Winclean::gaming_get_game_mode`] (`gaming_get_game_mode`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingGetGameModeArgs {}

/// Arguments for [`Winclean::gaming_get_gpu_info`] (`gaming_get_gpu_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingGetGpuInfoArgs {}

/// Arguments for [`Winclean::gaming_get_timer_resolution`] (`gaming_get_timer_resolution`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingGetTimerResolutionArgs {}

/// Arguments for [`Winclean::gaming_input_sequence`] (`gaming_input_sequence`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingInputSequenceArgs {
    /// Target window (Windows HWND or X11 id): focused and verified as foreground before any input
    /// is sent; input is refused otherwise.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive title substring of the target window, used when hwnd is absent; same focus
    /// guard.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Input events, at most 10000.
    #[serde(rename = "events")]
    pub events: Vec<serde_json::Value>,
}

impl GamingInputSequenceArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `events`.
    #[must_use]
    pub fn events(mut self, value: Vec<serde_json::Value>) -> Self {
        self.events = value;
        self
    }
}

/// Arguments for [`Winclean::gaming_key`] (`gaming_key`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingKeyArgs {
    /// Target window (Windows HWND or X11 id): focused and verified as foreground before any input
    /// is sent; input is refused otherwise.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive title substring of the target window, used when hwnd is absent; same focus
    /// guard.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Key name at its US-QWERTY physical position (games bind scan codes): a-z, 0-9, space, enter,
    /// escape, tab, shift, rshift, ctrl, alt, backspace, capslock, f1-f12, up, down, left, right,
    /// home, end, pageup, pagedown, insert, delete.
    #[serde(rename = "key", skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// PC set-1 scan code, used instead of key for any other key.
    #[serde(rename = "scanCode", skip_serializing_if = "Option::is_none")]
    pub scan_code: Option<i64>,
    /// Extended (E0) scan code flag for scanCode.
    ///
    /// Default: `false`.
    #[serde(rename = "extended", skip_serializing_if = "Option::is_none")]
    pub extended: Option<bool>,
    /// down, up, tap or hold.
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Hold time in ms for tap/hold (tap 20, hold 250 by default).
    #[serde(rename = "holdMs", skip_serializing_if = "Option::is_none")]
    pub hold_ms: Option<i64>,
    /// Repetitions [1, 1000].
    ///
    /// Default: `1`.
    #[serde(rename = "repeat", skip_serializing_if = "Option::is_none")]
    pub repeat: Option<i64>,
    /// Pause between repetitions in ms.
    ///
    /// Default: `20`.
    #[serde(rename = "intervalMs", skip_serializing_if = "Option::is_none")]
    pub interval_ms: Option<i64>,
}

impl GamingKeyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `key`.
    #[must_use]
    pub fn key(mut self, value: impl Into<String>) -> Self {
        self.key = Some(value.into());
        self
    }

    /// Sets `scanCode`.
    #[must_use]
    pub fn scan_code(mut self, value: i64) -> Self {
        self.scan_code = Some(value);
        self
    }

    /// Sets `extended`.
    #[must_use]
    pub fn extended(mut self, value: bool) -> Self {
        self.extended = Some(value);
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `holdMs`.
    #[must_use]
    pub fn hold_ms(mut self, value: i64) -> Self {
        self.hold_ms = Some(value);
        self
    }

    /// Sets `repeat`.
    #[must_use]
    pub fn repeat(mut self, value: i64) -> Self {
        self.repeat = Some(value);
        self
    }

    /// Sets `intervalMs`.
    #[must_use]
    pub fn interval_ms(mut self, value: i64) -> Self {
        self.interval_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_mouse_button`] (`gaming_mouse_button`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingMouseButtonArgs {
    /// Target window (Windows HWND or X11 id): focused and verified as foreground before any input
    /// is sent; input is refused otherwise.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive title substring of the target window, used when hwnd is absent; same focus
    /// guard.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// left, right or middle.
    #[serde(rename = "button", skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    /// down, up or click.
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Hold time for click in ms.
    ///
    /// Default: `30`.
    #[serde(rename = "holdMs", skip_serializing_if = "Option::is_none")]
    pub hold_ms: Option<i64>,
}

impl GamingMouseButtonArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `button`.
    #[must_use]
    pub fn button(mut self, value: impl Into<String>) -> Self {
        self.button = Some(value.into());
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `holdMs`.
    #[must_use]
    pub fn hold_ms(mut self, value: i64) -> Self {
        self.hold_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_mouse_delta`] (`gaming_mouse_delta`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingMouseDeltaArgs {
    /// Target window (Windows HWND or X11 id): focused and verified as foreground before any input
    /// is sent; input is refused otherwise.
    #[serde(rename = "hwnd", skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<i64>,
    /// Case-insensitive title substring of the target window, used when hwnd is absent; same focus
    /// guard.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Total horizontal counts.
    ///
    /// Default: `0`.
    #[serde(rename = "dx", skip_serializing_if = "Option::is_none")]
    pub dx: Option<i64>,
    /// Total vertical counts.
    ///
    /// Default: `0`.
    #[serde(rename = "dy", skip_serializing_if = "Option::is_none")]
    pub dy: Option<i64>,
    /// Number of input events [1, 100000].
    ///
    /// Default: `1`.
    #[serde(rename = "steps", skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
    /// Event rate [1, 8000].
    ///
    /// Default: `1000`.
    #[serde(rename = "rateHz", skip_serializing_if = "Option::is_none")]
    pub rate_hz: Option<i64>,
}

impl GamingMouseDeltaArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = Some(value);
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `dx`.
    #[must_use]
    pub fn dx(mut self, value: i64) -> Self {
        self.dx = Some(value);
        self
    }

    /// Sets `dy`.
    #[must_use]
    pub fn dy(mut self, value: i64) -> Self {
        self.dy = Some(value);
        self
    }

    /// Sets `steps`.
    #[must_use]
    pub fn steps(mut self, value: i64) -> Self {
        self.steps = Some(value);
        self
    }

    /// Sets `rateHz`.
    #[must_use]
    pub fn rate_hz(mut self, value: i64) -> Self {
        self.rate_hz = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_profile_apply`] (`gaming_profile_apply`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingProfileApplyArgs {
    /// Must be true to apply.
    ///
    /// Default: `false`.
    #[serde(rename = "confirm", skip_serializing_if = "Option::is_none")]
    pub confirm: Option<bool>,
    /// Return the command without applying.
    ///
    /// Default: `false`.
    #[serde(rename = "dryRun", skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
}

impl GamingProfileApplyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `confirm`.
    #[must_use]
    pub fn confirm(mut self, value: bool) -> Self {
        self.confirm = Some(value);
        self
    }

    /// Sets `dryRun`.
    #[must_use]
    pub fn dry_run(mut self, value: bool) -> Self {
        self.dry_run = Some(value);
        self
    }
}

/// Arguments for [`Winclean::gaming_profile_status`] (`gaming_profile_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingProfileStatusArgs {}

/// Arguments for [`Winclean::gaming_steam_launch`] (`gaming_steam_launch`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GamingSteamLaunchArgs {
    /// Steam application id.
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Game executable name used to find its window (e.g. game.exe).
    #[serde(rename = "processName", skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    /// Case-insensitive substring of the game window title.
    #[serde(rename = "windowTitle", skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    /// Window wait timeout in ms (max 600000).
    ///
    /// Default: `120000`.
    #[serde(rename = "timeoutMs", skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
    /// Bring the window to the foreground.
    ///
    /// Default: `true`.
    #[serde(rename = "focus", skip_serializing_if = "Option::is_none")]
    pub focus: Option<bool>,
}

impl GamingSteamLaunchArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `processName`.
    #[must_use]
    pub fn process_name(mut self, value: impl Into<String>) -> Self {
        self.process_name = Some(value.into());
        self
    }

    /// Sets `windowTitle`.
    #[must_use]
    pub fn window_title(mut self, value: impl Into<String>) -> Self {
        self.window_title = Some(value.into());
        self
    }

    /// Sets `timeoutMs`.
    #[must_use]
    pub fn timeout_ms(mut self, value: i64) -> Self {
        self.timeout_ms = Some(value);
        self
    }

    /// Sets `focus`.
    #[must_use]
    pub fn focus(mut self, value: bool) -> Self {
        self.focus = Some(value);
        self
    }
}

/// Arguments for [`Winclean::get_active_power_plan`] (`get_active_power_plan`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetActivePowerPlanArgs {}

/// Arguments for [`Winclean::get_clipboard_text`] (`get_clipboard_text`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetClipboardTextArgs {}

/// Arguments for [`Winclean::get_cpu_info`] (`get_cpu_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetCpuInfoArgs {}

/// Arguments for [`Winclean::get_cpu_usage`] (`get_cpu_usage`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetCpuUsageArgs {
    /// Sample window in milliseconds. Clamped to [50, 2000]. Default 250.
    ///
    /// Default: `250`.
    #[serde(rename = "intervalMs", skip_serializing_if = "Option::is_none")]
    pub interval_ms: Option<i64>,
}

impl GetCpuUsageArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `intervalMs`.
    #[must_use]
    pub fn interval_ms(mut self, value: i64) -> Self {
        self.interval_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::get_defender_status`] (`get_defender_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetDefenderStatusArgs {}

/// Arguments for [`Winclean::get_disk_info`] (`get_disk_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetDiskInfoArgs {}

/// Arguments for [`Winclean::get_file_info`] (`get_file_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetFileInfoArgs {
    /// Absolute or relative path.
    #[serde(rename = "path")]
    pub path: String,
}

impl GetFileInfoArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::get_gpu_preferences`] (`get_gpu_preferences`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetGpuPreferencesArgs {}

/// Arguments for [`Winclean::get_hags_mode`] (`get_hags_mode`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetHagsModeArgs {}

/// Arguments for [`Winclean::get_memory_info`] (`get_memory_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetMemoryInfoArgs {}

/// Arguments for [`Winclean::get_network_adapters`] (`get_network_adapters`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetNetworkAdaptersArgs {}

/// Arguments for [`Winclean::get_os_info`] (`get_os_info`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetOsInfoArgs {}

/// Arguments for [`Winclean::get_registry_value`] (`get_registry_value`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetRegistryValueArgs {
    /// Key path including hive prefix, e.g. 'HKCU:\Software\MyApp'.
    #[serde(rename = "path")]
    pub path: String,
    /// Value name. Use '(default)' for the default unnamed value.
    #[serde(rename = "name")]
    pub name: String,
}

impl GetRegistryValueArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = value.into();
        self
    }
}

/// Arguments for [`Winclean::get_system_profile`] (`get_system_profile`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GetSystemProfileArgs {}

/// Arguments for [`Winclean::golang_scan`] (`golang_scan`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GolangScanArgs {
    /// Absolute path to the target binary.
    #[serde(rename = "path")]
    pub path: String,
    /// Max symbols to extract (default 200).
    ///
    /// Default: `200`.
    #[serde(rename = "maxSymbols", skip_serializing_if = "Option::is_none")]
    pub max_symbols: Option<i64>,
}

impl GolangScanArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `maxSymbols`.
    #[must_use]
    pub fn max_symbols(mut self, value: i64) -> Self {
        self.max_symbols = Some(value);
        self
    }
}

/// Arguments for [`Winclean::keyboard_hold`] (`keyboard_hold`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct KeyboardHoldArgs {
    /// Virtual-key code (e.g. 0x57 = W, 0x10 = Shift).
    #[serde(rename = "vk")]
    pub vk: i64,
}

impl KeyboardHoldArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `vk`.
    #[must_use]
    pub fn vk(mut self, value: i64) -> Self {
        self.vk = value;
        self
    }
}

/// Arguments for [`Winclean::keyboard_release`] (`keyboard_release`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct KeyboardReleaseArgs {
    /// Virtual-key code.
    #[serde(rename = "vk")]
    pub vk: i64,
}

impl KeyboardReleaseArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `vk`.
    #[must_use]
    pub fn vk(mut self, value: i64) -> Self {
        self.vk = value;
        self
    }
}

/// Arguments for [`Winclean::keyboard_scan_code`] (`keyboard_scan_code`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct KeyboardScanCodeArgs {
    /// Scan code (decimal or 0x-prefixed hex, e.g. 0x1E for 'A').
    #[serde(rename = "scanCode")]
    pub scan_code: i64,
    /// 'down' | 'up' | 'tap'.
    ///
    /// Default: `"tap"`.
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Mark as extended (E0-prefixed) key (arrows, NumPad, RWIN, etc).
    ///
    /// Default: `false`.
    #[serde(rename = "extended", skip_serializing_if = "Option::is_none")]
    pub extended: Option<bool>,
}

impl KeyboardScanCodeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `scanCode`.
    #[must_use]
    pub fn scan_code(mut self, value: i64) -> Self {
        self.scan_code = value;
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `extended`.
    #[must_use]
    pub fn extended(mut self, value: bool) -> Self {
        self.extended = Some(value);
        self
    }
}

/// Arguments for [`Winclean::kill_process`] (`kill_process`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct KillProcessArgs {
    /// Process ID. Takes precedence over name when set.
    ///
    /// Default: `null`.
    #[serde(rename = "pid", skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    /// Process name (no .exe extension required). Used when pid is null.
    ///
    /// Default: `null`.
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Force terminate (default true).
    ///
    /// Default: `true`.
    #[serde(rename = "force", skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

impl KillProcessArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = Some(value);
        self
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }

    /// Sets `force`.
    #[must_use]
    pub fn force(mut self, value: bool) -> Self {
        self.force = Some(value);
        self
    }
}

/// Arguments for [`Winclean::launch_app`] (`launch_app`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct LaunchAppArgs {
    /// Path, executable name or shell URI to launch.
    #[serde(rename = "target")]
    pub target: String,
    /// Optional command-line arguments (space-separated, shell-escaped).
    ///
    /// Default: `null`.
    #[serde(rename = "args", skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    /// Working directory for the new process.
    ///
    /// Default: `null`.
    #[serde(rename = "workingDirectory", skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
}

impl LaunchAppArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `target`.
    #[must_use]
    pub fn target(mut self, value: impl Into<String>) -> Self {
        self.target = value.into();
        self
    }

    /// Sets `args`.
    #[must_use]
    pub fn args(mut self, value: impl Into<String>) -> Self {
        self.args = Some(value.into());
        self
    }

    /// Sets `workingDirectory`.
    #[must_use]
    pub fn working_directory(mut self, value: impl Into<String>) -> Self {
        self.working_directory = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::list_directory`] (`list_directory`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListDirectoryArgs {
    /// Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
    #[serde(rename = "path")]
    pub path: String,
    /// Glob pattern filter, e.g. '*.txt'. Empty = all entries.
    ///
    /// Default: `null`.
    #[serde(rename = "pattern", skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// Recurse into subdirectories.
    ///
    /// Default: `false`.
    #[serde(rename = "recursive", skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
    /// Include hidden / system entries.
    ///
    /// Default: `false`.
    #[serde(rename = "showHidden", skip_serializing_if = "Option::is_none")]
    pub show_hidden: Option<bool>,
    /// Optional ASCII case-insensitive glob patterns matching entry names to omit. Matching
    /// directories are not returned or traversed.
    ///
    /// Default: `[]`.
    #[serde(rename = "exclude", skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
}

impl ListDirectoryArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `pattern`.
    #[must_use]
    pub fn pattern(mut self, value: impl Into<String>) -> Self {
        self.pattern = Some(value.into());
        self
    }

    /// Sets `recursive`.
    #[must_use]
    pub fn recursive(mut self, value: bool) -> Self {
        self.recursive = Some(value);
        self
    }

    /// Sets `showHidden`.
    #[must_use]
    pub fn show_hidden(mut self, value: bool) -> Self {
        self.show_hidden = Some(value);
        self
    }

    /// Sets `exclude`.
    #[must_use]
    pub fn exclude(mut self, value: Vec<String>) -> Self {
        self.exclude = Some(value);
        self
    }
}

/// Arguments for [`Winclean::list_listening_ports`] (`list_listening_ports`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListListeningPortsArgs {}

/// Arguments for [`Winclean::list_power_plans`] (`list_power_plans`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListPowerPlansArgs {}

/// Arguments for [`Winclean::list_processes`] (`list_processes`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListProcessesArgs {
    /// Substring filter on process name (case-insensitive). Empty = no filter.
    ///
    /// Default: `null`.
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Sort key: 'memory', 'private', 'cpu', 'threads', 'handles' or 'name'.
    ///
    /// Default: `"memory"`.
    #[serde(rename = "sortBy", skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    /// Maximum number of results to return.
    ///
    /// Default: `20`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl ListProcessesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }

    /// Sets `sortBy`.
    #[must_use]
    pub fn sort_by(mut self, value: impl Into<String>) -> Self {
        self.sort_by = Some(value.into());
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::list_registry_key`] (`list_registry_key`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListRegistryKeyArgs {
    /// Key path including hive prefix.
    #[serde(rename = "path")]
    pub path: String,
}

impl ListRegistryKeyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::list_scheduled_tasks`] (`list_scheduled_tasks`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListScheduledTasksArgs {
    /// Task folder, default '\'. Use '\Microsoft\Windows\Defender' for sub-folders.
    ///
    /// Default: `"\\"`.
    #[serde(rename = "folder", skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

impl ListScheduledTasksArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `folder`.
    #[must_use]
    pub fn folder(mut self, value: impl Into<String>) -> Self {
        self.folder = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::list_services`] (`list_services`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListServicesArgs {
    /// Substring filter on service name (case-insensitive). Empty = no filter.
    ///
    /// Default: `null`.
    #[serde(rename = "nameFilter", skip_serializing_if = "Option::is_none")]
    pub name_filter: Option<String>,
    /// Status filter: Running, Stopped, Paused, StartPending, StopPending. Empty = any.
    ///
    /// Default: `null`.
    #[serde(rename = "statusFilter", skip_serializing_if = "Option::is_none")]
    pub status_filter: Option<String>,
}

impl ListServicesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `nameFilter`.
    #[must_use]
    pub fn name_filter(mut self, value: impl Into<String>) -> Self {
        self.name_filter = Some(value.into());
        self
    }

    /// Sets `statusFilter`.
    #[must_use]
    pub fn status_filter(mut self, value: impl Into<String>) -> Self {
        self.status_filter = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::list_tcp_connections`] (`list_tcp_connections`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListTcpConnectionsArgs {
    /// Optional state filter (case-insensitive). Empty = all states.
    ///
    /// Default: `null`.
    #[serde(rename = "stateFilter", skip_serializing_if = "Option::is_none")]
    pub state_filter: Option<String>,
}

impl ListTcpConnectionsArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `stateFilter`.
    #[must_use]
    pub fn state_filter(mut self, value: impl Into<String>) -> Self {
        self.state_filter = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::list_windows`] (`list_windows`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListWindowsArgs {}

/// Arguments for [`Winclean::mem_allocate`] (`mem_allocate`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemAllocateArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Size in bytes to commit.
    #[serde(rename = "size")]
    pub size: i64,
    /// Protection flags: rw | rwx | rx.
    ///
    /// Default: `"rw"`.
    #[serde(rename = "protect", skip_serializing_if = "Option::is_none")]
    pub protect: Option<String>,
}

impl MemAllocateArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `size`.
    #[must_use]
    pub fn size(mut self, value: i64) -> Self {
        self.size = value;
        self
    }

    /// Sets `protect`.
    #[must_use]
    pub fn protect(mut self, value: impl Into<String>) -> Self {
        self.protect = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::mem_dump_region`] (`mem_dump_region`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemDumpRegionArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Start address (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Bytes to read. Capped at 4 MiB.
    #[serde(rename = "size")]
    pub size: i64,
    /// Output file path. Empty = auto in %TEMP%.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Suspend the process for the duration of the read.
    ///
    /// Default: `false`.
    #[serde(rename = "suspend", skip_serializing_if = "Option::is_none")]
    pub suspend: Option<bool>,
}

impl MemDumpRegionArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `size`.
    #[must_use]
    pub fn size(mut self, value: i64) -> Self {
        self.size = value;
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }

    /// Sets `suspend`.
    #[must_use]
    pub fn suspend(mut self, value: bool) -> Self {
        self.suspend = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mem_enable_debug_privilege`] (`mem_enable_debug_privilege`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemEnableDebugPrivilegeArgs {}

/// Arguments for [`Winclean::mem_free`] (`mem_free`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemFreeArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Base address returned by MemAllocate (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemFreeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_get_module_base`] (`mem_get_module_base`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemGetModuleBaseArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Module name to find (e.g. 'kernel32.dll'). Case-insensitive.
    #[serde(rename = "moduleName")]
    pub module_name: String,
}

impl MemGetModuleBaseArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `moduleName`.
    #[must_use]
    pub fn module_name(mut self, value: impl Into<String>) -> Self {
        self.module_name = value.into();
        self
    }
}

/// Arguments for [`Winclean::mem_list_modules`] (`mem_list_modules`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemListModulesArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
}

impl MemListModulesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }
}

/// Arguments for [`Winclean::mem_list_processes`] (`mem_list_processes`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemListProcessesArgs {
    /// Substring filter on process name (case-insensitive). Empty = all.
    ///
    /// Default: `""`.
    #[serde(rename = "nameFilter", skip_serializing_if = "Option::is_none")]
    pub name_filter: Option<String>,
}

impl MemListProcessesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `nameFilter`.
    #[must_use]
    pub fn name_filter(mut self, value: impl Into<String>) -> Self {
        self.name_filter = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::mem_protect`] (`mem_protect`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemProtectArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Base address.
    #[serde(rename = "address")]
    pub address: i64,
    /// Region size in bytes.
    #[serde(rename = "size")]
    pub size: i64,
    /// New protection: rw | rwx | rx | ro | noaccess.
    #[serde(rename = "protect")]
    pub protect: String,
}

impl MemProtectArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `size`.
    #[must_use]
    pub fn size(mut self, value: i64) -> Self {
        self.size = value;
        self
    }

    /// Sets `protect`.
    #[must_use]
    pub fn protect(mut self, value: impl Into<String>) -> Self {
        self.protect = value.into();
        self
    }
}

/// Arguments for [`Winclean::mem_query_region`] (`mem_query_region`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemQueryRegionArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Any address within the region to query (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemQueryRegionArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_bytes`] (`mem_read_bytes`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadBytesArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Number of bytes to read. Capped at 65536.
    #[serde(rename = "length")]
    pub length: i64,
}

impl MemReadBytesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `length`.
    #[must_use]
    pub fn length(mut self, value: i64) -> Self {
        self.length = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_c_string`] (`mem_read_c_string`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadCStringArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Maximum bytes to read before stopping. Default 256, capped at 4096.
    ///
    /// Default: `256`.
    #[serde(rename = "maxLength", skip_serializing_if = "Option::is_none")]
    pub max_length: Option<i64>,
}

impl MemReadCStringArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `maxLength`.
    #[must_use]
    pub fn max_length(mut self, value: i64) -> Self {
        self.max_length = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mem_read_double`] (`mem_read_double`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadDoubleArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemReadDoubleArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_float`] (`mem_read_float`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadFloatArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemReadFloatArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_int32`] (`mem_read_int32`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadInt32Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemReadInt32Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_int64`] (`mem_read_int64`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadInt64Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
}

impl MemReadInt64Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }
}

/// Arguments for [`Winclean::mem_read_utf16`] (`mem_read_utf16`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemReadUtf16Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to read from (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Maximum characters to read. Default 256, capped at 2048.
    ///
    /// Default: `256`.
    #[serde(rename = "maxChars", skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<i64>,
}

impl MemReadUtf16Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `maxChars`.
    #[must_use]
    pub fn max_chars(mut self, value: i64) -> Self {
        self.max_chars = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mem_resume_process`] (`mem_resume_process`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemResumeProcessArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
}

impl MemResumeProcessArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }
}

/// Arguments for [`Winclean::mem_scan_aob`] (`mem_scan_aob`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemScanAobArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Module name to scan within (e.g. 'engine.dll').
    #[serde(rename = "moduleName")]
    pub module_name: String,
    /// IDA-style byte pattern with '??' wildcards (e.g. '48 8B 05 ?? ?? ??').
    #[serde(rename = "pattern")]
    pub pattern: String,
    /// Maximum number of matches to return. Default 10, capped at 100.
    ///
    /// Default: `10`.
    #[serde(rename = "maxHits", skip_serializing_if = "Option::is_none")]
    pub max_hits: Option<i64>,
}

impl MemScanAobArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `moduleName`.
    #[must_use]
    pub fn module_name(mut self, value: impl Into<String>) -> Self {
        self.module_name = value.into();
        self
    }

    /// Sets `pattern`.
    #[must_use]
    pub fn pattern(mut self, value: impl Into<String>) -> Self {
        self.pattern = value.into();
        self
    }

    /// Sets `maxHits`.
    #[must_use]
    pub fn max_hits(mut self, value: i64) -> Self {
        self.max_hits = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mem_scan_value_int32`] (`mem_scan_value_int32`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemScanValueInt32Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Value to search for.
    #[serde(rename = "value")]
    pub value: i64,
    /// Maximum hits to return (default 200, capped at 5000).
    ///
    /// Default: `200`.
    #[serde(rename = "maxHits", skip_serializing_if = "Option::is_none")]
    pub max_hits: Option<i64>,
}

impl MemScanValueInt32Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: i64) -> Self {
        self.value = value;
        self
    }

    /// Sets `maxHits`.
    #[must_use]
    pub fn max_hits(mut self, value: i64) -> Self {
        self.max_hits = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mem_suspend_process`] (`mem_suspend_process`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemSuspendProcessArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
}

impl MemSuspendProcessArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }
}

/// Arguments for [`Winclean::mem_write_bytes`] (`mem_write_bytes`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemWriteBytesArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address to write to (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Hex string of bytes to write (e.g. 'deadbeef' or 'de ad be ef').
    #[serde(rename = "hex")]
    pub hex: String,
}

impl MemWriteBytesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `hex`.
    #[must_use]
    pub fn hex(mut self, value: impl Into<String>) -> Self {
        self.hex = value.into();
        self
    }
}

/// Arguments for [`Winclean::mem_write_double`] (`mem_write_double`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemWriteDoubleArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Value to write.
    #[serde(rename = "value")]
    pub value: f64,
}

impl MemWriteDoubleArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: f64) -> Self {
        self.value = value;
        self
    }
}

/// Arguments for [`Winclean::mem_write_float`] (`mem_write_float`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemWriteFloatArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Value to write.
    #[serde(rename = "value")]
    pub value: f64,
}

impl MemWriteFloatArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: f64) -> Self {
        self.value = value;
        self
    }
}

/// Arguments for [`Winclean::mem_write_int32`] (`mem_write_int32`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemWriteInt32Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Value to write.
    #[serde(rename = "value")]
    pub value: i64,
}

impl MemWriteInt32Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: i64) -> Self {
        self.value = value;
        self
    }
}

/// Arguments for [`Winclean::mem_write_int64`] (`mem_write_int64`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MemWriteInt64Args {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Virtual address (decimal or 0x-prefixed hex).
    #[serde(rename = "address")]
    pub address: i64,
    /// Value to write.
    #[serde(rename = "value")]
    pub value: i64,
}

impl MemWriteInt64Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `address`.
    #[must_use]
    pub fn address(mut self, value: i64) -> Self {
        self.address = value;
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: i64) -> Self {
        self.value = value;
        self
    }
}

/// Arguments for [`Winclean::mouse_drag_to`] (`mouse_drag_to`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MouseDragToArgs {
    /// Start X (screen pixels).
    #[serde(rename = "x1")]
    pub x1: i64,
    /// Start Y (screen pixels).
    #[serde(rename = "y1")]
    pub y1: i64,
    /// End X (screen pixels).
    #[serde(rename = "x2")]
    pub x2: i64,
    /// End Y (screen pixels).
    #[serde(rename = "y2")]
    pub y2: i64,
    /// Mouse button: left | right | middle.
    ///
    /// Default: `"left"`.
    #[serde(rename = "button", skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    /// Intermediate move events (8..200).
    ///
    /// Default: `20`.
    #[serde(rename = "steps", skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
    /// Total drag duration in ms (clamped 50..5000).
    ///
    /// Default: `250`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

impl MouseDragToArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `x1`.
    #[must_use]
    pub fn x1(mut self, value: i64) -> Self {
        self.x1 = value;
        self
    }

    /// Sets `y1`.
    #[must_use]
    pub fn y1(mut self, value: i64) -> Self {
        self.y1 = value;
        self
    }

    /// Sets `x2`.
    #[must_use]
    pub fn x2(mut self, value: i64) -> Self {
        self.x2 = value;
        self
    }

    /// Sets `y2`.
    #[must_use]
    pub fn y2(mut self, value: i64) -> Self {
        self.y2 = value;
        self
    }

    /// Sets `button`.
    #[must_use]
    pub fn button(mut self, value: impl Into<String>) -> Self {
        self.button = Some(value.into());
        self
    }

    /// Sets `steps`.
    #[must_use]
    pub fn steps(mut self, value: i64) -> Self {
        self.steps = Some(value);
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::mouse_move_smooth`] (`mouse_move_smooth`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MouseMoveSmoothArgs {
    /// Target X (screen pixels).
    #[serde(rename = "x")]
    pub x: i64,
    /// Target Y (screen pixels).
    #[serde(rename = "y")]
    pub y: i64,
    /// Intermediate move events (4..200).
    ///
    /// Default: `30`.
    #[serde(rename = "steps", skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
    /// Total duration in ms (clamped 30..3000).
    ///
    /// Default: `200`.
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

impl MouseMoveSmoothArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `steps`.
    #[must_use]
    pub fn steps(mut self, value: i64) -> Self {
        self.steps = Some(value);
        self
    }

    /// Sets `durationMs`.
    #[must_use]
    pub fn duration_ms(mut self, value: i64) -> Self {
        self.duration_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::move_`] (`move`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MoveArgs {
    /// X coordinate in screen pixels.
    #[serde(rename = "x")]
    pub x: i64,
    /// Y coordinate in screen pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Left-button drag from current position to (x,y) when true; cursor move (hover) otherwise.
    ///
    /// Default: `false`.
    #[serde(rename = "drag", skip_serializing_if = "Option::is_none")]
    pub drag: Option<bool>,
}

impl MoveArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `drag`.
    #[must_use]
    pub fn drag(mut self, value: bool) -> Self {
        self.drag = Some(value);
        self
    }
}

/// Arguments for [`Winclean::move_path`] (`move_path`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MovePathArgs {
    /// Source path (absolute or relative to Desktop).
    #[serde(rename = "path")]
    pub path: String,
    /// Destination path (absolute or relative to Desktop).
    #[serde(rename = "destination")]
    pub destination: String,
    /// Overwrite existing destination.
    ///
    /// Default: `false`.
    #[serde(rename = "overwrite", skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
}

impl MovePathArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `destination`.
    #[must_use]
    pub fn destination(mut self, value: impl Into<String>) -> Self {
        self.destination = value.into();
        self
    }

    /// Sets `overwrite`.
    #[must_use]
    pub fn overwrite(mut self, value: bool) -> Self {
        self.overwrite = Some(value);
        self
    }
}

/// Arguments for [`Winclean::multi_edit`] (`multi_edit`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MultiEditArgs {
    /// Comma-separated UIA element names to type into.
    #[serde(rename = "labels")]
    pub labels: String,
    /// Text payload (applied identically to each target).
    #[serde(rename = "text")]
    pub text: String,
}

impl MultiEditArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `labels`.
    #[must_use]
    pub fn labels(mut self, value: impl Into<String>) -> Self {
        self.labels = value.into();
        self
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }
}

/// Arguments for [`Winclean::multi_select`] (`multi_select`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct MultiSelectArgs {
    /// Comma-separated UIA element names to click in order.
    #[serde(rename = "labels")]
    pub labels: String,
}

impl MultiSelectArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `labels`.
    #[must_use]
    pub fn labels(mut self, value: impl Into<String>) -> Self {
        self.labels = value.into();
        self
    }
}

/// Arguments for [`Winclean::perf_dwm_flush`] (`perf_dwm_flush`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PerfDwmFlushArgs {}

/// Arguments for [`Winclean::perf_empty_working_sets`] (`perf_empty_working_sets`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PerfEmptyWorkingSetsArgs {}

/// Arguments for [`Winclean::perf_memory_status`] (`perf_memory_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PerfMemoryStatusArgs {}

/// Arguments for [`Winclean::perf_purge_standby_list`] (`perf_purge_standby_list`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PerfPurgeStandbyListArgs {
    /// Purge low-priority only (faster, safer) instead of the full standby list.
    ///
    /// Default: `false`.
    #[serde(rename = "lowPriorityOnly", skip_serializing_if = "Option::is_none")]
    pub low_priority_only: Option<bool>,
}

impl PerfPurgeStandbyListArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `lowPriorityOnly`.
    #[must_use]
    pub fn low_priority_only(mut self, value: bool) -> Self {
        self.low_priority_only = Some(value);
        self
    }
}

/// Arguments for [`Winclean::perf_set_eco_mode`] (`perf_set_eco_mode`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PerfSetEcoModeArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// 'on' (eco), 'off' (max perf), 'default' (clear overrides).
    ///
    /// Default: `"on"`.
    #[serde(rename = "mode", skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

impl PerfSetEcoModeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `mode`.
    #[must_use]
    pub fn mode(mut self, value: impl Into<String>) -> Self {
        self.mode = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::power_shell`] (`power_shell`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct PowerShellArgs {
    /// PowerShell command or script to execute.
    #[serde(rename = "command")]
    pub command: String,
    /// Timeout in seconds before the process is killed (default 30, max 600).
    ///
    /// Default: `30`.
    #[serde(rename = "timeoutSeconds", skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<i64>,
}

impl PowerShellArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `command`.
    #[must_use]
    pub fn command(mut self, value: impl Into<String>) -> Self {
        self.command = value.into();
        self
    }

    /// Sets `timeoutSeconds`.
    #[must_use]
    pub fn timeout_seconds(mut self, value: i64) -> Self {
        self.timeout_seconds = Some(value);
        self
    }
}

/// Arguments for [`Winclean::query_event_log`] (`query_event_log`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct QueryEventLogArgs {
    /// Event log channel name.
    #[serde(rename = "channel")]
    pub channel: String,
    /// Maximum number of events to return (1..1000).
    ///
    /// Default: `50`.
    #[serde(rename = "maxEvents", skip_serializing_if = "Option::is_none")]
    pub max_events: Option<i64>,
    /// Optional XPath filter, e.g. "*[System[Level=2]]".
    ///
    /// Default: `null`.
    #[serde(rename = "xpathFilter", skip_serializing_if = "Option::is_none")]
    pub xpath_filter: Option<String>,
}

impl QueryEventLogArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `channel`.
    #[must_use]
    pub fn channel(mut self, value: impl Into<String>) -> Self {
        self.channel = value.into();
        self
    }

    /// Sets `maxEvents`.
    #[must_use]
    pub fn max_events(mut self, value: i64) -> Self {
        self.max_events = Some(value);
        self
    }

    /// Sets `xpathFilter`.
    #[must_use]
    pub fn xpath_filter(mut self, value: impl Into<String>) -> Self {
        self.xpath_filter = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::read_file`] (`read_file`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ReadFileArgs {
    /// Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
    #[serde(rename = "path")]
    pub path: String,
    /// Line offset (0-based). Default 0.
    ///
    /// Default: `0`.
    #[serde(rename = "offset", skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    /// Maximum number of lines to read. 0 = no limit.
    ///
    /// Default: `0`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl ReadFileArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `offset`.
    #[must_use]
    pub fn offset(mut self, value: i64) -> Self {
        self.offset = Some(value);
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::resize_window`] (`resize_window`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ResizeWindowArgs {
    /// Substring to match against the window title.
    #[serde(rename = "titleSubstring")]
    pub title_substring: String,
    /// X coordinate (screen pixels).
    #[serde(rename = "x")]
    pub x: i64,
    /// Y coordinate (screen pixels).
    #[serde(rename = "y")]
    pub y: i64,
    /// New width (0 = keep current).
    ///
    /// Default: `0`.
    #[serde(rename = "width", skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    /// New height (0 = keep current).
    ///
    /// Default: `0`.
    #[serde(rename = "height", skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
}

impl ResizeWindowArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `titleSubstring`.
    #[must_use]
    pub fn title_substring(mut self, value: impl Into<String>) -> Self {
        self.title_substring = value.into();
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `width`.
    #[must_use]
    pub fn width(mut self, value: i64) -> Self {
        self.width = Some(value);
        self
    }

    /// Sets `height`.
    #[must_use]
    pub fn height(mut self, value: i64) -> Self {
        self.height = Some(value);
        self
    }
}

/// Arguments for [`Winclean::restart_service`] (`restart_service`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct RestartServiceArgs {
    /// Service short name.
    #[serde(rename = "name")]
    pub name: String,
}

impl RestartServiceArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = value.into();
        self
    }
}

/// Arguments for [`Winclean::run_scheduled_task`] (`run_scheduled_task`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct RunScheduledTaskArgs {
    /// Absolute task path.
    #[serde(rename = "path")]
    pub path: String,
}

impl RunScheduledTaskArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::scrape`] (`scrape`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ScrapeArgs {
    /// Absolute URL (http:// or https://). Other schemes are rejected.
    #[serde(rename = "url")]
    pub url: String,
}

impl ScrapeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `url`.
    #[must_use]
    pub fn url(mut self, value: impl Into<String>) -> Self {
        self.url = value.into();
        self
    }
}

/// Arguments for [`Winclean::screenshot`] (`screenshot`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ScreenshotArgs {
    /// Output file path. If null, a timestamped file is written to %TEMP%.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
}

impl ScreenshotArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::scroll`] (`scroll`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ScrollArgs {
    /// X coordinate in screen pixels (cursor is moved here before scrolling).
    #[serde(rename = "x")]
    pub x: i64,
    /// Y coordinate in screen pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Scroll axis: vertical | horizontal.
    ///
    /// Default: `"vertical"`.
    #[serde(rename = "axis", skip_serializing_if = "Option::is_none")]
    pub axis: Option<String>,
    /// Scroll direction: up | down | left | right.
    ///
    /// Default: `"down"`.
    #[serde(rename = "direction", skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// Number of wheel notches.
    ///
    /// Default: `1`.
    #[serde(rename = "wheelTimes", skip_serializing_if = "Option::is_none")]
    pub wheel_times: Option<i64>,
}

impl ScrollArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `axis`.
    #[must_use]
    pub fn axis(mut self, value: impl Into<String>) -> Self {
        self.axis = Some(value.into());
        self
    }

    /// Sets `direction`.
    #[must_use]
    pub fn direction(mut self, value: impl Into<String>) -> Self {
        self.direction = Some(value.into());
        self
    }

    /// Sets `wheelTimes`.
    #[must_use]
    pub fn wheel_times(mut self, value: i64) -> Self {
        self.wheel_times = Some(value);
        self
    }
}

/// Arguments for [`Winclean::search_files`] (`search_files`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SearchFilesArgs {
    /// Root path (absolute or relative to Desktop).
    #[serde(rename = "path")]
    pub path: String,
    /// Glob pattern, e.g. '*.log'.
    #[serde(rename = "pattern")]
    pub pattern: String,
    /// Recurse into subdirectories.
    ///
    /// Default: `true`.
    #[serde(rename = "recursive", skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
    /// Basename glob patterns to omit; matching directories are not traversed.
    #[serde(rename = "exclude", skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
}

impl SearchFilesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `pattern`.
    #[must_use]
    pub fn pattern(mut self, value: impl Into<String>) -> Self {
        self.pattern = value.into();
        self
    }

    /// Sets `recursive`.
    #[must_use]
    pub fn recursive(mut self, value: bool) -> Self {
        self.recursive = Some(value);
        self
    }

    /// Sets `exclude`.
    #[must_use]
    pub fn exclude(mut self, value: Vec<String>) -> Self {
        self.exclude = Some(value);
        self
    }
}

/// Arguments for [`Winclean::search_windows`] (`search_windows`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SearchWindowsArgs {
    /// Les mots clés de la recherche (nom de fichier ou contenu texte).
    #[serde(rename = "query")]
    pub query: String,
}

impl SearchWindowsArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `query`.
    #[must_use]
    pub fn query(mut self, value: impl Into<String>) -> Self {
        self.query = value.into();
        self
    }
}

/// Arguments for [`Winclean::send_notification`] (`send_notification`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SendNotificationArgs {
    /// Notification title (heading).
    #[serde(rename = "title")]
    pub title: String,
    /// Notification body message.
    #[serde(rename = "message")]
    pub message: String,
    /// AUMID for branded toasts. Ignored in this Win32 balloon implementation.
    ///
    /// Default: `null`.
    #[serde(rename = "appId", skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
}

impl SendNotificationArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = value.into();
        self
    }

    /// Sets `message`.
    #[must_use]
    pub fn message(mut self, value: impl Into<String>) -> Self {
        self.message = value.into();
        self
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: impl Into<String>) -> Self {
        self.app_id = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::set_active_power_plan`] (`set_active_power_plan`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetActivePowerPlanArgs {
    /// GUID of the power plan to activate (with or without braces).
    #[serde(rename = "guid")]
    pub guid: String,
}

impl SetActivePowerPlanArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `guid`.
    #[must_use]
    pub fn guid(mut self, value: impl Into<String>) -> Self {
        self.guid = value.into();
        self
    }
}

/// Arguments for [`Winclean::set_clipboard_text`] (`set_clipboard_text`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetClipboardTextArgs {
    /// Text to copy to the clipboard.
    #[serde(rename = "text")]
    pub text: String,
}

impl SetClipboardTextArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }
}

/// Arguments for [`Winclean::set_gpu_preference`] (`set_gpu_preference`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetGpuPreferenceArgs {
    /// Absolute path to the executable.
    #[serde(rename = "exePath")]
    pub exe_path: String,
    /// 'SystemDefault' | 'PowerSaving' | 'HighPerformance'
    #[serde(rename = "preference")]
    pub preference: String,
}

impl SetGpuPreferenceArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `exePath`.
    #[must_use]
    pub fn exe_path(mut self, value: impl Into<String>) -> Self {
        self.exe_path = value.into();
        self
    }

    /// Sets `preference`.
    #[must_use]
    pub fn preference(mut self, value: impl Into<String>) -> Self {
        self.preference = value.into();
        self
    }
}

/// Arguments for [`Winclean::set_hags_mode`] (`set_hags_mode`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetHagsModeArgs {
    /// HwSchMode value: 0, 1, or 2.
    #[serde(rename = "mode")]
    pub mode: i64,
}

impl SetHagsModeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `mode`.
    #[must_use]
    pub fn mode(mut self, value: i64) -> Self {
        self.mode = value;
        self
    }
}

/// Arguments for [`Winclean::set_process_affinity`] (`set_process_affinity`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetProcessAffinityArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Affinity bitmask. Bit N = run on logical CPU N. 0 resets to system mask.
    #[serde(rename = "mask")]
    pub mask: i64,
}

impl SetProcessAffinityArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `mask`.
    #[must_use]
    pub fn mask(mut self, value: i64) -> Self {
        self.mask = value;
        self
    }
}

/// Arguments for [`Winclean::set_process_priority`] (`set_process_priority`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetProcessPriorityArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
    /// Priority class name (case-insensitive).
    #[serde(rename = "priority")]
    pub priority: String,
}

impl SetProcessPriorityArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }

    /// Sets `priority`.
    #[must_use]
    pub fn priority(mut self, value: impl Into<String>) -> Self {
        self.priority = value.into();
        self
    }
}

/// Arguments for [`Winclean::set_registry_value`] (`set_registry_value`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SetRegistryValueArgs {
    /// Key path including hive prefix, e.g. 'HKCU:\Software\MyApp'.
    #[serde(rename = "path")]
    pub path: String,
    /// Value name. Use '(default)' for the default unnamed value.
    #[serde(rename = "name")]
    pub name: String,
    /// Value contents as string (parsed per type).
    #[serde(rename = "value")]
    pub value: String,
    /// Type: String, ExpandString, DWord, QWord, MultiString.
    ///
    /// Default: `"String"`.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
}

impl SetRegistryValueArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = value.into();
        self
    }

    /// Sets `value`.
    #[must_use]
    pub fn value(mut self, value: impl Into<String>) -> Self {
        self.value = value.into();
        self
    }

    /// Sets `type`.
    #[must_use]
    pub fn type_(mut self, value: impl Into<String>) -> Self {
        self.type_ = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::shortcut`] (`shortcut`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShortcutArgs {
    /// Shortcut string, e.g. 'ctrl+shift+esc'.
    #[serde(rename = "shortcut")]
    pub shortcut: String,
}

impl ShortcutArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `shortcut`.
    #[must_use]
    pub fn shortcut(mut self, value: impl Into<String>) -> Self {
        self.shortcut = value.into();
        self
    }
}

/// Arguments for [`Winclean::snapshot`] (`snapshot`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SnapshotArgs {
    /// Optional process name filter (reserved for compatibility; use windowHandle for exact
    /// targeting).
    ///
    /// Default: `null`.
    #[serde(rename = "processName", skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    /// Maximum number of UI elements to return (1..1000).
    ///
    /// Default: `200`.
    #[serde(rename = "maxElements", skip_serializing_if = "Option::is_none")]
    pub max_elements: Option<i64>,
    /// Exact HWND to inspect (0 = current foreground window).
    ///
    /// Default: `0`.
    #[serde(rename = "windowHandle", skip_serializing_if = "Option::is_none")]
    pub window_handle: Option<i64>,
}

impl SnapshotArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `processName`.
    #[must_use]
    pub fn process_name(mut self, value: impl Into<String>) -> Self {
        self.process_name = Some(value.into());
        self
    }

    /// Sets `maxElements`.
    #[must_use]
    pub fn max_elements(mut self, value: i64) -> Self {
        self.max_elements = Some(value);
        self
    }

    /// Sets `windowHandle`.
    #[must_use]
    pub fn window_handle(mut self, value: i64) -> Self {
        self.window_handle = Some(value);
        self
    }
}

/// Arguments for [`Winclean::start_service`] (`start_service`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct StartServiceArgs {
    /// Service short name (e.g. 'wuauserv', 'BITS').
    #[serde(rename = "name")]
    pub name: String,
}

impl StartServiceArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = value.into();
        self
    }
}

/// Arguments for [`Winclean::steam_get_game`] (`steam_get_game`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamGetGameArgs {
    /// Steam AppID (integer).
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamGetGameArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_get_game_status`] (`steam_get_game_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamGetGameStatusArgs {
    /// Steam AppID (integer).
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Override executable name (no .exe required). Defaults to install_dir + .exe.
    ///
    /// Default: `null`.
    #[serde(rename = "executableName", skip_serializing_if = "Option::is_none")]
    pub executable_name: Option<String>,
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamGetGameStatusArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `executableName`.
    #[must_use]
    pub fn executable_name(mut self, value: impl Into<String>) -> Self {
        self.executable_name = Some(value.into());
        self
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_kill_game`] (`steam_kill_game`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamKillGameArgs {
    /// Steam AppID (informational only).
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Executable name to kill (no .exe required).
    #[serde(rename = "executableName")]
    pub executable_name: String,
}

impl SteamKillGameArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `executableName`.
    #[must_use]
    pub fn executable_name(mut self, value: impl Into<String>) -> Self {
        self.executable_name = value.into();
        self
    }
}

/// Arguments for [`Winclean::steam_launch_and_wait`] (`steam_launch_and_wait`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamLaunchAndWaitArgs {
    /// Steam AppID (integer).
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Executable name to watch for (no .exe required).
    #[serde(rename = "executableName")]
    pub executable_name: String,
    /// Maximum wait in milliseconds. Default 60000.
    ///
    /// Default: `60000`.
    #[serde(rename = "timeoutMs", skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
}

impl SteamLaunchAndWaitArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `executableName`.
    #[must_use]
    pub fn executable_name(mut self, value: impl Into<String>) -> Self {
        self.executable_name = value.into();
        self
    }

    /// Sets `timeoutMs`.
    #[must_use]
    pub fn timeout_ms(mut self, value: i64) -> Self {
        self.timeout_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::steam_launch_by_app_id`] (`steam_launch_by_app_id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamLaunchByAppIdArgs {
    /// Steam AppID (integer).
    #[serde(rename = "appId")]
    pub app_id: i64,
}

impl SteamLaunchByAppIdArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }
}

/// Arguments for [`Winclean::steam_list_games`] (`steam_list_games`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamListGamesArgs {
    /// Include games whose install directory is absent (files_present=0). Default false.
    ///
    /// Default: `false`.
    #[serde(rename = "includeMissing", skip_serializing_if = "Option::is_none")]
    pub include_missing: Option<bool>,
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamListGamesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `includeMissing`.
    #[must_use]
    pub fn include_missing(mut self, value: bool) -> Self {
        self.include_missing = Some(value);
        self
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_list_libraries`] (`steam_list_libraries`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamListLibrariesArgs {
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamListLibrariesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_open_uri`] (`steam_open_uri`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamOpenUriArgs {
    /// A steam:// URI, e.g. steam://store/2799860, steam://nav/console, steam://browsemedia.
    #[serde(rename = "steamUri")]
    pub steam_uri: String,
}

impl SteamOpenUriArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `steamUri`.
    #[must_use]
    pub fn steam_uri(mut self, value: impl Into<String>) -> Self {
        self.steam_uri = value.into();
        self
    }
}

/// Arguments for [`Winclean::steam_scan_summary`] (`steam_scan_summary`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamScanSummaryArgs {
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamScanSummaryArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_vault_status`] (`steam_vault_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamVaultStatusArgs {
    /// Steam client root; defaults to the registry SteamPath or the standard install locations.
    #[serde(rename = "steamRoot", skip_serializing_if = "Option::is_none")]
    pub steam_root: Option<String>,
}

impl SteamVaultStatusArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `steamRoot`.
    #[must_use]
    pub fn steam_root(mut self, value: impl Into<String>) -> Self {
        self.steam_root = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::steam_wait_for_launch`] (`steam_wait_for_launch`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SteamWaitForLaunchArgs {
    /// Steam AppID (informational only, used in the response).
    #[serde(rename = "appId")]
    pub app_id: i64,
    /// Executable name to watch for (no .exe required).
    #[serde(rename = "executableName")]
    pub executable_name: String,
    /// Maximum wait in milliseconds. Default 60000.
    ///
    /// Default: `60000`.
    #[serde(rename = "timeoutMs", skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
    /// Poll interval in milliseconds. Default 500.
    ///
    /// Default: `500`.
    #[serde(rename = "pollMs", skip_serializing_if = "Option::is_none")]
    pub poll_ms: Option<i64>,
}

impl SteamWaitForLaunchArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `appId`.
    #[must_use]
    pub fn app_id(mut self, value: i64) -> Self {
        self.app_id = value;
        self
    }

    /// Sets `executableName`.
    #[must_use]
    pub fn executable_name(mut self, value: impl Into<String>) -> Self {
        self.executable_name = value.into();
        self
    }

    /// Sets `timeoutMs`.
    #[must_use]
    pub fn timeout_ms(mut self, value: i64) -> Self {
        self.timeout_ms = Some(value);
        self
    }

    /// Sets `pollMs`.
    #[must_use]
    pub fn poll_ms(mut self, value: i64) -> Self {
        self.poll_ms = Some(value);
        self
    }
}

/// Arguments for [`Winclean::stop_service`] (`stop_service`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct StopServiceArgs {
    /// Service short name (e.g. 'wuauserv', 'BITS').
    #[serde(rename = "name")]
    pub name: String,
}

impl StopServiceArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = value.into();
        self
    }
}

/// Arguments for [`Winclean::switch_to_window`] (`switch_to_window`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SwitchToWindowArgs {
    /// Substring to match against the window title.
    #[serde(rename = "titleSubstring")]
    pub title_substring: String,
}

impl SwitchToWindowArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `titleSubstring`.
    #[must_use]
    pub fn title_substring(mut self, value: impl Into<String>) -> Self {
        self.title_substring = value.into();
        self
    }
}

/// Arguments for [`Winclean::trim_process_working_set`] (`trim_process_working_set`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TrimProcessWorkingSetArgs {
    /// Target process ID.
    #[serde(rename = "pid")]
    pub pid: i64,
}

impl TrimProcessWorkingSetArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = value;
        self
    }
}

/// Arguments for [`Winclean::type_`] (`type`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TypeArgs {
    /// Text to type.
    #[serde(rename = "text")]
    pub text: String,
    /// X coordinate in screen pixels (the field will be focused via a left-click).
    #[serde(rename = "x")]
    pub x: i64,
    /// Y coordinate in screen pixels.
    #[serde(rename = "y")]
    pub y: i64,
    /// Clear the existing field contents first (Ctrl+A then Delete).
    ///
    /// Default: `false`.
    #[serde(rename = "clear", skip_serializing_if = "Option::is_none")]
    pub clear: Option<bool>,
    /// Press ENTER after typing.
    ///
    /// Default: `false`.
    #[serde(rename = "pressEnter", skip_serializing_if = "Option::is_none")]
    pub press_enter: Option<bool>,
}

impl TypeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `clear`.
    #[must_use]
    pub fn clear(mut self, value: bool) -> Self {
        self.clear = Some(value);
        self
    }

    /// Sets `pressEnter`.
    #[must_use]
    pub fn press_enter(mut self, value: bool) -> Self {
        self.press_enter = Some(value);
        self
    }
}

/// Arguments for [`Winclean::wait`] (`wait`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WaitArgs {
    /// Sleep duration in seconds (clamped to [1,120]).
    #[serde(rename = "seconds")]
    pub seconds: i64,
}

impl WaitArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `seconds`.
    #[must_use]
    pub fn seconds(mut self, value: i64) -> Self {
        self.seconds = value;
        self
    }
}

/// Arguments for [`Winclean::window_capture`] (`window_capture`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowCaptureArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// Output BMP path. Empty = auto in %TEMP%.
    ///
    /// Default: `null`.
    #[serde(rename = "outputPath", skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// Render the full window content via DWM (recommended). False = client-area only.
    ///
    /// Default: `true`.
    #[serde(rename = "fullContent", skip_serializing_if = "Option::is_none")]
    pub full_content: Option<bool>,
}

impl WindowCaptureArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `outputPath`.
    #[must_use]
    pub fn output_path(mut self, value: impl Into<String>) -> Self {
        self.output_path = Some(value.into());
        self
    }

    /// Sets `fullContent`.
    #[must_use]
    pub fn full_content(mut self, value: bool) -> Self {
        self.full_content = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_close`] (`window_close`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowCloseArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
}

impl WindowCloseArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }
}

/// Arguments for [`Winclean::window_enum_all`] (`window_enum_all`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowEnumAllArgs {
    /// Filter by process ID (0 = any).
    ///
    /// Default: `0`.
    #[serde(rename = "pid", skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    /// Substring match on window class name (empty = any).
    ///
    /// Default: `""`.
    #[serde(rename = "classFilter", skip_serializing_if = "Option::is_none")]
    pub class_filter: Option<String>,
    /// Substring match on window title (empty = any).
    ///
    /// Default: `""`.
    #[serde(rename = "titleFilter", skip_serializing_if = "Option::is_none")]
    pub title_filter: Option<String>,
    /// Include invisible windows (default true).
    ///
    /// Default: `true`.
    #[serde(rename = "includeHidden", skip_serializing_if = "Option::is_none")]
    pub include_hidden: Option<bool>,
}

impl WindowEnumAllArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = Some(value);
        self
    }

    /// Sets `classFilter`.
    #[must_use]
    pub fn class_filter(mut self, value: impl Into<String>) -> Self {
        self.class_filter = Some(value.into());
        self
    }

    /// Sets `titleFilter`.
    #[must_use]
    pub fn title_filter(mut self, value: impl Into<String>) -> Self {
        self.title_filter = Some(value.into());
        self
    }

    /// Sets `includeHidden`.
    #[must_use]
    pub fn include_hidden(mut self, value: bool) -> Self {
        self.include_hidden = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_enum_children`] (`window_enum_children`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowEnumChildrenArgs {
    /// Parent HWND (signed 64-bit).
    #[serde(rename = "parentHwnd")]
    pub parent_hwnd: i64,
}

impl WindowEnumChildrenArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `parentHwnd`.
    #[must_use]
    pub fn parent_hwnd(mut self, value: i64) -> Self {
        self.parent_hwnd = value;
        self
    }
}

/// Arguments for [`Winclean::window_find_by_class`] (`window_find_by_class`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowFindByClassArgs {
    /// Exact window class name (case-sensitive).
    #[serde(rename = "className")]
    pub class_name: String,
    /// Optional exact window title (empty = any).
    ///
    /// Default: `""`.
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl WindowFindByClassArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `className`.
    #[must_use]
    pub fn class_name(mut self, value: impl Into<String>) -> Self {
        self.class_name = value.into();
        self
    }

    /// Sets `title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::window_get_text`] (`window_get_text`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowGetTextArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
}

impl WindowGetTextArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }
}

/// Arguments for [`Winclean::window_minimise_all`] (`window_minimise_all`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowMinimiseAllArgs {}

/// Arguments for [`Winclean::window_move`] (`window_move`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowMoveArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// New X (screen pixels).
    #[serde(rename = "x")]
    pub x: i64,
    /// New Y (screen pixels).
    #[serde(rename = "y")]
    pub y: i64,
    /// New width (0 = keep).
    ///
    /// Default: `0`.
    #[serde(rename = "width", skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    /// New height (0 = keep).
    ///
    /// Default: `0`.
    #[serde(rename = "height", skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
}

impl WindowMoveArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = value;
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = value;
        self
    }

    /// Sets `width`.
    #[must_use]
    pub fn width(mut self, value: i64) -> Self {
        self.width = Some(value);
        self
    }

    /// Sets `height`.
    #[must_use]
    pub fn height(mut self, value: i64) -> Self {
        self.height = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_post_message`] (`window_post_message`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowPostMessageArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// Message id (decimal or 0x-prefixed hex).
    #[serde(rename = "msg")]
    pub msg: i64,
    /// wParam.
    ///
    /// Default: `0`.
    #[serde(rename = "wParam", skip_serializing_if = "Option::is_none")]
    pub w_param: Option<i64>,
    /// lParam.
    ///
    /// Default: `0`.
    #[serde(rename = "lParam", skip_serializing_if = "Option::is_none")]
    pub l_param: Option<i64>,
}

impl WindowPostMessageArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `msg`.
    #[must_use]
    pub fn msg(mut self, value: i64) -> Self {
        self.msg = value;
        self
    }

    /// Sets `wParam`.
    #[must_use]
    pub fn w_param(mut self, value: i64) -> Self {
        self.w_param = Some(value);
        self
    }

    /// Sets `lParam`.
    #[must_use]
    pub fn l_param(mut self, value: i64) -> Self {
        self.l_param = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_send_message`] (`window_send_message`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowSendMessageArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// Message id (decimal or 0x-prefixed hex).
    #[serde(rename = "msg")]
    pub msg: i64,
    /// wParam.
    ///
    /// Default: `0`.
    #[serde(rename = "wParam", skip_serializing_if = "Option::is_none")]
    pub w_param: Option<i64>,
    /// lParam.
    ///
    /// Default: `0`.
    #[serde(rename = "lParam", skip_serializing_if = "Option::is_none")]
    pub l_param: Option<i64>,
}

impl WindowSendMessageArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `msg`.
    #[must_use]
    pub fn msg(mut self, value: i64) -> Self {
        self.msg = value;
        self
    }

    /// Sets `wParam`.
    #[must_use]
    pub fn w_param(mut self, value: i64) -> Self {
        self.w_param = Some(value);
        self
    }

    /// Sets `lParam`.
    #[must_use]
    pub fn l_param(mut self, value: i64) -> Self {
        self.l_param = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_set_opacity`] (`window_set_opacity`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowSetOpacityArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// Alpha 0..255 (255 = opaque).
    #[serde(rename = "alpha")]
    pub alpha: i64,
    /// Make the window click-through (input passes underneath).
    ///
    /// Default: `false`.
    #[serde(rename = "clickThrough", skip_serializing_if = "Option::is_none")]
    pub click_through: Option<bool>,
}

impl WindowSetOpacityArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `alpha`.
    #[must_use]
    pub fn alpha(mut self, value: i64) -> Self {
        self.alpha = value;
        self
    }

    /// Sets `clickThrough`.
    #[must_use]
    pub fn click_through(mut self, value: bool) -> Self {
        self.click_through = Some(value);
        self
    }
}

/// Arguments for [`Winclean::window_set_text`] (`window_set_text`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowSetTextArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// New text (UTF-16).
    #[serde(rename = "text")]
    pub text: String,
}

impl WindowSetTextArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `text`.
    #[must_use]
    pub fn text(mut self, value: impl Into<String>) -> Self {
        self.text = value.into();
        self
    }
}

/// Arguments for [`Winclean::window_set_topmost`] (`window_set_topmost`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WindowSetTopmostArgs {
    /// Target HWND.
    #[serde(rename = "hwnd")]
    pub hwnd: i64,
    /// true = pin topmost, false = release.
    ///
    /// Default: `true`.
    #[serde(rename = "topmost", skip_serializing_if = "Option::is_none")]
    pub topmost: Option<bool>,
}

impl WindowSetTopmostArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `hwnd`.
    #[must_use]
    pub fn hwnd(mut self, value: i64) -> Self {
        self.hwnd = value;
        self
    }

    /// Sets `topmost`.
    #[must_use]
    pub fn topmost(mut self, value: bool) -> Self {
        self.topmost = Some(value);
        self
    }
}

/// Arguments for [`Winclean::winml_get_version`] (`winml_get_version`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WinmlGetVersionArgs {}

/// Arguments for [`Winclean::winml_inspect_onnx`] (`winml_inspect_onnx`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WinmlInspectOnnxArgs {
    /// Absolute path to a .onnx model file.
    #[serde(rename = "modelPath")]
    pub model_path: String,
}

impl WinmlInspectOnnxArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `modelPath`.
    #[must_use]
    pub fn model_path(mut self, value: impl Into<String>) -> Self {
        self.model_path = value.into();
        self
    }
}

/// Arguments for [`Winclean::winml_list_providers`] (`winml_list_providers`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WinmlListProvidersArgs {}

/// Arguments for [`Winclean::winml_run_float32`] (`winml_run_float32`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WinmlRunFloat32Args {
    /// Absolute path to a .onnx model file.
    #[serde(rename = "modelPath")]
    pub model_path: String,
    /// JSON map of input name -> { shape: int[], data: float[] }.
    #[serde(rename = "inputsJson")]
    pub inputs_json: String,
    /// 'cpu' | 'dml' | 'cuda'. Default 'cpu'.
    ///
    /// Default: `"cpu"`.
    #[serde(rename = "executionProvider", skip_serializing_if = "Option::is_none")]
    pub execution_provider: Option<String>,
}

impl WinmlRunFloat32Args {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `modelPath`.
    #[must_use]
    pub fn model_path(mut self, value: impl Into<String>) -> Self {
        self.model_path = value.into();
        self
    }

    /// Sets `inputsJson`.
    #[must_use]
    pub fn inputs_json(mut self, value: impl Into<String>) -> Self {
        self.inputs_json = value.into();
        self
    }

    /// Sets `executionProvider`.
    #[must_use]
    pub fn execution_provider(mut self, value: impl Into<String>) -> Self {
        self.execution_provider = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::write_file`] (`write_file`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WriteFileArgs {
    /// Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
    #[serde(rename = "path")]
    pub path: String,
    /// Text content to write.
    #[serde(rename = "content")]
    pub content: String,
    /// Append to existing content instead of overwriting.
    ///
    /// Default: `false`.
    #[serde(rename = "append", skip_serializing_if = "Option::is_none")]
    pub append: Option<bool>,
}

impl WriteFileArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `content`.
    #[must_use]
    pub fn content(mut self, value: impl Into<String>) -> Self {
        self.content = value.into();
        self
    }

    /// Sets `append`.
    #[must_use]
    pub fn append(mut self, value: bool) -> Self {
        self.append = Some(value);
        self
    }
}

/// Arguments for [`Winclean::wsl_execute`] (`wsl_execute`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslExecuteArgs {
    /// Exact distribution name returned by wsl_list_distributions.
    #[serde(rename = "distribution")]
    pub distribution: String,
    /// Executable followed by its arguments; 1..64 values, no control characters.
    #[serde(rename = "command")]
    pub command: Vec<String>,
}

impl WslExecuteArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `distribution`.
    #[must_use]
    pub fn distribution(mut self, value: impl Into<String>) -> Self {
        self.distribution = value.into();
        self
    }

    /// Sets `command`.
    #[must_use]
    pub fn command(mut self, value: Vec<String>) -> Self {
        self.command = value;
        self
    }
}

/// Arguments for [`Winclean::wsl_get_status`] (`wsl_get_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslGetStatusArgs {}

/// Arguments for [`Winclean::wsl_list_distributions`] (`wsl_list_distributions`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslListDistributionsArgs {}

/// Arguments for [`Winclean::wsl_list_processes`] (`wsl_list_processes`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslListProcessesArgs {
    /// Exact distribution name returned by wsl_list_distributions.
    #[serde(rename = "distribution")]
    pub distribution: String,
}

impl WslListProcessesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `distribution`.
    #[must_use]
    pub fn distribution(mut self, value: impl Into<String>) -> Self {
        self.distribution = value.into();
        self
    }
}

/// Arguments for [`Winclean::wsl_read_only_probe`] (`wsl_read_only_probe`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslReadOnlyProbeArgs {
    /// Exact distribution name returned by wsl_list_distributions.
    #[serde(rename = "distribution")]
    pub distribution: String,
    /// One of: system-info, re-toolchain, processes, mounts, network.
    #[serde(rename = "probe")]
    pub probe: String,
}

impl WslReadOnlyProbeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `distribution`.
    #[must_use]
    pub fn distribution(mut self, value: impl Into<String>) -> Self {
        self.distribution = value.into();
        self
    }

    /// Sets `probe`.
    #[must_use]
    pub fn probe(mut self, value: impl Into<String>) -> Self {
        self.probe = value.into();
        self
    }
}

/// Arguments for [`Winclean::wsl_send_signal`] (`wsl_send_signal`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WslSendSignalArgs {
    /// Exact distribution name returned by wsl_list_distributions.
    #[serde(rename = "distribution")]
    pub distribution: String,
    /// Exact positive Linux PID returned by wsl_list_processes.
    #[serde(rename = "processId")]
    pub process_id: i64,
    /// HUP, INT, TERM, or KILL.
    ///
    /// Default: `"TERM"`.
    #[serde(rename = "signal", skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

impl WslSendSignalArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `distribution`.
    #[must_use]
    pub fn distribution(mut self, value: impl Into<String>) -> Self {
        self.distribution = value.into();
        self
    }

    /// Sets `processId`.
    #[must_use]
    pub fn process_id(mut self, value: i64) -> Self {
        self.process_id = value;
        self
    }

    /// Sets `signal`.
    #[must_use]
    pub fn signal(mut self, value: impl Into<String>) -> Self {
        self.signal = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::tweak_catalog`] (`tweak_catalog`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TweakCatalogArgs {
    /// Only tweaks of this module id.
    #[serde(rename = "module", skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

impl TweakCatalogArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `module`.
    #[must_use]
    pub fn module(mut self, value: impl Into<String>) -> Self {
        self.module = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::tweak_plan`] (`tweak_plan`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TweakPlanArgs {
    /// Inline profile TOML. Omit for the default conservative live profile.
    #[serde(rename = "profileToml", skip_serializing_if = "Option::is_none")]
    pub profile_toml: Option<String>,
    /// Path to a profile .toml file (alternative to profileToml).
    #[serde(rename = "profilePath", skip_serializing_if = "Option::is_none")]
    pub profile_path: Option<String>,
}

impl TweakPlanArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `profileToml`.
    #[must_use]
    pub fn profile_toml(mut self, value: impl Into<String>) -> Self {
        self.profile_toml = Some(value.into());
        self
    }

    /// Sets `profilePath`.
    #[must_use]
    pub fn profile_path(mut self, value: impl Into<String>) -> Self {
        self.profile_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::tweak_apply`] (`tweak_apply`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TweakApplyArgs {
    /// Path of a plan from tweak_plan. Omit to build one from the profile first.
    #[serde(rename = "planPath", skip_serializing_if = "Option::is_none")]
    pub plan_path: Option<String>,
    /// Inline profile TOML when no planPath is given.
    #[serde(rename = "profileToml", skip_serializing_if = "Option::is_none")]
    pub profile_toml: Option<String>,
    /// Must be true to apply.
    ///
    /// Default: `false`.
    #[serde(rename = "confirm")]
    pub confirm: bool,
}

impl TweakApplyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `planPath`.
    #[must_use]
    pub fn plan_path(mut self, value: impl Into<String>) -> Self {
        self.plan_path = Some(value.into());
        self
    }

    /// Sets `profileToml`.
    #[must_use]
    pub fn profile_toml(mut self, value: impl Into<String>) -> Self {
        self.profile_toml = Some(value.into());
        self
    }

    /// Sets `confirm`.
    #[must_use]
    pub fn confirm(mut self, value: bool) -> Self {
        self.confirm = value;
        self
    }
}

/// Arguments for [`Winclean::tweak_verify`] (`tweak_verify`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TweakVerifyArgs {
    /// Journal path. Omit to use the newest journal under %LOCALAPPDATA%unoswin11journal.
    #[serde(rename = "journalPath", skip_serializing_if = "Option::is_none")]
    pub journal_path: Option<String>,
}

impl TweakVerifyArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `journalPath`.
    #[must_use]
    pub fn journal_path(mut self, value: impl Into<String>) -> Self {
        self.journal_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::tweak_undo`] (`tweak_undo`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TweakUndoArgs {
    /// Journal path. Omit to use the newest journal.
    #[serde(rename = "journalPath", skip_serializing_if = "Option::is_none")]
    pub journal_path: Option<String>,
}

impl TweakUndoArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `journalPath`.
    #[must_use]
    pub fn journal_path(mut self, value: impl Into<String>) -> Self {
        self.journal_path = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::nt_status`] (`nt_status`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtStatusArgs {}

/// Arguments for [`Winclean::nt_events_start`] (`nt_events_start`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtEventsStartArgs {
    /// Comma list of process, thread, image, registry, or all (default process,image).
    ///
    /// Default: `"process,image"`.
    #[serde(rename = "sources", skip_serializing_if = "Option::is_none")]
    pub sources: Option<String>,
    /// Force the user-mode fallback even when the driver is loaded.
    ///
    /// Default: `false`.
    #[serde(rename = "userMode", skip_serializing_if = "Option::is_none")]
    pub user_mode: Option<bool>,
}

impl NtEventsStartArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `sources`.
    #[must_use]
    pub fn sources(mut self, value: impl Into<String>) -> Self {
        self.sources = Some(value.into());
        self
    }

    /// Sets `userMode`.
    #[must_use]
    pub fn user_mode(mut self, value: bool) -> Self {
        self.user_mode = Some(value);
        self
    }
}

/// Arguments for [`Winclean::nt_events_read`] (`nt_events_read`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtEventsReadArgs {
    /// Maximum events to return (1-512, default 256).
    ///
    /// Default: `256`.
    #[serde(rename = "max", skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
}

impl NtEventsReadArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `max`.
    #[must_use]
    pub fn max(mut self, value: i64) -> Self {
        self.max = Some(value);
        self
    }
}

/// Arguments for [`Winclean::nt_events_stop`] (`nt_events_stop`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtEventsStopArgs {}

/// Arguments for [`Winclean::nt_handles`] (`nt_handles`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtHandlesArgs {
    /// Only handles owned by this process id.
    #[serde(rename = "pid", skip_serializing_if = "Option::is_none")]
    pub pid: Option<i64>,
    /// Maximum handle rows (default 500, max 100000).
    ///
    /// Default: `500`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl NtHandlesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `pid`.
    #[must_use]
    pub fn pid(mut self, value: i64) -> Self {
        self.pid = Some(value);
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::nt_kernel_modules`] (`nt_kernel_modules`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct NtKernelModulesArgs {
    /// Case-insensitive substring filter on the file name.
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Maximum rows (default 500).
    ///
    /// Default: `500`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl NtKernelModulesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `name`.
    #[must_use]
    pub fn name(mut self, value: impl Into<String>) -> Self {
        self.name = Some(value.into());
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::wmi_query`] (`wmi_query`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WmiQueryArgs {
    /// WQL, e.g. SELECT Name, ProcessId FROM Win32_Process
    #[serde(rename = "query")]
    pub query: String,
    /// Namespace, default ROOTCIMV2
    #[serde(rename = "namespace", skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    /// Maximum rows.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl WmiQueryArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `query`.
    #[must_use]
    pub fn query(mut self, value: impl Into<String>) -> Self {
        self.query = value.into();
        self
    }

    /// Sets `namespace`.
    #[must_use]
    pub fn namespace(mut self, value: impl Into<String>) -> Self {
        self.namespace = Some(value.into());
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::com_invoke`] (`com_invoke`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ComInvokeArgs {
    /// ProgID, e.g. Shell.Application, WScript.Shell, Excel.Application
    #[serde(rename = "progId", skip_serializing_if = "Option::is_none")]
    pub prog_id: Option<String>,
    /// CLSID alternative to progId
    #[serde(rename = "clsid", skip_serializing_if = "Option::is_none")]
    pub clsid: Option<String>,
    /// Attach to a running instance (GetActiveObject) instead of creating one.
    #[serde(rename = "attach", skip_serializing_if = "Option::is_none")]
    pub attach: Option<bool>,
    /// [{name, op: auto|get|call|put, args: [...], value, on}]: each step runs on the object the
    /// previous step returned, or on the object of an earlier step with on=n (0 = root, n = step
    /// n-1's result). Arguments {$step: n} pass that object.
    #[serde(rename = "steps", skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<serde_json::Value>>,
    /// {properties: [names], limit} to enumerate the final collection.
    #[serde(rename = "enumerate", skip_serializing_if = "Option::is_none")]
    pub enumerate: Option<serde_json::Value>,
    /// Properties to read from the final object.
    #[serde(rename = "properties", skip_serializing_if = "Option::is_none")]
    pub properties: Option<Vec<String>>,
}

impl ComInvokeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `progId`.
    #[must_use]
    pub fn prog_id(mut self, value: impl Into<String>) -> Self {
        self.prog_id = Some(value.into());
        self
    }

    /// Sets `clsid`.
    #[must_use]
    pub fn clsid(mut self, value: impl Into<String>) -> Self {
        self.clsid = Some(value.into());
        self
    }

    /// Sets `attach`.
    #[must_use]
    pub fn attach(mut self, value: bool) -> Self {
        self.attach = Some(value);
        self
    }

    /// Sets `steps`.
    #[must_use]
    pub fn steps(mut self, value: Vec<serde_json::Value>) -> Self {
        self.steps = Some(value);
        self
    }

    /// Sets `enumerate`.
    #[must_use]
    pub fn enumerate(mut self, value: serde_json::Value) -> Self {
        self.enumerate = Some(value);
        self
    }

    /// Sets `properties`.
    #[must_use]
    pub fn properties(mut self, value: Vec<String>) -> Self {
        self.properties = Some(value);
        self
    }
}

/// Arguments for [`Winclean::shell_known_folders`] (`shell_known_folders`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellKnownFoldersArgs {}

/// Arguments for [`Winclean::shell_drives`] (`shell_drives`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellDrivesArgs {}

/// Arguments for [`Winclean::shell_file_operation`] (`shell_file_operation`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellFileOperationArgs {
    /// copy | move | rename | delete | recycle | newFolder
    #[serde(rename = "op")]
    pub op: String,
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "items", skip_serializing_if = "Option::is_none")]
    pub items: Option<String>,
    /// Destination folder for copy/move/newFolder.
    #[serde(rename = "destination", skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    /// New name for rename/newFolder, or the target name for a single copy/move.
    #[serde(rename = "newName", skip_serializing_if = "Option::is_none")]
    pub new_name: Option<String>,
    /// Show Explorer's progress and conflict UI.
    #[serde(rename = "ui", skip_serializing_if = "Option::is_none")]
    pub ui: Option<bool>,
}

impl ShellFileOperationArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `op`.
    #[must_use]
    pub fn op(mut self, value: impl Into<String>) -> Self {
        self.op = value.into();
        self
    }

    /// Sets `items`.
    #[must_use]
    pub fn items(mut self, value: impl Into<String>) -> Self {
        self.items = Some(value.into());
        self
    }

    /// Sets `destination`.
    #[must_use]
    pub fn destination(mut self, value: impl Into<String>) -> Self {
        self.destination = Some(value.into());
        self
    }

    /// Sets `newName`.
    #[must_use]
    pub fn new_name(mut self, value: impl Into<String>) -> Self {
        self.new_name = Some(value.into());
        self
    }

    /// Sets `ui`.
    #[must_use]
    pub fn ui(mut self, value: bool) -> Self {
        self.ui = Some(value);
        self
    }
}

/// Arguments for [`Winclean::shell_recycle_bin`] (`shell_recycle_bin`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellRecycleBinArgs {
    /// list | restore | empty
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "names", skip_serializing_if = "Option::is_none")]
    pub names: Option<String>,
    /// Required for empty.
    #[serde(rename = "confirm", skip_serializing_if = "Option::is_none")]
    pub confirm: Option<bool>,
}

impl ShellRecycleBinArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `names`.
    #[must_use]
    pub fn names(mut self, value: impl Into<String>) -> Self {
        self.names = Some(value.into());
        self
    }

    /// Sets `confirm`.
    #[must_use]
    pub fn confirm(mut self, value: bool) -> Self {
        self.confirm = Some(value);
        self
    }
}

/// Arguments for [`Winclean::shell_context_menu`] (`shell_context_menu`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellContextMenuArgs {
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "path")]
    pub path: String,
    /// list | invoke | popup
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Canonical verb to invoke.
    #[serde(rename = "verb", skip_serializing_if = "Option::is_none")]
    pub verb: Option<String>,
    /// Menu id from list.
    #[serde(rename = "id", skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    /// Keep the process alive while dialogs opened by the verb are visible (default true).
    #[serde(rename = "wait", skip_serializing_if = "Option::is_none")]
    pub wait: Option<bool>,
    /// Popup screen x (default: cursor).
    #[serde(rename = "x", skip_serializing_if = "Option::is_none")]
    pub x: Option<i64>,
    /// Popup screen y (default: cursor).
    #[serde(rename = "y", skip_serializing_if = "Option::is_none")]
    pub y: Option<i64>,
}

impl ShellContextMenuArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `verb`.
    #[must_use]
    pub fn verb(mut self, value: impl Into<String>) -> Self {
        self.verb = Some(value.into());
        self
    }

    /// Sets `id`.
    #[must_use]
    pub fn id(mut self, value: i64) -> Self {
        self.id = Some(value);
        self
    }

    /// Sets `wait`.
    #[must_use]
    pub fn wait(mut self, value: bool) -> Self {
        self.wait = Some(value);
        self
    }

    /// Sets `x`.
    #[must_use]
    pub fn x(mut self, value: i64) -> Self {
        self.x = Some(value);
        self
    }

    /// Sets `y`.
    #[must_use]
    pub fn y(mut self, value: i64) -> Self {
        self.y = Some(value);
        self
    }
}

/// Arguments for [`Winclean::shell_properties`] (`shell_properties`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellPropertiesArgs {
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "path")]
    pub path: String,
    /// read | dialog
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

impl ShellPropertiesArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::shell_thumbnail`] (`shell_thumbnail`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellThumbnailArgs {
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "path")]
    pub path: String,
    /// Edge in pixels (default 256).
    #[serde(rename = "size", skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    /// PNG output path.
    #[serde(rename = "output", skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

impl ShellThumbnailArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }

    /// Sets `size`.
    #[must_use]
    pub fn size(mut self, value: i64) -> Self {
        self.size = Some(value);
        self
    }

    /// Sets `output`.
    #[must_use]
    pub fn output(mut self, value: impl Into<String>) -> Self {
        self.output = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::shell_open_with`] (`shell_open_with`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellOpenWithArgs {
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "path", skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Extension (.txt) or URL protocol (https:).
    #[serde(rename = "extension", skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    /// list | invoke | default
    #[serde(rename = "action", skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Handler for invoke.
    #[serde(rename = "handler", skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    /// Only recommended handlers.
    #[serde(rename = "recommended", skip_serializing_if = "Option::is_none")]
    pub recommended: Option<bool>,
}

impl ShellOpenWithArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = Some(value.into());
        self
    }

    /// Sets `extension`.
    #[must_use]
    pub fn extension(mut self, value: impl Into<String>) -> Self {
        self.extension = Some(value.into());
        self
    }

    /// Sets `action`.
    #[must_use]
    pub fn action(mut self, value: impl Into<String>) -> Self {
        self.action = Some(value.into());
        self
    }

    /// Sets `handler`.
    #[must_use]
    pub fn handler(mut self, value: impl Into<String>) -> Self {
        self.handler = Some(value.into());
        self
    }

    /// Sets `recommended`.
    #[must_use]
    pub fn recommended(mut self, value: bool) -> Self {
        self.recommended = Some(value);
        self
    }
}

/// Arguments for [`Winclean::shell_reveal`] (`shell_reveal`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct ShellRevealArgs {
    /// One path or an array of paths (filesystem paths or shell parsing names such as ::{CLSID} /
    /// shell:RecycleBinFolder).
    #[serde(rename = "path")]
    pub path: String,
}

impl ShellRevealArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `path`.
    #[must_use]
    pub fn path(mut self, value: impl Into<String>) -> Self {
        self.path = value.into();
        self
    }
}

/// Arguments for [`Winclean::winget_sources`] (`winget_sources`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetSourcesArgs {}

/// Arguments for [`Winclean::winget_search`] (`winget_search`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetSearchArgs {
    /// Search text.
    #[serde(rename = "query")]
    pub query: String,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Maximum results (default 50).
    ///
    /// Default: `50`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl WingetSearchArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `query`.
    #[must_use]
    pub fn query(mut self, value: impl Into<String>) -> Self {
        self.query = value.into();
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::winget_list`] (`winget_list`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetListArgs {
    /// Optional filter text.
    #[serde(rename = "query", skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Only packages with an available update.
    ///
    /// Default: `false`.
    #[serde(rename = "upgradable", skip_serializing_if = "Option::is_none")]
    pub upgradable: Option<bool>,
    /// Maximum results (default 0, no limit).
    ///
    /// Default: `0`.
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

impl WingetListArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `query`.
    #[must_use]
    pub fn query(mut self, value: impl Into<String>) -> Self {
        self.query = Some(value.into());
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }

    /// Sets `upgradable`.
    #[must_use]
    pub fn upgradable(mut self, value: bool) -> Self {
        self.upgradable = Some(value);
        self
    }

    /// Sets `limit`.
    #[must_use]
    pub fn limit(mut self, value: i64) -> Self {
        self.limit = Some(value);
        self
    }
}

/// Arguments for [`Winclean::winget_show`] (`winget_show`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetShowArgs {
    /// Exact package identifier (e.g. Git.Git).
    #[serde(rename = "id")]
    pub id: String,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl WingetShowArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `id`.
    #[must_use]
    pub fn id(mut self, value: impl Into<String>) -> Self {
        self.id = value.into();
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }
}

/// Arguments for [`Winclean::winget_install`] (`winget_install`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetInstallArgs {
    /// Exact package identifier.
    #[serde(rename = "id")]
    pub id: String,
    /// Specific version; the default install version when omitted.
    #[serde(rename = "version", skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// 'user' or 'machine'; any when omitted.
    #[serde(rename = "scope", skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Reinstall or override checks.
    ///
    /// Default: `false`.
    #[serde(rename = "force", skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

impl WingetInstallArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `id`.
    #[must_use]
    pub fn id(mut self, value: impl Into<String>) -> Self {
        self.id = value.into();
        self
    }

    /// Sets `version`.
    #[must_use]
    pub fn version(mut self, value: impl Into<String>) -> Self {
        self.version = Some(value.into());
        self
    }

    /// Sets `scope`.
    #[must_use]
    pub fn scope(mut self, value: impl Into<String>) -> Self {
        self.scope = Some(value.into());
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }

    /// Sets `force`.
    #[must_use]
    pub fn force(mut self, value: bool) -> Self {
        self.force = Some(value);
        self
    }
}

/// Arguments for [`Winclean::winget_upgrade`] (`winget_upgrade`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetUpgradeArgs {
    /// Exact package identifier.
    #[serde(rename = "id")]
    pub id: String,
    /// Target version; the newest when omitted.
    #[serde(rename = "version", skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Upgrade even when no update is reported.
    ///
    /// Default: `false`.
    #[serde(rename = "force", skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

impl WingetUpgradeArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `id`.
    #[must_use]
    pub fn id(mut self, value: impl Into<String>) -> Self {
        self.id = value.into();
        self
    }

    /// Sets `version`.
    #[must_use]
    pub fn version(mut self, value: impl Into<String>) -> Self {
        self.version = Some(value.into());
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }

    /// Sets `force`.
    #[must_use]
    pub fn force(mut self, value: bool) -> Self {
        self.force = Some(value);
        self
    }
}

/// Arguments for [`Winclean::winget_uninstall`] (`winget_uninstall`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct WingetUninstallArgs {
    /// Exact package identifier.
    #[serde(rename = "id")]
    pub id: String,
    /// winget source name (winget, msstore); every configured source when omitted.
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Force the uninstall.
    ///
    /// Default: `false`.
    #[serde(rename = "force", skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

impl WingetUninstallArgs {
    /// Creates arguments with every field at its default.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `id`.
    #[must_use]
    pub fn id(mut self, value: impl Into<String>) -> Self {
        self.id = value.into();
        self
    }

    /// Sets `source`.
    #[must_use]
    pub fn source(mut self, value: impl Into<String>) -> Self {
        self.source = Some(value.into());
        self
    }

    /// Sets `force`.
    #[must_use]
    pub fn force(mut self, value: bool) -> Self {
        self.force = Some(value);
        self
    }
}

impl Winclean {
    /// Performs static analysis and symbol recovery on a target Windows PE binary (.exe or .dll).
    /// Recovers sections, imports, entry point disassembly, and maps symbols using heuristics (no
    /// execution).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn analyze_pe(&self, args: &AnalyzePeArgs) -> Result<ToolResult> {
        self.call("analyze_pe", args)
    }

    /// Async variant of [`Winclean::analyze_pe`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn analyze_pe_async(&self, args: &AnalyzePeArgs) -> Result<ToolResult> {
        self.call_async("analyze_pe", args).await
    }

    /// Scans raw file bytes for an Array of Bytes (AOB) pattern with optional wildcards (? or ??).
    /// Pattern format: '48 8B ? ? 48 89' or 'E8 ? ? ? ? 85 C0'. Returns matching offsets in the
    /// binary.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn aob_scan(&self, args: &AobScanArgs) -> Result<ToolResult> {
        self.call("aob_scan", args)
    }

    /// Async variant of [`Winclean::aob_scan`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn aob_scan_async(&self, args: &AobScanArgs) -> Result<ToolResult> {
        self.call_async("aob_scan", args).await
    }

    /// Lists files contained inside an Electron ASAR archive (.asar) without extraction or
    /// execution. Returns relative paths, offsets, and sizes.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn asar_list(&self, args: &AsarListArgs) -> Result<ToolResult> {
        self.call("asar_list", args)
    }

    /// Async variant of [`Winclean::asar_list`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn asar_list_async(&self, args: &AsarListArgs) -> Result<ToolResult> {
        self.call_async("asar_list", args).await
    }

    /// AES-128/256-CTR decryption of a file using caller-supplied key (hex) and 16-byte IV (hex).
    /// Streams large files. Returns sha256 of the plaintext. Key must be 16 or 32 bytes; IV must be
    /// 16 bytes.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_aes_ctr_decrypt(&self, args: &BinaryAesCtrDecryptArgs) -> Result<ToolResult> {
        self.call("binary_aes_ctr_decrypt", args)
    }

    /// Async variant of [`Winclean::binary_aes_ctr_decrypt`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_aes_ctr_decrypt_async(
        &self,
        args: &BinaryAesCtrDecryptArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_aes_ctr_decrypt", args).await
    }

    /// Computes Shannon entropy (0..8 bits/byte) per fixed-size block. High entropy (>=7.5)
    /// typically indicates encryption or compression. Helps locate packed sections in a binary
    /// without disassembling.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_entropy_map(&self, args: &BinaryEntropyMapArgs) -> Result<ToolResult> {
        self.call("binary_entropy_map", args)
    }

    /// Async variant of [`Winclean::binary_entropy_map`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_entropy_map_async(
        &self,
        args: &BinaryEntropyMapArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_entropy_map", args).await
    }

    /// Extracts printable ASCII and UTF-16LE strings of >=minLength characters from a file. Returns
    /// up to maxResults entries with offset, encoding (ascii/utf16), and the string. Streams the
    /// file in 1 MiB chunks — works on large binaries.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_extract_strings(&self, args: &BinaryExtractStringsArgs) -> Result<ToolResult> {
        self.call("binary_extract_strings", args)
    }

    /// Async variant of [`Winclean::binary_extract_strings`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_extract_strings_async(
        &self,
        args: &BinaryExtractStringsArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_extract_strings", args).await
    }

    /// Computes MD5 + SHA1 + SHA256 of a file in a single pass. Streams the file (any size).
    /// Returns all three hex digests.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_hash_multi(&self, args: &BinaryHashMultiArgs) -> Result<ToolResult> {
        self.call("binary_hash_multi", args)
    }

    /// Async variant of [`Winclean::binary_hash_multi`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_hash_multi_async(&self, args: &BinaryHashMultiArgs) -> Result<ToolResult> {
        self.call_async("binary_hash_multi", args).await
    }

    /// Lists files inside a CRIWARE CPK archive (used by Inazuma Eleven Victory Road, many Japanese
    /// games). Parses the @UTF table at the start of the file. Returns up to maxEntries rows with
    /// internal path, offset, size, compressed size, CRC32.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_list_cpk(&self, args: &BinaryListCpkArgs) -> Result<ToolResult> {
        self.call("binary_list_cpk", args)
    }

    /// Async variant of [`Winclean::binary_list_cpk`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_list_cpk_async(&self, args: &BinaryListCpkArgs) -> Result<ToolResult> {
        self.call_async("binary_list_cpk", args).await
    }

    /// Parses the PE/COFF header of a Windows executable or DLL. Returns machine (x64/arm64/x86),
    /// characteristics, image base, entry RVA, subsystem (gui/console), is64bit flag, and section
    /// table (name + RVA + size + flags).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_parse_pe_header(&self, args: &BinaryParsePeHeaderArgs) -> Result<ToolResult> {
        self.call("binary_parse_pe_header", args)
    }

    /// Async variant of [`Winclean::binary_parse_pe_header`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_parse_pe_header_async(
        &self,
        args: &BinaryParsePeHeaderArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_parse_pe_header", args).await
    }

    /// Dumps one named section (e.g. '.text', '.rdata', '.rsrc') of a PE file to outputPath.
    /// Returns offset, size, sha256.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_section_dump(&self, args: &BinarySectionDumpArgs) -> Result<ToolResult> {
        self.call("binary_section_dump", args)
    }

    /// Async variant of [`Winclean::binary_section_dump`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_section_dump_async(
        &self,
        args: &BinarySectionDumpArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_section_dump", args).await
    }

    /// Writes 'decrypted' = encryptedFile XOR repeating-key to outputPath. Key in hex (e.g. 'A5 5A
    /// 12' or 'A55A12'). Streams large files. If the encryption is a single-byte XOR, pass one
    /// byte. Returns sha256 of result.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn binary_xor_decrypt(&self, args: &BinaryXorDecryptArgs) -> Result<ToolResult> {
        self.call("binary_xor_decrypt", args)
    }

    /// Async variant of [`Winclean::binary_xor_decrypt`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn binary_xor_decrypt_async(
        &self,
        args: &BinaryXorDecryptArgs,
    ) -> Result<ToolResult> {
        self.call_async("binary_xor_decrypt", args).await
    }

    /// Performs a mouse click at the given screen coordinates. button: 'left' | 'right' | 'middle'.
    /// clicks: 0 = hover only, 1 = single click, 2 = double click.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn click(&self, args: &ClickArgs) -> Result<ToolResult> {
        self.call("click", args)
    }

    /// Async variant of [`Winclean::click`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn click_async(&self, args: &ClickArgs) -> Result<ToolResult> {
        self.call_async("click", args).await
    }

    /// Captures the primary desktop as a PNG image content block for visual computer use. Returns
    /// the screen dimensions and coordinate space in a text block before the image. Use
    /// computer_observe for a specific application and its UI Automation tree.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_capture_screen(&self, args: &ComputerCaptureScreenArgs) -> Result<ToolResult> {
        self.call("computer_capture_screen", args)
    }

    /// Async variant of [`Winclean::computer_capture_screen`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_capture_screen_async(
        &self,
        args: &ComputerCaptureScreenArgs,
    ) -> Result<ToolResult> {
        self.call_async("computer_capture_screen", args).await
    }

    /// Clicks a point in the selected application using native mouse input. x/y are relative to the
    /// outer window rectangle returned by computer_observe. The window is restored and focused by
    /// default. Re-observe after the click because menus and layouts may change.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_click(&self, args: &ComputerClickArgs) -> Result<ToolResult> {
        self.call("computer_click", args)
    }

    /// Async variant of [`Winclean::computer_click`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_click_async(&self, args: &ComputerClickArgs) -> Result<ToolResult> {
        self.call_async("computer_click", args).await
    }

    /// Finds one UI Automation element in a selected application and clicks its center. Prefer
    /// automationId when present, otherwise use an exact name, className or controlType from the
    /// latest computer_observe result. If multiple elements match, set occurrence (zero-based) or
    /// the tool returns the candidates without clicking.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_click_element(&self, args: &ComputerClickElementArgs) -> Result<ToolResult> {
        self.call("computer_click_element", args)
    }

    /// Async variant of [`Winclean::computer_click_element`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_click_element_async(
        &self,
        args: &ComputerClickElementArgs,
    ) -> Result<ToolResult> {
        self.call_async("computer_click_element", args).await
    }

    /// Drags inside a selected application with interpolated native mouse movement. Coordinates are
    /// relative to the latest observed window image. Use this for canvas operations in Blender,
    /// Photoshop and similar software, then capture a fresh observation to verify the result.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_drag(&self, args: &ComputerDragArgs) -> Result<ToolResult> {
        self.call("computer_drag", args)
    }

    /// Async variant of [`Winclean::computer_drag`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_drag_async(&self, args: &ComputerDragArgs) -> Result<ToolResult> {
        self.call_async("computer_drag", args).await
    }

    /// Sends a keyboard key or shortcut to a selected application using SendInput. Examples:
    /// ctrl+c, ctrl+shift+s, alt+f4, enter, tab, escape, f5. Windows-key shortcuts are
    /// intentionally rejected by this computer-use surface. Re-observe after actions that change
    /// UI.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_key(&self, args: &ComputerKeyArgs) -> Result<ToolResult> {
        self.call("computer_key", args)
    }

    /// Async variant of [`Winclean::computer_key`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_key_async(&self, args: &ComputerKeyArgs) -> Result<ToolResult> {
        self.call_async("computer_key", args).await
    }

    /// Observes a Windows application for computer use. Returns structured window metadata and a
    /// native UI Automation tree as text, plus a PNG image content block when capture succeeds.
    /// windowHandle=0 selects the foreground window; otherwise use an exact HWND returned by
    /// window_enum_all. Coordinates in later computer_* actions are relative to this window image.
    /// Use this before every state-dependent click, type or drag.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_observe(&self, args: &ComputerObserveArgs) -> Result<ToolResult> {
        self.call("computer_observe", args)
    }

    /// Async variant of [`Winclean::computer_observe`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_observe_async(&self, args: &ComputerObserveArgs) -> Result<ToolResult> {
        self.call_async("computer_observe", args).await
    }

    /// Runs local Windows OCR over the selected application screenshot and returns exact text with
    /// line/word bounding boxes. region coordinates are relative to the observed window image.
    /// format=json returns structured OCR; format=markdown returns the extracted text as Markdown.
    /// Set speak=true to synthesize and play the result with the installed Windows voice.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_ocr(&self, args: &ComputerOcrArgs) -> Result<ToolResult> {
        self.call("computer_ocr", args)
    }

    /// Async variant of [`Winclean::computer_ocr`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_ocr_async(&self, args: &ComputerOcrArgs) -> Result<ToolResult> {
        self.call_async("computer_ocr", args).await
    }

    /// Records a bounded, exportable clip of a window or the primary desktop as an uncompressed
    /// AVI. The clip is written locally without ffmpeg or a cloud service. durationMs is 1..30000
    /// and fps is 1..30.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_record_clip(&self, args: &ComputerRecordClipArgs) -> Result<ToolResult> {
        self.call("computer_record_clip", args)
    }

    /// Async variant of [`Winclean::computer_record_clip`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_record_clip_async(
        &self,
        args: &ComputerRecordClipArgs,
    ) -> Result<ToolResult> {
        self.call_async("computer_record_clip", args).await
    }

    /// Scrolls a selected application using native wheel input. x/y are relative to the observed
    /// window image and identify the pane under the cursor. Re-observe after scrolling because
    /// lazy-loaded content and UI layouts can change.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_scroll(&self, args: &ComputerScrollArgs) -> Result<ToolResult> {
        self.call("computer_scroll", args)
    }

    /// Async variant of [`Winclean::computer_scroll`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_scroll_async(&self, args: &ComputerScrollArgs) -> Result<ToolResult> {
        self.call_async("computer_scroll", args).await
    }

    /// Speaks text using the installed local Windows speech synthesizer and plays it immediately.
    /// No cloud API or key is used. Returns the generated WAV path for export or later playback.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_speak(&self, args: &ComputerSpeakArgs) -> Result<ToolResult> {
        self.call("computer_speak", args)
    }

    /// Async variant of [`Winclean::computer_speak`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_speak_async(&self, args: &ComputerSpeakArgs) -> Result<ToolResult> {
        self.call_async("computer_speak", args).await
    }

    /// Types literal Unicode text into a selected application. Focuses the point first; set
    /// clear=true to replace the current field. x/y are relative to the observed window image.
    /// Maximum payload is 4096 characters per call. Re-observe before submitting or pressing Enter.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn computer_type(&self, args: &ComputerTypeArgs) -> Result<ToolResult> {
        self.call("computer_type", args)
    }

    /// Async variant of [`Winclean::computer_type`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn computer_type_async(&self, args: &ComputerTypeArgs) -> Result<ToolResult> {
        self.call_async("computer_type", args).await
    }

    /// Publish a new .coord/CURRENT_TASK.md. The full body is the markdown content. Returns JSON
    /// {ok,bytes,path}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn coord_assign_task(&self, args: &CoordAssignTaskArgs) -> Result<ToolResult> {
        self.call("coord_assign_task", args)
    }

    /// Async variant of [`Winclean::coord_assign_task`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn coord_assign_task_async(&self, args: &CoordAssignTaskArgs) -> Result<ToolResult> {
        self.call_async("coord_assign_task", args).await
    }

    /// Check the A2A kill switch — presence of .coord/STOP. Returns JSON {ok,stop:true|false}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn coord_query_stop(&self, args: &CoordQueryStopArgs) -> Result<ToolResult> {
        self.call("coord_query_stop", args)
    }

    /// Async variant of [`Winclean::coord_query_stop`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn coord_query_stop_async(&self, args: &CoordQueryStopArgs) -> Result<ToolResult> {
        self.call_async("coord_query_stop", args).await
    }

    /// Read the latest status block for an agent from .coord/STATUS_<AGENT>.txt. Returns JSON
    /// {ok,agent,status} (status='' when the file is absent).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn coord_read_status(&self, args: &CoordReadStatusArgs) -> Result<ToolResult> {
        self.call("coord_read_status", args)
    }

    /// Async variant of [`Winclean::coord_read_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn coord_read_status_async(&self, args: &CoordReadStatusArgs) -> Result<ToolResult> {
        self.call_async("coord_read_status", args).await
    }

    /// Read the current .coord/CURRENT_TASK.md. Returns JSON {ok,content} (content='' when absent).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn coord_read_task(&self, args: &CoordReadTaskArgs) -> Result<ToolResult> {
        self.call("coord_read_task", args)
    }

    /// Async variant of [`Winclean::coord_read_task`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn coord_read_task_async(&self, args: &CoordReadTaskArgs) -> Result<ToolResult> {
        self.call_async("coord_read_task", args).await
    }

    /// Write the status block for an agent. The block goes to .coord/STATUS_<AGENT>.txt where
    /// <AGENT> is the upper-case form of `agent`. Returns JSON {ok,agent,bytes}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn coord_report_status(&self, args: &CoordReportStatusArgs) -> Result<ToolResult> {
        self.call("coord_report_status", args)
    }

    /// Async variant of [`Winclean::coord_report_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn coord_report_status_async(
        &self,
        args: &CoordReportStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("coord_report_status", args).await
    }

    /// Copies a file or directory to a destination.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn copy_path(&self, args: &CopyPathArgs) -> Result<ToolResult> {
        self.call("copy_path", args)
    }

    /// Async variant of [`Winclean::copy_path`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn copy_path_async(&self, args: &CopyPathArgs) -> Result<ToolResult> {
        self.call_async("copy_path", args).await
    }

    /// Deletes a file or directory. Set recursive=true for non-empty directories.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn delete_path(&self, args: &DeletePathArgs) -> Result<ToolResult> {
        self.call("delete_path", args)
    }

    /// Async variant of [`Winclean::delete_path`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn delete_path_async(&self, args: &DeletePathArgs) -> Result<ToolResult> {
        self.call_async("delete_path", args).await
    }

    /// Deletes a registry value (when name is set) or the entire key (when name is null/empty).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn delete_registry_entry(&self, args: &DeleteRegistryEntryArgs) -> Result<ToolResult> {
        self.call("delete_registry_entry", args)
    }

    /// Async variant of [`Winclean::delete_registry_entry`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn delete_registry_entry_async(
        &self,
        args: &DeleteRegistryEntryArgs,
    ) -> Result<ToolResult> {
        self.call_async("delete_registry_entry", args).await
    }

    /// Disables a scheduled task via schtasks /Change /Disable.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn disable_scheduled_task(&self, args: &DisableScheduledTaskArgs) -> Result<ToolResult> {
        self.call("disable_scheduled_task", args)
    }

    /// Async variant of [`Winclean::disable_scheduled_task`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn disable_scheduled_task_async(
        &self,
        args: &DisableScheduledTaskArgs,
    ) -> Result<ToolResult> {
        self.call_async("disable_scheduled_task", args).await
    }

    /// Enables a scheduled task via schtasks /Change /Enable.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn enable_scheduled_task(&self, args: &EnableScheduledTaskArgs) -> Result<ToolResult> {
        self.call("enable_scheduled_task", args)
    }

    /// Async variant of [`Winclean::enable_scheduled_task`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn enable_scheduled_task_async(
        &self,
        args: &EnableScheduledTaskArgs,
    ) -> Result<ToolResult> {
        self.call_async("enable_scheduled_task", args).await
    }

    /// Allocates a virtual Xbox 360 controller via ViGEmBus and connects it to the system. The
    /// virtual controller is indexed by slotIndex (0–7). Returns
    /// {"success":true,"slot":N,"vendorId":"045e","productId":"028e"} on success. Requires
    /// ViGEmBus: https://github.com/nefarius/ViGEmBus/releases
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_create_xbox360(&self, args: &GamepadCreateXbox360Args) -> Result<ToolResult> {
        self.call("gamepad_create_xbox360", args)
    }

    /// Async variant of [`Winclean::gamepad_create_xbox360`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_create_xbox360_async(
        &self,
        args: &GamepadCreateXbox360Args,
    ) -> Result<ToolResult> {
        self.call_async("gamepad_create_xbox360", args).await
    }

    /// Removes and frees the virtual Xbox 360 controller at the given slot. Safe to call if the
    /// slot was never created (no-op).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_destroy(&self, args: &GamepadDestroyArgs) -> Result<ToolResult> {
        self.call("gamepad_destroy", args)
    }

    /// Async variant of [`Winclean::gamepad_destroy`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_destroy_async(&self, args: &GamepadDestroyArgs) -> Result<ToolResult> {
        self.call_async("gamepad_destroy", args).await
    }

    /// Removes and frees ALL active virtual Xbox 360 controllers created in this process. Use as
    /// cleanup before shutdown or when resetting gamepad state.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_destroy_all(&self, args: &GamepadDestroyAllArgs) -> Result<ToolResult> {
        self.call("gamepad_destroy_all", args)
    }

    /// Async variant of [`Winclean::gamepad_destroy_all`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_destroy_all_async(
        &self,
        args: &GamepadDestroyAllArgs,
    ) -> Result<ToolResult> {
        self.call_async("gamepad_destroy_all", args).await
    }

    /// Diagnoses the ViGEmBus virtual gamepad environment. Reports whether ViGEmBus registry key
    /// exists, whether the service is running, and whether ViGEmClient.dll can be located on disk.
    /// Install ViGEmBus from https://github.com/nefarius/ViGEmBus/releases if absent.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_environment(&self, args: &GamepadEnvironmentArgs) -> Result<ToolResult> {
        self.call("gamepad_environment", args)
    }

    /// Async variant of [`Winclean::gamepad_environment`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_environment_async(
        &self,
        args: &GamepadEnvironmentArgs,
    ) -> Result<ToolResult> {
        self.call_async("gamepad_environment", args).await
    }

    /// Presses one or more buttons on a virtual Xbox 360 controller then releases them. buttonMask
    /// uses the same bitmask as GamepadSendXbox360State. holdMs: how long to hold the buttons down
    /// (clamped to [1, 5000] ms).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_press_button(&self, args: &GamepadPressButtonArgs) -> Result<ToolResult> {
        self.call("gamepad_press_button", args)
    }

    /// Async variant of [`Winclean::gamepad_press_button`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_press_button_async(
        &self,
        args: &GamepadPressButtonArgs,
    ) -> Result<ToolResult> {
        self.call_async("gamepad_press_button", args).await
    }

    /// Sends a full Xbox 360 controller state update. buttons bitmask: DPAD_UP=1, DPAD_DOWN=2,
    /// DPAD_LEFT=4, DPAD_RIGHT=8, START=16, BACK=32, L3=64, R3=128, LB=256, RB=512, GUIDE=1024,
    /// A=4096, B=8192, X=16384, Y=32768. Axes lx/ly/rx/ry: [-32768, 32767]. Triggers lt/rt: [0,
    /// 255].
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gamepad_send_xbox360_state(
        &self,
        args: &GamepadSendXbox360StateArgs,
    ) -> Result<ToolResult> {
        self.call("gamepad_send_xbox360_state", args)
    }

    /// Async variant of [`Winclean::gamepad_send_xbox360_state`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gamepad_send_xbox360_state_async(
        &self,
        args: &GamepadSendXbox360StateArgs,
    ) -> Result<ToolResult> {
        self.call_async("gamepad_send_xbox360_state", args).await
    }

    /// Measures sustained capture throughput of a window for durationMs: GPU grabs with CPU
    /// readback per second (grabFps, grab latency avg/p95/max) and frames delivered by the
    /// compositor (deliveredFps). Windows also reports the GDI PrintWindow PNG rate for comparison.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_capture_benchmark(
        &self,
        args: &GamingCaptureBenchmarkArgs,
    ) -> Result<ToolResult> {
        self.call("gaming_capture_benchmark", args)
    }

    /// Async variant of [`Winclean::gaming_capture_benchmark`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_capture_benchmark_async(
        &self,
        args: &GamingCaptureBenchmarkArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_capture_benchmark", args).await
    }

    /// Low-latency capture of one game window. Windows: Windows.Graphics.Capture on a Direct3D 11
    /// device (works for DirectX/Vulkan and occluded windows; GDI PrintWindow fallback). Linux: X11
    /// import on DISPLAY (Xvfb :99 on the VPS session). Returns PNG plus backend, size and capture
    /// time.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_capture_window(&self, args: &GamingCaptureWindowArgs) -> Result<ToolResult> {
        self.call("gaming_capture_window", args)
    }

    /// Async variant of [`Winclean::gaming_capture_window`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_capture_window_async(
        &self,
        args: &GamingCaptureWindowArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_capture_window", args).await
    }

    /// Reports the gaming computer-use backends of this host: Windows.Graphics.Capture support,
    /// SendInput, XInput pad slots (read-only), GameInput runtime and whether the ViGEmBus driver
    /// needed for virtual Xbox pads is installed (never installed by this SDK); on Linux the X11
    /// display, xdotool, import, /dev/uinput and gamescope.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_environment(&self, args: &GamingEnvironmentArgs) -> Result<ToolResult> {
        self.call("gaming_environment", args)
    }

    /// Async variant of [`Winclean::gaming_environment`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_environment_async(
        &self,
        args: &GamingEnvironmentArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_environment", args).await
    }

    /// Observes a game window's presented frames for durationMs without hooking the game: fps,
    /// frame time avg/p50/p95/p99/min/max, jitter and 1% low, from DWM present timestamps
    /// (Windows.Graphics.Capture). A static window delivers no frames. Linux samples X11 content
    /// changes (bounded by the capture rate).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_frame_pacing(&self, args: &GamingFramePacingArgs) -> Result<ToolResult> {
        self.call("gaming_frame_pacing", args)
    }

    /// Async variant of [`Winclean::gaming_frame_pacing`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_frame_pacing_async(
        &self,
        args: &GamingFramePacingArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_frame_pacing", args).await
    }

    /// Read-only: background apps switch (BackgroundAccessApplications GlobalUserDisabled) and the
    /// LetAppsRunInBackground policy.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_get_background_apps(
        &self,
        args: &GamingGetBackgroundAppsArgs,
    ) -> Result<ToolResult> {
        self.call("gaming_get_background_apps", args)
    }

    /// Async variant of [`Winclean::gaming_get_background_apps`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_get_background_apps_async(
        &self,
        args: &GamingGetBackgroundAppsArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_get_background_apps", args).await
    }

    /// Read-only: Xbox Game Bar background recording and app capture (GameConfigStore
    /// GameDVR_Enabled, GameDVR AppCaptureEnabled, AllowGameDVR policy).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_get_game_bar_capture(
        &self,
        args: &GamingGetGameBarCaptureArgs,
    ) -> Result<ToolResult> {
        self.call("gaming_get_game_bar_capture", args)
    }

    /// Async variant of [`Winclean::gaming_get_game_bar_capture`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_get_game_bar_capture_async(
        &self,
        args: &GamingGetGameBarCaptureArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_get_game_bar_capture", args).await
    }

    /// Read-only: Windows Game Mode (HKCU GameBar AutoGameModeEnabled / AllowAutoGameMode) with the
    /// recommended value.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_get_game_mode(&self, args: &GamingGetGameModeArgs) -> Result<ToolResult> {
        self.call("gaming_get_game_mode", args)
    }

    /// Async variant of [`Winclean::gaming_get_game_mode`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_get_game_mode_async(
        &self,
        args: &GamingGetGameModeArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_get_game_mode", args).await
    }

    /// Read-only: NVIDIA GPU state through nvidia-smi/NVML (name, driver, P-state, power limit and
    /// draw, clocks, temperature, utilisation, memory, PCIe link), hardware-accelerated GPU
    /// scheduling and per-app GPU preferences.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_get_gpu_info(&self, args: &GamingGetGpuInfoArgs) -> Result<ToolResult> {
        self.call("gaming_get_gpu_info", args)
    }

    /// Async variant of [`Winclean::gaming_get_gpu_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_get_gpu_info_async(
        &self,
        args: &GamingGetGpuInfoArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_get_gpu_info", args).await
    }

    /// Read-only: current, finest and coarsest kernel timer resolution (NtQueryTimerResolution) and
    /// the Windows 11 GlobalTimerResolutionRequests setting.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_get_timer_resolution(
        &self,
        args: &GamingGetTimerResolutionArgs,
    ) -> Result<ToolResult> {
        self.call("gaming_get_timer_resolution", args)
    }

    /// Async variant of [`Winclean::gaming_get_timer_resolution`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_get_timer_resolution_async(
        &self,
        args: &GamingGetTimerResolutionArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_get_timer_resolution", args).await
    }

    /// Plays a timed input sequence in one call for frame-accurate combos: events
    /// [{type:'move',dx,dy} | {type:'key',key|scanCode,action:down|up|tap,holdMs} |
    /// {type:'button',button,action:down|up|click,holdMs} | {type:'wait',ms}], each optionally
    /// scheduled at atMs from the start. Reports the worst scheduling lateness.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_input_sequence(&self, args: &GamingInputSequenceArgs) -> Result<ToolResult> {
        self.call("gaming_input_sequence", args)
    }

    /// Async variant of [`Winclean::gaming_input_sequence`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_input_sequence_async(
        &self,
        args: &GamingInputSequenceArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_input_sequence", args).await
    }

    /// Sends a keyboard key as a hardware scan code (SendInput KEYEVENTF_SCANCODE; Linux: xdotool
    /// keysym) so games that read scan codes or raw input see it: down, up, tap or hold for holdMs,
    /// repeated with intervalMs.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_key(&self, args: &GamingKeyArgs) -> Result<ToolResult> {
        self.call("gaming_key", args)
    }

    /// Async variant of [`Winclean::gaming_key`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_key_async(&self, args: &GamingKeyArgs) -> Result<ToolResult> {
        self.call_async("gaming_key", args).await
    }

    /// Presses a mouse button through SendInput (Linux: xdotool): down, up, or click with holdMs.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_mouse_button(&self, args: &GamingMouseButtonArgs) -> Result<ToolResult> {
        self.call("gaming_mouse_button", args)
    }

    /// Async variant of [`Winclean::gaming_mouse_button`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_mouse_button_async(
        &self,
        args: &GamingMouseButtonArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_mouse_button", args).await
    }

    /// Sends raw relative mouse motion (SendInput MOUSEEVENTF_MOVE, no absolute positioning) as
    /// games reading raw input expect: dx/dy split exactly across steps sent at rateHz with
    /// sub-millisecond pacing. Linux: xdotool mousemove_relative. Reports achieved rate and cursor
    /// before/after.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_mouse_delta(&self, args: &GamingMouseDeltaArgs) -> Result<ToolResult> {
        self.call("gaming_mouse_delta", args)
    }

    /// Async variant of [`Winclean::gaming_mouse_delta`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_mouse_delta_async(
        &self,
        args: &GamingMouseDeltaArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_mouse_delta", args).await
    }

    /// Applies the pending gaming profile items (registry values and power plan). Changes Windows
    /// settings: requires confirm=true and is meant to be run by the machine owner; dryRun=true
    /// only returns the command.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_profile_apply(&self, args: &GamingProfileApplyArgs) -> Result<ToolResult> {
        self.call("gaming_profile_apply", args)
    }

    /// Async variant of [`Winclean::gaming_profile_apply`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_profile_apply_async(
        &self,
        args: &GamingProfileApplyArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_profile_apply", args).await
    }

    /// Read-only gaming optimisation report: Game Mode, HAGS, power plan, background apps, Game Bar
    /// capture, timer resolution and GPU, each with current and recommended values, the pending
    /// items and applyCommand, the exact PowerShell one-liner the owner runs (elevated) to apply
    /// them.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_profile_status(&self, args: &GamingProfileStatusArgs) -> Result<ToolResult> {
        self.call("gaming_profile_status", args)
    }

    /// Async variant of [`Winclean::gaming_profile_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_profile_status_async(
        &self,
        args: &GamingProfileStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_profile_status", args).await
    }

    /// Launches an installed Steam game through the bun-steam owner (steam://rungameid/<appId>),
    /// then waits for its window by processName or windowTitle and brings it to the foreground for
    /// capture and input.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn gaming_steam_launch(&self, args: &GamingSteamLaunchArgs) -> Result<ToolResult> {
        self.call("gaming_steam_launch", args)
    }

    /// Async variant of [`Winclean::gaming_steam_launch`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn gaming_steam_launch_async(
        &self,
        args: &GamingSteamLaunchArgs,
    ) -> Result<ToolResult> {
        self.call_async("gaming_steam_launch", args).await
    }

    /// Returns the GUID and friendly name of the active Windows power plan.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_active_power_plan(&self, args: &GetActivePowerPlanArgs) -> Result<ToolResult> {
        self.call("get_active_power_plan", args)
    }

    /// Async variant of [`Winclean::get_active_power_plan`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_active_power_plan_async(
        &self,
        args: &GetActivePowerPlanArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_active_power_plan", args).await
    }

    /// Reads UTF-16 text content from the Windows clipboard.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_clipboard_text(&self, args: &GetClipboardTextArgs) -> Result<ToolResult> {
        self.call("get_clipboard_text", args)
    }

    /// Async variant of [`Winclean::get_clipboard_text`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_clipboard_text_async(
        &self,
        args: &GetClipboardTextArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_clipboard_text", args).await
    }

    /// Returns CPU topology as JSON: logical processors, physical cores, NUMA nodes, cache sizes
    /// (L1/L2/L3 aggregate), architecture.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_cpu_info(&self, args: &GetCpuInfoArgs) -> Result<ToolResult> {
        self.call("get_cpu_info", args)
    }

    /// Async variant of [`Winclean::get_cpu_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_cpu_info_async(&self, args: &GetCpuInfoArgs) -> Result<ToolResult> {
        self.call_async("get_cpu_info", args).await
    }

    /// Samples global CPU usage over a short interval (default 250 ms, clamp 50-2000) via
    /// GetSystemTimes. Returns usage/idle percent and raw idle/kernel/user deltas in seconds.
    /// Kernel time as reported by Windows INCLUDES idle time; this tool subtracts it before
    /// computing the percentage.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_cpu_usage(&self, args: &GetCpuUsageArgs) -> Result<ToolResult> {
        self.call("get_cpu_usage", args)
    }

    /// Async variant of [`Winclean::get_cpu_usage`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_cpu_usage_async(&self, args: &GetCpuUsageArgs) -> Result<ToolResult> {
        self.call_async("get_cpu_usage", args).await
    }

    /// Returns Windows Defender state as JSON: AntivirusEnabled, RealTimeProtectionEnabled,
    /// BehaviorMonitorEnabled, TamperProtected, AntivirusSignatureVersion, LastQuickScanStartUtc,
    /// LastFullScanStartUtc, ThreatCount.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_defender_status(&self, args: &GetDefenderStatusArgs) -> Result<ToolResult> {
        self.call("get_defender_status", args)
    }

    /// Async variant of [`Winclean::get_defender_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_defender_status_async(
        &self,
        args: &GetDefenderStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_defender_status", args).await
    }

    /// Returns logical-drive info (root, type, total/free/available bytes) as JSON via
    /// GetLogicalDriveStrings + GetDiskFreeSpaceEx.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_disk_info(&self, args: &GetDiskInfoArgs) -> Result<ToolResult> {
        self.call("get_disk_info", args)
    }

    /// Async variant of [`Winclean::get_disk_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_disk_info_async(&self, args: &GetDiskInfoArgs) -> Result<ToolResult> {
        self.call_async("get_disk_info", args).await
    }

    /// Returns metadata for a file or directory as JSON: size, dates, type, hidden flag.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_file_info(&self, args: &GetFileInfoArgs) -> Result<ToolResult> {
        self.call("get_file_info", args)
    }

    /// Async variant of [`Winclean::get_file_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_file_info_async(&self, args: &GetFileInfoArgs) -> Result<ToolResult> {
        self.call_async("get_file_info", args).await
    }

    /// Reads all per-app GPU preferences from HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences.
    /// Returns each registered exe path with its raw preference string ('GpuPreference=N;').
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_gpu_preferences(&self, args: &GetGpuPreferencesArgs) -> Result<ToolResult> {
        self.call("get_gpu_preferences", args)
    }

    /// Async variant of [`Winclean::get_gpu_preferences`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_gpu_preferences_async(
        &self,
        args: &GetGpuPreferencesArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_gpu_preferences", args).await
    }

    /// Reads HKLM\System\CurrentControlSet\Control\GraphicsDrivers\HwSchMode. 0 = WDDM CPU
    /// scheduling, 1 = OS-managed default, 2 = Hardware-Accelerated GPU Scheduling. Requires WDDM
    /// 2.7+ (Win10 20H1+ / Win11). Reboot to take effect.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_hags_mode(&self, args: &GetHagsModeArgs) -> Result<ToolResult> {
        self.call("get_hags_mode", args)
    }

    /// Async variant of [`Winclean::get_hags_mode`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_hags_mode_async(&self, args: &GetHagsModeArgs) -> Result<ToolResult> {
        self.call_async("get_hags_mode", args).await
    }

    /// Returns physical / virtual / page-file memory state as JSON via GlobalMemoryStatusEx.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_memory_info(&self, args: &GetMemoryInfoArgs) -> Result<ToolResult> {
        self.call("get_memory_info", args)
    }

    /// Async variant of [`Winclean::get_memory_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_memory_info_async(&self, args: &GetMemoryInfoArgs) -> Result<ToolResult> {
        self.call_async("get_memory_info", args).await
    }

    /// Lists network adapters (Name, Description, Status, MAC, link speed, IPv4 addresses) as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_network_adapters(&self, args: &GetNetworkAdaptersArgs) -> Result<ToolResult> {
        self.call("get_network_adapters", args)
    }

    /// Async variant of [`Winclean::get_network_adapters`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_network_adapters_async(
        &self,
        args: &GetNetworkAdaptersArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_network_adapters", args).await
    }

    /// Returns OS version info (ProductName, EditionId, DisplayVersion, BuildNumber, UBR,
    /// InstallationType, OSArchitecture, MachineName, UserName) as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_os_info(&self, args: &GetOsInfoArgs) -> Result<ToolResult> {
        self.call("get_os_info", args)
    }

    /// Async variant of [`Winclean::get_os_info`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_os_info_async(&self, args: &GetOsInfoArgs) -> Result<ToolResult> {
        self.call_async("get_os_info", args).await
    }

    /// Reads a registry value. Path uses PowerShell-style hive prefixes (HKCU:\, HKLM:\, HKCR:\,
    /// HKU:\, HKCC:\).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_registry_value(&self, args: &GetRegistryValueArgs) -> Result<ToolResult> {
        self.call("get_registry_value", args)
    }

    /// Async variant of [`Winclean::get_registry_value`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_registry_value_async(
        &self,
        args: &GetRegistryValueArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_registry_value", args).await
    }

    /// Récupère le profil système complet pour vérifier l'état d'optimisation du poste.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn get_system_profile(&self, args: &GetSystemProfileArgs) -> Result<ToolResult> {
        self.call("get_system_profile", args)
    }

    /// Async variant of [`Winclean::get_system_profile`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn get_system_profile_async(
        &self,
        args: &GetSystemProfileArgs,
    ) -> Result<ToolResult> {
        self.call_async("get_system_profile", args).await
    }

    /// Inspects a target binary for Golang runtime signatures (pclntab) and extracts Go
    /// package/symbol indicators. Passive inspection without execution.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn golang_scan(&self, args: &GolangScanArgs) -> Result<ToolResult> {
        self.call("golang_scan", args)
    }

    /// Async variant of [`Winclean::golang_scan`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn golang_scan_async(&self, args: &GolangScanArgs) -> Result<ToolResult> {
        self.call_async("golang_scan", args).await
    }

    /// Holds an arbitrary virtual key down (no release). Pair with KeyboardRelease to let go.
    /// Useful for charging mechanics, sustained movement keys, modifiers held across multiple ops.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn keyboard_hold(&self, args: &KeyboardHoldArgs) -> Result<ToolResult> {
        self.call("keyboard_hold", args)
    }

    /// Async variant of [`Winclean::keyboard_hold`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn keyboard_hold_async(&self, args: &KeyboardHoldArgs) -> Result<ToolResult> {
        self.call_async("keyboard_hold", args).await
    }

    /// Releases a virtual key previously held by KeyboardHold.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn keyboard_release(&self, args: &KeyboardReleaseArgs) -> Result<ToolResult> {
        self.call("keyboard_release", args)
    }

    /// Async variant of [`Winclean::keyboard_release`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn keyboard_release_async(&self, args: &KeyboardReleaseArgs) -> Result<ToolResult> {
        self.call_async("keyboard_release", args).await
    }

    /// Sends a single key by raw hardware SCAN CODE instead of virtual key. Some games (and
    /// anti-cheats) ignore Send-Input from virtual keys but accept scan codes because they match
    /// real keyboards. action: 'down' | 'up' | 'tap' (down+up).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn keyboard_scan_code(&self, args: &KeyboardScanCodeArgs) -> Result<ToolResult> {
        self.call("keyboard_scan_code", args)
    }

    /// Async variant of [`Winclean::keyboard_scan_code`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn keyboard_scan_code_async(
        &self,
        args: &KeyboardScanCodeArgs,
    ) -> Result<ToolResult> {
        self.call_async("keyboard_scan_code", args).await
    }

    /// Kills a process by PID (preferred) or name. Returns the count of terminated processes.
    /// Force=true requests an immediate kill (default true). PPL-protected processes return a
    /// labelled error.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn kill_process(&self, args: &KillProcessArgs) -> Result<ToolResult> {
        self.call("kill_process", args)
    }

    /// Async variant of [`Winclean::kill_process`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn kill_process_async(&self, args: &KillProcessArgs) -> Result<ToolResult> {
        self.call_async("kill_process", args).await
    }

    /// Launches a Windows application. Accepts an absolute path to an .exe (e.g.
    /// 'C:\\Windows\\System32\\notepad.exe'), an executable name resolvable via PATH (e.g.
    /// 'notepad.exe'), or a shell URI (mailto:, explorer:, ms-settings:).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn launch_app(&self, args: &LaunchAppArgs) -> Result<ToolResult> {
        self.call("launch_app", args)
    }

    /// Async variant of [`Winclean::launch_app`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn launch_app_async(&self, args: &LaunchAppArgs) -> Result<ToolResult> {
        self.call_async("launch_app", args).await
    }

    /// Lists directory contents as streamed JSON. Set recursive=true to descend, showHidden=true to
    /// include hidden entries, pattern to filter by glob, and exclude to omit matching entry names
    /// and skip matching directories. Exclusion matching is ASCII case-insensitive. Hard cap: 10000
    /// entries returned; result is marked truncated when exceeded.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_directory(&self, args: &ListDirectoryArgs) -> Result<ToolResult> {
        self.call("list_directory", args)
    }

    /// Async variant of [`Winclean::list_directory`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_directory_async(&self, args: &ListDirectoryArgs) -> Result<ToolResult> {
        self.call_async("list_directory", args).await
    }

    /// Lists TCP/IPv4 listening ports (LISTEN state only) as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_listening_ports(&self, args: &ListListeningPortsArgs) -> Result<ToolResult> {
        self.call("list_listening_ports", args)
    }

    /// Async variant of [`Winclean::list_listening_ports`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_listening_ports_async(
        &self,
        args: &ListListeningPortsArgs,
    ) -> Result<ToolResult> {
        self.call_async("list_listening_ports", args).await
    }

    /// Lists installed Windows power plans with their GUID, friendly name, and whether they are
    /// currently active. Returns JSON with the active GUID at the top.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_power_plans(&self, args: &ListPowerPlansArgs) -> Result<ToolResult> {
        self.call("list_power_plans", args)
    }

    /// Async variant of [`Winclean::list_power_plans`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_power_plans_async(&self, args: &ListPowerPlansArgs) -> Result<ToolResult> {
        self.call_async("list_power_plans", args).await
    }

    /// Lists running processes as JSON. Filter by name (substring, case-insensitive). Sort by
    /// 'memory' (default), 'private', 'cpu', 'threads', 'handles' or 'name'. Limit caps the result
    /// count (default 20, max 1000). Backed by NtQuerySystemInformation for a single-syscall
    /// enumeration with full per-process metrics.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_processes(&self, args: &ListProcessesArgs) -> Result<ToolResult> {
        self.call("list_processes", args)
    }

    /// Async variant of [`Winclean::list_processes`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_processes_async(&self, args: &ListProcessesArgs) -> Result<ToolResult> {
        self.call_async("list_processes", args).await
    }

    /// Lists sub-keys and values under a registry key as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_registry_key(&self, args: &ListRegistryKeyArgs) -> Result<ToolResult> {
        self.call("list_registry_key", args)
    }

    /// Async variant of [`Winclean::list_registry_key`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_registry_key_async(&self, args: &ListRegistryKeyArgs) -> Result<ToolResult> {
        self.call_async("list_registry_key", args).await
    }

    /// Lists scheduled tasks under the given folder (default = root '\') via schtasks /Query.
    /// Returns JSON: Path, Name, State, LastRunTimeUtc, LastTaskResult, Enabled.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_scheduled_tasks(&self, args: &ListScheduledTasksArgs) -> Result<ToolResult> {
        self.call("list_scheduled_tasks", args)
    }

    /// Async variant of [`Winclean::list_scheduled_tasks`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_scheduled_tasks_async(
        &self,
        args: &ListScheduledTasksArgs,
    ) -> Result<ToolResult> {
        self.call_async("list_scheduled_tasks", args).await
    }

    /// Lists Windows services as JSON. Filter by name substring (case-insensitive) and/or by
    /// status: Running, Stopped, Paused, StartPending, StopPending.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_services(&self, args: &ListServicesArgs) -> Result<ToolResult> {
        self.call("list_services", args)
    }

    /// Async variant of [`Winclean::list_services`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_services_async(&self, args: &ListServicesArgs) -> Result<ToolResult> {
        self.call_async("list_services", args).await
    }

    /// Lists active TCP/IPv4 connections (Local/Remote address+port, state, owning PID) as JSON.
    /// Optional state filter (Listen, Established, CloseWait, TimeWait, Closed, SynSent, etc.).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_tcp_connections(&self, args: &ListTcpConnectionsArgs) -> Result<ToolResult> {
        self.call("list_tcp_connections", args)
    }

    /// Async variant of [`Winclean::list_tcp_connections`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_tcp_connections_async(
        &self,
        args: &ListTcpConnectionsArgs,
    ) -> Result<ToolResult> {
        self.call_async("list_tcp_connections", args).await
    }

    /// Lists all visible top-level windows as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn list_windows(&self, args: &ListWindowsArgs) -> Result<ToolResult> {
        self.call("list_windows", args)
    }

    /// Async variant of [`Winclean::list_windows`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn list_windows_async(&self, args: &ListWindowsArgs) -> Result<ToolResult> {
        self.call_async("list_windows", args).await
    }

    /// Allocates virtual memory in a remote process via VirtualAllocEx. Returns the base address of
    /// the new region. protect: 'rw' (PAGE_READWRITE), 'rwx' (PAGE_EXECUTE_READWRITE), 'rx'
    /// (PAGE_EXECUTE_READ).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_allocate(&self, args: &MemAllocateArgs) -> Result<ToolResult> {
        self.call("mem_allocate", args)
    }

    /// Async variant of [`Winclean::mem_allocate`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_allocate_async(&self, args: &MemAllocateArgs) -> Result<ToolResult> {
        self.call_async("mem_allocate", args).await
    }

    /// Reads up to MAX_DUMP_BYTES (4 MiB) from a memory region and writes them to a host-side file
    /// (default: %TEMP%\winclean_mcp_dump_<pid>_<addr>.bin). Returns the path and sha256 of the
    /// dump. Suspends the target during the read if suspend=true (avoids torn pages).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_dump_region(&self, args: &MemDumpRegionArgs) -> Result<ToolResult> {
        self.call("mem_dump_region", args)
    }

    /// Async variant of [`Winclean::mem_dump_region`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_dump_region_async(&self, args: &MemDumpRegionArgs) -> Result<ToolResult> {
        self.call_async("mem_dump_region", args).await
    }

    /// Enables SeDebugPrivilege on the current MCP process so subsequent OpenProcess calls can
    /// attach to protected processes (most non-PPL user-mode targets). Idempotent — safe to call
    /// repeatedly.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_enable_debug_privilege(
        &self,
        args: &MemEnableDebugPrivilegeArgs,
    ) -> Result<ToolResult> {
        self.call("mem_enable_debug_privilege", args)
    }

    /// Async variant of [`Winclean::mem_enable_debug_privilege`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_enable_debug_privilege_async(
        &self,
        args: &MemEnableDebugPrivilegeArgs,
    ) -> Result<ToolResult> {
        self.call_async("mem_enable_debug_privilege", args).await
    }

    /// Releases a region previously allocated with MemAllocate (MEM_RELEASE).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_free(&self, args: &MemFreeArgs) -> Result<ToolResult> {
        self.call("mem_free", args)
    }

    /// Async variant of [`Winclean::mem_free`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_free_async(&self, args: &MemFreeArgs) -> Result<ToolResult> {
        self.call_async("mem_free", args).await
    }

    /// Returns the base address and size of a named module in a process. Name comparison is
    /// case-insensitive. Returns the first match.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_get_module_base(&self, args: &MemGetModuleBaseArgs) -> Result<ToolResult> {
        self.call("mem_get_module_base", args)
    }

    /// Async variant of [`Winclean::mem_get_module_base`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_get_module_base_async(
        &self,
        args: &MemGetModuleBaseArgs,
    ) -> Result<ToolResult> {
        self.call_async("mem_get_module_base", args).await
    }

    /// Lists all loaded modules (DLLs + EXE) of a process. Returns name, baseAddress, and
    /// sizeOfImage for each module.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_list_modules(&self, args: &MemListModulesArgs) -> Result<ToolResult> {
        self.call("mem_list_modules", args)
    }

    /// Async variant of [`Winclean::mem_list_modules`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_list_modules_async(&self, args: &MemListModulesArgs) -> Result<ToolResult> {
        self.call_async("mem_list_modules", args).await
    }

    /// Lists running processes filtered by name substring (case-insensitive). Returns pid, name,
    /// and sessionId for each match. Leave nameFilter empty to list all processes (capped at 512).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_list_processes(&self, args: &MemListProcessesArgs) -> Result<ToolResult> {
        self.call("mem_list_processes", args)
    }

    /// Async variant of [`Winclean::mem_list_processes`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_list_processes_async(
        &self,
        args: &MemListProcessesArgs,
    ) -> Result<ToolResult> {
        self.call_async("mem_list_processes", args).await
    }

    /// Changes page protection on a memory region via VirtualProtectEx. Returns the previous
    /// protection flags. protect: rw | rwx | rx | ro | noaccess.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_protect(&self, args: &MemProtectArgs) -> Result<ToolResult> {
        self.call("mem_protect", args)
    }

    /// Async variant of [`Winclean::mem_protect`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_protect_async(&self, args: &MemProtectArgs) -> Result<ToolResult> {
        self.call_async("mem_protect", args).await
    }

    /// Queries the virtual memory region containing the given address via VirtualQueryEx. Returns
    /// BaseAddress, RegionSize, State (Free/Reserve/Commit), Protect flags, and Type
    /// (Private/Image/Mapped).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_query_region(&self, args: &MemQueryRegionArgs) -> Result<ToolResult> {
        self.call("mem_query_region", args)
    }

    /// Async variant of [`Winclean::mem_query_region`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_query_region_async(&self, args: &MemQueryRegionArgs) -> Result<ToolResult> {
        self.call_async("mem_query_region", args).await
    }

    /// Reads raw bytes from a process's virtual address space via ReadProcessMemory. Length is
    /// capped at 65536 bytes. Returns hex-encoded bytes in the 'hex' field.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_bytes(&self, args: &MemReadBytesArgs) -> Result<ToolResult> {
        self.call("mem_read_bytes", args)
    }

    /// Async variant of [`Winclean::mem_read_bytes`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_bytes_async(&self, args: &MemReadBytesArgs) -> Result<ToolResult> {
        self.call_async("mem_read_bytes", args).await
    }

    /// Reads a null-terminated ASCII C-string from a process's virtual memory. Stops at the first
    /// NUL byte or maxLength bytes, whichever comes first.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_c_string(&self, args: &MemReadCStringArgs) -> Result<ToolResult> {
        self.call("mem_read_c_string", args)
    }

    /// Async variant of [`Winclean::mem_read_c_string`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_c_string_async(&self, args: &MemReadCStringArgs) -> Result<ToolResult> {
        self.call_async("mem_read_c_string", args).await
    }

    /// Reads a 64-bit IEEE 754 double (little-endian) from a process's virtual memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_double(&self, args: &MemReadDoubleArgs) -> Result<ToolResult> {
        self.call("mem_read_double", args)
    }

    /// Async variant of [`Winclean::mem_read_double`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_double_async(&self, args: &MemReadDoubleArgs) -> Result<ToolResult> {
        self.call_async("mem_read_double", args).await
    }

    /// Reads a 32-bit IEEE 754 float (little-endian) from a process's virtual memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_float(&self, args: &MemReadFloatArgs) -> Result<ToolResult> {
        self.call("mem_read_float", args)
    }

    /// Async variant of [`Winclean::mem_read_float`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_float_async(&self, args: &MemReadFloatArgs) -> Result<ToolResult> {
        self.call_async("mem_read_float", args).await
    }

    /// Reads a signed 32-bit integer (little-endian) from a process's virtual memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_int32(&self, args: &MemReadInt32Args) -> Result<ToolResult> {
        self.call("mem_read_int32", args)
    }

    /// Async variant of [`Winclean::mem_read_int32`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_int32_async(&self, args: &MemReadInt32Args) -> Result<ToolResult> {
        self.call_async("mem_read_int32", args).await
    }

    /// Reads a signed 64-bit integer (little-endian) from a process's virtual memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_int64(&self, args: &MemReadInt64Args) -> Result<ToolResult> {
        self.call("mem_read_int64", args)
    }

    /// Async variant of [`Winclean::mem_read_int64`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_int64_async(&self, args: &MemReadInt64Args) -> Result<ToolResult> {
        self.call_async("mem_read_int64", args).await
    }

    /// Reads a null-terminated UTF-16LE wide string from a process's virtual memory. Stops at the
    /// first NUL char or maxChars characters, whichever comes first.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_read_utf16(&self, args: &MemReadUtf16Args) -> Result<ToolResult> {
        self.call("mem_read_utf16", args)
    }

    /// Async variant of [`Winclean::mem_read_utf16`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_read_utf16_async(&self, args: &MemReadUtf16Args) -> Result<ToolResult> {
        self.call_async("mem_read_utf16", args).await
    }

    /// Resumes every thread of the target process via NtResumeProcess.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_resume_process(&self, args: &MemResumeProcessArgs) -> Result<ToolResult> {
        self.call("mem_resume_process", args)
    }

    /// Async variant of [`Winclean::mem_resume_process`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_resume_process_async(
        &self,
        args: &MemResumeProcessArgs,
    ) -> Result<ToolResult> {
        self.call_async("mem_resume_process", args).await
    }

    /// Scans a module's memory range for an IDA-style byte pattern (Array-of-Bytes scan). Pattern
    /// format: hex bytes separated by spaces, '??' as wildcard. Example: '48 8B 05 ?? ?? ?? ?? 48
    /// 89 01'. Reads the module in 256 KiB chunks. Returns up to maxHits matching addresses.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_scan_aob(&self, args: &MemScanAobArgs) -> Result<ToolResult> {
        self.call("mem_scan_aob", args)
    }

    /// Async variant of [`Winclean::mem_scan_aob`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_scan_aob_async(&self, args: &MemScanAobArgs) -> Result<ToolResult> {
        self.call_async("mem_scan_aob", args).await
    }

    /// Cheat-Engine-style first scan: searches every committed RW page of the process for a 4-byte
    /// little-endian int32 value. Returns up to maxHits absolute addresses. Use MemReadInt32 to
    /// verify, then narrow via repeated scans.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_scan_value_int32(&self, args: &MemScanValueInt32Args) -> Result<ToolResult> {
        self.call("mem_scan_value_int32", args)
    }

    /// Async variant of [`Winclean::mem_scan_value_int32`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_scan_value_int32_async(
        &self,
        args: &MemScanValueInt32Args,
    ) -> Result<ToolResult> {
        self.call_async("mem_scan_value_int32", args).await
    }

    /// Suspends every thread of the target process via NtSuspendProcess.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_suspend_process(&self, args: &MemSuspendProcessArgs) -> Result<ToolResult> {
        self.call("mem_suspend_process", args)
    }

    /// Async variant of [`Winclean::mem_suspend_process`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_suspend_process_async(
        &self,
        args: &MemSuspendProcessArgs,
    ) -> Result<ToolResult> {
        self.call_async("mem_suspend_process", args).await
    }

    /// Writes raw bytes to a process's virtual memory via WriteProcessMemory. hex format:
    /// continuous hex digits (e.g. '48895c2408') or space-separated ('48 89 5c 24 08'). Length
    /// capped at 65536. Requires PROCESS_VM_WRITE — call MemEnableDebugPrivilege first for
    /// protected targets.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_write_bytes(&self, args: &MemWriteBytesArgs) -> Result<ToolResult> {
        self.call("mem_write_bytes", args)
    }

    /// Async variant of [`Winclean::mem_write_bytes`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_write_bytes_async(&self, args: &MemWriteBytesArgs) -> Result<ToolResult> {
        self.call_async("mem_write_bytes", args).await
    }

    /// Writes a 64-bit IEEE 754 double to a process's memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_write_double(&self, args: &MemWriteDoubleArgs) -> Result<ToolResult> {
        self.call("mem_write_double", args)
    }

    /// Async variant of [`Winclean::mem_write_double`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_write_double_async(&self, args: &MemWriteDoubleArgs) -> Result<ToolResult> {
        self.call_async("mem_write_double", args).await
    }

    /// Writes a 32-bit IEEE 754 float to a process's memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_write_float(&self, args: &MemWriteFloatArgs) -> Result<ToolResult> {
        self.call("mem_write_float", args)
    }

    /// Async variant of [`Winclean::mem_write_float`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_write_float_async(&self, args: &MemWriteFloatArgs) -> Result<ToolResult> {
        self.call_async("mem_write_float", args).await
    }

    /// Writes a signed 32-bit little-endian integer to a process's memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_write_int32(&self, args: &MemWriteInt32Args) -> Result<ToolResult> {
        self.call("mem_write_int32", args)
    }

    /// Async variant of [`Winclean::mem_write_int32`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_write_int32_async(&self, args: &MemWriteInt32Args) -> Result<ToolResult> {
        self.call_async("mem_write_int32", args).await
    }

    /// Writes a signed 64-bit little-endian integer to a process's memory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mem_write_int64(&self, args: &MemWriteInt64Args) -> Result<ToolResult> {
        self.call("mem_write_int64", args)
    }

    /// Async variant of [`Winclean::mem_write_int64`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mem_write_int64_async(&self, args: &MemWriteInt64Args) -> Result<ToolResult> {
        self.call_async("mem_write_int64", args).await
    }

    /// Performs a mouse drag from (x1,y1) to (x2,y2) with intermediate cursor moves so the OS
    /// drag-recognition logic actually fires (some apps reject teleported clicks). button: 'left' |
    /// 'right' | 'middle'. steps: number of intermediate move events (default 20).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mouse_drag_to(&self, args: &MouseDragToArgs) -> Result<ToolResult> {
        self.call("mouse_drag_to", args)
    }

    /// Async variant of [`Winclean::mouse_drag_to`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mouse_drag_to_async(&self, args: &MouseDragToArgs) -> Result<ToolResult> {
        self.call_async("mouse_drag_to", args).await
    }

    /// Moves the mouse cursor smoothly along an interpolated path. Useful when the target window
    /// inspects MOUSEMOVE deltas (anti-automation heuristics) instead of a teleport via
    /// SetCursorPos. No button is pressed.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn mouse_move_smooth(&self, args: &MouseMoveSmoothArgs) -> Result<ToolResult> {
        self.call("mouse_move_smooth", args)
    }

    /// Async variant of [`Winclean::mouse_move_smooth`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn mouse_move_smooth_async(&self, args: &MouseMoveSmoothArgs) -> Result<ToolResult> {
        self.call_async("mouse_move_smooth", args).await
    }

    /// Moves the mouse cursor to the given screen coordinates. Set drag=true to perform a
    /// left-button drag from the current position to the target.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn move_(&self, args: &MoveArgs) -> Result<ToolResult> {
        self.call("move", args)
    }

    /// Async variant of [`Winclean::move_`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn move_async(&self, args: &MoveArgs) -> Result<ToolResult> {
        self.call_async("move", args).await
    }

    /// Moves or renames a file or directory.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn move_path(&self, args: &MovePathArgs) -> Result<ToolResult> {
        self.call("move_path", args)
    }

    /// Async variant of [`Winclean::move_path`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn move_path_async(&self, args: &MovePathArgs) -> Result<ToolResult> {
        self.call_async("move_path", args).await
    }

    /// Types the same text into multiple UIA elements identified by exact Name property. Takes a
    /// comma-separated label list and a single text payload. Resolves labels against a fresh
    /// Snapshot() of the foreground window.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn multi_edit(&self, args: &MultiEditArgs) -> Result<ToolResult> {
        self.call("multi_edit", args)
    }

    /// Async variant of [`Winclean::multi_edit`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn multi_edit_async(&self, args: &MultiEditArgs) -> Result<ToolResult> {
        self.call_async("multi_edit", args).await
    }

    /// Clicks multiple UI elements identified by exact UIA Name property. Takes a comma-separated
    /// label list. Returns a JSON summary of clicked / notFound. Resolves labels against a fresh
    /// Snapshot() of the foreground window.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn multi_select(&self, args: &MultiSelectArgs) -> Result<ToolResult> {
        self.call("multi_select", args)
    }

    /// Async variant of [`Winclean::multi_select`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn multi_select_async(&self, args: &MultiSelectArgs) -> Result<ToolResult> {
        self.call_async("multi_select", args).await
    }

    /// Forces the Desktop Window Manager to flush pending GPU work (DwmFlush). Useful right before
    /// / after a frame-rate critical operation to align with VBLANK.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn perf_dwm_flush(&self, args: &PerfDwmFlushArgs) -> Result<ToolResult> {
        self.call("perf_dwm_flush", args)
    }

    /// Async variant of [`Winclean::perf_dwm_flush`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn perf_dwm_flush_async(&self, args: &PerfDwmFlushArgs) -> Result<ToolResult> {
        self.call_async("perf_dwm_flush", args).await
    }

    /// Trims the working set of EVERY accessible process via NtSetSystemInformation
    /// (MemoryEmptyWorkingSets). Each process keeps its memory but pages are pushed to standby,
    /// freeing physical RAM immediately. No process is killed.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn perf_empty_working_sets(&self, args: &PerfEmptyWorkingSetsArgs) -> Result<ToolResult> {
        self.call("perf_empty_working_sets", args)
    }

    /// Async variant of [`Winclean::perf_empty_working_sets`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn perf_empty_working_sets_async(
        &self,
        args: &PerfEmptyWorkingSetsArgs,
    ) -> Result<ToolResult> {
        self.call_async("perf_empty_working_sets", args).await
    }

    /// Returns current physical and virtual memory pressure (MEMORYSTATUSEX). Use before/after
    /// PerfPurgeStandbyList or PerfEmptyWorkingSets to measure impact.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn perf_memory_status(&self, args: &PerfMemoryStatusArgs) -> Result<ToolResult> {
        self.call("perf_memory_status", args)
    }

    /// Async variant of [`Winclean::perf_memory_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn perf_memory_status_async(
        &self,
        args: &PerfMemoryStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("perf_memory_status", args).await
    }

    /// Purges the Windows memory standby list (cached pages that are no longer in any working set
    /// but kept around for re-use). Frees RAM instantly without touching working sets. Equivalent
    /// to RAMMap → Empty Standby List. Requires elevation.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn perf_purge_standby_list(&self, args: &PerfPurgeStandbyListArgs) -> Result<ToolResult> {
        self.call("perf_purge_standby_list", args)
    }

    /// Async variant of [`Winclean::perf_purge_standby_list`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn perf_purge_standby_list_async(
        &self,
        args: &PerfPurgeStandbyListArgs,
    ) -> Result<ToolResult> {
        self.call_async("perf_purge_standby_list", args).await
    }

    /// Toggles Win11 EcoQoS (PowerThrottling) on a process. EcoMode = on → process is throttled to
    /// E-cores and capped frequency (saves power). EcoMode = off → release throttling (max
    /// performance). Reset all overrides with mode='default'.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn perf_set_eco_mode(&self, args: &PerfSetEcoModeArgs) -> Result<ToolResult> {
        self.call("perf_set_eco_mode", args)
    }

    /// Async variant of [`Winclean::perf_set_eco_mode`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn perf_set_eco_mode_async(&self, args: &PerfSetEcoModeArgs) -> Result<ToolResult> {
        self.call_async("perf_set_eco_mode", args).await
    }

    /// Executes a PowerShell command and returns stdout, stderr, exit code, and duration as JSON.
    /// Uses pwsh (PowerShell 7) when available, falling back to powershell.exe. Captures both
    /// streams without launching a window.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn power_shell(&self, args: &PowerShellArgs) -> Result<ToolResult> {
        self.call("power_shell", args)
    }

    /// Async variant of [`Winclean::power_shell`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn power_shell_async(&self, args: &PowerShellArgs) -> Result<ToolResult> {
        self.call_async("power_shell", args).await
    }

    /// Queries a Windows Event Log channel via wevtapi and returns up to maxEvents entries (newest
    /// first) as JSON. Optional XPath filter (e.g. "*[System[Level=2]]" for Error-level only).
    /// Channel examples: Application, System, Security,
    /// Microsoft-Windows-WindowsUpdateClient/Operational.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn query_event_log(&self, args: &QueryEventLogArgs) -> Result<ToolResult> {
        self.call("query_event_log", args)
    }

    /// Async variant of [`Winclean::query_event_log`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn query_event_log_async(&self, args: &QueryEventLogArgs) -> Result<ToolResult> {
        self.call_async("query_event_log", args).await
    }

    /// Reads a UTF-8 text file. Supports optional line offset and limit for reading large files in
    /// chunks. Returns the content prefixed with the resolved absolute path.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn read_file(&self, args: &ReadFileArgs) -> Result<ToolResult> {
        self.call("read_file", args)
    }

    /// Async variant of [`Winclean::read_file`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn read_file_async(&self, args: &ReadFileArgs) -> Result<ToolResult> {
        self.call_async("read_file", args).await
    }

    /// Resizes / moves a window matched by title substring. Set width/height to 0 to keep current
    /// size.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn resize_window(&self, args: &ResizeWindowArgs) -> Result<ToolResult> {
        self.call("resize_window", args)
    }

    /// Async variant of [`Winclean::resize_window`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn resize_window_async(&self, args: &ResizeWindowArgs) -> Result<ToolResult> {
        self.call_async("resize_window", args).await
    }

    /// Restarts a Windows service. Stops then starts, waiting up to 10s per phase.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn restart_service(&self, args: &RestartServiceArgs) -> Result<ToolResult> {
        self.call("restart_service", args)
    }

    /// Async variant of [`Winclean::restart_service`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn restart_service_async(&self, args: &RestartServiceArgs) -> Result<ToolResult> {
        self.call_async("restart_service", args).await
    }

    /// Runs a scheduled task immediately via schtasks /Run.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn run_scheduled_task(&self, args: &RunScheduledTaskArgs) -> Result<ToolResult> {
        self.call("run_scheduled_task", args)
    }

    /// Async variant of [`Winclean::run_scheduled_task`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn run_scheduled_task_async(
        &self,
        args: &RunScheduledTaskArgs,
    ) -> Result<ToolResult> {
        self.call_async("run_scheduled_task", args).await
    }

    /// Fetches a URL via HTTP GET and returns extracted plain text (script/style stripped, tags
    /// removed). Caps: 4 MiB download, 200k extracted chars, 30s timeout. For richer extraction
    /// prefer the docs MCP server (microsoft_docs_fetch / winclean_universal_web_fetch).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn scrape(&self, args: &ScrapeArgs) -> Result<ToolResult> {
        self.call("scrape", args)
    }

    /// Async variant of [`Winclean::scrape`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn scrape_async(&self, args: &ScrapeArgs) -> Result<ToolResult> {
        self.call_async("scrape", args).await
    }

    /// Captures the primary monitor to a BMP file on disk. Returns the absolute file path.
    /// Width/height default to the full virtual screen.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn screenshot(&self, args: &ScreenshotArgs) -> Result<ToolResult> {
        self.call("screenshot", args)
    }

    /// Async variant of [`Winclean::screenshot`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn screenshot_async(&self, args: &ScreenshotArgs) -> Result<ToolResult> {
        self.call_async("screenshot", args).await
    }

    /// Scrolls at the given screen coordinates. axis: 'vertical' | 'horizontal'. direction: up/down
    /// for vertical, left/right for horizontal. wheelTimes is the number of wheel notches (each
    /// notch ≈ 3 lines).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn scroll(&self, args: &ScrollArgs) -> Result<ToolResult> {
        self.call("scroll", args)
    }

    /// Async variant of [`Winclean::scroll`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn scroll_async(&self, args: &ScrollArgs) -> Result<ToolResult> {
        self.call_async("scroll", args).await
    }

    /// Searches a directory tree for files matching a glob pattern. Exclude basenames with glob
    /// patterns; excluded directories are not traversed. Hard cap: 10000 results; result is marked
    /// truncated when exceeded.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn search_files(&self, args: &SearchFilesArgs) -> Result<ToolResult> {
        self.call("search_files", args)
    }

    /// Async variant of [`Winclean::search_files`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn search_files_async(&self, args: &SearchFilesArgs) -> Result<ToolResult> {
        self.call_async("search_files", args).await
    }

    /// Effectue une recherche sur le disque via l'indexeur natif Windows Search.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn search_windows(&self, args: &SearchWindowsArgs) -> Result<ToolResult> {
        self.call("search_windows", args)
    }

    /// Async variant of [`Winclean::search_windows`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn search_windows_async(&self, args: &SearchWindowsArgs) -> Result<ToolResult> {
        self.call_async("search_windows", args).await
    }

    /// Displays a Windows tray balloon notification with title and message. Note: balloon tips
    /// replace classic Win32 toasts; modern WinRT toast (requires WindowsAppSDK projection) is not
    /// yet wired up.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn send_notification(&self, args: &SendNotificationArgs) -> Result<ToolResult> {
        self.call("send_notification", args)
    }

    /// Async variant of [`Winclean::send_notification`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn send_notification_async(&self, args: &SendNotificationArgs) -> Result<ToolResult> {
        self.call_async("send_notification", args).await
    }

    /// Activates a Windows power plan by GUID. Common GUIDs: 381b4222-f694-41f0-9685-ff5bb260df2e
    /// (Balanced), 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (High performance),
    /// a1841308-3541-4fab-bc81-f71556f20b4a (Power saver), e9a42b02-d5df-448d-aa00-03f14749eb61
    /// (Ultimate Performance).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_active_power_plan(&self, args: &SetActivePowerPlanArgs) -> Result<ToolResult> {
        self.call("set_active_power_plan", args)
    }

    /// Async variant of [`Winclean::set_active_power_plan`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_active_power_plan_async(
        &self,
        args: &SetActivePowerPlanArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_active_power_plan", args).await
    }

    /// Writes UTF-16 text to the Windows clipboard.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_clipboard_text(&self, args: &SetClipboardTextArgs) -> Result<ToolResult> {
        self.call("set_clipboard_text", args)
    }

    /// Async variant of [`Winclean::set_clipboard_text`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_clipboard_text_async(
        &self,
        args: &SetClipboardTextArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_clipboard_text", args).await
    }

    /// Writes per-app GPU preference in HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences.
    /// preference: 'SystemDefault' (0), 'PowerSaving' (1, iGPU), 'HighPerformance' (2, dGPU).
    /// exePath should be the absolute path to the .exe. Takes effect on next process launch. Format
    /// written: REG_SZ 'GpuPreference=N;'.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_gpu_preference(&self, args: &SetGpuPreferenceArgs) -> Result<ToolResult> {
        self.call("set_gpu_preference", args)
    }

    /// Async variant of [`Winclean::set_gpu_preference`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_gpu_preference_async(
        &self,
        args: &SetGpuPreferenceArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_gpu_preference", args).await
    }

    /// Writes HwSchMode in HKLM\System\CurrentControlSet\Control\GraphicsDrivers. Valid: 0 (WDDM
    /// CPU), 1 (OS default), 2 (HW-accelerated GPU scheduling). Requires admin + reboot. Microsoft
    /// + NVIDIA recommend 2 on WDDM 2.7+ hardware (validates DLSS 3 Frame Generation).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_hags_mode(&self, args: &SetHagsModeArgs) -> Result<ToolResult> {
        self.call("set_hags_mode", args)
    }

    /// Async variant of [`Winclean::set_hags_mode`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_hags_mode_async(&self, args: &SetHagsModeArgs) -> Result<ToolResult> {
        self.call_async("set_hags_mode", args).await
    }

    /// Sets the CPU affinity mask of a process. The mask is a bitmask where bit N means 'process
    /// may run on logical processor N'. Pass 0 to reset to the system default. Returns previous and
    /// new mask in hex as JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_process_affinity(&self, args: &SetProcessAffinityArgs) -> Result<ToolResult> {
        self.call("set_process_affinity", args)
    }

    /// Async variant of [`Winclean::set_process_affinity`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_process_affinity_async(
        &self,
        args: &SetProcessAffinityArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_process_affinity", args).await
    }

    /// Sets the Windows priority class of a process. Valid values: 'Idle', 'BelowNormal', 'Normal',
    /// 'AboveNormal', 'High', 'Realtime'. Returns previous and new class as JSON. Realtime requires
    /// Administrator and can starve system services.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_process_priority(&self, args: &SetProcessPriorityArgs) -> Result<ToolResult> {
        self.call("set_process_priority", args)
    }

    /// Async variant of [`Winclean::set_process_priority`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_process_priority_async(
        &self,
        args: &SetProcessPriorityArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_process_priority", args).await
    }

    /// Writes a registry value. Creates the key if missing. Supported types: String, ExpandString,
    /// DWord, QWord, MultiString (newline-separated).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn set_registry_value(&self, args: &SetRegistryValueArgs) -> Result<ToolResult> {
        self.call("set_registry_value", args)
    }

    /// Async variant of [`Winclean::set_registry_value`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn set_registry_value_async(
        &self,
        args: &SetRegistryValueArgs,
    ) -> Result<ToolResult> {
        self.call_async("set_registry_value", args).await
    }

    /// Sends a keyboard shortcut. The combo is a '+'-separated list of keys, e.g. 'ctrl+c',
    /// 'ctrl+shift+esc', 'win+r', 'alt+f4'. Modifier keys: ctrl, shift, alt, win. Literal keys:
    /// a-z, 0-9, f1-f24, esc, enter, tab, space, backspace, delete, home, end, up, down, left,
    /// right.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shortcut(&self, args: &ShortcutArgs) -> Result<ToolResult> {
        self.call("shortcut", args)
    }

    /// Async variant of [`Winclean::shortcut`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shortcut_async(&self, args: &ShortcutArgs) -> Result<ToolResult> {
        self.call_async("shortcut", args).await
    }

    /// Captures a UIA control-view tree snapshot of the foreground window via native UI Automation.
    /// Pass windowHandle to inspect a specific application without changing focus. Returns up to
    /// maxElements (default 200) descendants with name, controlType, automationId, className,
    /// bounds, focus and enabled state. Used by computer_* and MultiSelect/MultiEdit.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn snapshot(&self, args: &SnapshotArgs) -> Result<ToolResult> {
        self.call("snapshot", args)
    }

    /// Async variant of [`Winclean::snapshot`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn snapshot_async(&self, args: &SnapshotArgs) -> Result<ToolResult> {
        self.call_async("snapshot", args).await
    }

    /// Starts a stopped Windows service. Waits up to 10s for the Running state.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn start_service(&self, args: &StartServiceArgs) -> Result<ToolResult> {
        self.call("start_service", args)
    }

    /// Async variant of [`Winclean::start_service`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn start_service_async(&self, args: &StartServiceArgs) -> Result<ToolResult> {
        self.call_async("start_service", args).await
    }

    /// Returns one installed Steam game by appId from the live app manifests of every library
    /// (bun-steam). Returns {"success":false,...} when the app is not installed.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_get_game(&self, args: &SteamGetGameArgs) -> Result<ToolResult> {
        self.call("steam_get_game", args)
    }

    /// Async variant of [`Winclean::steam_get_game`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_get_game_async(&self, args: &SteamGetGameArgs) -> Result<ToolResult> {
        self.call_async("steam_get_game", args).await
    }

    /// Checks whether an installed Steam game's process is running. Resolves install_dir and the
    /// absolute install path from the live app manifests. Executable name defaults to install_dir +
    /// ".exe". Returns
    /// {"appId":N,"running":bool,"pid":N|null,"executable":"...","installDir":"...","absoluteInstallPath":"..."}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_get_game_status(&self, args: &SteamGetGameStatusArgs) -> Result<ToolResult> {
        self.call("steam_get_game_status", args)
    }

    /// Async variant of [`Winclean::steam_get_game_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_get_game_status_async(
        &self,
        args: &SteamGetGameStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_get_game_status", args).await
    }

    /// Kills a running Steam game by executable name. Returns {"success":true,"pid":N,"killed":1}
    /// or {"success":false,"error":"not running"}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_kill_game(&self, args: &SteamKillGameArgs) -> Result<ToolResult> {
        self.call("steam_kill_game", args)
    }

    /// Async variant of [`Winclean::steam_kill_game`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_kill_game_async(&self, args: &SteamKillGameArgs) -> Result<ToolResult> {
        self.call_async("steam_kill_game", args).await
    }

    /// Launches a Steam game via steam://rungameid/{appId} then waits for the process to appear.
    /// Combines SteamLaunchByAppId + SteamWaitForLaunch in a single MCP call. Returns
    /// {"success":true,"pid":N,"elapsedMs":N} or {"success":false,...}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_launch_and_wait(&self, args: &SteamLaunchAndWaitArgs) -> Result<ToolResult> {
        self.call("steam_launch_and_wait", args)
    }

    /// Async variant of [`Winclean::steam_launch_and_wait`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_launch_and_wait_async(
        &self,
        args: &SteamLaunchAndWaitArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_launch_and_wait", args).await
    }

    /// Launches a Steam game via steam://rungameid/{appId}. Returns immediately — use
    /// SteamWaitForLaunch to block until the process is alive. Returns {"success":false,...} if
    /// Steam is not installed.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_launch_by_app_id(&self, args: &SteamLaunchByAppIdArgs) -> Result<ToolResult> {
        self.call("steam_launch_by_app_id", args)
    }

    /// Async variant of [`Winclean::steam_launch_by_app_id`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_launch_by_app_id_async(
        &self,
        args: &SteamLaunchByAppIdArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_launch_by_app_id", args).await
    }

    /// Returns the installed Steam games of every library from the live app manifests (bun-steam).
    /// By default only games whose install directory exists are returned; includeMissing=true
    /// returns every manifest.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_list_games(&self, args: &SteamListGamesArgs) -> Result<ToolResult> {
        self.call("steam_list_games", args)
    }

    /// Async variant of [`Winclean::steam_list_games`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_list_games_async(&self, args: &SteamListGamesArgs) -> Result<ToolResult> {
        self.call_async("steam_list_games", args).await
    }

    /// Returns the Steam library folders (libraryfolders.vdf) with game_count and total_size_bytes
    /// from their app manifests.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_list_libraries(&self, args: &SteamListLibrariesArgs) -> Result<ToolResult> {
        self.call("steam_list_libraries", args)
    }

    /// Async variant of [`Winclean::steam_list_libraries`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_list_libraries_async(
        &self,
        args: &SteamListLibrariesArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_list_libraries", args).await
    }

    /// Opens any steam:// URI via ShellExecute. Allowed schemes: steam:// only. Returns
    /// {"success":true,"uri":"..."} or {"success":false,"error":"invalid scheme"}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_open_uri(&self, args: &SteamOpenUriArgs) -> Result<ToolResult> {
        self.call("steam_open_uri", args)
    }

    /// Async variant of [`Winclean::steam_open_uri`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_open_uri_async(&self, args: &SteamOpenUriArgs) -> Result<ToolResult> {
        self.call_async("steam_open_uri", args).await
    }

    /// Returns live Steam counts: nb_libraries, nb_games, nb_games_present, total_size_bytes.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_scan_summary(&self, args: &SteamScanSummaryArgs) -> Result<ToolResult> {
        self.call("steam_scan_summary", args)
    }

    /// Async variant of [`Winclean::steam_scan_summary`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_scan_summary_async(
        &self,
        args: &SteamScanSummaryArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_scan_summary", args).await
    }

    /// Reports Steam credential state without secrets: client accounts (names and flags) and, per
    /// account, whether the client or steamcmd holds a reusable cached session (ConnectCache key
    /// presence only). Passwords, tokens and ConnectCache values are never read.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_vault_status(&self, args: &SteamVaultStatusArgs) -> Result<ToolResult> {
        self.call("steam_vault_status", args)
    }

    /// Async variant of [`Winclean::steam_vault_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_vault_status_async(
        &self,
        args: &SteamVaultStatusArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_vault_status", args).await
    }

    /// Polls until the named process appears or the timeout elapses. Returns
    /// {"success":true,"pid":N,"elapsedMs":N} or {"success":false,"error":"timeout",...}.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn steam_wait_for_launch(&self, args: &SteamWaitForLaunchArgs) -> Result<ToolResult> {
        self.call("steam_wait_for_launch", args)
    }

    /// Async variant of [`Winclean::steam_wait_for_launch`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn steam_wait_for_launch_async(
        &self,
        args: &SteamWaitForLaunchArgs,
    ) -> Result<ToolResult> {
        self.call_async("steam_wait_for_launch", args).await
    }

    /// Stops a running Windows service. Waits up to 10s for the Stopped state.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn stop_service(&self, args: &StopServiceArgs) -> Result<ToolResult> {
        self.call("stop_service", args)
    }

    /// Async variant of [`Winclean::stop_service`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn stop_service_async(&self, args: &StopServiceArgs) -> Result<ToolResult> {
        self.call_async("stop_service", args).await
    }

    /// Brings a window to the foreground by partial title match (case-insensitive). Restores it if
    /// minimized.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn switch_to_window(&self, args: &SwitchToWindowArgs) -> Result<ToolResult> {
        self.call("switch_to_window", args)
    }

    /// Async variant of [`Winclean::switch_to_window`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn switch_to_window_async(&self, args: &SwitchToWindowArgs) -> Result<ToolResult> {
        self.call_async("switch_to_window", args).await
    }

    /// DIAGNOSTIC / DEBUG ONLY. Trims a process's working set via SetProcessWorkingSetSize(-1,-1).
    /// The OS does NOT free the pages — it moves them to the standby list. The next time the
    /// process touches that memory, it incurs a HARD PAGE FAULT (disk read). Mark Russinovich
    /// (Sysinternals creator, Azure CTO) documents this is anti-performance for normal use: see
    /// 'The Memory-Optimization Hoax'. The Microsoft API doc itself states the function is 'useful
    /// primarily for testing and tuning'. Use only on demonstrably-idle GUI apps where you accept
    /// the next-touch latency. Do NOT call in a loop.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn trim_process_working_set(&self, args: &TrimProcessWorkingSetArgs) -> Result<ToolResult> {
        self.call("trim_process_working_set", args)
    }

    /// Async variant of [`Winclean::trim_process_working_set`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn trim_process_working_set_async(
        &self,
        args: &TrimProcessWorkingSetArgs,
    ) -> Result<ToolResult> {
        self.call_async("trim_process_working_set", args).await
    }

    /// Types text at the given screen coordinates. Set clear=true to send Ctrl+A + Delete before
    /// typing. Set pressEnter=true to submit with RETURN after typing. Max 4096 chars per call.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn type_(&self, args: &TypeArgs) -> Result<ToolResult> {
        self.call("type", args)
    }

    /// Async variant of [`Winclean::type_`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn type_async(&self, args: &TypeArgs) -> Result<ToolResult> {
        self.call_async("type", args).await
    }

    /// Pauses execution for the given duration in seconds (1..120).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wait(&self, args: &WaitArgs) -> Result<ToolResult> {
        self.call("wait", args)
    }

    /// Async variant of [`Winclean::wait`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wait_async(&self, args: &WaitArgs) -> Result<ToolResult> {
        self.call_async("wait", args).await
    }

    /// Captures the pixels of a window to a 24-bit BMP file via PrintWindow + GetDIBits. Works even
    /// when the window is MINIMISED, OFF-SCREEN or COVERED by another window (DWM redirection
    /// surface). Returns the saved BMP path and dimensions.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_capture(&self, args: &WindowCaptureArgs) -> Result<ToolResult> {
        self.call("window_capture", args)
    }

    /// Async variant of [`Winclean::window_capture`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_capture_async(&self, args: &WindowCaptureArgs) -> Result<ToolResult> {
        self.call_async("window_capture", args).await
    }

    /// Sends WM_CLOSE to the window (graceful close request).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_close(&self, args: &WindowCloseArgs) -> Result<ToolResult> {
        self.call("window_close", args)
    }

    /// Async variant of [`Winclean::window_close`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_close_async(&self, args: &WindowCloseArgs) -> Result<ToolResult> {
        self.call_async("window_close", args).await
    }

    /// Enumerates every top-level window (visible AND hidden). Filters by pid (0 = any), class
    /// substring, title substring (all case-insensitive). Returns hwnd, pid, classname, title,
    /// rect, visible, minimised, maximised flags.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_enum_all(&self, args: &WindowEnumAllArgs) -> Result<ToolResult> {
        self.call("window_enum_all", args)
    }

    /// Async variant of [`Winclean::window_enum_all`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_enum_all_async(&self, args: &WindowEnumAllArgs) -> Result<ToolResult> {
        self.call_async("window_enum_all", args).await
    }

    /// Enumerates direct + indirect child windows of a given HWND parent. Useful to drill into
    /// controls inside an app frame (edit fields, buttons, listviews).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_enum_children(&self, args: &WindowEnumChildrenArgs) -> Result<ToolResult> {
        self.call("window_enum_children", args)
    }

    /// Async variant of [`Winclean::window_enum_children`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_enum_children_async(
        &self,
        args: &WindowEnumChildrenArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_enum_children", args).await
    }

    /// Finds the first top-level HWND with the exact class name (case-sensitive) and optionally a
    /// matching window title. Returns hwnd=0 if not found.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_find_by_class(&self, args: &WindowFindByClassArgs) -> Result<ToolResult> {
        self.call("window_find_by_class", args)
    }

    /// Async variant of [`Winclean::window_find_by_class`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_find_by_class_async(
        &self,
        args: &WindowFindByClassArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_find_by_class", args).await
    }

    /// Reads the text of a window or control via WM_GETTEXTLENGTH + WM_GETTEXT. Works on hidden
    /// controls; pair with WindowEnumChildren to locate the HWND.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_get_text(&self, args: &WindowGetTextArgs) -> Result<ToolResult> {
        self.call("window_get_text", args)
    }

    /// Async variant of [`Winclean::window_get_text`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_get_text_async(&self, args: &WindowGetTextArgs) -> Result<ToolResult> {
        self.call_async("window_get_text", args).await
    }

    /// Sends WM_KEYDOWN/UP for Win+D to the shell — minimises every visible window at once.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_minimise_all(&self, args: &WindowMinimiseAllArgs) -> Result<ToolResult> {
        self.call("window_minimise_all", args)
    }

    /// Async variant of [`Winclean::window_minimise_all`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_minimise_all_async(
        &self,
        args: &WindowMinimiseAllArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_minimise_all", args).await
    }

    /// Moves and/or resizes a window by HWND. Set width/height to 0 to keep current size, set x/y
    /// to a value outside the visible desktop to park the window off-screen.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_move(&self, args: &WindowMoveArgs) -> Result<ToolResult> {
        self.call("window_move", args)
    }

    /// Async variant of [`Winclean::window_move`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_move_async(&self, args: &WindowMoveArgs) -> Result<ToolResult> {
        self.call_async("window_move", args).await
    }

    /// Posts a Win32 message to a window's queue via PostMessageW (asynchronous, non-blocking).
    /// Returns immediately even if the target ignores or hangs on the message.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_post_message(&self, args: &WindowPostMessageArgs) -> Result<ToolResult> {
        self.call("window_post_message", args)
    }

    /// Async variant of [`Winclean::window_post_message`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_post_message_async(
        &self,
        args: &WindowPostMessageArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_post_message", args).await
    }

    /// Sends a Win32 message to a window via SendMessageW (synchronous). Useful to drive controls
    /// without stealing focus — e.g. WM_LBUTTONDOWN/UP on a button HWND, WM_SETTEXT to set an edit
    /// field, WM_CLOSE to request close. wParam/lParam can be decimal or 0x-prefixed hex.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_send_message(&self, args: &WindowSendMessageArgs) -> Result<ToolResult> {
        self.call("window_send_message", args)
    }

    /// Async variant of [`Winclean::window_send_message`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_send_message_async(
        &self,
        args: &WindowSendMessageArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_send_message", args).await
    }

    /// Sets per-window opacity (0..255). Promotes the window to WS_EX_LAYERED if needed. Use 255 =
    /// fully opaque, 0 = fully transparent (but still receives input unless clickThrough).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_set_opacity(&self, args: &WindowSetOpacityArgs) -> Result<ToolResult> {
        self.call("window_set_opacity", args)
    }

    /// Async variant of [`Winclean::window_set_opacity`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_set_opacity_async(
        &self,
        args: &WindowSetOpacityArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_set_opacity", args).await
    }

    /// Sets the text of a window or control via WM_SETTEXT. Targets edit fields, captions, listbox
    /// items. For complex Unicode UIs prefer UIA.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_set_text(&self, args: &WindowSetTextArgs) -> Result<ToolResult> {
        self.call("window_set_text", args)
    }

    /// Async variant of [`Winclean::window_set_text`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_set_text_async(&self, args: &WindowSetTextArgs) -> Result<ToolResult> {
        self.call_async("window_set_text", args).await
    }

    /// Sets the TOPMOST flag on a window (Z-order pinned above all non-topmost windows).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn window_set_topmost(&self, args: &WindowSetTopmostArgs) -> Result<ToolResult> {
        self.call("window_set_topmost", args)
    }

    /// Async variant of [`Winclean::window_set_topmost`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn window_set_topmost_async(
        &self,
        args: &WindowSetTopmostArgs,
    ) -> Result<ToolResult> {
        self.call_async("window_set_topmost", args).await
    }

    /// Returns the ONNX Runtime version string powering Windows ML on this machine.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winml_get_version(&self, args: &WinmlGetVersionArgs) -> Result<ToolResult> {
        self.call("winml_get_version", args)
    }

    /// Async variant of [`Winclean::winml_get_version`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winml_get_version_async(&self, args: &WinmlGetVersionArgs) -> Result<ToolResult> {
        self.call_async("winml_get_version", args).await
    }

    /// Loads an ONNX model and returns its input/output metadata (name, element type, shape). Use
    /// this before WinmlRunFloat32 to discover tensor shapes.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winml_inspect_onnx(&self, args: &WinmlInspectOnnxArgs) -> Result<ToolResult> {
        self.call("winml_inspect_onnx", args)
    }

    /// Async variant of [`Winclean::winml_inspect_onnx`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winml_inspect_onnx_async(
        &self,
        args: &WinmlInspectOnnxArgs,
    ) -> Result<ToolResult> {
        self.call_async("winml_inspect_onnx", args).await
    }

    /// Lists ONNX Runtime execution providers available in the current process (e.g.
    /// CPUExecutionProvider, DmlExecutionProvider, CUDAExecutionProvider). Reflects whatever EPs
    /// Windows ML / the loaded native dll registered.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winml_list_providers(&self, args: &WinmlListProvidersArgs) -> Result<ToolResult> {
        self.call("winml_list_providers", args)
    }

    /// Async variant of [`Winclean::winml_list_providers`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winml_list_providers_async(
        &self,
        args: &WinmlListProvidersArgs,
    ) -> Result<ToolResult> {
        self.call_async("winml_list_providers", args).await
    }

    /// Runs inference on an ONNX model with float32 tensor inputs. inputsJson:
    /// '{"input_name":{"shape":[1,3,224,224],"data":[0.1,0.2,...]}}'. executionProvider: 'cpu'
    /// (default) | 'dml' (DirectML, any GPU) | 'cuda' (NVIDIA). Returns the first output tensor as
    /// float32 JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winml_run_float32(&self, args: &WinmlRunFloat32Args) -> Result<ToolResult> {
        self.call("winml_run_float32", args)
    }

    /// Async variant of [`Winclean::winml_run_float32`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winml_run_float32_async(&self, args: &WinmlRunFloat32Args) -> Result<ToolResult> {
        self.call_async("winml_run_float32", args).await
    }

    /// Writes UTF-8 text to a file. Creates parent directories as needed. Set append=true to append
    /// instead of overwrite.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn write_file(&self, args: &WriteFileArgs) -> Result<ToolResult> {
        self.call("write_file", args)
    }

    /// Async variant of [`Winclean::write_file`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn write_file_async(&self, args: &WriteFileArgs) -> Result<ToolResult> {
        self.call_async("write_file", args).await
    }

    /// Runs a command in an existing WSL distribution using an argv array, with a 30-second bound
    /// and captured stdout/stderr. command must contain the executable followed by arguments; it is
    /// never concatenated into a shell command. For deliberate shell scripting, pass /bin/sh, -lc,
    /// and the script as separate command entries.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_execute(&self, args: &WslExecuteArgs) -> Result<ToolResult> {
        self.call("wsl_execute", args)
    }

    /// Async variant of [`Winclean::wsl_execute`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_execute_async(&self, args: &WslExecuteArgs) -> Result<ToolResult> {
        self.call_async("wsl_execute", args).await
    }

    /// Returns the local WSL installation status. This is read-only and reports the Windows WSL
    /// configuration, default distribution, and kernel information when available.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_get_status(&self, args: &WslGetStatusArgs) -> Result<ToolResult> {
        self.call("wsl_get_status", args)
    }

    /// Async variant of [`Winclean::wsl_get_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_get_status_async(&self, args: &WslGetStatusArgs) -> Result<ToolResult> {
        self.call_async("wsl_get_status", args).await
    }

    /// Lists installed WSL distributions with their state and WSL version. This is read-only; it
    /// never starts, terminates, imports, exports, or unregisters a distribution.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_list_distributions(&self, args: &WslListDistributionsArgs) -> Result<ToolResult> {
        self.call("wsl_list_distributions", args)
    }

    /// Async variant of [`Winclean::wsl_list_distributions`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_list_distributions_async(
        &self,
        args: &WslListDistributionsArgs,
    ) -> Result<ToolResult> {
        self.call_async("wsl_list_distributions", args).await
    }

    /// Lists Linux processes in an existing WSL distribution. This is read-only and returns PID,
    /// parent PID, command, and arguments.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_list_processes(&self, args: &WslListProcessesArgs) -> Result<ToolResult> {
        self.call("wsl_list_processes", args)
    }

    /// Async variant of [`Winclean::wsl_list_processes`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_list_processes_async(
        &self,
        args: &WslListProcessesArgs,
    ) -> Result<ToolResult> {
        self.call_async("wsl_list_processes", args).await
    }

    /// Runs one fixed, read-only diagnostic inside an existing WSL distribution. probe must be one
    /// of: system-info, re-toolchain, processes, mounts, or network. No arbitrary shell command is
    /// accepted.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_read_only_probe(&self, args: &WslReadOnlyProbeArgs) -> Result<ToolResult> {
        self.call("wsl_read_only_probe", args)
    }

    /// Async variant of [`Winclean::wsl_read_only_probe`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_read_only_probe_async(
        &self,
        args: &WslReadOnlyProbeArgs,
    ) -> Result<ToolResult> {
        self.call_async("wsl_read_only_probe", args).await
    }

    /// Sends HUP, INT, TERM, or KILL to one exact Linux PID in an existing WSL distribution. Call
    /// wsl_list_processes first to identify the target PID.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wsl_send_signal(&self, args: &WslSendSignalArgs) -> Result<ToolResult> {
        self.call("wsl_send_signal", args)
    }

    /// Async variant of [`Winclean::wsl_send_signal`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wsl_send_signal_async(&self, args: &WslSendSignalArgs) -> Result<ToolResult> {
        self.call_async("wsl_send_signal", args).await
    }

    /// Lists the Bun OS Windows tweak catalog (catalog/tweaks.toml): modules and tweaks with id,
    /// module, title, level (conservative|standard|aggressive), targets (live|offline) and
    /// operation count. The single source of truth for bunos-win11 and Bun OS Tweaks. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn tweak_catalog(&self, args: &TweakCatalogArgs) -> Result<ToolResult> {
        self.call("tweak_catalog", args)
    }

    /// Async variant of [`Winclean::tweak_catalog`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn tweak_catalog_async(&self, args: &TweakCatalogArgs) -> Result<ToolResult> {
        self.call_async("tweak_catalog", args).await
    }

    /// Builds a tweak plan for the running Windows from a profile (archinstall-style: target,
    /// level, modules, include, exclude) without changing anything. Detects each operation, marks
    /// it change|ok|skip|refused, saves the plan JSON under %LOCALAPPDATA%unoswin11 and returns
    /// the path and a per-module summary. Guarded operations (Defender, Windows Update,
    /// WSL/Hyper-V, Store, WebView2, networking, aphrody/ssh/WireGuard) are always refused.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn tweak_plan(&self, args: &TweakPlanArgs) -> Result<ToolResult> {
        self.call("tweak_plan", args)
    }

    /// Async variant of [`Winclean::tweak_plan`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn tweak_plan_async(&self, args: &TweakPlanArgs) -> Result<ToolResult> {
        self.call_async("tweak_plan", args).await
    }

    /// Applies a previously built plan (or a profile) to the running Windows. Creates a System
    /// Restore point, exports every touched registry key to .reg, and journals every change so
    /// tweak_undo reverts it. Requires confirm=true; machine-wide changes require an elevated
    /// process. Returns the journal path and the number of changes applied.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn tweak_apply(&self, args: &TweakApplyArgs) -> Result<ToolResult> {
        self.call("tweak_apply", args)
    }

    /// Async variant of [`Winclean::tweak_apply`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn tweak_apply_async(&self, args: &TweakApplyArgs) -> Result<ToolResult> {
        self.call_async("tweak_apply", args).await
    }

    /// Re-detects every change recorded in a journal and returns the ids of tweaks whose state no
    /// longer matches (drift). Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn tweak_verify(&self, args: &TweakVerifyArgs) -> Result<ToolResult> {
        self.call("tweak_verify", args)
    }

    /// Async variant of [`Winclean::tweak_verify`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn tweak_verify_async(&self, args: &TweakVerifyArgs) -> Result<ToolResult> {
        self.call_async("tweak_verify", args).await
    }

    /// Reverts a journal in place: replays every applied change backwards, restoring each registry
    /// value, service start type, scheduled task and power scheme to its recorded previous state,
    /// and re-registers removed per-user appx packages. Irreversible operations (offline
    /// file/capability removals) are reported, not reverted.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn tweak_undo(&self, args: &TweakUndoArgs) -> Result<ToolResult> {
        self.call("tweak_undo", args)
    }

    /// Async variant of [`Winclean::tweak_undo`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn tweak_undo_async(&self, args: &TweakUndoArgs) -> Result<ToolResult> {
        self.call_async("tweak_undo", args).await
    }

    /// Reports the Bun OS NT layer: whether the bunos.sys kernel driver is loaded (loaded |
    /// access-denied when not elevated | absent), its version, ABI and capabilities (event sources
    /// supported and active, ring capacity, counters), and the active event session. Every nt_*
    /// tool falls back to user-mode Win32/NT APIs when the driver is absent. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_status(&self, args: &NtStatusArgs) -> Result<ToolResult> {
        self.call("nt_status", args)
    }

    /// Async variant of [`Winclean::nt_status`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_status_async(&self, args: &NtStatusArgs) -> Result<ToolResult> {
        self.call_async("nt_status", args).await
    }

    /// Starts a low-level Windows event session. With bunos.sys loaded (elevated): kernel
    /// notification callbacks for the chosen sources (process create/exit with image path, thread
    /// create/exit, image load, registry set/delete value and delete key; monitor only, never
    /// blocks an operation). Without the driver: user-mode process create/exit polling. Replaces
    /// any previous session.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_events_start(&self, args: &NtEventsStartArgs) -> Result<ToolResult> {
        self.call("nt_events_start", args)
    }

    /// Async variant of [`Winclean::nt_events_start`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_events_start_async(&self, args: &NtEventsStartArgs) -> Result<ToolResult> {
        self.call_async("nt_events_start", args).await
    }

    /// Drains queued events of the session started by nt_events_start, oldest first: kind, FILETIME
    /// time, pid, a0/a1 (parent pid, thread id, user image base and size, registry value type and
    /// size), name (image or registry path, tail kept when truncated), plus dropped and pending
    /// counts. Kernel image addresses are never reported.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_events_read(&self, args: &NtEventsReadArgs) -> Result<ToolResult> {
        self.call("nt_events_read", args)
    }

    /// Async variant of [`Winclean::nt_events_read`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_events_read_async(&self, args: &NtEventsReadArgs) -> Result<ToolResult> {
        self.call_async("nt_events_read", args).await
    }

    /// Stops the event session: disables every kernel source (or the user-mode poll) and releases
    /// the device.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_events_stop(&self, args: &NtEventsStopArgs) -> Result<ToolResult> {
        self.call("nt_events_stop", args)
    }

    /// Async variant of [`Winclean::nt_events_stop`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_events_stop_async(&self, args: &NtEventsStopArgs) -> Result<ToolResult> {
        self.call_async("nt_events_stop", args).await
    }

    /// Enumerates the system handle table from user mode (NtQuerySystemInformation
    /// SystemExtendedHandleInformation) with object type names: pid, handle value, type, granted
    /// access, attributes, and a per-type summary. Kernel object addresses are omitted. Elevation
    /// shows every process. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_handles(&self, args: &NtHandlesArgs) -> Result<ToolResult> {
        self.call("nt_handles", args)
    }

    /// Async variant of [`Winclean::nt_handles`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_handles_async(&self, args: &NtHandlesArgs) -> Result<ToolResult> {
        self.call_async("nt_handles", args).await
    }

    /// Lists loaded kernel images (drivers, ntoskrnl, hal) from user mode (NtQuerySystemInformation
    /// SystemModuleInformation): name, path, size, load order, and whether bunos.sys is loaded.
    /// Base addresses are omitted. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn nt_kernel_modules(&self, args: &NtKernelModulesArgs) -> Result<ToolResult> {
        self.call("nt_kernel_modules", args)
    }

    /// Async variant of [`Winclean::nt_kernel_modules`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn nt_kernel_modules_async(&self, args: &NtKernelModulesArgs) -> Result<ToolResult> {
        self.call_async("nt_kernel_modules", args).await
    }

    /// Runs a WQL query against any WMI/CIM namespace in-process (IWbemServices::ExecQuery), the
    /// equivalent of Get-CimInstance/wmic, and returns every non-system property of each instance
    /// as JSON. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn wmi_query(&self, args: &WmiQueryArgs) -> Result<ToolResult> {
        self.call("wmi_query", args)
    }

    /// Async variant of [`Winclean::wmi_query`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn wmi_query_async(&self, args: &WmiQueryArgs) -> Result<ToolResult> {
        self.call_async("wmi_query", args).await
    }

    /// Late-bound COM automation (IDispatch), the equivalent of New-Object -ComObject /
    /// CreateObject: creates or attaches to an object by progId or clsid, walks steps of property
    /// gets, method calls and property puts, and optionally enumerates the resulting collection
    /// (_NewEnum) reading chosen properties. Objects are addressed by index (0 = root, n = the
    /// object step n-1 returned) through on (target of a step) and {"$step":n} (as an argument).
    /// Can change state, depending on the members called.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn com_invoke(&self, args: &ComInvokeArgs) -> Result<ToolResult> {
        self.call("com_invoke", args)
    }

    /// Async variant of [`Winclean::com_invoke`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn com_invoke_async(&self, args: &ComInvokeArgs) -> Result<ToolResult> {
        self.call_async("com_invoke", args).await
    }

    /// Lists every registered Windows known folder (IKnownFolderManager): id, canonical name,
    /// category, current path (null for virtual folders) and parsing name. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_known_folders(&self, args: &ShellKnownFoldersArgs) -> Result<ToolResult> {
        self.call("shell_known_folders", args)
    }

    /// Async variant of [`Winclean::shell_known_folders`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_known_folders_async(
        &self,
        args: &ShellKnownFoldersArgs,
    ) -> Result<ToolResult> {
        self.call_async("shell_known_folders", args).await
    }

    /// Lists logical drives with type, label, filesystem, serial and free/total bytes. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_drives(&self, args: &ShellDrivesArgs) -> Result<ToolResult> {
        self.call("shell_drives", args)
    }

    /// Async variant of [`Winclean::shell_drives`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_drives_async(&self, args: &ShellDrivesArgs) -> Result<ToolResult> {
        self.call_async("shell_drives", args).await
    }

    /// Runs a file operation through IFileOperation, Explorer's engine (undo history, Recycle Bin,
    /// copy hooks; Explorer progress and conflict dialogs when ui=true): op
    /// copy|move|rename|delete|recycle|newFolder. delete is permanent; recycle sends to the Recycle
    /// Bin.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_file_operation(&self, args: &ShellFileOperationArgs) -> Result<ToolResult> {
        self.call("shell_file_operation", args)
    }

    /// Async variant of [`Winclean::shell_file_operation`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_file_operation_async(
        &self,
        args: &ShellFileOperationArgs,
    ) -> Result<ToolResult> {
        self.call_async("shell_file_operation", args).await
    }

    /// The Recycle Bin: action list (name, original folder, date deleted, parsing name), restore
    /// (names = display names, original paths or parsing names; uses the Restore verb) or empty
    /// (permanent; requires confirm=true).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_recycle_bin(&self, args: &ShellRecycleBinArgs) -> Result<ToolResult> {
        self.call("shell_recycle_bin", args)
    }

    /// Async variant of [`Winclean::shell_recycle_bin`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_recycle_bin_async(&self, args: &ShellRecycleBinArgs) -> Result<ToolResult> {
        self.call_async("shell_recycle_bin", args).await
    }

    /// Explorer's context menu for one or more items via IContextMenu, including third-party shell
    /// extensions: action list returns {id,label,verb,enabled} flattened with 'Parent > Child'
    /// labels; action invoke runs one by verb (open, edit, properties, runas, undelete, openas) or
    /// by id from list; action popup shows Explorer's own menu (multi-selection, dynamic Send
    /// to/Open with/New submenus) at x,y or the cursor and runs the chosen command.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_context_menu(&self, args: &ShellContextMenuArgs) -> Result<ToolResult> {
        self.call("shell_context_menu", args)
    }

    /// Async variant of [`Winclean::shell_context_menu`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_context_menu_async(
        &self,
        args: &ShellContextMenuArgs,
    ) -> Result<ToolResult> {
        self.call_async("shell_context_menu", args).await
    }

    /// Property system of an item: action read returns every value by canonical name (System.Size,
    /// System.Media.Duration, ...); action dialog opens Explorer's Properties sheet and waits until
    /// it is closed.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_properties(&self, args: &ShellPropertiesArgs) -> Result<ToolResult> {
        self.call("shell_properties", args)
    }

    /// Async variant of [`Winclean::shell_properties`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_properties_async(&self, args: &ShellPropertiesArgs) -> Result<ToolResult> {
        self.call_async("shell_properties", args).await
    }

    /// Renders the thumbnail Explorer shows (registered IThumbnailProvider, else the icon) through
    /// IShellItemImageFactory as PNG, written to output or returned base64. Read-only.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_thumbnail(&self, args: &ShellThumbnailArgs) -> Result<ToolResult> {
        self.call("shell_thumbnail", args)
    }

    /// Async variant of [`Winclean::shell_thumbnail`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_thumbnail_async(&self, args: &ShellThumbnailArgs) -> Result<ToolResult> {
        self.call_async("shell_thumbnail", args).await
    }

    /// "Open with": action list returns the handlers for an extension or path (SHAssocEnumHandlers:
    /// name, UI name, recommended, icon) and the current default ProgID
    /// (IApplicationAssociationRegistration); action invoke opens path with a handler matched by
    /// name, executable or UI name; action default returns only the default for an extension or URL
    /// protocol.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_open_with(&self, args: &ShellOpenWithArgs) -> Result<ToolResult> {
        self.call("shell_open_with", args)
    }

    /// Async variant of [`Winclean::shell_open_with`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_open_with_async(&self, args: &ShellOpenWithArgs) -> Result<ToolResult> {
        self.call_async("shell_open_with", args).await
    }

    /// Opens an Explorer window on the item's folder with the item selected
    /// (SHOpenFolderAndSelectItems).
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn shell_reveal(&self, args: &ShellRevealArgs) -> Result<ToolResult> {
        self.call("shell_reveal", args)
    }

    /// Async variant of [`Winclean::shell_reveal`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn shell_reveal_async(&self, args: &ShellRevealArgs) -> Result<ToolResult> {
        self.call_async("shell_reveal", args).await
    }

    /// Lists the configured winget sources (name, id, type, argument, origin, trust level, last
    /// update). Runs in process through bunos_windows.dll (packages/bun-dotnet-windows, C# Native
    /// AOT) over the Microsoft.Management.Deployment COM API that winget.exe itself uses; no
    /// winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_sources(&self, args: &WingetSourcesArgs) -> Result<ToolResult> {
        self.call("winget_sources", args)
    }

    /// Async variant of [`Winclean::winget_sources`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_sources_async(&self, args: &WingetSourcesArgs) -> Result<ToolResult> {
        self.call_async("winget_sources", args).await
    }

    /// Searches winget catalogs (id, name, moniker, tags, like `winget search`) and returns
    /// packages with id, name, available and installed versions, source and update availability.
    /// Runs in process through bunos_windows.dll (packages/bun-dotnet-windows, C# Native AOT) over
    /// the Microsoft.Management.Deployment COM API that winget.exe itself uses; no winget.exe
    /// process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_search(&self, args: &WingetSearchArgs) -> Result<ToolResult> {
        self.call("winget_search", args)
    }

    /// Async variant of [`Winclean::winget_search`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_search_async(&self, args: &WingetSearchArgs) -> Result<ToolResult> {
        self.call_async("winget_search", args).await
    }

    /// Lists installed packages correlated with the winget catalogs (installed and available
    /// version, update availability); upgradable=true keeps those with an update, like `winget
    /// upgrade`. Runs in process through bunos_windows.dll (packages/bun-dotnet-windows, C# Native
    /// AOT) over the Microsoft.Management.Deployment COM API that winget.exe itself uses; no
    /// winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_list(&self, args: &WingetListArgs) -> Result<ToolResult> {
        self.call("winget_list", args)
    }

    /// Async variant of [`Winclean::winget_list`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_list_async(&self, args: &WingetListArgs) -> Result<ToolResult> {
        self.call_async("winget_list", args).await
    }

    /// Package details: publisher, description, license, URLs, tags, installed version and every
    /// available version. Runs in process through bunos_windows.dll (packages/bun-dotnet-windows,
    /// C# Native AOT) over the Microsoft.Management.Deployment COM API that winget.exe itself uses;
    /// no winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_show(&self, args: &WingetShowArgs) -> Result<ToolResult> {
        self.call("winget_show", args)
    }

    /// Async variant of [`Winclean::winget_show`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_show_async(&self, args: &WingetShowArgs) -> Result<ToolResult> {
        self.call_async("winget_show", args).await
    }

    /// Installs a package silently by exact id (package agreements accepted) and returns status,
    /// installer error code and reboot requirement. Runs in process through bunos_windows.dll
    /// (packages/bun-dotnet-windows, C# Native AOT) over the Microsoft.Management.Deployment COM
    /// API that winget.exe itself uses; no winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_install(&self, args: &WingetInstallArgs) -> Result<ToolResult> {
        self.call("winget_install", args)
    }

    /// Async variant of [`Winclean::winget_install`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_install_async(&self, args: &WingetInstallArgs) -> Result<ToolResult> {
        self.call_async("winget_install", args).await
    }

    /// Upgrades an installed package by exact id to its newest (or a given) version, silently;
    /// reports NoApplicableUpgrade when up to date. Runs in process through bunos_windows.dll
    /// (packages/bun-dotnet-windows, C# Native AOT) over the Microsoft.Management.Deployment COM
    /// API that winget.exe itself uses; no winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_upgrade(&self, args: &WingetUpgradeArgs) -> Result<ToolResult> {
        self.call("winget_upgrade", args)
    }

    /// Async variant of [`Winclean::winget_upgrade`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_upgrade_async(&self, args: &WingetUpgradeArgs) -> Result<ToolResult> {
        self.call_async("winget_upgrade", args).await
    }

    /// Uninstalls an installed package by exact id, silently, and returns status, uninstaller error
    /// code and reboot requirement. Runs in process through bunos_windows.dll
    /// (packages/bun-dotnet-windows, C# Native AOT) over the Microsoft.Management.Deployment COM
    /// API that winget.exe itself uses; no winget.exe process, structured JSON.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub fn winget_uninstall(&self, args: &WingetUninstallArgs) -> Result<ToolResult> {
        self.call("winget_uninstall", args)
    }

    /// Async variant of [`Winclean::winget_uninstall`]; runs on the library thread pool.
    ///
    /// # Errors
    /// Returns an error when the arguments cannot be serialised or the result cannot be decoded.
    pub async fn winget_uninstall_async(&self, args: &WingetUninstallArgs) -> Result<ToolResult> {
        self.call_async("winget_uninstall", args).await
    }
}
