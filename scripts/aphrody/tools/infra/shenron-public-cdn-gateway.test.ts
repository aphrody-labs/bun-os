// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { publicCdnFallback, renderPublicCdnGateway } from "./shenron-public-cdn-gateway";

test("preserves API/site/TLS blocks and replaces both legacy fallback owners", () => {
  const api = "location /api/ { proxy_pass http://site; }";
  const source = `server { ${api}\n# location @cdn_worker { example only; }\nlocation @cdn_worker { if ($uri ~ "x{2}") { return 404; } proxy_pass https://old; }\nlocation @cdn_public_origin { proxy_pass http://wrong-host; }\nssl_certificate /cert.pem; }`;
  const result = renderPublicCdnGateway(source, "http://127.0.0.1:9077");
  expect(result).toContain(api);
  expect(result).toContain("# location @cdn_worker { example only; }");
  expect(result).toContain("ssl_certificate /cert.pem;");
  expect(result).not.toContain("https://old");
  expect(result).not.toContain("wrong-host");
  expect(result.match(/proxy_pass http:\/\/127.0.0.1:9077/g)).toHaveLength(2);
  expect(renderPublicCdnGateway(result, "http://127.0.0.1:9077")).toBe(result);
});

test("public fallback strips inbound authentication and preserves range conditions", () => {
  const result = publicCdnFallback("@cdn_worker", "http://127.0.0.1:9077");
  for (const expected of [
    "GET|HEAD",
    "proxy_pass_request_headers off",
    "proxy_pass_request_body off",
    "_objects",
    "private",
    "proxy_set_header Range $http_range",
    "proxy_set_header If-Range $http_if_range",
    "proxy_intercept_errors on",
    "error_page 404 = @vfs_asset",
    "proxy_cache off",
    "wiki|dbz|adn|media",
    "Accept-Encoding identity",
  ])
    expect(result).toContain(expected);
  expect(result).not.toContain("$http_cookie");
  expect(result).not.toContain("$http_authorization");
  expect(() => publicCdnFallback("@cdn_worker", "http://10.200.77.1")).toThrow();
  expect(() => renderPublicCdnGateway("server {}", "http://127.0.0.1:9077")).toThrow();
});

