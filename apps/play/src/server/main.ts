// SPDX-License-Identifier: Apache-2.0
/**
 * Production entry (systemd user unit bun-os-play.service): the Bun API/WebSocket server on
 * loopback and the nginx engine it owns in front of it. SIGHUP re-renders and reloads the
 * engine; SIGTERM/SIGINT quit it gracefully before exiting.
 */
import { createServer } from "./app";
import { reloadEngine, startEngine, stopEngine } from "./nginx";

const log = (line: string) => console.log(line);
const server = createServer();
log(`[play] api ${server.url}`);

try {
  await startEngine(log);
} catch {
  await stopEngine();
  server.stop(true);
  process.exit(1);
}

process.on("SIGHUP", () => {
  reloadEngine().then(
    (state) => log(`[play] nginx reloaded (master ${state.pid})`),
    (error) => log(`[play] nginx reload rejected: ${String(error)}`),
  );
});

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log(`[play] ${signal}: quitting the nginx engine`);
  await stopEngine();
  server.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
