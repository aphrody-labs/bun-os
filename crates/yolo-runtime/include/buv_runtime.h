/* SPDX-License-Identifier: Apache-2.0 */
#ifndef BUV_RUNTIME_H
#define BUV_RUNTIME_H
#include "yolo_runtime.h"

#define BUV_ABI_MAJOR YOLO_ABI_MAJOR
#define BUV_ABI_MINOR YOLO_ABI_MINOR
#define BUV_MAX_OPERATIONS_LIMIT YOLO_MAX_OPERATIONS_LIMIT
#define BUV_OK YOLO_OK
#define BUV_INVALID_ARGUMENT YOLO_INVALID_ARGUMENT
#define BUV_ABI_MISMATCH YOLO_ABI_MISMATCH
#define BUV_INVALID_HANDLE YOLO_INVALID_HANDLE
#define BUV_CANCELLED YOLO_CANCELLED
#define BUV_TIMEOUT YOLO_TIMEOUT
#define BUV_BUSY YOLO_BUSY
#define BUV_INTERNAL YOLO_INTERNAL
#define BUV_PANIC YOLO_PANIC
#define BUV_OUTPUT_LIMIT YOLO_OUTPUT_LIMIT
#define BUV_SPAWN_NULL_STDIO YOLO_SPAWN_NULL_STDIO
#define BUV_SPAWN_CAPTURE YOLO_SPAWN_CAPTURE
#define BUV_SPAWN_CAPTURE_LOSSLESS YOLO_SPAWN_CAPTURE_LOSSLESS
#define BUV_SPAWN_PIPE_STDIN YOLO_SPAWN_PIPE_STDIN
#define BUV_STDIN_MAX_BYTES YOLO_STDIN_MAX_BYTES
#define BUV_CAPTURE_MAX_BYTES YOLO_CAPTURE_MAX_BYTES
#define BUV_STREAM_STDOUT YOLO_STREAM_STDOUT
#define BUV_STREAM_STDERR YOLO_STREAM_STDERR
#define BUV_READ_DRAIN YOLO_READ_DRAIN
#define BUV_READ_PEEK YOLO_READ_PEEK
typedef YoloHandle BuvHandle;
typedef YoloStatus BuvStatus;
typedef YoloBuffer BuvBuffer;
typedef YoloCreateInfo BuvCreateInfo;
typedef YoloSpawnInfo BuvSpawnInfo;
typedef YoloSpawnInfoV14 BuvSpawnInfoV14;
typedef YoloProcessStatus BuvProcessStatus;

#ifdef __cplusplus
extern "C" {
#endif
uint32_t buv_abi_version(void);
BuvStatus buv_runtime_create(const BuvCreateInfo *info, BuvHandle *out);
BuvStatus buv_runtime_destroy(BuvHandle runtime);
BuvStatus buv_runtime_build_info(BuvBuffer *out);
BuvStatus buv_runtime_capabilities(BuvHandle runtime, BuvBuffer *out);
BuvStatus buv_system_stats(BuvHandle runtime, BuvBuffer *out);
BuvStatus buv_bench_start(BuvHandle runtime, uint32_t iterations, BuvHandle *out_operation);
BuvStatus buv_operation_wait(BuvHandle operation, uint32_t timeout_ms, BuvBuffer *out);
BuvStatus buv_operation_cancel(BuvHandle operation);
BuvStatus buv_operation_release(BuvHandle operation);
BuvStatus buv_process_spawn(BuvHandle runtime, const BuvSpawnInfo *info, BuvHandle *out);
BuvStatus buv_process_status(BuvHandle process, BuvProcessStatus *out);
BuvStatus buv_process_read(BuvHandle process, uint32_t stream, uint32_t mode, BuvBuffer *out);
BuvStatus buv_process_stop(BuvHandle process, uint32_t grace_ms);
BuvStatus buv_process_stop_start(BuvHandle process, uint32_t grace_ms, BuvHandle *out_operation);
BuvStatus buv_process_output_complete(BuvHandle process, uint32_t *out);
/* ABI1.6 contracts and limits are identical to yolo_process_* in the included header. */
BuvStatus buv_process_stdin_write(BuvHandle process, const uint8_t *bytes, size_t len);
BuvStatus buv_process_stdin_close(BuvHandle process);
BuvStatus buv_process_wait_start(BuvHandle process, BuvHandle *out_operation);
BuvStatus buv_process_release(BuvHandle process);
BuvStatus buv_http_probe_start(BuvHandle runtime, const char *host, uint16_t port,
                              const char *path, uint32_t timeout_ms, BuvHandle *out_operation);
void buv_buffer_free(BuvBuffer *buffer);
BuvStatus buv_last_error(BuvBuffer *out);
#ifdef __cplusplus
}
#endif
#endif
