// SPDX-License-Identifier: Apache-2.0
// @generated from the canonical Rust tool catalog — do not edit by hand.
/* eslint-disable */
import type { ToolResult } from "./result";

export const TOOL_NAMES = [
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
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Arguments for `analyze_pe`. */
export interface AnalyzePeArgs {
  /**
   * Absolute path to the target PE executable or DLL file.
   */
  path: string;
}

/** Arguments for `aob_scan`. */
export interface AobScanArgs {
  /**
   * Absolute path to the target binary.
   */
  path: string;
  /**
   * AOB pattern with hex bytes and wildcards, e.g. '48 89 5C 24 ? 48 89 74 24 ?'.
   */
  pattern: string;
  /**
   * Max matches to return (default 50, max 1000).
   * @default 50
   */
  maxMatches?: number;
}

/** Arguments for `asar_list`. */
export interface AsarListArgs {
  /**
   * Absolute path to the .asar archive.
   */
  path: string;
}

/** Arguments for `binary_aes_ctr_decrypt`. */
export interface BinaryAesCtrDecryptArgs {
  /**
   * Absolute path to the ciphertext.
   */
  inputPath: string;
  /**
   * Absolute path of the plaintext output.
   */
  outputPath: string;
  /**
   * AES key in hex (32 or 64 hex chars).
   */
  keyHex: string;
  /**
   * Initial counter (IV) in hex (32 hex chars).
   */
  ivHex: string;
}

/** Arguments for `binary_entropy_map`. */
export interface BinaryEntropyMapArgs {
  /**
   * Absolute path to the file.
   */
  path: string;
  /**
   * Block size in bytes (default 4096, min 256, max 1048576).
   * @default 4096
   */
  blockSize?: number;
}

/** Arguments for `binary_extract_strings`. */
export interface BinaryExtractStringsArgs {
  /**
   * Absolute path to the file.
   */
  path: string;
  /**
   * Minimum string length (default 4, capped at 256).
   * @default 4
   */
  minLength?: number;
  /**
   * Maximum strings to return (default 1000, capped at 50000).
   * @default 1000
   */
  maxResults?: number;
}

/** Arguments for `binary_hash_multi`. */
export interface BinaryHashMultiArgs {
  /**
   * Absolute path to the file.
   */
  path: string;
}

/** Arguments for `binary_list_cpk`. */
export interface BinaryListCpkArgs {
  /**
   * Absolute path to the .cpk archive.
   */
  path: string;
  /**
   * Max entries to return (default 500, capped at 50000).
   * @default 500
   */
  maxEntries?: number;
}

/** Arguments for `binary_parse_pe_header`. */
export interface BinaryParsePeHeaderArgs {
  /**
   * Absolute path to the PE file (.exe / .dll / .sys / .efi).
   */
  path: string;
}

/** Arguments for `binary_section_dump`. */
export interface BinarySectionDumpArgs {
  /**
   * Absolute path to the PE file.
   */
  path: string;
  /**
   * Section name (e.g. '.text').
   */
  sectionName: string;
  /**
   * Output binary path. Empty = auto in %TEMP%.
   * @default null
   */
  outputPath?: string | null;
}

/** Arguments for `binary_xor_decrypt`. */
export interface BinaryXorDecryptArgs {
  /**
   * Absolute path to the encrypted file.
   */
  inputPath: string;
  /**
   * Absolute path of the decrypted output.
   */
  outputPath: string;
  /**
   * Hex key (e.g. 'A5' or 'DEADBEEF').
   */
  keyHex: string;
}

/** Arguments for `click`. */
export interface ClickArgs {
  /**
   * X coordinate in screen pixels.
   */
  x: number;
  /**
   * Y coordinate in screen pixels.
   */
  y: number;
  /**
   * Mouse button: left | right | middle.
   * @default "left"
   */
  button?: string;
  /**
   * 0 = hover, 1 = single, 2 = double.
   * @default 1
   */
  clicks?: number;
}

/** Arguments for `computer_capture_screen`. */
export interface ComputerCaptureScreenArgs {}

/** Arguments for `computer_click`. */
export interface ComputerClickArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Window-relative X coordinate in pixels.
   */
  x: number;
  /**
   * Window-relative Y coordinate in pixels.
   */
  y: number;
  /**
   * Mouse button: left | right | middle.
   * @default "left"
   */
  button?: string;
  /**
   * Number of clicks: 1 or 2.
   * @default 1
   */
  clicks?: number;
  /**
   * Restore and focus the target window before input.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `computer_click_element`. */
export interface ComputerClickElementArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Exact UIA AutomationId, when available.
   * @default null
   */
  automationId?: string | null;
  /**
   * Exact UIA Name, case-insensitive.
   * @default null
   */
  name?: string | null;
  /**
   * Exact UIA className, case-insensitive.
   * @default null
   */
  className?: string | null;
  /**
   * Exact UIA controlType, case-insensitive.
   * @default null
   */
  controlType?: string | null;
  /**
   * Zero-based match to click when more than one element matches.
   * @default -1
   */
  occurrence?: number;
  /**
   * Restore and focus the target window before clicking.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `computer_drag`. */
export interface ComputerDragArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Window-relative start X.
   */
  fromX: number;
  /**
   * Window-relative start Y.
   */
  fromY: number;
  /**
   * Window-relative end X.
   */
  toX: number;
  /**
   * Window-relative end Y.
   */
  toY: number;
  /**
   * Mouse button: left | right | middle.
   * @default "left"
   */
  button?: string;
  /**
   * Intermediate movement steps (8..200).
   * @default 20
   */
  steps?: number;
  /**
   * Total drag duration in milliseconds (50..5000).
   * @default 250
   */
  durationMs?: number;
  /**
   * Restore and focus the target window before input.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `computer_key`. */
export interface ComputerKeyArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Shortcut string such as ctrl+s, alt+f4, enter or f5.
   */
  shortcut: string;
  /**
   * Restore and focus the target window before input.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `computer_observe`. */
export interface ComputerObserveArgs {
  /**
   * Exact HWND to inspect (0 = foreground window).
   * @default 0
   */
  windowHandle?: number;
  /**
   * Maximum UI Automation elements (1..1000, default 160).
   * @default 160
   */
  maxElements?: number;
  /**
   * Include the UI Automation tree in the text block.
   * @default true
   */
  includeUiTree?: boolean;
  /**
   * Optional PNG export path. When set, the captured observation is also written there.
   * @default null
   */
  outputPath?: string | null;
}

/** Arguments for `computer_ocr`. */
export interface ComputerOcrArgs {
  /**
   * Exact HWND from the latest observation (0 = foreground window).
   * @default 0
   */
  windowHandle?: number;
  /**
   * json or markdown.
   * @default "json"
   */
  format?: string;
  /**
   * Windows OCR language tag, for example fr-FR or en-US. Null uses the user profile languages.
   * @default null
   */
  language?: string | null;
  /**
   * Region X relative to the captured window image (0 for full image).
   * @default 0
   */
  regionX?: number;
  /**
   * Region Y relative to the captured window image (0 for full image).
   * @default 0
   */
  regionY?: number;
  /**
   * Region width; 0 means the remaining image width.
   * @default 0
   */
  regionWidth?: number;
  /**
   * Region height; 0 means the remaining image height.
   * @default 0
   */
  regionHeight?: number;
  /**
   * Play the recognized text through the installed local Windows voice.
   * @default false
   */
  speak?: boolean;
  /**
   * Optional JSON/Markdown export path.
   * @default null
   */
  outputPath?: string | null;
  /**
   * Optional WAV export path when speak=true; otherwise a temporary WAV is created.
   * @default null
   */
  audioPath?: string | null;
}

/** Arguments for `computer_record_clip`. */
export interface ComputerRecordClipArgs {
  /**
   * Exact HWND from the latest observation; 0 records the primary desktop.
   * @default 0
   */
  windowHandle?: number;
  /**
   * Output AVI path; null creates a timestamped file in the user temp directory.
   * @default null
   */
  outputPath?: string | null;
  /**
   * Clip duration in milliseconds (100..30000).
   * @default 5000
   */
  durationMs?: number;
  /**
   * Frames per second (1..30).
   * @default 10
   */
  fps?: number;
}

/** Arguments for `computer_scroll`. */
export interface ComputerScrollArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Window-relative X coordinate.
   */
  x: number;
  /**
   * Window-relative Y coordinate.
   */
  y: number;
  /**
   * vertical or horizontal.
   * @default "vertical"
   */
  axis?: string;
  /**
   * up, down, left or right.
   * @default "down"
   */
  direction?: string;
  /**
   * Number of wheel notches (1..40).
   * @default 1
   */
  wheelTimes?: number;
  /**
   * Restore and focus the target window before input.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `computer_speak`. */
export interface ComputerSpeakArgs {
  /**
   * Text to speak, maximum 32768 characters.
   */
  text: string;
  /**
   * Optional WAV export path; otherwise a temporary WAV is created.
   * @default null
   */
  audioPath?: string | null;
}

/** Arguments for `computer_type`. */
export interface ComputerTypeArgs {
  /**
   * Exact HWND from the latest observation (0 = current foreground window).
   */
  windowHandle: number;
  /**
   * Text to type.
   */
  text: string;
  /**
   * Window-relative X coordinate in pixels.
   */
  x: number;
  /**
   * Window-relative Y coordinate in pixels.
   */
  y: number;
  /**
   * Select all and delete existing field contents first.
   * @default false
   */
  clear?: boolean;
  /**
   * Press Enter after typing.
   * @default false
   */
  pressEnter?: boolean;
  /**
   * Restore and focus the target window before input.
   * @default true
   */
  activate?: boolean;
}

/** Arguments for `coord_assign_task`. */
export interface CoordAssignTaskArgs {
  /**
   * Markdown content for the new CURRENT_TASK.md (overwrites the existing file).
   */
  markdown: string;
}

/** Arguments for `coord_query_stop`. */
export interface CoordQueryStopArgs {}

/** Arguments for `coord_read_status`. */
export interface CoordReadStatusArgs {
  /**
   * Agent name to read. Case-insensitive.
   */
  agent: string;
}

/** Arguments for `coord_read_task`. */
export interface CoordReadTaskArgs {}

/** Arguments for `coord_report_status`. */
export interface CoordReportStatusArgs {
  /**
   * Agent name (e.g. 'claude', 'gemini', 'aphrody-claude'). Case-insensitive on disk.
   */
  agent: string;
  /**
   * Full multi-line status block. Trailing newline is normalised.
   */
  status: string;
}

/** Arguments for `copy_path`. */
export interface CopyPathArgs {
  /**
   * Source path (absolute or relative to Desktop).
   */
  path: string;
  /**
   * Destination path (absolute or relative to Desktop).
   */
  destination: string;
  /**
   * Overwrite existing destination.
   * @default false
   */
  overwrite?: boolean;
}

/** Arguments for `delete_path`. */
export interface DeletePathArgs {
  /**
   * Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
   */
  path: string;
  /**
   * Recurse into directory contents.
   * @default false
   */
  recursive?: boolean;
}

/** Arguments for `delete_registry_entry`. */
export interface DeleteRegistryEntryArgs {
  /**
   * Key path including hive prefix.
   */
  path: string;
  /**
   * Value name; null/empty deletes the entire key.
   * @default null
   */
  name?: string | null;
}

/** Arguments for `disable_scheduled_task`. */
export interface DisableScheduledTaskArgs {
  /**
   * Absolute task path.
   */
  path: string;
}

/** Arguments for `enable_scheduled_task`. */
export interface EnableScheduledTaskArgs {
  /**
   * Absolute task path, e.g. '\Microsoft\Windows\Defender\Windows Defender Scheduled Scan'.
   */
  path: string;
}

/** Arguments for `gamepad_create_xbox360`. */
export interface GamepadCreateXbox360Args {
  /**
   * Slot index (0–7) used to reference this controller in subsequent calls.
   * @default 0
   */
  slotIndex?: number;
}

/** Arguments for `gamepad_destroy`. */
export interface GamepadDestroyArgs {
  /**
   * Slot index to destroy.
   */
  slot: number;
}

/** Arguments for `gamepad_destroy_all`. */
export interface GamepadDestroyAllArgs {}

/** Arguments for `gamepad_environment`. */
export interface GamepadEnvironmentArgs {}

/** Arguments for `gamepad_press_button`. */
export interface GamepadPressButtonArgs {
  /**
   * Slot index from GamepadCreateXbox360.
   */
  slot: number;
  /**
   * Button bitmask to press (e.g. 4096 for A).
   */
  buttonMask: number;
  /**
   * Hold duration in milliseconds [1, 5000].
   * @default 100
   */
  holdMs?: number;
}

/** Arguments for `gamepad_send_xbox360_state`. */
export interface GamepadSendXbox360StateArgs {
  /**
   * Slot index from GamepadCreateXbox360.
   */
  slot: number;
  /**
   * Button bitmask (see description for values).
   */
  buttons: number;
  /**
   * Left stick X axis [-32768, 32767].
   * @default 0
   */
  lx?: number;
  /**
   * Left stick Y axis [-32768, 32767].
   * @default 0
   */
  ly?: number;
  /**
   * Right stick X axis [-32768, 32767].
   * @default 0
   */
  rx?: number;
  /**
   * Right stick Y axis [-32768, 32767].
   * @default 0
   */
  ry?: number;
  /**
   * Left trigger [0, 255].
   * @default 0
   */
  lt?: number;
  /**
   * Right trigger [0, 255].
   * @default 0
   */
  rt?: number;
}

/** Arguments for `gaming_capture_benchmark`. */
export interface GamingCaptureBenchmarkArgs {
  /**
   * Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground window.
   */
  hwnd?: number;
  /**
   * Case-insensitive substring of the target window title, used when hwnd is absent.
   */
  title?: string;
  /**
   * Measurement window in ms [100, 30000].
   * @default 3000
   */
  durationMs?: number;
  /**
   * Also measure the GDI PNG capture rate (Windows).
   * @default true
   */
  compareGdi?: boolean;
}

/** Arguments for `gaming_capture_window`. */
export interface GamingCaptureWindowArgs {
  /**
   * Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground window.
   */
  hwnd?: number;
  /**
   * Case-insensitive substring of the target window title, used when hwnd is absent.
   */
  title?: string;
  /**
   * Optional PNG path written in addition to the returned image.
   */
  outputPath?: string;
  /**
   * Return the PNG inline as base64.
   * @default true
   */
  includeImage?: boolean;
}

/** Arguments for `gaming_environment`. */
export interface GamingEnvironmentArgs {}

/** Arguments for `gaming_frame_pacing`. */
export interface GamingFramePacingArgs {
  /**
   * Target window: Windows HWND or X11 window id. 0 or absent uses title, else the foreground window.
   */
  hwnd?: number;
  /**
   * Case-insensitive substring of the target window title, used when hwnd is absent.
   */
  title?: string;
  /**
   * Observation window in ms [100, 30000].
   * @default 3000
   */
  durationMs?: number;
}

/** Arguments for `gaming_get_background_apps`. */
export interface GamingGetBackgroundAppsArgs {}

/** Arguments for `gaming_get_game_bar_capture`. */
export interface GamingGetGameBarCaptureArgs {}

/** Arguments for `gaming_get_game_mode`. */
export interface GamingGetGameModeArgs {}

/** Arguments for `gaming_get_gpu_info`. */
export interface GamingGetGpuInfoArgs {}

/** Arguments for `gaming_get_timer_resolution`. */
export interface GamingGetTimerResolutionArgs {}

/** Arguments for `gaming_input_sequence`. */
export interface GamingInputSequenceArgs {
  /**
   * Target window (Windows HWND or X11 id): focused and verified as foreground before any input is sent; input is refused otherwise.
   */
  hwnd?: number;
  /**
   * Case-insensitive title substring of the target window, used when hwnd is absent; same focus guard.
   */
  title?: string;
  /**
   * Input events, at most 10000.
   */
  events: Record<string, unknown>[];
}

/** Arguments for `gaming_key`. */
export interface GamingKeyArgs {
  /**
   * Target window (Windows HWND or X11 id): focused and verified as foreground before any input is sent; input is refused otherwise.
   */
  hwnd?: number;
  /**
   * Case-insensitive title substring of the target window, used when hwnd is absent; same focus guard.
   */
  title?: string;
  /**
   * Key name at its US-QWERTY physical position (games bind scan codes): a-z, 0-9, space, enter, escape, tab, shift, rshift, ctrl, alt, backspace, capslock, f1-f12, up, down, left, right, home, end, pageup, pagedown, insert, delete.
   */
  key?: string;
  /**
   * PC set-1 scan code, used instead of key for any other key.
   */
  scanCode?: number;
  /**
   * Extended (E0) scan code flag for scanCode.
   * @default false
   */
  extended?: boolean;
  /**
   * down, up, tap or hold.
   */
  action?: string;
  /**
   * Hold time in ms for tap/hold (tap 20, hold 250 by default).
   */
  holdMs?: number;
  /**
   * Repetitions [1, 1000].
   * @default 1
   */
  repeat?: number;
  /**
   * Pause between repetitions in ms.
   * @default 20
   */
  intervalMs?: number;
}

/** Arguments for `gaming_mouse_button`. */
export interface GamingMouseButtonArgs {
  /**
   * Target window (Windows HWND or X11 id): focused and verified as foreground before any input is sent; input is refused otherwise.
   */
  hwnd?: number;
  /**
   * Case-insensitive title substring of the target window, used when hwnd is absent; same focus guard.
   */
  title?: string;
  /**
   * left, right or middle.
   */
  button?: string;
  /**
   * down, up or click.
   */
  action?: string;
  /**
   * Hold time for click in ms.
   * @default 30
   */
  holdMs?: number;
}

/** Arguments for `gaming_mouse_delta`. */
export interface GamingMouseDeltaArgs {
  /**
   * Target window (Windows HWND or X11 id): focused and verified as foreground before any input is sent; input is refused otherwise.
   */
  hwnd?: number;
  /**
   * Case-insensitive title substring of the target window, used when hwnd is absent; same focus guard.
   */
  title?: string;
  /**
   * Total horizontal counts.
   * @default 0
   */
  dx?: number;
  /**
   * Total vertical counts.
   * @default 0
   */
  dy?: number;
  /**
   * Number of input events [1, 100000].
   * @default 1
   */
  steps?: number;
  /**
   * Event rate [1, 8000].
   * @default 1000
   */
  rateHz?: number;
}

/** Arguments for `gaming_profile_apply`. */
export interface GamingProfileApplyArgs {
  /**
   * Must be true to apply.
   * @default false
   */
  confirm?: boolean;
  /**
   * Return the command without applying.
   * @default false
   */
  dryRun?: boolean;
}

/** Arguments for `gaming_profile_status`. */
export interface GamingProfileStatusArgs {}

/** Arguments for `gaming_steam_launch`. */
export interface GamingSteamLaunchArgs {
  /**
   * Steam application id.
   */
  appId: number;
  /**
   * Game executable name used to find its window (e.g. game.exe).
   */
  processName?: string;
  /**
   * Case-insensitive substring of the game window title.
   */
  windowTitle?: string;
  /**
   * Window wait timeout in ms (max 600000).
   * @default 120000
   */
  timeoutMs?: number;
  /**
   * Bring the window to the foreground.
   * @default true
   */
  focus?: boolean;
}

/** Arguments for `get_active_power_plan`. */
export interface GetActivePowerPlanArgs {}

/** Arguments for `get_clipboard_text`. */
export interface GetClipboardTextArgs {}

/** Arguments for `get_cpu_info`. */
export interface GetCpuInfoArgs {}

/** Arguments for `get_cpu_usage`. */
export interface GetCpuUsageArgs {
  /**
   * Sample window in milliseconds. Clamped to [50, 2000]. Default 250.
   * @default 250
   */
  intervalMs?: number;
}

/** Arguments for `get_defender_status`. */
export interface GetDefenderStatusArgs {}

/** Arguments for `get_disk_info`. */
export interface GetDiskInfoArgs {}

/** Arguments for `get_file_info`. */
export interface GetFileInfoArgs {
  /**
   * Absolute or relative path.
   */
  path: string;
}

/** Arguments for `get_gpu_preferences`. */
export interface GetGpuPreferencesArgs {}

/** Arguments for `get_hags_mode`. */
export interface GetHagsModeArgs {}

/** Arguments for `get_memory_info`. */
export interface GetMemoryInfoArgs {}

/** Arguments for `get_network_adapters`. */
export interface GetNetworkAdaptersArgs {}

/** Arguments for `get_os_info`. */
export interface GetOsInfoArgs {}

/** Arguments for `get_registry_value`. */
export interface GetRegistryValueArgs {
  /**
   * Key path including hive prefix, e.g. 'HKCU:\Software\MyApp'.
   */
  path: string;
  /**
   * Value name. Use '(default)' for the default unnamed value.
   */
  name: string;
}

/** Arguments for `get_system_profile`. */
export interface GetSystemProfileArgs {}

/** Arguments for `golang_scan`. */
export interface GolangScanArgs {
  /**
   * Absolute path to the target binary.
   */
  path: string;
  /**
   * Max symbols to extract (default 200).
   * @default 200
   */
  maxSymbols?: number;
}

/** Arguments for `keyboard_hold`. */
export interface KeyboardHoldArgs {
  /**
   * Virtual-key code (e.g. 0x57 = W, 0x10 = Shift).
   */
  vk: number;
}

/** Arguments for `keyboard_release`. */
export interface KeyboardReleaseArgs {
  /**
   * Virtual-key code.
   */
  vk: number;
}

/** Arguments for `keyboard_scan_code`. */
export interface KeyboardScanCodeArgs {
  /**
   * Scan code (decimal or 0x-prefixed hex, e.g. 0x1E for 'A').
   */
  scanCode: number;
  /**
   * 'down' | 'up' | 'tap'.
   * @default "tap"
   */
  action?: string;
  /**
   * Mark as extended (E0-prefixed) key (arrows, NumPad, RWIN, etc).
   * @default false
   */
  extended?: boolean;
}

/** Arguments for `kill_process`. */
export interface KillProcessArgs {
  /**
   * Process ID. Takes precedence over name when set.
   * @default null
   */
  pid?: number | null;
  /**
   * Process name (no .exe extension required). Used when pid is null.
   * @default null
   */
  name?: string | null;
  /**
   * Force terminate (default true).
   * @default true
   */
  force?: boolean;
}

/** Arguments for `launch_app`. */
export interface LaunchAppArgs {
  /**
   * Path, executable name or shell URI to launch.
   */
  target: string;
  /**
   * Optional command-line arguments (space-separated, shell-escaped).
   * @default null
   */
  args?: string | null;
  /**
   * Working directory for the new process.
   * @default null
   */
  workingDirectory?: string | null;
}

/** Arguments for `list_directory`. */
export interface ListDirectoryArgs {
  /**
   * Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
   */
  path: string;
  /**
   * Glob pattern filter, e.g. '*.txt'. Empty = all entries.
   * @default null
   */
  pattern?: string | null;
  /**
   * Recurse into subdirectories.
   * @default false
   */
  recursive?: boolean;
  /**
   * Include hidden / system entries.
   * @default false
   */
  showHidden?: boolean;
  /**
   * Optional ASCII case-insensitive glob patterns matching entry names to omit. Matching directories are not returned or traversed.
   * @default []
   */
  exclude?: string[];
}

/** Arguments for `list_listening_ports`. */
export interface ListListeningPortsArgs {}

/** Arguments for `list_power_plans`. */
export interface ListPowerPlansArgs {}

/** Arguments for `list_processes`. */
export interface ListProcessesArgs {
  /**
   * Substring filter on process name (case-insensitive). Empty = no filter.
   * @default null
   */
  name?: string | null;
  /**
   * Sort key: 'memory', 'private', 'cpu', 'threads', 'handles' or 'name'.
   * @default "memory"
   */
  sortBy?: string;
  /**
   * Maximum number of results to return.
   * @default 20
   */
  limit?: number;
}

/** Arguments for `list_registry_key`. */
export interface ListRegistryKeyArgs {
  /**
   * Key path including hive prefix.
   */
  path: string;
}

/** Arguments for `list_scheduled_tasks`. */
export interface ListScheduledTasksArgs {
  /**
   * Task folder, default '\'. Use '\Microsoft\Windows\Defender' for sub-folders.
   * @default "\\"
   */
  folder?: string;
}

/** Arguments for `list_services`. */
export interface ListServicesArgs {
  /**
   * Substring filter on service name (case-insensitive). Empty = no filter.
   * @default null
   */
  nameFilter?: string | null;
  /**
   * Status filter: Running, Stopped, Paused, StartPending, StopPending. Empty = any.
   * @default null
   */
  statusFilter?: string | null;
}

/** Arguments for `list_tcp_connections`. */
export interface ListTcpConnectionsArgs {
  /**
   * Optional state filter (case-insensitive). Empty = all states.
   * @default null
   */
  stateFilter?: string | null;
}

/** Arguments for `list_windows`. */
export interface ListWindowsArgs {}

/** Arguments for `mem_allocate`. */
export interface MemAllocateArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Size in bytes to commit.
   */
  size: number;
  /**
   * Protection flags: rw | rwx | rx.
   * @default "rw"
   */
  protect?: string;
}

