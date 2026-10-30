// SPDX-License-Identifier: Apache-2.0
// Standalone HTTP service of the Store data APIs (/api/store/*: catalog, qualification, indexes, winget REST
// source), independent of the desktop front. nginx proxies /api/store/ here; repositories are static files.
//   bun apps/webos/store/serve.ts        (systemd: infra/config/host/systemd/aphrody/aphrody-store.service)
import { storeApi } from "./api";

const server = Bun.serve({
  port: Number(Bun.env.STORE_PORT ?? 8791),
  hostname: "127.0.0.1",
  maxRequestBodySize: 64 * 1024,
  idleTimeout: 30,
  async fetch(request) {
    return (await storeApi(request)) ?? Response.json({ error: "Not found" }, { status: 404 });
  },
});
console.log(`store api: ${server.url}`);
