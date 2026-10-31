// SPDX-License-Identifier: Apache-2.0
/** Render a sealed-release candidate; Infra activation remains the sole host writer. */
export function publicCdnFallback(name: string, upstream: string): string {
  if (!/^@cdn_(?:worker|public_origin)$/.test(name)) throw Error("Unknown CDN fallback");
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(upstream) || Number(new URL(upstream).port) > 65535)
    throw Error("Qualified loopback upstream required");
  return `location ${name} {
  if ($request_method !~ "^(GET|HEAD)$") { return 405; }
  if ($uri !~* "^/(?:assets/.+|(?:wiki|dbz|adn|media)/.+\\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mp3|m4a|ogg|wav)|sfx/.+\\.(?:mp3|m4a|ogg|wav)|dragonball-super/[a-f0-9]{64}\\.(?:avif|gif|jpe?g|png|svg|webp|ico)|publications/manga-catalogue/objects/[a-f0-9]{64}\\.json|publications/[a-z0-9-]+/(?:index\\.json|objects/[a-f0-9]{64}\\.(?:md|png|jpe?g|webp|avif|svg))|wasm/shenron_re_bg\\.[a-f0-9]{16}\\.wasm|manifest\\.webmanifest)$") { return 404; }
  if ($uri ~* "(?:^|/)(?:api|_objects|_migration|private|manifests|cookies|node_modules)(?:/|$)") { return 404; }
  if ($uri ~* "\\.(?:sql|sqlite|db|env|jsonl|pem|key|toml|ya?ml|ini|log|bak)$") { return 404; }
  proxy_pass ${upstream};
  proxy_http_version 1.1;
  proxy_cache off;
  proxy_pass_request_headers off;
  proxy_pass_request_body off;
  proxy_set_header Host $host;
  proxy_set_header Content-Length "";
  proxy_set_header Connection "";
  proxy_set_header Accept $http_accept;
  proxy_set_header Accept-Encoding identity;
  proxy_set_header Range $http_range;
  proxy_set_header If-Range $http_if_range;
  proxy_set_header If-None-Match $http_if_none_match;
  proxy_set_header If-Modified-Since $http_if_modified_since;
  proxy_connect_timeout 5s;
  proxy_read_timeout 60s;
  proxy_intercept_errors on;
  error_page 404 = @vfs_asset;
}`;
}

const VFS_ASSET_MAP = `map $request_uri $shenron_vfs_asset_path {
    default "";
    "~^(?<vfs_asset_path>/assets/(?!\\.{1,2}(/|\\?|$)|.*?/\\.{1,2}(/|\\?|$))[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*)(?:\\?.*)?$" $vfs_asset_path;
}`;

const VFS_ASSET_LOCATION = `location @vfs_asset {
  if ($request_method !~ "^(GET|HEAD)$") { return 405; }
  if ($shenron_vfs_asset_path = "") { return 404; }
  proxy_pass http://127.0.0.1:5011/api/v1/vfs/file?path=$shenron_vfs_asset_path;
  proxy_http_version 1.1;
  proxy_cache off;
  proxy_pass_request_headers off;
  proxy_pass_request_body off;
  proxy_set_header Host dragonballfr.com;
  proxy_set_header Content-Length "";
  proxy_set_header Connection "";
  proxy_set_header Accept $http_accept;
  proxy_set_header Accept-Encoding identity;
  proxy_set_header Range $http_range;
  proxy_set_header If-Range $http_if_range;
  proxy_set_header If-None-Match $http_if_none_match;
  proxy_set_header If-Modified-Since $http_if_modified_since;
  proxy_connect_timeout 3s;
  proxy_read_timeout 30s;
  proxy_intercept_errors off;
}`;

