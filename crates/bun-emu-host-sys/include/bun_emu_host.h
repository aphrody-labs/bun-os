/*
 * bun_emu_host.h - stable C ABI of the Bun OS emulator host.
 *
 * Every core (melonDS, Dolphin, Azahar, Kyty) is built as its own plugin
 * library (bun_emu_<core>.dll / libbun_emu_<core>.so) that exports exactly
 * this interface. Callers pick a core by loading its library; Rust binds it
 * through crates/bun-emu-host-sys and Bun through packages/bun-emu-host/src.
 *
 * Threading: a bun_emu instance is driven from one thread at a time. The log
 * callback may be invoked from emulator worker threads.
 *
 * Ownership: pointers returned by the library stay valid until the next call
 * that mutates the same instance (run_frame, load_*, reset, save_state) or
 * until bun_emu_destroy. Buffers passed in are copied before returning.
 */
#ifndef BUN_EMU_HOST_H
#define BUN_EMU_HOST_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#if defined(BUN_EMU_HOST_BUILD)
#define BUN_EMU_API __declspec(dllexport)
#else
#define BUN_EMU_API __declspec(dllimport)
#endif
#else
#define BUN_EMU_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

/** Version of this header; bun_emu_core()->abi_version must match. */
#define BUN_EMU_ABI_VERSION 1u

/* Status codes returned as int32_t. Negative values are errors. */
#define BUN_EMU_OK 0
#define BUN_EMU_FRAME 1          /* run_frame completed one video frame */
#define BUN_EMU_STOPPED 2        /* the guest stopped (power off, exit, fatal) */
#define BUN_EMU_E_INVALID (-1)   /* bad argument */
#define BUN_EMU_E_IO (-2)        /* file or buffer could not be read */
#define BUN_EMU_E_UNSUPPORTED (-3)
#define BUN_EMU_E_STATE (-4)     /* call not valid in the current lifecycle state */
#define BUN_EMU_E_CORE (-5)      /* the core rejected the request; see bun_emu_last_error */

/* Pixel formats of bun_emu_screen. */
#define BUN_EMU_PIXEL_BGRX8888 1 /* bytes B,G,R,X (little-endian 0xXXRRGGBB) */
#define BUN_EMU_PIXEL_RGBX8888 2 /* bytes R,G,B,X */
#define BUN_EMU_PIXEL_RGB565 3

/* Log levels. */
#define BUN_EMU_LOG_DEBUG 0
#define BUN_EMU_LOG_INFO 1
#define BUN_EMU_LOG_WARN 2
#define BUN_EMU_LOG_ERROR 3

/* Core capability flags (bun_emu_core_info.flags). */
#define BUN_EMU_CAP_SAVESTATE (1u << 0)
#define BUN_EMU_CAP_TOUCH (1u << 1)
#define BUN_EMU_CAP_ANALOG (1u << 2)
#define BUN_EMU_CAP_AUDIO (1u << 3)
#define BUN_EMU_CAP_NEEDS_QT_GUI (1u << 4) /* runs a QGuiApplication on the offscreen platform */
#define BUN_EMU_CAP_MEMORY (1u << 5)       /* bun_emu_read_memory is implemented */

/* Button bits for bun_emu_set_buttons. Bits 0-11 match bun-engine's machine::keys. */
#define BUN_EMU_BTN_A (1ull << 0)
#define BUN_EMU_BTN_B (1ull << 1)
#define BUN_EMU_BTN_SELECT (1ull << 2)
#define BUN_EMU_BTN_START (1ull << 3)
#define BUN_EMU_BTN_RIGHT (1ull << 4)
#define BUN_EMU_BTN_LEFT (1ull << 5)
#define BUN_EMU_BTN_UP (1ull << 6)
#define BUN_EMU_BTN_DOWN (1ull << 7)
#define BUN_EMU_BTN_R (1ull << 8)
#define BUN_EMU_BTN_L (1ull << 9)
#define BUN_EMU_BTN_X (1ull << 10)
#define BUN_EMU_BTN_Y (1ull << 11)
#define BUN_EMU_BTN_ZL (1ull << 12)
#define BUN_EMU_BTN_ZR (1ull << 13)
#define BUN_EMU_BTN_Z (1ull << 14)
#define BUN_EMU_BTN_HOME (1ull << 15)
#define BUN_EMU_BTN_L3 (1ull << 16)
#define BUN_EMU_BTN_R3 (1ull << 17)
#define BUN_EMU_BTN_LID (1ull << 18) /* DS: lid closed while held */
#define BUN_EMU_BTN_DEBUG (1ull << 19)

/* Analog axes for bun_emu_set_analog; values are -32768..32767 (triggers 0..32767). */
#define BUN_EMU_AXIS_LX 0
#define BUN_EMU_AXIS_LY 1
#define BUN_EMU_AXIS_RX 2
#define BUN_EMU_AXIS_RY 3
#define BUN_EMU_AXIS_LT 4
#define BUN_EMU_AXIS_RT 5