/** Arguments for `mem_dump_region`. */
export interface MemDumpRegionArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Start address (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Bytes to read. Capped at 4 MiB.
   */
  size: number;
  /**
   * Output file path. Empty = auto in %TEMP%.
   * @default null
   */
  outputPath?: string | null;
  /**
   * Suspend the process for the duration of the read.
   * @default false
   */
  suspend?: boolean;
}

/** Arguments for `mem_enable_debug_privilege`. */
export interface MemEnableDebugPrivilegeArgs {}

/** Arguments for `mem_free`. */
export interface MemFreeArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Base address returned by MemAllocate (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_get_module_base`. */
export interface MemGetModuleBaseArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Module name to find (e.g. 'kernel32.dll'). Case-insensitive.
   */
  moduleName: string;
}

/** Arguments for `mem_list_modules`. */
export interface MemListModulesArgs {
  /**
   * Target process ID.
   */
  pid: number;
}

/** Arguments for `mem_list_processes`. */
export interface MemListProcessesArgs {
  /**
   * Substring filter on process name (case-insensitive). Empty = all.
   * @default ""
   */
  nameFilter?: string;
}

/** Arguments for `mem_protect`. */
export interface MemProtectArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Base address.
   */
  address: number;
  /**
   * Region size in bytes.
   */
  size: number;
  /**
   * New protection: rw | rwx | rx | ro | noaccess.
   */
  protect: string;
}

/** Arguments for `mem_query_region`. */
export interface MemQueryRegionArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Any address within the region to query (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_read_bytes`. */
export interface MemReadBytesArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Number of bytes to read. Capped at 65536.
   */
  length: number;
}

/** Arguments for `mem_read_c_string`. */
export interface MemReadCStringArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Maximum bytes to read before stopping. Default 256, capped at 4096.
   * @default 256
   */
  maxLength?: number;
}