function insertVfsAssetMap(source: string) {
  const maps = blocks(source, /map\s+\$request_uri\s+\$shenron_vfs_asset_path\s*\{/y);
  if (maps.length > 1) throw Error("Duplicate public VFS asset map");
  if (maps.length) {
    const current = source.slice(maps[0]!.start, maps[0]!.end + 1).trim();
    if (current !== VFS_ASSET_MAP) throw Error("Conflicting public VFS asset map");
    return source;
  }
  return `${VFS_ASSET_MAP}\n\n${source}`;
}

function insertVfsAssetLocation(source: string) {
  let result = "",
    previous = 0,
    owners = 0;
  for (const server of blocks(source, /server\s*\{/y)) {
    const body = source.slice(server.start, server.end);
    if (!blocks(body, /location\s+@cdn_(?:worker|public_origin)\s*\{/y).length) continue;
    const existing = blocks(body, /location\s+@vfs_asset\s*\{/y);
    if (existing.length > 1) throw Error("Duplicate public VFS asset location");
    if (existing.length) {
      const current = body.slice(existing[0]!.start, existing[0]!.end + 1).trim();
      if (current !== VFS_ASSET_LOCATION) throw Error("Conflicting public VFS asset location");
      result += source.slice(previous, server.end + 1);
    } else {
      result += source.slice(previous, server.end) + `\n${VFS_ASSET_LOCATION}\n` + source[server.end]!;
    }
    previous = server.end + 1;
    owners++;
  }
  if (!owners) throw Error("No owned server for public VFS asset location");
  return result + source.slice(previous);
}

function* syntaxPositions(source: string, start = 0) {
  let quote = "",
    comment = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "#") {
      comment = true;
      continue;
    }
    yield i;
  }
}

function closingBrace(source: string, start: number): number {
  let depth = 1;
  for (const i of syntaxPositions(source, start)) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return i;
  }
  throw Error("Unclosed CDN fallback block");
}

function blocks(source: string, pattern: RegExp) {
  const found: { start: number; end: number; match: RegExpExecArray }[] = [];
  let previous = -1;
  for (const start of syntaxPositions(source)) {
    if (start <= previous || (start > 0 && /[\w]/.test(source[start - 1]!))) continue;
    pattern.lastIndex = start;
    const match = pattern.exec(source);
    if (!match) continue;
    const end = closingBrace(source, pattern.lastIndex);
    found.push({ start, end, match });
    previous = end;
  }
  return found;
}

function bunVideoLocation(path: string, mime: string) {
  return `location = ${path} {
  if ($request_method !~ "^(GET|HEAD)$") { return 405; }
  root /srv/shenron-cdn/site;
  types {}
  default_type ${mime};
  add_header X-Content-Type-Options nosniff always;
  add_header Cache-Control "no-cache" always;
  try_files $uri =404;
}`;
}

function insertBunVideoAssets(source: string) {
  let result = "",
    previous = 0,
    owners = 0;
  for (const server of blocks(source, /server\s*\{/y)) {
    const body = source.slice(server.start, server.end);
    if (!blocks(body, /location\s+@cdn_(?:worker|public_origin)\s*\{/y).length) continue;
    const existing = blocks(body, /location\s*=\s*(\/assets\/bun-video\/(?:hls\.worker\.js|LICENSE\.txt))\s*\{/y);
    const missing: string[] = [];
    for (const [path, mime] of [
      ["/assets/bun-video/hls.worker.js", "application/javascript"],
      ["/assets/bun-video/LICENSE.txt", "text/plain"],
    ]) {
      const wanted = bunVideoLocation(path!, mime!);
      const matches = existing.filter(entry => entry.match[1] === path);
      if (matches.length > 1 || (matches.length && body.slice(matches[0]!.start, matches[0]!.end + 1) !== wanted))
        throw Error("Conflicting exact Bun Video asset location");
      if (!matches.length) missing.push(wanted);
    }
    result += source.slice(previous, server.end) + (missing.length ? `\n${missing.join("\n")}\n` : "");
    previous = server.end;
    owners++;
  }
  if (!owners) throw Error("No owned server for staged Bun Video assets");
  return result + source.slice(previous);
}

/** Replace only named CDN fallback blocks; preserve site/API/TLS routing verbatim. */
export function renderPublicCdnGateway(source: string, upstream: string, includeBunVideoAssets = false): string {
  const pattern = /^[ \t]*location\s+(@cdn_(?:worker|public_origin))\s*\{/gm;
  let result = "",
    previous = 0,
    count = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const end = closingBrace(source, pattern.lastIndex);
    result += source.slice(previous, match.index) + publicCdnFallback(match[1]!, upstream);
    previous = end + 1;
    pattern.lastIndex = previous;
    count++;
  }
  if (!count) throw Error("No owned CDN fallback blocks found");
  const rendered = insertVfsAssetLocation(insertVfsAssetMap(result + source.slice(previous)));
  return includeBunVideoAssets ? insertBunVideoAssets(rendered) : rendered;
}

if (import.meta.main) {
  const [source, destination, upstream, assets] = process.argv.slice(2);
  if (!source || !destination || !upstream || source === destination)
    throw Error("Expected distinct SOURCE CANDIDATE and qualified LOOPBACK_UPSTREAM");
  if (assets && assets !== "--bun-video-assets") throw Error("Unknown explicit asset option");
  const input = await Bun.file(source).text();
  const output = renderPublicCdnGateway(input, upstream, assets === "--bun-video-assets");
  await Bun.write(destination, output);
  console.log(
    JSON.stringify({
      source,
      destination,
      upstream,
      inputSha256: new Bun.CryptoHasher("sha256").update(input).digest("hex"),
      candidateSha256: new Bun.CryptoHasher("sha256").update(output).digest("hex"),
    }),
  );
}
