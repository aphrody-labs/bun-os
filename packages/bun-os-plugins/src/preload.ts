// SPDX-License-Identifier: MIT
// Root `bunfig.toml` preload: registers every Bun OS plugin before the entry module resolves.
import { registerAll } from "./index.ts";

registerAll();
