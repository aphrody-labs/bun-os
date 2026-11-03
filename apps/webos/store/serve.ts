// SPDX-License-Identifier: Apache-2.0
// Standalone HTTP service of the Store data APIs (/api/store/*: catalog, qualification, indexes, winget REST
// source, /api/store/openapi.json and /api/store/health), independent of the desktop front. nginx proxies
// /api/store/ here and the API gateway serves it as https://api.aphrody.com/v1/store/; repositories are static files.
//   bun apps/webos/store/serve.ts        (systemd: infra/config/host/systemd/aphrody/aphrody-store.service)
import { problem } from "../../../packages/bun-os-platform/src/api/index.ts";
import { storeApi } from "./api";

const server = Bun.serve({
  port: Number(Bun.env.STORE_PORT ?? 8791),
  hostname: "127.0.0.1",
  maxRequestBodySize: 64 * 1024,
  idleTimeout: 30,
  async fetch(request) {
    return (await storeApi(request)) ?? problem(404, undefined, undefined, { instance: new URL(request.url).pathname });
  },
});
console.log(`store api: ${server.url}`);
