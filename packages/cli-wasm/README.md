<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/cli-wasm

The pure sub-commands of the `aphrody` CLI as WebAssembly. They are the same code as
`aphrody pure ...` of the native binary (`crates/infra/aphrody-command-pure`, consumed by
`aphrody-command`): no network, no processes, no tokio, git or ssh.

````ts
import { loadCliWasm } from "@aphrody/cli-wasm";
const cli = await loadCliWasm();
cli.json(["rag", "chunk", "-", "--path", "guide.md"], { stdin: markdown });
cli.json(["toolcall", "repair", "-"], { stdin: "```json\n{'a': 1,}\n```" });
cli.text(["html", "markdown", "page.html"], { files: { "page.html": html } });
cli.run(["--help"]).stdout;
````

Groups: `rag` (the RAG call surface of `aphrody-rag-core`), `toolcall` (repair, validate, extract),
`html` (extract, markdown, simhash), `text` (comments, scrub, aphrodify, is-japanese).
The single module also exposes the structured RAG transport and dense-vector kernels through
`cli.rag` (`abiVersion`, `manifest`, `callJson`, `callVec`). The typed loaders in
`@aphrody/rag-core/wasm` use this same loader, module instance and linear memory.
No separate RAG WASM binary is built or shipped.

Build (`wasm/`, git-ignored): `bun run build:wasm`.

## Portable release

`bun run stage -- --out <directory>` delegates Rust compilation to the existing WASM build
owner and emits a downloads archive. To package already qualified Docker/factory output
without compiling Rust, use `--input <wasm-bindgen-directory> --provenance <build.json>`.
The provenance must name the full source commit and match the SHA-256 and byte count
of all four wasm-bindgen outputs in `inputs` (glue JS, glue declarations, module and
module declarations), with the module also identified by `wasm`. Inputs are copied
into a private staging directory and validated there before bundling or type emission.
Composite builds retain explicit source patch paths and hashes.

Extract the archive and serve its files together. The minified browser ESM facade is
`index.js`; its default loader fetches the single `.wasm` file alongside it. A web server
should serve that module as `application/wasm` for streaming compilation. No host or
filesystem access is introduced. Bun and Node can load verified local bytes:

```ts
import { loadCliWasm } from "./index.js";
import { readFile } from "node:fs/promises";
const cli = await loadCliWasm(
  await readFile(new URL("./aphrody_command_wasm_bg.wasm", import.meta.url)),
);
console.log(cli.run(["--help"]).stdout);
```

The archive includes emitted TypeScript declarations, package exports, the Apache-2.0
license, and separate module/build/packaging provenance. The same `src/index.ts` facade
and Rust command core supply workspace and portable packages.