/** Arguments for `mem_read_double`. */
export interface MemReadDoubleArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_read_float`. */
export interface MemReadFloatArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_read_int32`. */
export interface MemReadInt32Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_read_int64`. */
export interface MemReadInt64Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
}

/** Arguments for `mem_read_utf16`. */
export interface MemReadUtf16Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to read from (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Maximum characters to read. Default 256, capped at 2048.
   * @default 256
   */
  maxChars?: number;
}

/** Arguments for `mem_resume_process`. */
export interface MemResumeProcessArgs {
  /**
   * Target process ID.
   */
  pid: number;
}

/** Arguments for `mem_scan_aob`. */
export interface MemScanAobArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Module name to scan within (e.g. 'engine.dll').
   */
  moduleName: string;
  /**
   * IDA-style byte pattern with '??' wildcards (e.g. '48 8B 05 ?? ?? ??').
   */
  pattern: string;
  /**
   * Maximum number of matches to return. Default 10, capped at 100.
   * @default 10
   */
  maxHits?: number;
}

/** Arguments for `mem_scan_value_int32`. */
export interface MemScanValueInt32Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Value to search for.
   */
  value: number;
  /**
   * Maximum hits to return (default 200, capped at 5000).
   * @default 200
   */
  maxHits?: number;
}

/** Arguments for `mem_suspend_process`. */
export interface MemSuspendProcessArgs {
  /**
   * Target process ID.
   */
  pid: number;
}

/** Arguments for `mem_write_bytes`. */
export interface MemWriteBytesArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address to write to (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Hex string of bytes to write (e.g. 'deadbeef' or 'de ad be ef').
   */
  hex: string;
}

/** Arguments for `mem_write_double`. */
export interface MemWriteDoubleArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Value to write.
   */
  value: number;
}

/** Arguments for `mem_write_float`. */
export interface MemWriteFloatArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Value to write.
   */
  value: number;
}

/** Arguments for `mem_write_int32`. */
export interface MemWriteInt32Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Value to write.
   */
  value: number;
}

/** Arguments for `mem_write_int64`. */
export interface MemWriteInt64Args {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Virtual address (decimal or 0x-prefixed hex).
   */
  address: number;
  /**
   * Value to write.
   */
  value: number;
}

/** Arguments for `mouse_drag_to`. */
export interface MouseDragToArgs {
  /**
   * Start X (screen pixels).
   */
  x1: number;
  /**
   * Start Y (screen pixels).
   */
  y1: number;
  /**
   * End X (screen pixels).
   */
  x2: number;
  /**
   * End Y (screen pixels).
   */
  y2: number;
  /**
   * Mouse button: left | right | middle.
   * @default "left"
   */
  button?: string;
  /**
   * Intermediate move events (8..200).
   * @default 20
   */
  steps?: number;
  /**
   * Total drag duration in ms (clamped 50..5000).
   * @default 250
   */
  durationMs?: number;
}

/** Arguments for `mouse_move_smooth`. */
export interface MouseMoveSmoothArgs {
  /**
   * Target X (screen pixels).
   */
  x: number;
  /**
   * Target Y (screen pixels).
   */
  y: number;
  /**
   * Intermediate move events (4..200).
   * @default 30
   */
  steps?: number;
  /**
   * Total duration in ms (clamped 30..3000).
   * @default 200
   */
  durationMs?: number;
}

/** Arguments for `move`. */
export interface MoveArgs {
  /**
   * X coordinate in screen pixels.
   */
  x: number;
  /**
   * Y coordinate in screen pixels.
   */
  y: number;
  /**
   * Left-button drag from current position to (x,y) when true; cursor move (hover) otherwise.
   * @default false
   */
  drag?: boolean;
}

/** Arguments for `move_path`. */
export interface MovePathArgs {
  /**
   * Source path (absolute or relative to Desktop).
   */
  path: string;
  /**
   * Destination path (absolute or relative to Desktop).
   */
  destination: string;
  /**
   * Overwrite existing destination.
   * @default false
   */
  overwrite?: boolean;
}

/** Arguments for `multi_edit`. */
export interface MultiEditArgs {
  /**
   * Comma-separated UIA element names to type into.
   */
  labels: string;
  /**
   * Text payload (applied identically to each target).
   */
  text: string;
}

/** Arguments for `multi_select`. */
export interface MultiSelectArgs {
  /**
   * Comma-separated UIA element names to click in order.
   */
  labels: string;
}

/** Arguments for `perf_dwm_flush`. */
export interface PerfDwmFlushArgs {}

/** Arguments for `perf_empty_working_sets`. */
export interface PerfEmptyWorkingSetsArgs {}

/** Arguments for `perf_memory_status`. */
export interface PerfMemoryStatusArgs {}

/** Arguments for `perf_purge_standby_list`. */
export interface PerfPurgeStandbyListArgs {
  /**
   * Purge low-priority only (faster, safer) instead of the full standby list.
   * @default false
   */
  lowPriorityOnly?: boolean;
}

/** Arguments for `perf_set_eco_mode`. */
export interface PerfSetEcoModeArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * 'on' (eco), 'off' (max perf), 'default' (clear overrides).
   * @default "on"
   */
  mode?: string;
}

/** Arguments for `power_shell`. */
export interface PowerShellArgs {
  /**
   * PowerShell command or script to execute.
   */
  command: string;
  /**
   * Timeout in seconds before the process is killed (default 30, max 600).
   * @default 30
   */
  timeoutSeconds?: number;
}

/** Arguments for `query_event_log`. */
export interface QueryEventLogArgs {
  /**
   * Event log channel name.
   */
  channel: string;
  /**
   * Maximum number of events to return (1..1000).
   * @default 50
   */
  maxEvents?: number;
  /**
   * Optional XPath filter, e.g. "*[System[Level=2]]".
   * @default null
   */
  xpathFilter?: string | null;
}

/** Arguments for `read_file`. */
export interface ReadFileArgs {
  /**
   * Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
   */
  path: string;
  /**
   * Line offset (0-based). Default 0.
   * @default 0
   */
  offset?: number;
  /**
   * Maximum number of lines to read. 0 = no limit.
   * @default 0
   */
  limit?: number;
}

/** Arguments for `resize_window`. */
export interface ResizeWindowArgs {
  /**
   * Substring to match against the window title.
   */
  titleSubstring: string;
  /**
   * X coordinate (screen pixels).
   */
  x: number;
  /**
   * Y coordinate (screen pixels).
   */
  y: number;
  /**
   * New width (0 = keep current).
   * @default 0
   */
  width?: number;
  /**
   * New height (0 = keep current).
   * @default 0
   */
  height?: number;
}

/** Arguments for `restart_service`. */
export interface RestartServiceArgs {
  /**
   * Service short name.
   */
  name: string;
}

/** Arguments for `run_scheduled_task`. */
export interface RunScheduledTaskArgs {
  /**
   * Absolute task path.
   */
  path: string;
}

/** Arguments for `scrape`. */
export interface ScrapeArgs {
  /**
   * Absolute URL (http:// or https://). Other schemes are rejected.
   */
  url: string;
}

/** Arguments for `screenshot`. */
export interface ScreenshotArgs {
  /**
   * Output file path. If null, a timestamped file is written to %TEMP%.
   * @default null
   */
  outputPath?: string | null;
}

/** Arguments for `scroll`. */
export interface ScrollArgs {
  /**
   * X coordinate in screen pixels (cursor is moved here before scrolling).
   */
  x: number;
  /**
   * Y coordinate in screen pixels.
   */
  y: number;
  /**
   * Scroll axis: vertical | horizontal.
   * @default "vertical"
   */
  axis?: string;
  /**
   * Scroll direction: up | down | left | right.
   * @default "down"
   */
  direction?: string;
  /**
   * Number of wheel notches.
   * @default 1
   */
  wheelTimes?: number;
}

/** Arguments for `search_files`. */
export interface SearchFilesArgs {
  /**
   * Root path (absolute or relative to Desktop).
   */
  path: string;
  /**
   * Glob pattern, e.g. '*.log'.
   */
  pattern: string;
  /**
   * Recurse into subdirectories.
   * @default true
   */
  recursive?: boolean;
  /**
   * Basename glob patterns to omit; matching directories are not traversed.
   */
  exclude?: string[];
}

/** Arguments for `search_windows`. */
export interface SearchWindowsArgs {
  /**
   * Les mots clés de la recherche (nom de fichier ou contenu texte).
   */
  query: string;
}

/** Arguments for `send_notification`. */
export interface SendNotificationArgs {
  /**
   * Notification title (heading).
   */
  title: string;
  /**
   * Notification body message.
   */
  message: string;
  /**
   * AUMID for branded toasts. Ignored in this Win32 balloon implementation.
   * @default null
   */
  appId?: string | null;
}

/** Arguments for `set_active_power_plan`. */
export interface SetActivePowerPlanArgs {
  /**
   * GUID of the power plan to activate (with or without braces).
   */
  guid: string;
}

/** Arguments for `set_clipboard_text`. */
export interface SetClipboardTextArgs {
  /**
   * Text to copy to the clipboard.
   */
  text: string;
}

/** Arguments for `set_gpu_preference`. */
export interface SetGpuPreferenceArgs {
  /**
   * Absolute path to the executable.
   */
  exePath: string;
  /**
   * 'SystemDefault' | 'PowerSaving' | 'HighPerformance'
   */
  preference: string;
}

/** Arguments for `set_hags_mode`. */
export interface SetHagsModeArgs {
  /**
   * HwSchMode value: 0, 1, or 2.
   */
  mode: number;
}

/** Arguments for `set_process_affinity`. */
export interface SetProcessAffinityArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Affinity bitmask. Bit N = run on logical CPU N. 0 resets to system mask.
   */
  mask: number;
}

/** Arguments for `set_process_priority`. */
export interface SetProcessPriorityArgs {
  /**
   * Target process ID.
   */
  pid: number;
  /**
   * Priority class name (case-insensitive).
   */
  priority: string;
}

/** Arguments for `set_registry_value`. */
export interface SetRegistryValueArgs {
  /**
   * Key path including hive prefix, e.g. 'HKCU:\Software\MyApp'.
   */
  path: string;
  /**
   * Value name. Use '(default)' for the default unnamed value.
   */
  name: string;
  /**
   * Value contents as string (parsed per type).
   */
  value: string;
  /**
   * Type: String, ExpandString, DWord, QWord, MultiString.
   * @default "String"
   */
  type?: string;
}

/** Arguments for `shortcut`. */
export interface ShortcutArgs {
  /**
   * Shortcut string, e.g. 'ctrl+shift+esc'.
   */
  shortcut: string;
}

/** Arguments for `snapshot`. */
export interface SnapshotArgs {
  /**
   * Optional process name filter (reserved for compatibility; use windowHandle for exact targeting).
   * @default null
   */
  processName?: string | null;
  /**
   * Maximum number of UI elements to return (1..1000).
   * @default 200
   */
  maxElements?: number;
  /**
   * Exact HWND to inspect (0 = current foreground window).
   * @default 0
   */
  windowHandle?: number;
}

/** Arguments for `start_service`. */
export interface StartServiceArgs {
  /**
   * Service short name (e.g. 'wuauserv', 'BITS').
   */
  name: string;
}

/** Arguments for `steam_get_game`. */
export interface SteamGetGameArgs {
  /**
   * Steam AppID (integer).
   */
  appId: number;
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_get_game_status`. */
export interface SteamGetGameStatusArgs {
  /**
   * Steam AppID (integer).
   */
  appId: number;
  /**
   * Override executable name (no .exe required). Defaults to install_dir + .exe.
   * @default null
   */
  executableName?: string | null;
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_kill_game`. */
export interface SteamKillGameArgs {
  /**
   * Steam AppID (informational only).
   */
  appId: number;
  /**
   * Executable name to kill (no .exe required).
   */
  executableName: string;
}

/** Arguments for `steam_launch_and_wait`. */
export interface SteamLaunchAndWaitArgs {
  /**
   * Steam AppID (integer).
   */
  appId: number;
  /**
   * Executable name to watch for (no .exe required).
   */
  executableName: string;
  /**
   * Maximum wait in milliseconds. Default 60000.
   * @default 60000
   */
  timeoutMs?: number;
}

/** Arguments for `steam_launch_by_app_id`. */
export interface SteamLaunchByAppIdArgs {
  /**
   * Steam AppID (integer).
   */
  appId: number;
}

/** Arguments for `steam_list_games`. */
export interface SteamListGamesArgs {
  /**
   * Include games whose install directory is absent (files_present=0). Default false.
   * @default false
   */
  includeMissing?: boolean;
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_list_libraries`. */
export interface SteamListLibrariesArgs {
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_open_uri`. */
export interface SteamOpenUriArgs {
  /**
   * A steam:// URI, e.g. steam://store/2799860, steam://nav/console, steam://browsemedia.
   */
  steamUri: string;
}

/** Arguments for `steam_scan_summary`. */
export interface SteamScanSummaryArgs {
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_vault_status`. */
export interface SteamVaultStatusArgs {
  /**
   * Steam client root; defaults to the registry SteamPath or the standard install locations.
   */
  steamRoot?: string;
}

/** Arguments for `steam_wait_for_launch`. */
export interface SteamWaitForLaunchArgs {
  /**
   * Steam AppID (informational only, used in the response).
   */
  appId: number;
  /**
   * Executable name to watch for (no .exe required).
   */
  executableName: string;
  /**
   * Maximum wait in milliseconds. Default 60000.
   * @default 60000
   */
  timeoutMs?: number;
  /**
   * Poll interval in milliseconds. Default 500.
   * @default 500
   */
  pollMs?: number;
}

/** Arguments for `stop_service`. */
export interface StopServiceArgs {
  /**
   * Service short name (e.g. 'wuauserv', 'BITS').
   */
  name: string;
}

/** Arguments for `switch_to_window`. */
export interface SwitchToWindowArgs {
  /**
   * Substring to match against the window title.
   */
  titleSubstring: string;
}

/** Arguments for `trim_process_working_set`. */
export interface TrimProcessWorkingSetArgs {
  /**
   * Target process ID.
   */
  pid: number;
}

/** Arguments for `type`. */
export interface TypeArgs {
  /**
   * Text to type.
   */
  text: string;
  /**
   * X coordinate in screen pixels (the field will be focused via a left-click).
   */
  x: number;
  /**
   * Y coordinate in screen pixels.
   */
  y: number;
  /**
   * Clear the existing field contents first (Ctrl+A then Delete).
   * @default false
   */
  clear?: boolean;
  /**
   * Press ENTER after typing.
   * @default false
   */
  pressEnter?: boolean;
}

/** Arguments for `wait`. */
export interface WaitArgs {
  /**
   * Sleep duration in seconds (clamped to [1,120]).
   */
  seconds: number;
}

/** Arguments for `window_capture`. */
export interface WindowCaptureArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * Output BMP path. Empty = auto in %TEMP%.
   * @default null
   */
  outputPath?: string | null;
  /**
   * Render the full window content via DWM (recommended). False = client-area only.
   * @default true
   */
  fullContent?: boolean;
}

/** Arguments for `window_close`. */
export interface WindowCloseArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
}

/** Arguments for `window_enum_all`. */
export interface WindowEnumAllArgs {
  /**
   * Filter by process ID (0 = any).
   * @default 0
   */
  pid?: number;
  /**
   * Substring match on window class name (empty = any).
   * @default ""
   */
  classFilter?: string;
  /**
   * Substring match on window title (empty = any).
   * @default ""
   */
  titleFilter?: string;
  /**
   * Include invisible windows (default true).
   * @default true
   */
  includeHidden?: boolean;
}

/** Arguments for `window_enum_children`. */
export interface WindowEnumChildrenArgs {
  /**
   * Parent HWND (signed 64-bit).
   */
  parentHwnd: number;
}

/** Arguments for `window_find_by_class`. */
export interface WindowFindByClassArgs {
  /**
   * Exact window class name (case-sensitive).
   */
  className: string;
  /**
   * Optional exact window title (empty = any).
   * @default ""
   */
  title?: string;
}

/** Arguments for `window_get_text`. */
export interface WindowGetTextArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
}

/** Arguments for `window_minimise_all`. */
export interface WindowMinimiseAllArgs {}

/** Arguments for `window_move`. */
export interface WindowMoveArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * New X (screen pixels).
   */
  x: number;
  /**
   * New Y (screen pixels).
   */
  y: number;
  /**
   * New width (0 = keep).
   * @default 0
   */
  width?: number;
  /**
   * New height (0 = keep).
   * @default 0
   */
  height?: number;
}

/** Arguments for `window_post_message`. */
export interface WindowPostMessageArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * Message id (decimal or 0x-prefixed hex).
   */
  msg: number;
  /**
   * wParam.
   * @default 0
   */
  wParam?: number;
  /**
   * lParam.
   * @default 0
   */
  lParam?: number;
}

/** Arguments for `window_send_message`. */
export interface WindowSendMessageArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * Message id (decimal or 0x-prefixed hex).
   */
  msg: number;
  /**
   * wParam.
   * @default 0
   */
  wParam?: number;
  /**
   * lParam.
   * @default 0
   */
  lParam?: number;
}

/** Arguments for `window_set_opacity`. */
export interface WindowSetOpacityArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * Alpha 0..255 (255 = opaque).
   */
  alpha: number;
  /**
   * Make the window click-through (input passes underneath).
   * @default false
   */
  clickThrough?: boolean;
}

/** Arguments for `window_set_text`. */
export interface WindowSetTextArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * New text (UTF-16).
   */
  text: string;
}

