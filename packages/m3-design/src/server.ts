// SPDX-License-Identifier: Apache-2.0
//! HTTP Server & CLI Entrypoint for the design compiler engine.
//! Run directly (`bun src/server.ts`); the package index never imports this file.

import { DesignCompiler } from "./generator.ts";
import { nativeSpecValidator } from "./native.ts";
import { createFetchHandler, parseCliArgs, runCli } from "./handlers.ts";

const PORT = 3005;

const compiler = new DesignCompiler({
  validateSpec: nativeSpecValidator,
});
const cli = parseCliArgs(Bun.argv);

if (cli) {
  process.exit(runCli(cli, compiler));
}

console.log(`[HTTP Server] Starting automated design engine on http://localhost:${PORT}...`);
Bun.serve({ port: PORT, fetch: createFetchHandler(compiler) });
