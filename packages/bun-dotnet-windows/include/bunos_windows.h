/* SPDX-License-Identifier: MIT */
/*
 * C ABI of the Bun OS Windows stack (packages/bun-dotnet-windows).
 *
 *   bunos_windows.dll   C# Native AOT: Win32/COM/DirectX 12 (CsWin32), WinRT (CsWinRT), winget (Microsoft.Management.Deployment)
 *   bunos_win_cpp.dll   C++: DirectX 12 (DirectX-Headers, d3dx12), WIL, C++/WinRT
 *   winrtact.dll        vendor/winget-cli UndockedRegFreeWinRT: winmd resolution for unpackaged hosts, winget manual activation
 *
 * Strings are NUL-terminated UTF-8. Every char* a function returns is owned by the caller and released with the free
 * function of the same library. Call results are JSON envelopes: {"ok":true,"value":...} or
 * {"ok":false,"error":{"code":"...","message":"..."}}. Bound by bun:ffi (src/native.ts), Rust (bun-windows-winclean
 * src/dotnet_windows.rs, libloading) and any C/C++ caller.
 */
#ifndef BUNOS_WINDOWS_H
#define BUNOS_WINDOWS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BUNOS_WINDOWS_ABI 1

#ifndef BUNOS_API
#  ifdef BUNOS_WIN_CPP_BUILD
#    define BUNOS_API __declspec(dllexport)
#  else
#    define BUNOS_API __declspec(dllimport)
#  endif
#endif

/* ---- bunos_windows.dll (C# Native AOT) ---------------------------------------------------------------------------- */

/* Progress (kind 0) and completion (kind 1) of bunos_call_async; `json` is valid only during the call. */
typedef void (*bunos_callback)(intptr_t user, int32_t kind, const char* json);

int32_t bunos_abi(void);
int64_t bunos_ping(int64_t value);
char* bunos_version(void);
char* bunos_methods(void);
/* method: system.info, graphics.adapters, winget.sources|search|list|show|install|upgrade|uninstall|status */
char* bunos_call(const char* method, const char* args_json);
int64_t bunos_call_async(const char* method, const char* args_json, bunos_callback callback, intptr_t user);
void bunos_free(char* value);

/* ---- bunos_win_cpp.dll (C++) -------------------------------------------------------------------------------------- */

BUNOS_API int32_t bunos_cpp_abi(void);
BUNOS_API int64_t bunos_cpp_ping(int64_t value);
/* method: graphics.adapters, system.profile */
BUNOS_API char* bunos_cpp_call(const char* method, const char* args_json);
BUNOS_API void bunos_cpp_free(char* value);

#ifdef __cplusplus
}
#endif

#endif /* BUNOS_WINDOWS_H */
