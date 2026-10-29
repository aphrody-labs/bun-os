# Cross-Language Architecture: Bun, Rust NIE & C# IECODE.Core

> Technical design and implementation of the unified tri-runtime architecture powering IECODE.
> Bridges TypeScript / Bun, Rust C-ABI (`libiecode.so`), and .NET 10 NativeAOT (`IECODE.Ffi.so`).

---

## 1. Architecture Overview

```
+---------------------------------------------------------------------------------+
|                       USER INTERFACES & WORKSPACE CONSUMERS                     |
|  - CLI: `inagle <command>`                                                      |
|  - Web Application: external web consumers (separate repositories)                 |
|  - Shared Components: `packages/ieverse`                                       |
+---------------------------------------+-----------------------------------------+
                                        |
                   +--------------------+--------------------+
                   |                                         |
+------------------v------------------+   +------------------v------------------+
|           BUN FFI CLIENT            |   |         .NET NATIVEAOT / C-ABI      |
|    `packages/inagle/src/ffi/nie.ts`  |   |   `src/IECODE/Ffi/IECODE.Ffi.so`    |
|   - Borrowed input / copied output buffers       |   |   - CriFs CPK Container Engine      |
|   - Safe memory pointer unwrapping  |   |   - UnmanagedCallersOnly exports    |
|   - Multi-platform library loader   |   |   - Node-API JSExport layer         |
+------------------+------------------+   +------------------+------------------+
                   |                                         |
+------------------v-----------------------------------------v------------------+
|                      RUST NIE ENGINE (crates/nie/*)                           |
|               Shared Library: `target/release/libiecode.so`                    |
|   - `aphrody-nie-core`: CRC32 (reflected), Viola cipher, PRNG, endian IO       |
|   - `aphrody-nie-formats`: CRILAYLA SIMD decompressor, G4TX, G4MD, RDBN        |
|   - `aphrody-nie-save`: Lives save decryption (002AB8F4-* containers)        |
|   - `aphrody-nie-data`: In-game gamedata schemas, players, growth curves       |
|   - `aphrody-nie-wiki`: Relational SQLite database queries and drop tables   |
+-------------------------------------------------------------------------------+
```

---

## 2. ABI Contracts & Memory Management

### 2.1 Rust C-ABI (`libiecode.so`)

- **Owner**: `crates/nie/aphrody-nie-ffi`, library target `iecode`.
- **Symbol prefix**: `nie_*`; Rust source defines each signature and sentinel.
- **Dynamic output**: use `_out` functions with a writable `NieBytes` slot
  (`ptr`, `len`, `cap`; 24 bytes on the 64-bit targets supported by this bridge).
  Copy returned bytes into JavaScript-owned memory and free the original exactly
  once with `nie_bytes_free_fields`. Never pass the struct by value through Bun.
- **Static strings**: `nie_version` and format names are borrowed C strings and
  must not be freed. There is no `nie_free_string` symbol in this ABI.
- **Failures**: null/empty/sentinel results depend on the called function;
  `nie_last_error_out` provides diagnostics. The ABI does not use a universal
  negative status-code table.
- **Native availability**: `isNativeAvailable()` and `getNativeLoadError()` expose
  loader state. Only documented pure functions have TypeScript fallbacks;
  successful fallback tests do not qualify native execution.

See the [current bridge contract](../../../docs/development/INAGLE-NIE-FFI.md).

### 2.2 .NET 10 NativeAOT (`IECODE.Ffi.so`)

- **Symbol Prefix**: `iecode_*`
- **Compiler**: `dotnet publish /p:PublishAot=true` producing self-contained native `.so` without external runtime dependency.
- **Node-API**: Compliant with Node.js N-API v8 and Bun native addon loader.

---

## 3. High-Performance TypeScript Usage

```typescript
import { Inagle } from "@aphrody/inagle";
import {
  nieCrc32,
  nieDecompressCrilayla,
  nieProbeHeader,
} from "@aphrody/inagle/ffi";
import { IecodeDotnet } from "@aphrody/inagle/dotnet";

// 1. Instant header probe
const probe = nieProbeHeader(rawBuffer);
console.log("Detected format:", probe.format);

// 2. High-speed SIMD CRILAYLA decompression
const decompressed = nieDecompressCrilayla(compressedBytes);

// 3. .NET CriFs CPK Extraction
await IecodeDotnet.extractCpk("data/packs/common.cpk", "dist/common");
```