/** Arguments for `window_set_topmost`. */
export interface WindowSetTopmostArgs {
  /**
   * Target HWND.
   */
  hwnd: number;
  /**
   * true = pin topmost, false = release.
   * @default true
   */
  topmost?: boolean;
}

/** Arguments for `winml_get_version`. */
export interface WinmlGetVersionArgs {}

/** Arguments for `winml_inspect_onnx`. */
export interface WinmlInspectOnnxArgs {
  /**
   * Absolute path to a .onnx model file.
   */
  modelPath: string;
}

/** Arguments for `winml_list_providers`. */
export interface WinmlListProvidersArgs {}

/** Arguments for `winml_run_float32`. */
export interface WinmlRunFloat32Args {
  /**
   * Absolute path to a .onnx model file.
   */
  modelPath: string;
  /**
   * JSON map of input name -> { shape: int[], data: float[] }.
   */
  inputsJson: string;
  /**
   * 'cpu' | 'dml' | 'cuda'. Default 'cpu'.
   * @default "cpu"
   */
  executionProvider?: string;
}

/** Arguments for `write_file`. */
export interface WriteFileArgs {
  /**
   * Absolute or relative path. Relative paths are resolved against the user's Desktop folder.
   */
  path: string;
  /**
   * Text content to write.
   */
  content: string;
  /**
   * Append to existing content instead of overwriting.
   * @default false
   */
  append?: boolean;
}

/** Arguments for `wsl_execute`. */
export interface WslExecuteArgs {
  /**
   * Exact distribution name returned by wsl_list_distributions.
   */
  distribution: string;
  /**
   * Executable followed by its arguments; 1..64 values, no control characters.
   */
  command: string[];
}

/** Arguments for `wsl_get_status`. */
export interface WslGetStatusArgs {}

/** Arguments for `wsl_list_distributions`. */
export interface WslListDistributionsArgs {}

/** Arguments for `wsl_list_processes`. */
export interface WslListProcessesArgs {
  /**
   * Exact distribution name returned by wsl_list_distributions.
   */
  distribution: string;
}

/** Arguments for `wsl_read_only_probe`. */
export interface WslReadOnlyProbeArgs {
  /**
   * Exact distribution name returned by wsl_list_distributions.
   */
  distribution: string;
  /**
   * One of: system-info, re-toolchain, processes, mounts, network.
   */
  probe: string;
}

/** Arguments for `wsl_send_signal`. */
export interface WslSendSignalArgs {
  /**
   * Exact distribution name returned by wsl_list_distributions.
   */
  distribution: string;
  /**
   * Exact positive Linux PID returned by wsl_list_processes.
   */
  processId: number;
  /**
   * HUP, INT, TERM, or KILL.
   * @default "TERM"
   */
  signal?: string;
}

/** Arguments for `tweak_catalog`. */
export interface TweakCatalogArgs {
  /**
   * Only tweaks of this module id.
   */
  module?: string;
}

/** Arguments for `tweak_plan`. */
export interface TweakPlanArgs {
  /**
   * Inline profile TOML. Omit for the default conservative live profile.
   */
  profileToml?: string;
  /**
   * Path to a profile .toml file (alternative to profileToml).
   */
  profilePath?: string;
}

/** Arguments for `tweak_apply`. */
export interface TweakApplyArgs {
  /**
   * Path of a plan from tweak_plan. Omit to build one from the profile first.
   */
  planPath?: string;
  /**
   * Inline profile TOML when no planPath is given.
   */
  profileToml?: string;
  /**
   * Must be true to apply.
   * @default false
   */
  confirm: boolean;
}

/** Arguments for `tweak_verify`. */
export interface TweakVerifyArgs {
  /**
   * Journal path. Omit to use the newest journal under %LOCALAPPDATA%unoswin11journal.
   */
  journalPath?: string;
}

/** Arguments for `tweak_undo`. */
export interface TweakUndoArgs {
  /**
   * Journal path. Omit to use the newest journal.
   */
  journalPath?: string;
}

export type ToolArgsMap = {
  analyze_pe: AnalyzePeArgs;
  aob_scan: AobScanArgs;
  asar_list: AsarListArgs;
  binary_aes_ctr_decrypt: BinaryAesCtrDecryptArgs;
  binary_entropy_map: BinaryEntropyMapArgs;
  binary_extract_strings: BinaryExtractStringsArgs;
  binary_hash_multi: BinaryHashMultiArgs;
  binary_list_cpk: BinaryListCpkArgs;
  binary_parse_pe_header: BinaryParsePeHeaderArgs;
  binary_section_dump: BinarySectionDumpArgs;
  binary_xor_decrypt: BinaryXorDecryptArgs;
  click: ClickArgs;
  computer_capture_screen: ComputerCaptureScreenArgs;
  computer_click: ComputerClickArgs;
  computer_click_element: ComputerClickElementArgs;
  computer_drag: ComputerDragArgs;
  computer_key: ComputerKeyArgs;
  computer_observe: ComputerObserveArgs;
  computer_ocr: ComputerOcrArgs;
  computer_record_clip: ComputerRecordClipArgs;
  computer_scroll: ComputerScrollArgs;
  computer_speak: ComputerSpeakArgs;
  computer_type: ComputerTypeArgs;
  coord_assign_task: CoordAssignTaskArgs;
  coord_query_stop: CoordQueryStopArgs;
  coord_read_status: CoordReadStatusArgs;
  coord_read_task: CoordReadTaskArgs;
  coord_report_status: CoordReportStatusArgs;
  copy_path: CopyPathArgs;
  delete_path: DeletePathArgs;
  delete_registry_entry: DeleteRegistryEntryArgs;
  disable_scheduled_task: DisableScheduledTaskArgs;
  enable_scheduled_task: EnableScheduledTaskArgs;
  gamepad_create_xbox360: GamepadCreateXbox360Args;
  gamepad_destroy: GamepadDestroyArgs;
  gamepad_destroy_all: GamepadDestroyAllArgs;
  gamepad_environment: GamepadEnvironmentArgs;
  gamepad_press_button: GamepadPressButtonArgs;
  gamepad_send_xbox360_state: GamepadSendXbox360StateArgs;
  gaming_capture_benchmark: GamingCaptureBenchmarkArgs;
  gaming_capture_window: GamingCaptureWindowArgs;
  gaming_environment: GamingEnvironmentArgs;
  gaming_frame_pacing: GamingFramePacingArgs;
  gaming_get_background_apps: GamingGetBackgroundAppsArgs;
  gaming_get_game_bar_capture: GamingGetGameBarCaptureArgs;
  gaming_get_game_mode: GamingGetGameModeArgs;
  gaming_get_gpu_info: GamingGetGpuInfoArgs;
  gaming_get_timer_resolution: GamingGetTimerResolutionArgs;
  gaming_input_sequence: GamingInputSequenceArgs;
  gaming_key: GamingKeyArgs;
  gaming_mouse_button: GamingMouseButtonArgs;
  gaming_mouse_delta: GamingMouseDeltaArgs;
  gaming_profile_apply: GamingProfileApplyArgs;
  gaming_profile_status: GamingProfileStatusArgs;
  gaming_steam_launch: GamingSteamLaunchArgs;
  get_active_power_plan: GetActivePowerPlanArgs;
  get_clipboard_text: GetClipboardTextArgs;
  get_cpu_info: GetCpuInfoArgs;
  get_cpu_usage: GetCpuUsageArgs;
  get_defender_status: GetDefenderStatusArgs;
  get_disk_info: GetDiskInfoArgs;
  get_file_info: GetFileInfoArgs;
  get_gpu_preferences: GetGpuPreferencesArgs;
  get_hags_mode: GetHagsModeArgs;
  get_memory_info: GetMemoryInfoArgs;
  get_network_adapters: GetNetworkAdaptersArgs;
  get_os_info: GetOsInfoArgs;
  get_registry_value: GetRegistryValueArgs;
  get_system_profile: GetSystemProfileArgs;
  golang_scan: GolangScanArgs;
  keyboard_hold: KeyboardHoldArgs;
  keyboard_release: KeyboardReleaseArgs;
  keyboard_scan_code: KeyboardScanCodeArgs;
  kill_process: KillProcessArgs;
  launch_app: LaunchAppArgs;
  list_directory: ListDirectoryArgs;
  list_listening_ports: ListListeningPortsArgs;
  list_power_plans: ListPowerPlansArgs;
  list_processes: ListProcessesArgs;
  list_registry_key: ListRegistryKeyArgs;
  list_scheduled_tasks: ListScheduledTasksArgs;
  list_services: ListServicesArgs;
  list_tcp_connections: ListTcpConnectionsArgs;
  list_windows: ListWindowsArgs;
  mem_allocate: MemAllocateArgs;
  mem_dump_region: MemDumpRegionArgs;
  mem_enable_debug_privilege: MemEnableDebugPrivilegeArgs;
  mem_free: MemFreeArgs;
  mem_get_module_base: MemGetModuleBaseArgs;
  mem_list_modules: MemListModulesArgs;
  mem_list_processes: MemListProcessesArgs;
  mem_protect: MemProtectArgs;
  mem_query_region: MemQueryRegionArgs;
  mem_read_bytes: MemReadBytesArgs;
  mem_read_c_string: MemReadCStringArgs;
  mem_read_double: MemReadDoubleArgs;
  mem_read_float: MemReadFloatArgs;
  mem_read_int32: MemReadInt32Args;
  mem_read_int64: MemReadInt64Args;
  mem_read_utf16: MemReadUtf16Args;
  mem_resume_process: MemResumeProcessArgs;
  mem_scan_aob: MemScanAobArgs;
  mem_scan_value_int32: MemScanValueInt32Args;
  mem_suspend_process: MemSuspendProcessArgs;
  mem_write_bytes: MemWriteBytesArgs;
  mem_write_double: MemWriteDoubleArgs;
  mem_write_float: MemWriteFloatArgs;
  mem_write_int32: MemWriteInt32Args;
  mem_write_int64: MemWriteInt64Args;
  mouse_drag_to: MouseDragToArgs;
  mouse_move_smooth: MouseMoveSmoothArgs;
  move: MoveArgs;
  move_path: MovePathArgs;
  multi_edit: MultiEditArgs;
  multi_select: MultiSelectArgs;
  perf_dwm_flush: PerfDwmFlushArgs;
  perf_empty_working_sets: PerfEmptyWorkingSetsArgs;
  perf_memory_status: PerfMemoryStatusArgs;
  perf_purge_standby_list: PerfPurgeStandbyListArgs;
  perf_set_eco_mode: PerfSetEcoModeArgs;
  power_shell: PowerShellArgs;
  query_event_log: QueryEventLogArgs;
  read_file: ReadFileArgs;
  resize_window: ResizeWindowArgs;
  restart_service: RestartServiceArgs;
  run_scheduled_task: RunScheduledTaskArgs;
  scrape: ScrapeArgs;
  screenshot: ScreenshotArgs;
  scroll: ScrollArgs;
  search_files: SearchFilesArgs;
  search_windows: SearchWindowsArgs;
  send_notification: SendNotificationArgs;
  set_active_power_plan: SetActivePowerPlanArgs;
  set_clipboard_text: SetClipboardTextArgs;
  set_gpu_preference: SetGpuPreferenceArgs;
  set_hags_mode: SetHagsModeArgs;
  set_process_affinity: SetProcessAffinityArgs;
  set_process_priority: SetProcessPriorityArgs;
  set_registry_value: SetRegistryValueArgs;
  shortcut: ShortcutArgs;
  snapshot: SnapshotArgs;
  start_service: StartServiceArgs;
  steam_get_game: SteamGetGameArgs;
  steam_get_game_status: SteamGetGameStatusArgs;
  steam_kill_game: SteamKillGameArgs;
  steam_launch_and_wait: SteamLaunchAndWaitArgs;
  steam_launch_by_app_id: SteamLaunchByAppIdArgs;
  steam_list_games: SteamListGamesArgs;
  steam_list_libraries: SteamListLibrariesArgs;
  steam_open_uri: SteamOpenUriArgs;
  steam_scan_summary: SteamScanSummaryArgs;
  steam_vault_status: SteamVaultStatusArgs;
  steam_wait_for_launch: SteamWaitForLaunchArgs;
  stop_service: StopServiceArgs;
  switch_to_window: SwitchToWindowArgs;
  trim_process_working_set: TrimProcessWorkingSetArgs;
  type: TypeArgs;
  wait: WaitArgs;
  window_capture: WindowCaptureArgs;
  window_close: WindowCloseArgs;
  window_enum_all: WindowEnumAllArgs;
  window_enum_children: WindowEnumChildrenArgs;
  window_find_by_class: WindowFindByClassArgs;
  window_get_text: WindowGetTextArgs;
  window_minimise_all: WindowMinimiseAllArgs;
  window_move: WindowMoveArgs;
  window_post_message: WindowPostMessageArgs;
  window_send_message: WindowSendMessageArgs;
  window_set_opacity: WindowSetOpacityArgs;
  window_set_text: WindowSetTextArgs;
  window_set_topmost: WindowSetTopmostArgs;
  winml_get_version: WinmlGetVersionArgs;
  winml_inspect_onnx: WinmlInspectOnnxArgs;
  winml_list_providers: WinmlListProvidersArgs;
  winml_run_float32: WinmlRunFloat32Args;
  write_file: WriteFileArgs;
  wsl_execute: WslExecuteArgs;
  wsl_get_status: WslGetStatusArgs;
  wsl_list_distributions: WslListDistributionsArgs;
  wsl_list_processes: WslListProcessesArgs;
  wsl_read_only_probe: WslReadOnlyProbeArgs;
  wsl_send_signal: WslSendSignalArgs;
  tweak_catalog: TweakCatalogArgs;
  tweak_plan: TweakPlanArgs;
  tweak_apply: TweakApplyArgs;
  tweak_verify: TweakVerifyArgs;
  tweak_undo: TweakUndoArgs;
};

/** One typed async method per WinClean tool. */
export abstract class GeneratedTools {
  abstract call<N extends ToolName>(
    name: N,
    args?: ToolArgsMap[N],
  ): Promise<ToolResult>;

  /**
   * Performs static analysis and symbol recovery on a target Windows PE binary (.exe or .dll). Recovers sections, imports, entry point disassembly, and maps symbols using heuristics (no execution).
   */
  analyzePe(args: AnalyzePeArgs): Promise<ToolResult> {
    return this.call("analyze_pe", args);
  }

  /**
   * Scans raw file bytes for an Array of Bytes (AOB) pattern with optional wildcards (? or ??). Pattern format: '48 8B ? ? 48 89' or 'E8 ? ? ? ? 85 C0'. Returns matching offsets in the binary.
   */
  aobScan(args: AobScanArgs): Promise<ToolResult> {
    return this.call("aob_scan", args);
  }

  /**
   * Lists files contained inside an Electron ASAR archive (.asar) without extraction or execution. Returns relative paths, offsets, and sizes.
   */
  asarList(args: AsarListArgs): Promise<ToolResult> {
    return this.call("asar_list", args);
  }