test("404s from the CDN origin reach only the public VFS asset API", () => {
  const source = `# keep this include\ninclude /etc/nginx/conf.d/zz-cdn-origin.locations.inc;\nserver {\n location /assets/ { try_files $uri @cdn_worker; }\n location @cdn_worker { proxy_pass http://127.0.0.1:9077; }\n location @cdn_public_origin { proxy_pass http://127.0.0.1:9077; }\n}`;
  const result = renderPublicCdnGateway(source, "http://127.0.0.1:9077");
  expect(result).toContain("include /etc/nginx/conf.d/zz-cdn-origin.locations.inc;");
  expect(result).toContain("error_page 404 = @vfs_asset;");
  expect(result).toContain("map $request_uri $shenron_vfs_asset_path {");
  expect(result).toContain("proxy_pass http://127.0.0.1:5011/api/v1/vfs/file?path=$shenron_vfs_asset_path;");
  expect(result.match(/location @vfs_asset \{/g)).toHaveLength(1);
  expect(result.match(/error_page 404 = @vfs_asset;/g)).toHaveLength(2);
  expect(result).not.toContain("proxy_pass http://127.0.0.1:5011/api/v1/vfs/file?path=$request_uri");
  for (const forbidden of [
    "$http_cookie",
    "$http_authorization",
    "shenron-vfs.sqlite",
    "proxy_set_header Cookie",
    "proxy_set_header Authorization",
  ])
    expect(result).not.toContain(forbidden);
  expect(renderPublicCdnGateway(result, "http://127.0.0.1:9077")).toBe(result);
});

test("public VFS URI map rejects non-assets, encoded paths, and traversal", () => {
  const result = renderPublicCdnGateway("server {\n location @cdn_worker { return 404; }\n}", "http://127.0.0.1:9077");
  const expression = result
    .split("\n")
    .map(line => line.trim().match(/^"(~\^.*)" \$vfs_asset_path;$/)?.[1])
    .find(Boolean);
  expect(expression).toBeDefined();
  const allowed = new RegExp(expression!.slice(1));
  for (const path of ["/assets/manga/dbz/001.webp", "/assets/file-name_1.webp?x=1"])
    expect(allowed.test(path)).toBe(true);
  for (const path of [
    "/wiki/manga/001.webp",
    "/assets/../private.env",
    "/assets/a/../../private.env",
    "/assets/%2e%2e/private.env",
    "/assets/a b.webp",
    "/assets/",
  ])
    expect(allowed.test(path), path).toBe(false);
});

test("conflicting VFS routes fail closed instead of replacing sealed configuration", () => {
  const source = "server {\n location @cdn_worker { return 404; }\n location @vfs_asset { return 200; }\n}";
  expect(() => renderPublicCdnGateway(source, "http://127.0.0.1:9077")).toThrow(
    "Conflicting public VFS asset location",
  );
});

test("public fallback admits catalog video and audio paths without broadening private routes", () => {
  const result = publicCdnFallback("@cdn_public_origin", "http://127.0.0.1:9077");
  const expression = result.match(/if \(\$uri !~\* "([^"]+)"\)/)?.[1];
  expect(expression).toBeDefined();
  const allowed = new RegExp(expression!, "i");
  for (const path of [
    "/assets/wiki/bardock.web.mp4",
    "/wiki/vegetagokukaioken.web.mp4",
    "/sfx/official/nimbus.mp3",
    "/media/episodes/beerus-01/optimized-720p.mp4",
    "/wiki/chapter/cover.webp",
    "/dragonball-super/317db92a510fb5ceb09df63a579fc53de75e9d17b0c34fa28c18f07369a68218.webp",
    "/publications/archive-dragon-ball/index.json",
    "/publications/archive-dragon-ball/objects/8103ad36038a74ccb9d3b60a93cbdaa712f5463afe584acd041a98cf18fa861e.md",
    "/publications/manga-catalogue/objects/66de6ae9569c8cab8284d64cf7f0a9d1ba41515b8c7a19a7e303612e00c3a584.json",
    "/wasm/shenron_re_bg.1abeadb164523a44.wasm",
    "/manifest.webmanifest",
  ])
    expect(allowed.test(path)).toBe(true);
  for (const path of [
    "/private/cookies.mp3",
    "/sfx/private.env",
    "/wiki/hidden.sqlite",
    "/api/public/video.mp4",
    "/sfx/official/nimbus.mp3/secret",
    "/publications/archive-dragon-ball/private/index.json",
    "/publications/archive-dragon-ball/objects/short.md",
    "/publications/archive-dragon-ball/objects/66de6ae9569c8cab8284d64cf7f0a9d1ba41515b8c7a19a7e303612e00c3a584.json",
    "/publications/manga-catalogue/objects/short.json",
    "/publications/manga-catalogue/private/66de6ae9569c8cab8284d64cf7f0a9d1ba41515b8c7a19a7e303612e00c3a584.json",
    "/dragonball-super/private.webp",
    "/wasm/other.wasm",
  ])
    expect(allowed.test(path)).toBe(false);
  expect(result).toContain("proxy_set_header Range $http_range");
  expect(result).toContain("proxy_set_header If-Range $http_if_range");
});

test("explicit SDK assets override only their two exact paths in each owning server", () => {
  const first =
    "server { location /assets/ { alias /srv/shenron-cdn/assets/; }\nlocation @cdn_worker { return 404; }\n}";
  const second = "server {\nlocation @cdn_public_origin { return 404; }\n}";
  const unrelated = "server {\nlocation / { return 302 /home; }\n}";
  const source = `${first}${second}\n${unrelated}`;
  const old = renderPublicCdnGateway(source, "http://127.0.0.1:9077");
  expect(old).not.toContain("/assets/bun-video/");
  expect(renderPublicCdnGateway(source, "http://127.0.0.1:9077", false)).toBe(old);
  const result = renderPublicCdnGateway(source, "http://127.0.0.1:9077", true);
  expect(result.match(/location = \/assets\/bun-video\/hls\.worker\.js/g)).toHaveLength(2);
  expect(result.match(/location = \/assets\/bun-video\/LICENSE\.txt/g)).toHaveLength(2);
  expect(result).toContain("location /assets/ { alias /srv/shenron-cdn/assets/; }");
  expect(result).toContain(unrelated);
  for (const token of [
    "root /srv/shenron-cdn/site;",
    "default_type application/javascript;",
    "default_type text/plain;",
    "X-Content-Type-Options nosniff always",
    'Cache-Control "no-cache" always',
    "try_files $uri =404;",
  ])
    expect(result).toContain(token);
  expect(result).not.toContain("location /assets/bun-video/");
  expect(renderPublicCdnGateway(result, "http://127.0.0.1:9077", true)).toBe(result);
});

test("quoted and commented fake servers are ignored and conflicting exact SDK routes fail closed", () => {
  const body = "server {\nlocation @cdn_worker { return 404; }\n}";
  const fake = '# server { location @cdn_worker { fake; } }\nset $label "server { location @cdn_worker { fake; } }";\n';
  const result = renderPublicCdnGateway(fake + body, "http://127.0.0.1:9077", true);
  expect(result).toContain(fake);
  expect(result.match(/location = \/assets\/bun-video\/hls\.worker\.js/g)).toHaveLength(1);
  const conflict = body.replace(
    "server {",
    "server { location = /assets/bun-video/hls.worker.js { proxy_pass http://wrong; }",
  );
  expect(() => renderPublicCdnGateway(conflict, "http://127.0.0.1:9077", true)).toThrow("Conflicting exact");
});
