#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { parseArgs } from "node:util";
import { Adb } from "./adb.ts";
import { startGateway } from "./gateway.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "8710" },
    host: { type: "string", default: "127.0.0.1" },
    serial: { type: "string" },
    connect: { type: "string" },
    "max-size": { type: "string", default: "1280" },
    "max-fps": { type: "string", default: "60" },
    "allow-anonymous": { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`bun-waydroid-gateway [--port 8710] [--host 127.0.0.1] [--connect host:port] [--serial id]
Auth: set BUN_WAYDROID_TOKEN (Bearer header or ?token=), or pass --allow-anonymous on loopback only.`);
  process.exit(0);
}

if (values.connect) console.log(await new Adb(values.serial).connect(values.connect));

const gw = startGateway({
  port: Number(values.port),
  hostname: values.host,
  allowAnonymous: values["allow-anonymous"],
  start: { maxSize: Number(values["max-size"]), maxFps: Number(values["max-fps"]) },
});
console.log(`waydroid gateway on ${gw.url}  (ws: /stream, api: /api/*)`);