  /**
   * AES-128/256-CTR decryption of a file using caller-supplied key (hex) and 16-byte IV (hex). Streams large files. Returns sha256 of the plaintext. Key must be 16 or 32 bytes; IV must be 16 bytes.
   */
  binaryAesCtrDecrypt(args: BinaryAesCtrDecryptArgs): Promise<ToolResult> {
    return this.call("binary_aes_ctr_decrypt", args);
  }

  /**
   * Computes Shannon entropy (0..8 bits/byte) per fixed-size block. High entropy (>=7.5) typically indicates encryption or compression. Helps locate packed sections in a binary without disassembling.
   */
  binaryEntropyMap(args: BinaryEntropyMapArgs): Promise<ToolResult> {
    return this.call("binary_entropy_map", args);
  }

  /**
   * Extracts printable ASCII and UTF-16LE strings of >=minLength characters from a file. Returns up to maxResults entries with offset, encoding (ascii/utf16), and the string. Streams the file in 1 MiB chunks — works on large binaries.
   */
  binaryExtractStrings(args: BinaryExtractStringsArgs): Promise<ToolResult> {
    return this.call("binary_extract_strings", args);
  }

  /**
   * Computes MD5 + SHA1 + SHA256 of a file in a single pass. Streams the file (any size). Returns all three hex digests.
   */
  binaryHashMulti(args: BinaryHashMultiArgs): Promise<ToolResult> {
    return this.call("binary_hash_multi", args);
  }

  /**
   * Lists files inside a CRIWARE CPK archive (used by Inazuma Eleven Victory Road, many Japanese games). Parses the @UTF table at the start of the file. Returns up to maxEntries rows with internal path, offset, size, compressed size, CRC32.
   */
  binaryListCpk(args: BinaryListCpkArgs): Promise<ToolResult> {
    return this.call("binary_list_cpk", args);
  }

  /**
   * Parses the PE/COFF header of a Windows executable or DLL. Returns machine (x64/arm64/x86), characteristics, image base, entry RVA, subsystem (gui/console), is64bit flag, and section table (name + RVA + size + flags).
   */
  binaryParsePeHeader(args: BinaryParsePeHeaderArgs): Promise<ToolResult> {
    return this.call("binary_parse_pe_header", args);
  }

  /**
   * Dumps one named section (e.g. '.text', '.rdata', '.rsrc') of a PE file to outputPath. Returns offset, size, sha256.
   */
  binarySectionDump(args: BinarySectionDumpArgs): Promise<ToolResult> {
    return this.call("binary_section_dump", args);
  }

  /**
   * Writes 'decrypted' = encryptedFile XOR repeating-key to outputPath. Key in hex (e.g. 'A5 5A 12' or 'A55A12'). Streams large files. If the encryption is a single-byte XOR, pass one byte. Returns sha256 of result.
   */
  binaryXorDecrypt(args: BinaryXorDecryptArgs): Promise<ToolResult> {
    return this.call("binary_xor_decrypt", args);
  }

  /**
   * Performs a mouse click at the given screen coordinates. button: 'left' | 'right' | 'middle'. clicks: 0 = hover only, 1 = single click, 2 = double click.
   */
  click(args: ClickArgs): Promise<ToolResult> {
    return this.call("click", args);
  }

  /**
   * Captures the primary desktop as a PNG image content block for visual computer use. Returns the screen dimensions and coordinate space in a text block before the image. Use computer_observe for a specific application and its UI Automation tree.
   */
  computerCaptureScreen(args?: ComputerCaptureScreenArgs): Promise<ToolResult> {
    return this.call("computer_capture_screen", args);
  }

  /**
   * Clicks a point in the selected application using native mouse input. x/y are relative to the outer window rectangle returned by computer_observe. The window is restored and focused by default. Re-observe after the click because menus and layouts may change.
   */
  computerClick(args: ComputerClickArgs): Promise<ToolResult> {
    return this.call("computer_click", args);
  }

  /**
   * Finds one UI Automation element in a selected application and clicks its center. Prefer automationId when present, otherwise use an exact name, className or controlType from the latest computer_observe result. If multiple elements match, set occurrence (zero-based) or the tool returns the candidates without clicking.
   */
  computerClickElement(args: ComputerClickElementArgs): Promise<ToolResult> {
    return this.call("computer_click_element", args);
  }

  /**
   * Drags inside a selected application with interpolated native mouse movement. Coordinates are relative to the latest observed window image. Use this for canvas operations in Blender, Photoshop and similar software, then capture a fresh observation to verify the result.
   */
  computerDrag(args: ComputerDragArgs): Promise<ToolResult> {
    return this.call("computer_drag", args);
  }

  /**
   * Sends a keyboard key or shortcut to a selected application using SendInput. Examples: ctrl+c, ctrl+shift+s, alt+f4, enter, tab, escape, f5. Windows-key shortcuts are intentionally rejected by this computer-use surface. Re-observe after actions that change UI.
   */
  computerKey(args: ComputerKeyArgs): Promise<ToolResult> {
    return this.call("computer_key", args);
  }

  /**
   * Observes a Windows application for computer use. Returns structured window metadata and a native UI Automation tree as text, plus a PNG image content block when capture succeeds. windowHandle=0 selects the foreground window; otherwise use an exact HWND returned by window_enum_all. Coordinates in later computer_* actions are relative to this window image. Use this before every state-dependent click, type or drag.
   */
  computerObserve(args?: ComputerObserveArgs): Promise<ToolResult> {
    return this.call("computer_observe", args);
  }

  /**
   * Runs local Windows OCR over the selected application screenshot and returns exact text with line/word bounding boxes. region coordinates are relative to the observed window image. format=json returns structured OCR; format=markdown returns the extracted text as Markdown. Set speak=true to synthesize and play the result with the installed Windows voice.
   */
  computerOcr(args?: ComputerOcrArgs): Promise<ToolResult> {
    return this.call("computer_ocr", args);
  }

  /**
   * Records a bounded, exportable clip of a window or the primary desktop as an uncompressed AVI. The clip is written locally without ffmpeg or a cloud service. durationMs is 1..30000 and fps is 1..30.
   */
  computerRecordClip(args?: ComputerRecordClipArgs): Promise<ToolResult> {
    return this.call("computer_record_clip", args);
  }

  /**
   * Scrolls a selected application using native wheel input. x/y are relative to the observed window image and identify the pane under the cursor. Re-observe after scrolling because lazy-loaded content and UI layouts can change.
   */
  computerScroll(args: ComputerScrollArgs): Promise<ToolResult> {
    return this.call("computer_scroll", args);
  }

  /**
   * Speaks text using the installed local Windows speech synthesizer and plays it immediately. No cloud API or key is used. Returns the generated WAV path for export or later playback.
   */
  computerSpeak(args: ComputerSpeakArgs): Promise<ToolResult> {
    return this.call("computer_speak", args);
  }

  /**
   * Types literal Unicode text into a selected application. Focuses the point first; set clear=true to replace the current field. x/y are relative to the observed window image. Maximum payload is 4096 characters per call. Re-observe before submitting or pressing Enter.
   */
  computerType(args: ComputerTypeArgs): Promise<ToolResult> {
    return this.call("computer_type", args);
  }

  /**
   * Publish a new .coord/CURRENT_TASK.md. The full body is the markdown content. Returns JSON {ok,bytes,path}.
   */
  coordAssignTask(args: CoordAssignTaskArgs): Promise<ToolResult> {
    return this.call("coord_assign_task", args);
  }

  /**
   * Check the A2A kill switch — presence of .coord/STOP. Returns JSON {ok,stop:true|false}.
   */
  coordQueryStop(args?: CoordQueryStopArgs): Promise<ToolResult> {
    return this.call("coord_query_stop", args);
  }

  /**
   * Read the latest status block for an agent from .coord/STATUS_<AGENT>.txt. Returns JSON {ok,agent,status} (status='' when the file is absent).
   */
  coordReadStatus(args: CoordReadStatusArgs): Promise<ToolResult> {
    return this.call("coord_read_status", args);
  }

  /**
   * Read the current .coord/CURRENT_TASK.md. Returns JSON {ok,content} (content='' when absent).
   */
  coordReadTask(args?: CoordReadTaskArgs): Promise<ToolResult> {
    return this.call("coord_read_task", args);
  }

  /**
   * Write the status block for an agent. The block goes to .coord/STATUS_<AGENT>.txt where <AGENT> is the upper-case form of `agent`. Returns JSON {ok,agent,bytes}.
   */
  coordReportStatus(args: CoordReportStatusArgs): Promise<ToolResult> {
    return this.call("coord_report_status", args);
  }

  /**
   * Copies a file or directory to a destination.
   */
  copyPath(args: CopyPathArgs): Promise<ToolResult> {
    return this.call("copy_path", args);
  }

  /**
   * Deletes a file or directory. Set recursive=true for non-empty directories.
   */
  deletePath(args: DeletePathArgs): Promise<ToolResult> {
    return this.call("delete_path", args);
  }

  /**
   * Deletes a registry value (when name is set) or the entire key (when name is null/empty).
   */
  deleteRegistryEntry(args: DeleteRegistryEntryArgs): Promise<ToolResult> {
    return this.call("delete_registry_entry", args);
  }

  /**
   * Disables a scheduled task via schtasks /Change /Disable.
   */
  disableScheduledTask(args: DisableScheduledTaskArgs): Promise<ToolResult> {
    return this.call("disable_scheduled_task", args);
  }

  /**
   * Enables a scheduled task via schtasks /Change /Enable.
   */
  enableScheduledTask(args: EnableScheduledTaskArgs): Promise<ToolResult> {
    return this.call("enable_scheduled_task", args);
  }

  /**
   * Allocates a virtual Xbox 360 controller via ViGEmBus and connects it to the system. The virtual controller is indexed by slotIndex (0–7). Returns {"success":true,"slot":N,"vendorId":"045e","productId":"028e"} on success. Requires ViGEmBus: https://github.com/nefarius/ViGEmBus/releases
   */
  gamepadCreateXbox360(args?: GamepadCreateXbox360Args): Promise<ToolResult> {
    return this.call("gamepad_create_xbox360", args);
  }

  /**
   * Removes and frees the virtual Xbox 360 controller at the given slot. Safe to call if the slot was never created (no-op).
   */
  gamepadDestroy(args: GamepadDestroyArgs): Promise<ToolResult> {
    return this.call("gamepad_destroy", args);
  }

  /**
   * Removes and frees ALL active virtual Xbox 360 controllers created in this process. Use as cleanup before shutdown or when resetting gamepad state.
   */
  gamepadDestroyAll(args?: GamepadDestroyAllArgs): Promise<ToolResult> {
    return this.call("gamepad_destroy_all", args);
  }

  /**
   * Diagnoses the ViGEmBus virtual gamepad environment. Reports whether ViGEmBus registry key exists, whether the service is running, and whether ViGEmClient.dll can be located on disk. Install ViGEmBus from https://github.com/nefarius/ViGEmBus/releases if absent.
   */
  gamepadEnvironment(args?: GamepadEnvironmentArgs): Promise<ToolResult> {
    return this.call("gamepad_environment", args);
  }

  /**
   * Presses one or more buttons on a virtual Xbox 360 controller then releases them. buttonMask uses the same bitmask as GamepadSendXbox360State. holdMs: how long to hold the buttons down (clamped to [1, 5000] ms).
   */
  gamepadPressButton(args: GamepadPressButtonArgs): Promise<ToolResult> {
    return this.call("gamepad_press_button", args);
  }

  /**
   * Sends a full Xbox 360 controller state update. buttons bitmask: DPAD_UP=1, DPAD_DOWN=2, DPAD_LEFT=4, DPAD_RIGHT=8, START=16, BACK=32, L3=64, R3=128, LB=256, RB=512, GUIDE=1024, A=4096, B=8192, X=16384, Y=32768. Axes lx/ly/rx/ry: [-32768, 32767]. Triggers lt/rt: [0, 255].
   */
  gamepadSendXbox360State(
    args: GamepadSendXbox360StateArgs,
  ): Promise<ToolResult> {
    return this.call("gamepad_send_xbox360_state", args);
  }

  /**
   * Measures sustained capture throughput of a window for durationMs: GPU grabs with CPU readback per second (grabFps, grab latency avg/p95/max) and frames delivered by the compositor (deliveredFps). Windows also reports the GDI PrintWindow PNG rate for comparison.
   */
  gamingCaptureBenchmark(
    args?: GamingCaptureBenchmarkArgs,
  ): Promise<ToolResult> {
    return this.call("gaming_capture_benchmark", args);
  }

  /**
   * Low-latency capture of one game window. Windows: Windows.Graphics.Capture on a Direct3D 11 device (works for DirectX/Vulkan and occluded windows; GDI PrintWindow fallback). Linux: X11 import on DISPLAY (Xvfb :99 on the VPS session). Returns PNG plus backend, size and capture time.
   */
  gamingCaptureWindow(args?: GamingCaptureWindowArgs): Promise<ToolResult> {
    return this.call("gaming_capture_window", args);
  }

  /**
   * Reports the gaming computer-use backends of this host: Windows.Graphics.Capture support, SendInput, XInput pad slots (read-only), GameInput runtime and whether the ViGEmBus driver needed for virtual Xbox pads is installed (never installed by this SDK); on Linux the X11 display, xdotool, import, /dev/uinput and gamescope.
   */
  gamingEnvironment(args?: GamingEnvironmentArgs): Promise<ToolResult> {
    return this.call("gaming_environment", args);
  }

  /**
   * Observes a game window's presented frames for durationMs without hooking the game: fps, frame time avg/p50/p95/p99/min/max, jitter and 1% low, from DWM present timestamps (Windows.Graphics.Capture). A static window delivers no frames. Linux samples X11 content changes (bounded by the capture rate).
   */
  gamingFramePacing(args?: GamingFramePacingArgs): Promise<ToolResult> {
    return this.call("gaming_frame_pacing", args);
  }

  /**
   * Read-only: background apps switch (BackgroundAccessApplications GlobalUserDisabled) and the LetAppsRunInBackground policy.
   */
  gamingGetBackgroundApps(
    args?: GamingGetBackgroundAppsArgs,
  ): Promise<ToolResult> {
    return this.call("gaming_get_background_apps", args);
  }

  /**
   * Read-only: Xbox Game Bar background recording and app capture (GameConfigStore GameDVR_Enabled, GameDVR AppCaptureEnabled, AllowGameDVR policy).
   */
  gamingGetGameBarCapture(
    args?: GamingGetGameBarCaptureArgs,
  ): Promise<ToolResult> {
    return this.call("gaming_get_game_bar_capture", args);
  }

  /**
   * Read-only: Windows Game Mode (HKCU GameBar AutoGameModeEnabled / AllowAutoGameMode) with the recommended value.
   */
  gamingGetGameMode(args?: GamingGetGameModeArgs): Promise<ToolResult> {
    return this.call("gaming_get_game_mode", args);
  }

