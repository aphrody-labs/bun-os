<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/rag-core

The RAG core of Aphrody (source-aware chunkers, rank fusion, MMR, source weighting, vector kernels,
the retrieval eval harness) behind one typed facade, with two backends over the same Rust source of
truth, `crates/ai/rag-core/src/api.rs`:

| Backend     | Import                   | Use                                                                    |
| :---------- | :----------------------- | :--------------------------------------------------------------------- |
| WebAssembly | `@aphrody/rag-core/wasm` | browser, Bun, Node (the shared `@aphrody/cli-wasm` module)             |
| bun:ffi     | `@aphrody/rag-core/ffi`  | Bun backend (`crates/ai/rag-ffi`, in the single `aphrody-ffi` library) |

The native desktop app links `aphrody-rag-core` directly as a Rust crate (no binding layer).

```ts
import { loadRagWasm } from "@aphrody/rag-core/wasm"; // web
const rag = await loadRagWasm();
rag.chunk("docs/guide.md", markdown, { profile: "default" });
rag.topKCosineF32(query, matrix, 384, 10);

import { openRagFfi } from "@aphrody/rag-core/ffi"; // Bun backend
const native = openRagFfi(); // APHRODY_RAG_LIBRARY or the Aphrody lib store
```

Both return the same `RagCore` object. Adding a capability is one row in `api.rs`; the manifest
(`rag.manifest`) lists every operation and `test/` fails when this facade lacks one.

Build the browser module with `bun run build:wasm`; this delegates to `@aphrody/cli-wasm`,
whose single binary is `aphrody_command_wasm_bg.wasm`. CLI and typed RAG calls share its
loader and memory. The `loadRagWasm` and `loadRagWasmSync` APIs remain unchanged; explicit
bytes or module inputs must now be the CLI module. The old generated `wasm/*` resource
exports are replaced by `@aphrody/cli-wasm/wasm/*`. No second module is copied into this package.
