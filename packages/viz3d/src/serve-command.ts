// SPDX-License-Identifier: MIT
// `viz3d serve`: keep a scene server running on loopback until interrupted.
import { parse, UsageError } from "./commands.ts";
import { blueprint, kitUrl, serve } from "./server.ts";

export const SERVE_HELP = `usage: serve.js (--kit [RECORD-ID] [--tier T1|T2|T3] | --dir DIR | --study [ID]) [--port N]
Serve kit blueprints (Three.js WebGPU, WebGL2 fallback, M3 chrome), a built scene directory, or the upstream
studies on 127.0.0.1 with Bun.serve, and print the URL. Ctrl+C stops it.`;

export async function serveCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    kit: { type: "boolean" },
    dir: { type: "string" },
    study: { type: "boolean" },
    tier: { type: "string" },
    port: { type: "string" },
  });
  if (values.help) {
    console.log(SERVE_HELP);
    return 0;
  }
  const modes = [values.kit, values.dir, values.study].filter(Boolean).length;
  if (modes !== 1) throw new UsageError(SERVE_HELP);
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port: invalid value '${values.port}'`);
  const mode = values.kit ? "kit" : values.study ? "study" : "dir";
  const [target] = positionals;
  if (mode === "kit" && target) blueprint(target);
  const server = await serve({ mode, dir: values.dir as string | undefined, port });
  const url =
    mode === "kit" && target
      ? kitUrl(server.url, target, { tier: values.tier as string | undefined })
      : mode === "study" && target
        ? new URL(`${target}/`, server.url).href
        : server.url;
  console.log(url);
  await new Promise<void>(done => {
    process.on("SIGINT", () => done());
    process.on("SIGTERM", () => done());
  });
  server.stop();
  return 0;
}