  /**
   * Read-only: NVIDIA GPU state through nvidia-smi/NVML (name, driver, P-state, power limit and draw, clocks, temperature, utilisation, memory, PCIe link), hardware-accelerated GPU scheduling and per-app GPU preferences.
   */
  gamingGetGpuInfo(args?: GamingGetGpuInfoArgs): Promise<ToolResult> {
    return this.call("gaming_get_gpu_info", args);
  }

  /**
   * Read-only: current, finest and coarsest kernel timer resolution (NtQueryTimerResolution) and the Windows 11 GlobalTimerResolutionRequests setting.
   */
  gamingGetTimerResolution(
    args?: GamingGetTimerResolutionArgs,
  ): Promise<ToolResult> {
    return this.call("gaming_get_timer_resolution", args);
  }

  /**
   * Plays a timed input sequence in one call for frame-accurate combos: events [{type:'move',dx,dy} | {type:'key',key|scanCode,action:down|up|tap,holdMs} | {type:'button',button,action:down|up|click,holdMs} | {type:'wait',ms}], each optionally scheduled at atMs from the start. Reports the worst scheduling lateness.
   */
  gamingInputSequence(args: GamingInputSequenceArgs): Promise<ToolResult> {
    return this.call("gaming_input_sequence", args);
  }

  /**
   * Sends a keyboard key as a hardware scan code (SendInput KEYEVENTF_SCANCODE; Linux: xdotool keysym) so games that read scan codes or raw input see it: down, up, tap or hold for holdMs, repeated with intervalMs.
   */
  gamingKey(args?: GamingKeyArgs): Promise<ToolResult> {
    return this.call("gaming_key", args);
  }

  /**
   * Presses a mouse button through SendInput (Linux: xdotool): down, up, or click with holdMs.
   */
  gamingMouseButton(args?: GamingMouseButtonArgs): Promise<ToolResult> {
    return this.call("gaming_mouse_button", args);
  }

  /**
   * Sends raw relative mouse motion (SendInput MOUSEEVENTF_MOVE, no absolute positioning) as games reading raw input expect: dx/dy split exactly across steps sent at rateHz with sub-millisecond pacing. Linux: xdotool mousemove_relative. Reports achieved rate and cursor before/after.
   */
  gamingMouseDelta(args?: GamingMouseDeltaArgs): Promise<ToolResult> {
    return this.call("gaming_mouse_delta", args);
  }

  /**
   * Applies the pending gaming profile items (registry values and power plan). Changes Windows settings: requires confirm=true and is meant to be run by the machine owner; dryRun=true only returns the command.
   */
  gamingProfileApply(args?: GamingProfileApplyArgs): Promise<ToolResult> {
    return this.call("gaming_profile_apply", args);
  }

  /**
   * Read-only gaming optimisation report: Game Mode, HAGS, power plan, background apps, Game Bar capture, timer resolution and GPU, each with current and recommended values, the pending items and applyCommand, the exact PowerShell one-liner the owner runs (elevated) to apply them.
   */
  gamingProfileStatus(args?: GamingProfileStatusArgs): Promise<ToolResult> {
    return this.call("gaming_profile_status", args);
  }

  /**
   * Launches an installed Steam game through the bun-steam owner (steam://rungameid/<appId>), then waits for its window by processName or windowTitle and brings it to the foreground for capture and input.
   */
  gamingSteamLaunch(args: GamingSteamLaunchArgs): Promise<ToolResult> {
    return this.call("gaming_steam_launch", args);
  }

  /**
   * Returns the GUID and friendly name of the active Windows power plan.
   */
  getActivePowerPlan(args?: GetActivePowerPlanArgs): Promise<ToolResult> {
    return this.call("get_active_power_plan", args);
  }

  /**
   * Reads UTF-16 text content from the Windows clipboard.
   */
  getClipboardText(args?: GetClipboardTextArgs): Promise<ToolResult> {
    return this.call("get_clipboard_text", args);
  }

  /**
   * Returns CPU topology as JSON: logical processors, physical cores, NUMA nodes, cache sizes (L1/L2/L3 aggregate), architecture.
   */
  getCpuInfo(args?: GetCpuInfoArgs): Promise<ToolResult> {
    return this.call("get_cpu_info", args);
  }

  /**
   * Samples global CPU usage over a short interval (default 250 ms, clamp 50-2000) via GetSystemTimes. Returns usage/idle percent and raw idle/kernel/user deltas in seconds. Kernel time as reported by Windows INCLUDES idle time; this tool subtracts it before computing the percentage.
   */
  getCpuUsage(args?: GetCpuUsageArgs): Promise<ToolResult> {
    return this.call("get_cpu_usage", args);
  }

  /**
   * Returns Windows Defender state as JSON: AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled, TamperProtected, AntivirusSignatureVersion, LastQuickScanStartUtc, LastFullScanStartUtc, ThreatCount.
   */
  getDefenderStatus(args?: GetDefenderStatusArgs): Promise<ToolResult> {
    return this.call("get_defender_status", args);
  }

  /**
   * Returns logical-drive info (root, type, total/free/available bytes) as JSON via GetLogicalDriveStrings + GetDiskFreeSpaceEx.
   */
  getDiskInfo(args?: GetDiskInfoArgs): Promise<ToolResult> {
    return this.call("get_disk_info", args);
  }

  /**
   * Returns metadata for a file or directory as JSON: size, dates, type, hidden flag.
   */
  getFileInfo(args: GetFileInfoArgs): Promise<ToolResult> {
    return this.call("get_file_info", args);
  }

  /**
   * Reads all per-app GPU preferences from HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences. Returns each registered exe path with its raw preference string ('GpuPreference=N;').
   */
  getGpuPreferences(args?: GetGpuPreferencesArgs): Promise<ToolResult> {
    return this.call("get_gpu_preferences", args);
  }

  /**
   * Reads HKLM\System\CurrentControlSet\Control\GraphicsDrivers\HwSchMode. 0 = WDDM CPU scheduling, 1 = OS-managed default, 2 = Hardware-Accelerated GPU Scheduling. Requires WDDM 2.7+ (Win10 20H1+ / Win11). Reboot to take effect.
   */
  getHagsMode(args?: GetHagsModeArgs): Promise<ToolResult> {
    return this.call("get_hags_mode", args);
  }

  /**
   * Returns physical / virtual / page-file memory state as JSON via GlobalMemoryStatusEx.
   */
  getMemoryInfo(args?: GetMemoryInfoArgs): Promise<ToolResult> {
    return this.call("get_memory_info", args);
  }

  /**
   * Lists network adapters (Name, Description, Status, MAC, link speed, IPv4 addresses) as JSON.
   */
  getNetworkAdapters(args?: GetNetworkAdaptersArgs): Promise<ToolResult> {
    return this.call("get_network_adapters", args);
  }

  /**
   * Returns OS version info (ProductName, EditionId, DisplayVersion, BuildNumber, UBR, InstallationType, OSArchitecture, MachineName, UserName) as JSON.
   */
  getOsInfo(args?: GetOsInfoArgs): Promise<ToolResult> {
    return this.call("get_os_info", args);
  }

  /**
   * Reads a registry value. Path uses PowerShell-style hive prefixes (HKCU:\, HKLM:\, HKCR:\, HKU:\, HKCC:\).
   */
  getRegistryValue(args: GetRegistryValueArgs): Promise<ToolResult> {
    return this.call("get_registry_value", args);
  }

  /**
   * Récupère le profil système complet pour vérifier l'état d'optimisation du poste.
   */
  getSystemProfile(args?: GetSystemProfileArgs): Promise<ToolResult> {
    return this.call("get_system_profile", args);
  }

  /**
   * Inspects a target binary for Golang runtime signatures (pclntab) and extracts Go package/symbol indicators. Passive inspection without execution.
   */
  golangScan(args: GolangScanArgs): Promise<ToolResult> {
    return this.call("golang_scan", args);
  }

  /**
   * Holds an arbitrary virtual key down (no release). Pair with KeyboardRelease to let go. Useful for charging mechanics, sustained movement keys, modifiers held across multiple ops.
   */
  keyboardHold(args: KeyboardHoldArgs): Promise<ToolResult> {
    return this.call("keyboard_hold", args);
  }

  /**
   * Releases a virtual key previously held by KeyboardHold.
   */
  keyboardRelease(args: KeyboardReleaseArgs): Promise<ToolResult> {
    return this.call("keyboard_release", args);
  }

  /**
   * Sends a single key by raw hardware SCAN CODE instead of virtual key. Some games (and anti-cheats) ignore Send-Input from virtual keys but accept scan codes because they match real keyboards. action: 'down' | 'up' | 'tap' (down+up).
   */
  keyboardScanCode(args: KeyboardScanCodeArgs): Promise<ToolResult> {
    return this.call("keyboard_scan_code", args);
  }

  /**
   * Kills a process by PID (preferred) or name. Returns the count of terminated processes. Force=true requests an immediate kill (default true). PPL-protected processes return a labelled error.
   */
  killProcess(args?: KillProcessArgs): Promise<ToolResult> {
    return this.call("kill_process", args);
  }

  /**
   * Launches a Windows application. Accepts an absolute path to an .exe (e.g. 'C:\\Windows\\System32\\notepad.exe'), an executable name resolvable via PATH (e.g. 'notepad.exe'), or a shell URI (mailto:, explorer:, ms-settings:).
   */
  launchApp(args: LaunchAppArgs): Promise<ToolResult> {
    return this.call("launch_app", args);
  }

  /**
   * Lists directory contents as streamed JSON. Set recursive=true to descend, showHidden=true to include hidden entries, pattern to filter by glob, and exclude to omit matching entry names and skip matching directories. Exclusion matching is ASCII case-insensitive. Hard cap: 10000 entries returned; result is marked truncated when exceeded.
   */
  listDirectory(args: ListDirectoryArgs): Promise<ToolResult> {
    return this.call("list_directory", args);
  }

  /**
   * Lists TCP/IPv4 listening ports (LISTEN state only) as JSON.
   */
  listListeningPorts(args?: ListListeningPortsArgs): Promise<ToolResult> {
    return this.call("list_listening_ports", args);
  }

  /**
   * Lists installed Windows power plans with their GUID, friendly name, and whether they are currently active. Returns JSON with the active GUID at the top.
   */
  listPowerPlans(args?: ListPowerPlansArgs): Promise<ToolResult> {
    return this.call("list_power_plans", args);
  }

  /**
   * Lists running processes as JSON. Filter by name (substring, case-insensitive). Sort by 'memory' (default), 'private', 'cpu', 'threads', 'handles' or 'name'. Limit caps the result count (default 20, max 1000). Backed by NtQuerySystemInformation for a single-syscall enumeration with full per-process metrics.
   */
  listProcesses(args?: ListProcessesArgs): Promise<ToolResult> {
    return this.call("list_processes", args);
  }

  /**
   * Lists sub-keys and values under a registry key as JSON.
   */
  listRegistryKey(args: ListRegistryKeyArgs): Promise<ToolResult> {
    return this.call("list_registry_key", args);
  }

  /**
   * Lists scheduled tasks under the given folder (default = root '\') via schtasks /Query. Returns JSON: Path, Name, State, LastRunTimeUtc, LastTaskResult, Enabled.
   */
  listScheduledTasks(args?: ListScheduledTasksArgs): Promise<ToolResult> {
    return this.call("list_scheduled_tasks", args);
  }

  /**
   * Lists Windows services as JSON. Filter by name substring (case-insensitive) and/or by status: Running, Stopped, Paused, StartPending, StopPending.
   */
  listServices(args?: ListServicesArgs): Promise<ToolResult> {
    return this.call("list_services", args);
  }

  /**
   * Lists active TCP/IPv4 connections (Local/Remote address+port, state, owning PID) as JSON. Optional state filter (Listen, Established, CloseWait, TimeWait, Closed, SynSent, etc.).
   */
  listTcpConnections(args?: ListTcpConnectionsArgs): Promise<ToolResult> {
    return this.call("list_tcp_connections", args);
  }

  /**
   * Lists all visible top-level windows as JSON.
   */
  listWindows(args?: ListWindowsArgs): Promise<ToolResult> {
    return this.call("list_windows", args);
  }

  /**
   * Allocates virtual memory in a remote process via VirtualAllocEx. Returns the base address of the new region. protect: 'rw' (PAGE_READWRITE), 'rwx' (PAGE_EXECUTE_READWRITE), 'rx' (PAGE_EXECUTE_READ).
   */
  memAllocate(args: MemAllocateArgs): Promise<ToolResult> {
    return this.call("mem_allocate", args);
  }

  /**
   * Reads up to MAX_DUMP_BYTES (4 MiB) from a memory region and writes them to a host-side file (default: %TEMP%\winclean_mcp_dump_<pid>_<addr>.bin). Returns the path and sha256 of the dump. Suspends the target during the read if suspend=true (avoids torn pages).
   */
  memDumpRegion(args: MemDumpRegionArgs): Promise<ToolResult> {
    return this.call("mem_dump_region", args);
  }

  /**
   * Enables SeDebugPrivilege on the current MCP process so subsequent OpenProcess calls can attach to protected processes (most non-PPL user-mode targets). Idempotent — safe to call repeatedly.
   */
  memEnableDebugPrivilege(
    args?: MemEnableDebugPrivilegeArgs,
  ): Promise<ToolResult> {
    return this.call("mem_enable_debug_privilege", args);
  }

  /**
   * Releases a region previously allocated with MemAllocate (MEM_RELEASE).
   */
  memFree(args: MemFreeArgs): Promise<ToolResult> {
    return this.call("mem_free", args);
  }

  /**
   * Returns the base address and size of a named module in a process. Name comparison is case-insensitive. Returns the first match.
   */
  memGetModuleBase(args: MemGetModuleBaseArgs): Promise<ToolResult> {
    return this.call("mem_get_module_base", args);
  }

  /**
   * Lists all loaded modules (DLLs + EXE) of a process. Returns name, baseAddress, and sizeOfImage for each module.
   */
  memListModules(args: MemListModulesArgs): Promise<ToolResult> {
    return this.call("mem_list_modules", args);
  }

  /**
   * Lists running processes filtered by name substring (case-insensitive). Returns pid, name, and sessionId for each match. Leave nameFilter empty to list all processes (capped at 512).
   */
  memListProcesses(args?: MemListProcessesArgs): Promise<ToolResult> {
    return this.call("mem_list_processes", args);
  }

  /**
   * Changes page protection on a memory region via VirtualProtectEx. Returns the previous protection flags. protect: rw | rwx | rx | ro | noaccess.
   */
  memProtect(args: MemProtectArgs): Promise<ToolResult> {
    return this.call("mem_protect", args);
  }

  /**
   * Queries the virtual memory region containing the given address via VirtualQueryEx. Returns BaseAddress, RegionSize, State (Free/Reserve/Commit), Protect flags, and Type (Private/Image/Mapped).
   */
  memQueryRegion(args: MemQueryRegionArgs): Promise<ToolResult> {
    return this.call("mem_query_region", args);
  }