typedef struct bun_emu bun_emu;

typedef struct bun_emu_core_info {
  uint32_t abi_version; /* BUN_EMU_ABI_VERSION the library was built with */
  uint32_t flags;       /* BUN_EMU_CAP_* */
  const char* name;     /* "melonds", "dolphin", "azahar", "kyty" */
  const char* version;  /* upstream revision */
  const char* systems;  /* comma-separated system ids, e.g. "nds,dsi" */
  const char* extensions; /* comma-separated content extensions */
  const char* firmware_kinds; /* comma-separated kinds accepted by bun_emu_load_firmware */
  uint32_t max_screens;
  uint32_t reserved;
} bun_emu_core_info;

typedef struct bun_emu_screen {
  uint32_t width;
  uint32_t height;
  uint32_t stride; /* bytes per row */
  uint32_t format; /* BUN_EMU_PIXEL_* */
  const uint8_t* pixels;
} bun_emu_screen;

typedef void (*bun_emu_log_fn)(void* user, int32_t level, const char* message, size_t length);

/** Static description of the core in this library. Never NULL. */
BUN_EMU_API const bun_emu_core_info* bun_emu_core(void);

/** Create an idle instance (Qt runtime started on first use). NULL on failure. */
BUN_EMU_API bun_emu* bun_emu_create(void);
BUN_EMU_API void bun_emu_destroy(bun_emu* emu);

/** Last error message of the instance (empty string when none). */
BUN_EMU_API const char* bun_emu_last_error(const bun_emu* emu);

/** Route core log lines to fn (NULL restores stderr). */
BUN_EMU_API void bun_emu_set_log(bun_emu* emu, bun_emu_log_fn fn, void* user);

/** Core configuration; keys are core-specific ("renderer", "direct_boot", ...).
 * Values apply on the next load_content or reset. */
BUN_EMU_API int32_t bun_emu_set_config(bun_emu* emu, const char* key, const char* value);
/** Copies the value (NUL-terminated, truncated to cap) and returns its full length,
 * or -1 when the key is unset. */
BUN_EMU_API int64_t bun_emu_get_config(const bun_emu* emu, const char* key, char* out, size_t cap);

/** Provide a firmware/BIOS image of a kind listed in bun_emu_core()->firmware_kinds. */
BUN_EMU_API int32_t bun_emu_load_firmware(bun_emu* emu, const char* kind, const uint8_t* data, size_t len);

/** Load and boot content from a UTF-8 path. */
BUN_EMU_API int32_t bun_emu_load_content_path(bun_emu* emu, const char* path);
/** Load and boot content from memory; name_hint carries the extension ("game.nds"). */
BUN_EMU_API int32_t bun_emu_load_content(bun_emu* emu, const char* name_hint, const uint8_t* data, size_t len);

BUN_EMU_API int32_t bun_emu_reset(bun_emu* emu);

/** Advance exactly one guest video frame. Returns BUN_EMU_FRAME, BUN_EMU_STOPPED or an error. */
BUN_EMU_API int32_t bun_emu_run_frame(bun_emu* emu);
BUN_EMU_API uint64_t bun_emu_frame_count(const bun_emu* emu);

BUN_EMU_API uint32_t bun_emu_screen_count(const bun_emu* emu);
/** CPU-readable framebuffer of screen index (0 = top/main). */
BUN_EMU_API int32_t bun_emu_get_screen(const bun_emu* emu, uint32_t index, bun_emu_screen* out);

/** Output sample rate in Hz (0 when the core produces no audio). */
BUN_EMU_API uint32_t bun_emu_audio_rate(const bun_emu* emu);
/** Drain up to max_frames stereo frames (interleaved int16 L,R) produced since the last call. */
BUN_EMU_API size_t bun_emu_audio(bun_emu* emu, int16_t* out, size_t max_frames);

BUN_EMU_API void bun_emu_set_buttons(bun_emu* emu, uint32_t port, uint64_t buttons);
BUN_EMU_API void bun_emu_set_touch(bun_emu* emu, int32_t pressed, uint32_t x, uint32_t y);
BUN_EMU_API void bun_emu_set_analog(bun_emu* emu, uint32_t port, uint32_t axis, int32_t value);

/** Serialize the running machine. *data stays valid until the next save_state or destroy. */
BUN_EMU_API int32_t bun_emu_save_state(bun_emu* emu, const uint8_t** data, size_t* len);
BUN_EMU_API int32_t bun_emu_load_state(bun_emu* emu, const uint8_t* data, size_t len);

/** Read guest memory at a guest address (core-defined address space). */
BUN_EMU_API int32_t bun_emu_read_memory(bun_emu* emu, uint64_t address, uint8_t* out, size_t len);

/** Drain guest console/debug output (e.g. nocash prints, OSReport, svcOutputDebugString).
 * Returns the number of bytes copied. */
BUN_EMU_API size_t bun_emu_console(bun_emu* emu, char* out, size_t cap);

#ifdef __cplusplus
}
#endif

#endif /* BUN_EMU_HOST_H */
