# DBXV2 runtime convergence

Verified on 2026-10-18. This document separates the installed PC game, its data
readers and the browser execution targets. It does not declare a completed game port.

| Owner | Responsibility | Qualified boundary |
| --- | --- | --- |
| `crates/re/src/game` | Format identification, CPK access, conversions | Real CPK reads through Rust FFI and WASM |
| `apps/play` | Authenticated Steam target and launch request | `/stream?appId=454650`; explicit launch, no automatic execution |
| `packages/bun-steam` | Installed library and existing Steam client | Native launch URI; acceptance is not readiness |
| `packages/bun-gamestream` | Signalling, client and input protocol | Existing WebRTC sender reused |
| `infra/config/host/apps/vps/gaming/stream` | Headless or authorized existing X11 capture | X11 mode preserves the host Steam store; audio initially disabled |
| `bun:nginx` (fork-only, not available on upstream Bun) and host NGINX | Play frontend and private assets origin | Keep established authentication, range and private-origin boundaries |

## Real-data gate

The WASM proof gate (an FFI loader plus a WASM module run on an authorized CPK) now fails on missing FFI, extracted-size mismatch, byte mismatch,
invalid PNG, PNG mismatch or image decoding failure. It always closes its CPK
descriptor and loaded library after the proof. It does not execute a PC binary.

The factory run read a real 8,999,735,320-byte CPK through 11 range reads totalling
9,999,196 bytes. It found 24,025 EMB entries, decoded a compressed 50,048-byte
entry and produced identical native/WASM PNG output, decoded to 128 × 128 pixels.
PNG SHA-256: `f093c5778fbc8ec82792070d33cc24b5a2c3046dc9725940f462ab3e3a67cf32`.

## Remaining execution boundary

The installed PC executable is PE x86-64, 23,877,704 bytes, SHA-256
`8283d8e24e52047d9a71fcf4f08671de6167fa0576f3802f7831e2919eeb8e5f`.
The current RE recompilation pipeline supports console machine targets; it does
not provide a Windows x86-64 API/runtime or a DBXV2 executable-to-WASM conversion.
The Windows hypervisor engine is host-specific, not a browser runtime.

No existing Axum DBXV2 game server was found in these owners. Replacing a mature
CPK service requires parity for authentication, ranges, CRILAYLA, bounded
workers, caching and every conversion route before retiring its current owner.
An Axum wrapper, static assets or a healthy signalling endpoint alone would not
prove game execution. Verify actual negotiated frames, input, audio and gameplay
separately from source delivery, image build and listener readiness.