  /**
   * Reads raw bytes from a process's virtual address space via ReadProcessMemory. Length is capped at 65536 bytes. Returns hex-encoded bytes in the 'hex' field.
   */
  memReadBytes(args: MemReadBytesArgs): Promise<ToolResult> {
    return this.call("mem_read_bytes", args);
  }

  /**
   * Reads a null-terminated ASCII C-string from a process's virtual memory. Stops at the first NUL byte or maxLength bytes, whichever comes first.
   */
  memReadCString(args: MemReadCStringArgs): Promise<ToolResult> {
    return this.call("mem_read_c_string", args);
  }

  /**
   * Reads a 64-bit IEEE 754 double (little-endian) from a process's virtual memory.
   */
  memReadDouble(args: MemReadDoubleArgs): Promise<ToolResult> {
    return this.call("mem_read_double", args);
  }

  /**
   * Reads a 32-bit IEEE 754 float (little-endian) from a process's virtual memory.
   */
  memReadFloat(args: MemReadFloatArgs): Promise<ToolResult> {
    return this.call("mem_read_float", args);
  }

  /**
   * Reads a signed 32-bit integer (little-endian) from a process's virtual memory.
   */
  memReadInt32(args: MemReadInt32Args): Promise<ToolResult> {
    return this.call("mem_read_int32", args);
  }

  /**
   * Reads a signed 64-bit integer (little-endian) from a process's virtual memory.
   */
  memReadInt64(args: MemReadInt64Args): Promise<ToolResult> {
    return this.call("mem_read_int64", args);
  }

  /**
   * Reads a null-terminated UTF-16LE wide string from a process's virtual memory. Stops at the first NUL char or maxChars characters, whichever comes first.
   */
  memReadUtf16(args: MemReadUtf16Args): Promise<ToolResult> {
    return this.call("mem_read_utf16", args);
  }

  /**
   * Resumes every thread of the target process via NtResumeProcess.
   */
  memResumeProcess(args: MemResumeProcessArgs): Promise<ToolResult> {
    return this.call("mem_resume_process", args);
  }

  /**
   * Scans a module's memory range for an IDA-style byte pattern (Array-of-Bytes scan). Pattern format: hex bytes separated by spaces, '??' as wildcard. Example: '48 8B 05 ?? ?? ?? ?? 48 89 01'. Reads the module in 256 KiB chunks. Returns up to maxHits matching addresses.
   */
  memScanAob(args: MemScanAobArgs): Promise<ToolResult> {
    return this.call("mem_scan_aob", args);
  }

  /**
   * Cheat-Engine-style first scan: searches every committed RW page of the process for a 4-byte little-endian int32 value. Returns up to maxHits absolute addresses. Use MemReadInt32 to verify, then narrow via repeated scans.
   */
  memScanValueInt32(args: MemScanValueInt32Args): Promise<ToolResult> {
    return this.call("mem_scan_value_int32", args);
  }

  /**
   * Suspends every thread of the target process via NtSuspendProcess.
   */
  memSuspendProcess(args: MemSuspendProcessArgs): Promise<ToolResult> {
    return this.call("mem_suspend_process", args);
  }

  /**
   * Writes raw bytes to a process's virtual memory via WriteProcessMemory. hex format: continuous hex digits (e.g. '48895c2408') or space-separated ('48 89 5c 24 08'). Length capped at 65536. Requires PROCESS_VM_WRITE — call MemEnableDebugPrivilege first for protected targets.
   */
  memWriteBytes(args: MemWriteBytesArgs): Promise<ToolResult> {
    return this.call("mem_write_bytes", args);
  }

  /**
   * Writes a 64-bit IEEE 754 double to a process's memory.
   */
  memWriteDouble(args: MemWriteDoubleArgs): Promise<ToolResult> {
    return this.call("mem_write_double", args);
  }

  /**
   * Writes a 32-bit IEEE 754 float to a process's memory.
   */
  memWriteFloat(args: MemWriteFloatArgs): Promise<ToolResult> {
    return this.call("mem_write_float", args);
  }

  /**
   * Writes a signed 32-bit little-endian integer to a process's memory.
   */
  memWriteInt32(args: MemWriteInt32Args): Promise<ToolResult> {
    return this.call("mem_write_int32", args);
  }

  /**
   * Writes a signed 64-bit little-endian integer to a process's memory.
   */
  memWriteInt64(args: MemWriteInt64Args): Promise<ToolResult> {
    return this.call("mem_write_int64", args);
  }

  /**
   * Performs a mouse drag from (x1,y1) to (x2,y2) with intermediate cursor moves so the OS drag-recognition logic actually fires (some apps reject teleported clicks). button: 'left' | 'right' | 'middle'. steps: number of intermediate move events (default 20).
   */
  mouseDragTo(args: MouseDragToArgs): Promise<ToolResult> {
    return this.call("mouse_drag_to", args);
  }

  /**
   * Moves the mouse cursor smoothly along an interpolated path. Useful when the target window inspects MOUSEMOVE deltas (anti-automation heuristics) instead of a teleport via SetCursorPos. No button is pressed.
   */
  mouseMoveSmooth(args: MouseMoveSmoothArgs): Promise<ToolResult> {
    return this.call("mouse_move_smooth", args);
  }

  /**
   * Moves the mouse cursor to the given screen coordinates. Set drag=true to perform a left-button drag from the current position to the target.
   */
  move(args: MoveArgs): Promise<ToolResult> {
    return this.call("move", args);
  }

  /**
   * Moves or renames a file or directory.
   */
  movePath(args: MovePathArgs): Promise<ToolResult> {
    return this.call("move_path", args);
  }

  /**
   * Types the same text into multiple UIA elements identified by exact Name property. Takes a comma-separated label list and a single text payload. Resolves labels against a fresh Snapshot() of the foreground window.
   */
  multiEdit(args: MultiEditArgs): Promise<ToolResult> {
    return this.call("multi_edit", args);
  }

  /**
   * Clicks multiple UI elements identified by exact UIA Name property. Takes a comma-separated label list. Returns a JSON summary of clicked / notFound. Resolves labels against a fresh Snapshot() of the foreground window.
   */
  multiSelect(args: MultiSelectArgs): Promise<ToolResult> {
    return this.call("multi_select", args);
  }

  /**
   * Forces the Desktop Window Manager to flush pending GPU work (DwmFlush). Useful right before / after a frame-rate critical operation to align with VBLANK.
   */
  perfDwmFlush(args?: PerfDwmFlushArgs): Promise<ToolResult> {
    return this.call("perf_dwm_flush", args);
  }

  /**
   * Trims the working set of EVERY accessible process via NtSetSystemInformation (MemoryEmptyWorkingSets). Each process keeps its memory but pages are pushed to standby, freeing physical RAM immediately. No process is killed.
   */
  perfEmptyWorkingSets(args?: PerfEmptyWorkingSetsArgs): Promise<ToolResult> {
    return this.call("perf_empty_working_sets", args);
  }

  /**
   * Returns current physical and virtual memory pressure (MEMORYSTATUSEX). Use before/after PerfPurgeStandbyList or PerfEmptyWorkingSets to measure impact.
   */
  perfMemoryStatus(args?: PerfMemoryStatusArgs): Promise<ToolResult> {
    return this.call("perf_memory_status", args);
  }

  /**
   * Purges the Windows memory standby list (cached pages that are no longer in any working set but kept around for re-use). Frees RAM instantly without touching working sets. Equivalent to RAMMap → Empty Standby List. Requires elevation.
   */
  perfPurgeStandbyList(args?: PerfPurgeStandbyListArgs): Promise<ToolResult> {
    return this.call("perf_purge_standby_list", args);
  }

  /**
   * Toggles Win11 EcoQoS (PowerThrottling) on a process. EcoMode = on  → process is throttled to E-cores and capped frequency (saves power). EcoMode = off → release throttling (max performance). Reset all overrides with mode='default'.
   */
  perfSetEcoMode(args: PerfSetEcoModeArgs): Promise<ToolResult> {
    return this.call("perf_set_eco_mode", args);
  }

  /**
   * Executes a PowerShell command and returns stdout, stderr, exit code, and duration as JSON. Uses pwsh (PowerShell 7) when available, falling back to powershell.exe. Captures both streams without launching a window.
   */
  powerShell(args: PowerShellArgs): Promise<ToolResult> {
    return this.call("power_shell", args);
  }

  /**
   * Queries a Windows Event Log channel via wevtapi and returns up to maxEvents entries (newest first) as JSON. Optional XPath filter (e.g. "*[System[Level=2]]" for Error-level only). Channel examples: Application, System, Security, Microsoft-Windows-WindowsUpdateClient/Operational.
   */
  queryEventLog(args: QueryEventLogArgs): Promise<ToolResult> {
    return this.call("query_event_log", args);
  }

  /**
   * Reads a UTF-8 text file. Supports optional line offset and limit for reading large files in chunks. Returns the content prefixed with the resolved absolute path.
   */
  readFile(args: ReadFileArgs): Promise<ToolResult> {
    return this.call("read_file", args);
  }

  /**
   * Resizes / moves a window matched by title substring. Set width/height to 0 to keep current size.
   */
  resizeWindow(args: ResizeWindowArgs): Promise<ToolResult> {
    return this.call("resize_window", args);
  }

  /**
   * Restarts a Windows service. Stops then starts, waiting up to 10s per phase.
   */
  restartService(args: RestartServiceArgs): Promise<ToolResult> {
    return this.call("restart_service", args);
  }

  /**
   * Runs a scheduled task immediately via schtasks /Run.
   */
  runScheduledTask(args: RunScheduledTaskArgs): Promise<ToolResult> {
    return this.call("run_scheduled_task", args);
  }

  /**
   * Fetches a URL via HTTP GET and returns extracted plain text (script/style stripped, tags removed). Caps: 4 MiB download, 200k extracted chars, 30s timeout. For richer extraction prefer the docs MCP server (microsoft_docs_fetch / winclean_universal_web_fetch).
   */
  scrape(args: ScrapeArgs): Promise<ToolResult> {
    return this.call("scrape", args);
  }

  /**
   * Captures the primary monitor to a BMP file on disk. Returns the absolute file path. Width/height default to the full virtual screen.
   */
  screenshot(args?: ScreenshotArgs): Promise<ToolResult> {
    return this.call("screenshot", args);
  }

  /**
   * Scrolls at the given screen coordinates. axis: 'vertical' | 'horizontal'. direction: up/down for vertical, left/right for horizontal. wheelTimes is the number of wheel notches (each notch ≈ 3 lines).
   */
  scroll(args: ScrollArgs): Promise<ToolResult> {
    return this.call("scroll", args);
  }

  /**
   * Searches a directory tree for files matching a glob pattern. Exclude basenames with glob patterns; excluded directories are not traversed. Hard cap: 10000 results; result is marked truncated when exceeded.
   */
  searchFiles(args: SearchFilesArgs): Promise<ToolResult> {
    return this.call("search_files", args);
  }

  /**
   * Effectue une recherche sur le disque via l'indexeur natif Windows Search.
   */
  searchWindows(args: SearchWindowsArgs): Promise<ToolResult> {
    return this.call("search_windows", args);
  }

  /**
   * Displays a Windows tray balloon notification with title and message. Note: balloon tips replace classic Win32 toasts; modern WinRT toast (requires WindowsAppSDK projection) is not yet wired up.
   */
  sendNotification(args: SendNotificationArgs): Promise<ToolResult> {
    return this.call("send_notification", args);
  }

  /**
   * Activates a Windows power plan by GUID. Common GUIDs: 381b4222-f694-41f0-9685-ff5bb260df2e (Balanced), 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (High performance), a1841308-3541-4fab-bc81-f71556f20b4a (Power saver), e9a42b02-d5df-448d-aa00-03f14749eb61 (Ultimate Performance).
   */
  setActivePowerPlan(args: SetActivePowerPlanArgs): Promise<ToolResult> {
    return this.call("set_active_power_plan", args);
  }

  /**
   * Writes UTF-16 text to the Windows clipboard.
   */
  setClipboardText(args: SetClipboardTextArgs): Promise<ToolResult> {
    return this.call("set_clipboard_text", args);
  }

  /**
   * Writes per-app GPU preference in HKCU\SOFTWARE\Microsoft\DirectX\UserGpuPreferences. preference: 'SystemDefault' (0), 'PowerSaving' (1, iGPU), 'HighPerformance' (2, dGPU). exePath should be the absolute path to the .exe. Takes effect on next process launch. Format written: REG_SZ 'GpuPreference=N;'.
   */
  setGpuPreference(args: SetGpuPreferenceArgs): Promise<ToolResult> {
    return this.call("set_gpu_preference", args);
  }

  /**
   * Writes HwSchMode in HKLM\System\CurrentControlSet\Control\GraphicsDrivers. Valid: 0 (WDDM CPU), 1 (OS default), 2 (HW-accelerated GPU scheduling). Requires admin + reboot. Microsoft + NVIDIA recommend 2 on WDDM 2.7+ hardware (validates DLSS 3 Frame Generation).
   */
  setHagsMode(args: SetHagsModeArgs): Promise<ToolResult> {
    return this.call("set_hags_mode", args);
  }

  /**
   * Sets the CPU affinity mask of a process. The mask is a bitmask where bit N means 'process may run on logical processor N'. Pass 0 to reset to the system default. Returns previous and new mask in hex as JSON.
   */
  setProcessAffinity(args: SetProcessAffinityArgs): Promise<ToolResult> {
    return this.call("set_process_affinity", args);
  }

  /**
   * Sets the Windows priority class of a process. Valid values: 'Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'Realtime'. Returns previous and new class as JSON. Realtime requires Administrator and can starve system services.
   */
  setProcessPriority(args: SetProcessPriorityArgs): Promise<ToolResult> {
    return this.call("set_process_priority", args);
  }

  /**
   * Writes a registry value. Creates the key if missing. Supported types: String, ExpandString, DWord, QWord, MultiString (newline-separated).
   */
  setRegistryValue(args: SetRegistryValueArgs): Promise<ToolResult> {
    return this.call("set_registry_value", args);
  }

  /**
   * Sends a keyboard shortcut. The combo is a '+'-separated list of keys, e.g. 'ctrl+c', 'ctrl+shift+esc', 'win+r', 'alt+f4'. Modifier keys: ctrl, shift, alt, win. Literal keys: a-z, 0-9, f1-f24, esc, enter, tab, space, backspace, delete, home, end, up, down, left, right.
   */
  shortcut(args: ShortcutArgs): Promise<ToolResult> {
    return this.call("shortcut", args);
  }

  /**
   * Captures a UIA control-view tree snapshot of the foreground window via native UI Automation. Pass windowHandle to inspect a specific application without changing focus. Returns up to maxElements (default 200) descendants with name, controlType, automationId, className, bounds, focus and enabled state. Used by computer_* and MultiSelect/MultiEdit.
   */
  snapshot(args?: SnapshotArgs): Promise<ToolResult> {
    return this.call("snapshot", args);
  }

