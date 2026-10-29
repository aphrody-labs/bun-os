// SPDX-License-Identifier: Apache-2.0
// The minimal M3 server of the benchmark: `serveM3` (Bun.serve + the HTML bundle) on a free port.
// Prints `ready <port>` once listening. `main()` instead of top-level await so it also compiles with bytecode.
import index from "./index.html";
import { serveM3 } from "../../../../packages/m3/src/server.ts";

async function main(): Promise<void> {
  const server = await serveM3({ index, port: 0, hmr: false });
  console.log(`ready ${server.port}`);
}

void main();
