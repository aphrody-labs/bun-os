/* SPDX-License-Identifier: Apache-2.0 */
/**
 * @file yolo_runtime.h
 * @brief yolo_* runtime C ABI of the standalone `yolo_runtime` library
 * (`yolo_runtime.dll`, `libyolo_runtime.so`, `libyolo_runtime.dylib`).
 *
 * Origin: section "yolo_* runtime ABI" of crates/interop/ffi/include/aphrody.h in
 * aphrody-labs/aphrody, where the same symbols are re-exported by `aphrody_ffi`.
 * Contract and ownership rules: ../docs/RUNTIME-ABI.md. The browser and GPU
 * extensions are only exported by builds that enable those features.
 */
#include <stddef.h>
#include <stdint.h>

#ifndef YOLO_RUNTIME_H
#define YOLO_RUNTIME_H

#ifdef __cplusplus
extern "C" {
#endif

#define YOLO_ABI_MAJOR 1u
#define YOLO_ABI_MINOR 6u
#define YOLO_MAX_OPERATIONS_LIMIT 64u

/* Opaque handle owned by the library; 0 is never valid. */
typedef uint64_t YoloHandle;

typedef int32_t YoloStatus;
enum {
  YOLO_OK = 0,
  YOLO_INVALID_ARGUMENT = 1,
  YOLO_ABI_MISMATCH = 2,
  YOLO_INVALID_HANDLE = 3,
  YOLO_CANCELLED = 4,
  YOLO_TIMEOUT = 5,
  YOLO_BUSY = 6,
  YOLO_INTERNAL = 7,
  YOLO_PANIC = 8,
  YOLO_OUTPUT_LIMIT = 9
};

/* Buffer owned by the library: release it with yolo_buffer_free. */
typedef struct YoloBuffer {
  uint8_t *data;
  size_t len;
  size_t cap;
} YoloBuffer;

typedef struct YoloCreateInfo {
  uint32_t struct_size; /* sizeof(YoloCreateInfo) of the caller */
  uint32_t abi_major;   /* YOLO_ABI_MAJOR the caller was built for */
  uint32_t abi_minor;
  uint32_t max_operations; /* 0 = default */
} YoloCreateInfo;

/* (major << 16) | minor. Call first, refuse a different major. */
uint32_t yolo_abi_version(void);

YoloStatus yolo_runtime_create(const YoloCreateInfo *info, YoloHandle *out);
/* Cancels and joins every operation owned by the runtime, then invalidates it. */
YoloStatus yolo_runtime_destroy(YoloHandle runtime);

YoloStatus yolo_runtime_build_info(YoloBuffer *out);                      /* JSON object */
YoloStatus yolo_runtime_capabilities(YoloHandle runtime, YoloBuffer *out); /* JSON array */

/* capability "system.stats" */
YoloStatus yolo_system_stats(YoloHandle runtime, YoloBuffer *out); /* JSON object */

/* capability "bench.compute" */
YoloStatus yolo_bench_start(YoloHandle runtime, uint32_t iterations, YoloHandle *out_operation);
/* OK: JSON result in out. TIMEOUT: still running, handle stays valid. */
YoloStatus yolo_operation_wait(YoloHandle operation, uint32_t timeout_ms, YoloBuffer *out);
YoloStatus yolo_operation_cancel(YoloHandle operation);
/* Cancels if running, joins the worker, invalidates the handle. Required for every operation. */
YoloStatus yolo_operation_release(YoloHandle operation);

/* capability "process.supervise" (ABI 1.1): the child runs in its own process group */
#define YOLO_SPAWN_NULL_STDIO 1u /* YoloSpawnInfo.flags: stdin/stdout/stderr -> null device */
#define YOLO_SPAWN_CAPTURE 2u    /* flags (ABI 1.2): stdin null, stdout/stderr captured (last 64 KiB each) */
#define YOLO_SPAWN_CAPTURE_LOSSLESS 4u /* ABI 1.4: complete bytes, error on budget overflow */
#define YOLO_SPAWN_PIPE_STDIN 8u /* ABI 1.6: owned stdin pipe, may combine with capture */
#define YOLO_STDIN_MAX_BYTES 1048576u /* cumulative accepted bytes per process */
#define YOLO_CAPTURE_MAX_BYTES 67108864u /* default/maximum per stream */
#define YOLO_STREAM_STDOUT 1u
#define YOLO_STREAM_STDERR 2u
#define YOLO_READ_DRAIN 0u
#define YOLO_READ_PEEK 1u

typedef struct YoloSpawnInfo {
  uint32_t struct_size; /* sizeof(YoloSpawnInfo) of the caller */
  uint32_t flags;
  const char *program;       /* UTF-8, NUL-terminated */
  const char *const *args;   /* NULL-terminated, without the program; may be NULL */
  const char *const *env;    /* NULL-terminated "KEY=VALUE" added to the environment; may be NULL */
  const char *cwd;           /* may be NULL */
} YoloSpawnInfo;

/* ABI 1.4 optional extension. Set base.struct_size = sizeof(YoloSpawnInfoV14), flag
 * YOLO_SPAWN_CAPTURE_LOSSLESS, then pass &info.base. Older 40-byte callers remain supported.
 * A zero capture_limit uses the default; otherwise 1..YOLO_CAPTURE_MAX_BYTES per stream. */
typedef struct YoloSpawnInfoV14 {
  YoloSpawnInfo base;
  uint64_t capture_limit;
} YoloSpawnInfoV14;

typedef struct YoloProcessStatus {
  uint32_t struct_size; /* sizeof(YoloProcessStatus) of the caller */
  uint32_t state;       /* 0 running, 1 exited */
  int32_t exit_code;    /* -1 if terminated by a signal */
  int32_t signal;       /* terminating signal (Unix), else 0 */
  uint32_t pid;
} YoloProcessStatus;

/* Counts against max_operations (BUSY beyond). */
YoloStatus yolo_process_spawn(YoloHandle runtime, const YoloSpawnInfo *info, YoloHandle *out);
YoloStatus yolo_process_status(YoloHandle process, YoloProcessStatus *out); /* non-blocking */
/* ABI 1.2: captured output of a YOLO_SPAWN_CAPTURE process, in a library-owned buffer (maybe empty). */
YoloStatus yolo_process_read(YoloHandle process, uint32_t stream, uint32_t mode, YoloBuffer *out);
/* ABI 1.4: 1 when both readers finished; read can still report OUTPUT_LIMIT or I/O failure. */
YoloStatus yolo_process_output_complete(YoloHandle process, uint32_t *out);
/* ABI 1.6, capabilities "process.stdin" and "process.wait". An ABI1.4 caller keeps the same
 * structure/flags and behavior. Resolve these new symbols only after capability negotiation.
 * stdin_write copies/enqueues (does not wait for pipe I/O), at most 1 MiB total and 64 queued
 * chunks/process. NULL is allowed only for len=0. Write-after-close is INVALID_ARGUMENT.
 * stdin_close drains accepted data then produces EOF; repeated close succeeds. */
YoloStatus yolo_process_stdin_write(YoloHandle process, const uint8_t *bytes, size_t len);
YoloStatus yolo_process_stdin_close(YoloHandle process);
/* One operation per process; no extra max_operations slot. Cancel stops the owned tree;
 * operation_wait Timeout leaves it running. OK yields JSON {"state":1,"pid":n,"exit_code":n,
 * "signal":n,"output_complete":true,"stdin_complete":true} after child exit and full capture EOF.
 * OUTPUT_LIMIT and I/O failures propagate. Release every returned operation normally. */
YoloStatus yolo_process_wait_start(YoloHandle process, YoloHandle *out_operation);
/* SIGTERM to the group, SIGKILL after grace_ms; waits. The handle stays valid (read the status). */
YoloStatus yolo_process_stop(YoloHandle process, uint32_t grace_ms);
/* ABI 1.3: asynchronous stop on a worker (not counted against max_operations). The operation yields
 * JSON {"exit_code": n, "signal": n}; release the operation as usual. */
YoloStatus yolo_process_stop_start(YoloHandle process, uint32_t grace_ms, YoloHandle *out_operation);
/* Stops if running (2 s grace) and invalidates the handle. Required for every process. */
YoloStatus yolo_process_release(YoloHandle process);

/* capability "http.probe": one HTTP/1.0 GET on a worker thread, never blocking the caller.
 * Counts against max_operations. yolo_operation_wait returns JSON {"status": <code>} when the
 * server answered, {"status": null, "error": "<why>"} when it is not reachable (yet). */
YoloStatus yolo_http_probe_start(YoloHandle runtime, const char *host, uint16_t port,
                                 const char *path, uint32_t timeout_ms, YoloHandle *out_operation);

/* Optional browser feature, ABI 1.4 extension. Probe browser.* capabilities before resolving
 * these symbols; default core artifacts do not export them. JSON requests are UTF-8 with explicit
 * byte lengths. Contexts own their browser thread; close/destroy interrupts and joins workers.
 * call_start yields an operation managed by the existing wait/cancel/release functions. */
YoloStatus yolo_browser_create(YoloHandle runtime, const uint8_t *input, size_t input_len, YoloHandle *out);
YoloStatus yolo_browser_call_start(YoloHandle browser, const uint8_t *input, size_t input_len, YoloHandle *out_operation);
YoloStatus yolo_browser_close(YoloHandle browser);

/* Optional GPU feature, ABI 1.5. Probe gpu.info / gpu.wgsl / gpu.cuda before resolving this symbol.
 * One process-wide device (NVIDIA discrete first) is shared with every other host of the process.
 * input: UTF-8 JSON {"op":"info"} | {"op":"wgsl","shader":"...","entryPoint":"main","workgroups":[x,y,z]}
 *        | {"op":"cuda","source":"...","kernel":"name","blockSize":0}, 1 byte..1 MiB.
 * data: job buffer (WGSL storage binding 0, or little-endian f32 for CUDA), 0..16 MiB, may be NULL
 * when data_len is 0. Both are copied before the call returns. The operation yields the JSON report
 * for info, or {"bytes":n,"data":"<base64>","elapsedMs":t} for jobs; GPU errors fail the operation. */
YoloStatus yolo_gpu_call_start(YoloHandle runtime, const uint8_t *input, size_t input_len,
                               const uint8_t *data, size_t data_len, YoloHandle *out_operation);

/* Buffers and errors */
void yolo_buffer_free(YoloBuffer *buffer); /* zeroes the buffer; no-op if already empty */
YoloStatus yolo_last_error(YoloBuffer *out); /* JSON {"message": "..."} of the calling thread */

/* High-throughput zero-copy vector math FFI */
double ffi_sum_squares(const double *ptr, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* YOLO_RUNTIME_H */