  /**
   * Starts a stopped Windows service. Waits up to 10s for the Running state.
   */
  startService(args: StartServiceArgs): Promise<ToolResult> {
    return this.call("start_service", args);
  }

  /**
   * Returns one installed Steam game by appId from the live app manifests of every library (bun-steam). Returns {"success":false,...} when the app is not installed.
   */
  steamGetGame(args: SteamGetGameArgs): Promise<ToolResult> {
    return this.call("steam_get_game", args);
  }

  /**
   * Checks whether an installed Steam game's process is running. Resolves install_dir and the absolute install path from the live app manifests. Executable name defaults to install_dir + ".exe". Returns {"appId":N,"running":bool,"pid":N|null,"executable":"...","installDir":"...","absoluteInstallPath":"..."}.
   */
  steamGetGameStatus(args: SteamGetGameStatusArgs): Promise<ToolResult> {
    return this.call("steam_get_game_status", args);
  }

  /**
   * Kills a running Steam game by executable name. Returns {"success":true,"pid":N,"killed":1} or {"success":false,"error":"not running"}.
   */
  steamKillGame(args: SteamKillGameArgs): Promise<ToolResult> {
    return this.call("steam_kill_game", args);
  }

  /**
   * Launches a Steam game via steam://rungameid/{appId} then waits for the process to appear. Combines SteamLaunchByAppId + SteamWaitForLaunch in a single MCP call. Returns {"success":true,"pid":N,"elapsedMs":N} or {"success":false,...}.
   */
  steamLaunchAndWait(args: SteamLaunchAndWaitArgs): Promise<ToolResult> {
    return this.call("steam_launch_and_wait", args);
  }

  /**
   * Launches a Steam game via steam://rungameid/{appId}. Returns immediately — use SteamWaitForLaunch to block until the process is alive. Returns {"success":false,...} if Steam is not installed.
   */
  steamLaunchByAppId(args: SteamLaunchByAppIdArgs): Promise<ToolResult> {
    return this.call("steam_launch_by_app_id", args);
  }

  /**
   * Returns the installed Steam games of every library from the live app manifests (bun-steam). By default only games whose install directory exists are returned; includeMissing=true returns every manifest.
   */
  steamListGames(args?: SteamListGamesArgs): Promise<ToolResult> {
    return this.call("steam_list_games", args);
  }

  /**
   * Returns the Steam library folders (libraryfolders.vdf) with game_count and total_size_bytes from their app manifests.
   */
  steamListLibraries(args?: SteamListLibrariesArgs): Promise<ToolResult> {
    return this.call("steam_list_libraries", args);
  }

  /**
   * Opens any steam:// URI via ShellExecute. Allowed schemes: steam:// only. Returns {"success":true,"uri":"..."} or {"success":false,"error":"invalid scheme"}.
   */
  steamOpenUri(args: SteamOpenUriArgs): Promise<ToolResult> {
    return this.call("steam_open_uri", args);
  }

  /**
   * Returns live Steam counts: nb_libraries, nb_games, nb_games_present, total_size_bytes.
   */
  steamScanSummary(args?: SteamScanSummaryArgs): Promise<ToolResult> {
    return this.call("steam_scan_summary", args);
  }

  /**
   * Reports Steam credential state without secrets: client accounts (names and flags) and, per account, whether the client or steamcmd holds a reusable cached session (ConnectCache key presence only). Passwords, tokens and ConnectCache values are never read.
   */
  steamVaultStatus(args?: SteamVaultStatusArgs): Promise<ToolResult> {
    return this.call("steam_vault_status", args);
  }

  /**
   * Polls until the named process appears or the timeout elapses. Returns {"success":true,"pid":N,"elapsedMs":N} or {"success":false,"error":"timeout",...}.
   */
  steamWaitForLaunch(args: SteamWaitForLaunchArgs): Promise<ToolResult> {
    return this.call("steam_wait_for_launch", args);
  }

  /**
   * Stops a running Windows service. Waits up to 10s for the Stopped state.
   */
  stopService(args: StopServiceArgs): Promise<ToolResult> {
    return this.call("stop_service", args);
  }

  /**
   * Brings a window to the foreground by partial title match (case-insensitive). Restores it if minimized.
   */
  switchToWindow(args: SwitchToWindowArgs): Promise<ToolResult> {
    return this.call("switch_to_window", args);
  }

  /**
   * DIAGNOSTIC / DEBUG ONLY. Trims a process's working set via SetProcessWorkingSetSize(-1,-1). The OS does NOT free the pages — it moves them to the standby list. The next time the process touches that memory, it incurs a HARD PAGE FAULT (disk read). Mark Russinovich (Sysinternals creator, Azure CTO) documents this is anti-performance for normal use: see 'The Memory-Optimization Hoax'. The Microsoft API doc itself states the function is 'useful primarily for testing and tuning'. Use only on demonstrably-idle GUI apps where you accept the next-touch latency. Do NOT call in a loop.
   */
  trimProcessWorkingSet(args: TrimProcessWorkingSetArgs): Promise<ToolResult> {
    return this.call("trim_process_working_set", args);
  }

  /**
   * Types text at the given screen coordinates. Set clear=true to send Ctrl+A + Delete before typing. Set pressEnter=true to submit with RETURN after typing. Max 4096 chars per call.
   */
  type(args: TypeArgs): Promise<ToolResult> {
    return this.call("type", args);
  }

  /**
   * Pauses execution for the given duration in seconds (1..120).
   */
  wait(args: WaitArgs): Promise<ToolResult> {
    return this.call("wait", args);
  }

  /**
   * Captures the pixels of a window to a 24-bit BMP file via PrintWindow + GetDIBits. Works even when the window is MINIMISED, OFF-SCREEN or COVERED by another window (DWM redirection surface). Returns the saved BMP path and dimensions.
   */
  windowCapture(args: WindowCaptureArgs): Promise<ToolResult> {
    return this.call("window_capture", args);
  }

  /**
   * Sends WM_CLOSE to the window (graceful close request).
   */
  windowClose(args: WindowCloseArgs): Promise<ToolResult> {
    return this.call("window_close", args);
  }

  /**
   * Enumerates every top-level window (visible AND hidden). Filters by pid (0 = any), class substring, title substring (all case-insensitive). Returns hwnd, pid, classname, title, rect, visible, minimised, maximised flags.
   */
  windowEnumAll(args?: WindowEnumAllArgs): Promise<ToolResult> {
    return this.call("window_enum_all", args);
  }

  /**
   * Enumerates direct + indirect child windows of a given HWND parent. Useful to drill into controls inside an app frame (edit fields, buttons, listviews).
   */
  windowEnumChildren(args: WindowEnumChildrenArgs): Promise<ToolResult> {
    return this.call("window_enum_children", args);
  }

  /**
   * Finds the first top-level HWND with the exact class name (case-sensitive) and optionally a matching window title. Returns hwnd=0 if not found.
   */
  windowFindByClass(args: WindowFindByClassArgs): Promise<ToolResult> {
    return this.call("window_find_by_class", args);
  }

  /**
   * Reads the text of a window or control via WM_GETTEXTLENGTH + WM_GETTEXT. Works on hidden controls; pair with WindowEnumChildren to locate the HWND.
   */
  windowGetText(args: WindowGetTextArgs): Promise<ToolResult> {
    return this.call("window_get_text", args);
  }

  /**
   * Sends WM_KEYDOWN/UP for Win+D to the shell — minimises every visible window at once.
   */
  windowMinimiseAll(args?: WindowMinimiseAllArgs): Promise<ToolResult> {
    return this.call("window_minimise_all", args);
  }

  /**
   * Moves and/or resizes a window by HWND. Set width/height to 0 to keep current size, set x/y to a value outside the visible desktop to park the window off-screen.
   */
  windowMove(args: WindowMoveArgs): Promise<ToolResult> {
    return this.call("window_move", args);
  }

  /**
   * Posts a Win32 message to a window's queue via PostMessageW (asynchronous, non-blocking). Returns immediately even if the target ignores or hangs on the message.
   */
  windowPostMessage(args: WindowPostMessageArgs): Promise<ToolResult> {
    return this.call("window_post_message", args);
  }

  /**
   * Sends a Win32 message to a window via SendMessageW (synchronous). Useful to drive controls without stealing focus — e.g. WM_LBUTTONDOWN/UP on a button HWND, WM_SETTEXT to set an edit field, WM_CLOSE to request close. wParam/lParam can be decimal or 0x-prefixed hex.
   */
  windowSendMessage(args: WindowSendMessageArgs): Promise<ToolResult> {
    return this.call("window_send_message", args);
  }

  /**
   * Sets per-window opacity (0..255). Promotes the window to WS_EX_LAYERED if needed. Use 255 = fully opaque, 0 = fully transparent (but still receives input unless clickThrough).
   */
  windowSetOpacity(args: WindowSetOpacityArgs): Promise<ToolResult> {
    return this.call("window_set_opacity", args);
  }

  /**
   * Sets the text of a window or control via WM_SETTEXT. Targets edit fields, captions, listbox items. For complex Unicode UIs prefer UIA.
   */
  windowSetText(args: WindowSetTextArgs): Promise<ToolResult> {
    return this.call("window_set_text", args);
  }

  /**
   * Sets the TOPMOST flag on a window (Z-order pinned above all non-topmost windows).
   */
  windowSetTopmost(args: WindowSetTopmostArgs): Promise<ToolResult> {
    return this.call("window_set_topmost", args);
  }

  /**
   * Returns the ONNX Runtime version string powering Windows ML on this machine.
   */
  winmlGetVersion(args?: WinmlGetVersionArgs): Promise<ToolResult> {
    return this.call("winml_get_version", args);
  }

  /**
   * Loads an ONNX model and returns its input/output metadata (name, element type, shape). Use this before WinmlRunFloat32 to discover tensor shapes.
   */
  winmlInspectOnnx(args: WinmlInspectOnnxArgs): Promise<ToolResult> {
    return this.call("winml_inspect_onnx", args);
  }

  /**
   * Lists ONNX Runtime execution providers available in the current process (e.g. CPUExecutionProvider, DmlExecutionProvider, CUDAExecutionProvider). Reflects whatever EPs Windows ML / the loaded native dll registered.
   */
  winmlListProviders(args?: WinmlListProvidersArgs): Promise<ToolResult> {
    return this.call("winml_list_providers", args);
  }

  /**
   * Runs inference on an ONNX model with float32 tensor inputs. inputsJson: '{"input_name":{"shape":[1,3,224,224],"data":[0.1,0.2,...]}}'. executionProvider: 'cpu' (default) | 'dml' (DirectML, any GPU) | 'cuda' (NVIDIA). Returns the first output tensor as float32 JSON.
   */
  winmlRunFloat32(args: WinmlRunFloat32Args): Promise<ToolResult> {
    return this.call("winml_run_float32", args);
  }

  /**
   * Writes UTF-8 text to a file. Creates parent directories as needed. Set append=true to append instead of overwrite.
   */
  writeFile(args: WriteFileArgs): Promise<ToolResult> {
    return this.call("write_file", args);
  }

  /**
   * Runs a command in an existing WSL distribution using an argv array, with a 30-second bound and captured stdout/stderr. command must contain the executable followed by arguments; it is never concatenated into a shell command. For deliberate shell scripting, pass /bin/sh, -lc, and the script as separate command entries.
   */
  wslExecute(args: WslExecuteArgs): Promise<ToolResult> {
    return this.call("wsl_execute", args);
  }

  /**
   * Returns the local WSL installation status. This is read-only and reports the Windows WSL configuration, default distribution, and kernel information when available.
   */
  wslGetStatus(args?: WslGetStatusArgs): Promise<ToolResult> {
    return this.call("wsl_get_status", args);
  }

  /**
   * Lists installed WSL distributions with their state and WSL version. This is read-only; it never starts, terminates, imports, exports, or unregisters a distribution.
   */
  wslListDistributions(args?: WslListDistributionsArgs): Promise<ToolResult> {
    return this.call("wsl_list_distributions", args);
  }

  /**
   * Lists Linux processes in an existing WSL distribution. This is read-only and returns PID, parent PID, command, and arguments.
   */
  wslListProcesses(args: WslListProcessesArgs): Promise<ToolResult> {
    return this.call("wsl_list_processes", args);
  }

  /**
   * Runs one fixed, read-only diagnostic inside an existing WSL distribution. probe must be one of: system-info, re-toolchain, processes, mounts, or network. No arbitrary shell command is accepted.
   */
  wslReadOnlyProbe(args: WslReadOnlyProbeArgs): Promise<ToolResult> {
    return this.call("wsl_read_only_probe", args);
  }

  /**
   * Sends HUP, INT, TERM, or KILL to one exact Linux PID in an existing WSL distribution. Call wsl_list_processes first to identify the target PID.
   */
  wslSendSignal(args: WslSendSignalArgs): Promise<ToolResult> {
    return this.call("wsl_send_signal", args);
  }

  /**
   * Lists the Bun OS Windows tweak catalog (catalog/tweaks.toml): modules and tweaks with id, module, title, level (conservative|standard|aggressive), targets (live|offline) and operation count. The single source of truth for bunos-win11 and Bun OS Tweaks. Read-only.
   */
  tweakCatalog(args?: TweakCatalogArgs): Promise<ToolResult> {
    return this.call("tweak_catalog", args);
  }

  /**
   * Builds a tweak plan for the running Windows from a profile (archinstall-style: target, level, modules, include, exclude) without changing anything. Detects each operation, marks it change|ok|skip|refused, saves the plan JSON under %LOCALAPPDATA%unoswin11 and returns the path and a per-module summary. Guarded operations (Defender, Windows Update, WSL/Hyper-V, Store, WebView2, networking, aphrody/ssh/WireGuard) are always refused.
   */
  tweakPlan(args?: TweakPlanArgs): Promise<ToolResult> {
    return this.call("tweak_plan", args);
  }

  /**
   * Applies a previously built plan (or a profile) to the running Windows. Creates a System Restore point, exports every touched registry key to .reg, and journals every change so tweak_undo reverts it. Requires confirm=true; machine-wide changes require an elevated process. Returns the journal path and the number of changes applied.
   */
  tweakApply(args: TweakApplyArgs): Promise<ToolResult> {
    return this.call("tweak_apply", args);
  }

  /**
   * Re-detects every change recorded in a journal and returns the ids of tweaks whose state no longer matches (drift). Read-only.
   */
  tweakVerify(args?: TweakVerifyArgs): Promise<ToolResult> {
    return this.call("tweak_verify", args);
  }

  /**
   * Reverts a journal in place: replays every applied change backwards, restoring each registry value, service start type, scheduled task and power scheme to its recorded previous state, and re-registers removed per-user appx packages. Irreversible operations (offline file/capability removals) are reported, not reverted.
   */
  tweakUndo(args?: TweakUndoArgs): Promise<ToolResult> {
    return this.call("tweak_undo", args);
  }
}
