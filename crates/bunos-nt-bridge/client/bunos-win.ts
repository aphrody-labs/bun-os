#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// `bunos win <tool> [jsonArgs]`: the Bun OS (WSL guest) client of the Windows bridge (crates/bunos-nt-bridge).
//   bunos win hello                    list the tools the bridge serves
//   bunos win ping
//   bunos win nt_status
//   bunos win nt_handles '{"limit":20}'
// Transport: TCP loopback for host testing (BUNOS_WIN_BRIDGE=127.0.0.1:<port>); AF_VSOCK in the real guest, reached
// through the same JSON-lines protocol (the WSL agent wires `bunos win` to this over vsock, see docs/NTCORE.md §9).
// The token is read from BUNOS_BRIDGE_TOKEN or the shared token file (default /mnt/c/Windows/BunOS/bridge.token in
// the guest). One request per line: { token, id, tool, args }; one reply line: { ok, id, result|error }.
import { connect } from "node:net";
import { readFileSync } from "node:fs";

export interface BridgeReply {
  ok: boolean;
  id?: unknown;
  result?: unknown;
  tools?: string[];
  error?: string;
  pong?: boolean;
}

function token(): string {
  const env = process.env.BUNOS_BRIDGE_TOKEN;
  if (env) return env.trim();
  const path = process.env.BUNOS_BRIDGE_TOKEN_FILE ?? "/mnt/c/Windows/BunOS/bridge.token";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`no bridge token: set BUNOS_BRIDGE_TOKEN or provide ${path}`);
  }
}

/** One request/reply over a TCP loopback transport (host testing). Returns the parsed reply line. */
export async function callOverTcp(host: string, port: number, tool: string, args: unknown): Promise<BridgeReply> {
  return await new Promise<BridgeReply>((resolve, reject) => {
    const socket = connect({ host, port }, () => {
      socket.write(`${JSON.stringify({ token: token(), id: 1, tool, args: args ?? {} })}\n`);
    });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl >= 0) {
        socket.end();
        try {
          resolve(JSON.parse(buffer.slice(0, nl)) as BridgeReply);
        } catch (e) {
          reject(e as Error);
        }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      if (!buffer.includes("\n")) reject(new Error("bridge closed the connection without a reply"));
    });
  });
}

if (import.meta.main) {
  const [tool, rawArgs] = process.argv.slice(2);
  if (!tool) {
    console.error("usage: bunos win <tool|hello|ping> [jsonArgs]");
    process.exit(2);
  }
  const target = process.env.BUNOS_WIN_BRIDGE ?? "127.0.0.1:17";
  const [host, portText] = target.split(":");
  const args = rawArgs ? JSON.parse(rawArgs) : {};
  const reply = await callOverTcp(host!, Number(portText), tool, args);
  console.log(JSON.stringify(reply, null, 2));
  process.exit(reply.ok ? 0 : 1);
}
