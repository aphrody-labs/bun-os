# SPDX-License-Identifier: Apache-2.0
# Public IEVR asset routes shared by nie.aphrody.app. Upstream: 127.0.0.1:8810,
# which relays this host to its supervised
# nie-model-serve child. Requires the `nie_assets` / `nie_conn` zones of nginx/nie/nie.aphrody.app.conf.

location = /robots.txt {
    add_header Content-Type "text/plain; charset=utf-8";
    return 200 "User-agent: *\nDisallow: /\n";
}

location = /health {
    proxy_pass http://127.0.0.1:8810/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    access_log off;
}

# Routes that hand out the game itself rather than a derived asset (original bytes, listing of
# the installed game, project source): never public.
location ~ ^/(raw|vfs|depot)(/|$) {
    return 404;
}

# Converted downloads: derived formats only. nie-model-serve defaults `/export/` to `raw` when
# `format` is absent, and nginx matches argument names case-insensitively, so the whole query
# string is checked.
location ^~ /export/ {
    if ($args !~ "^format=(png|webp|gif|jpg|bmp|tga|tiff|qoi|json|glb|wav|mp4|webm|h264|m2v)(&id=[0-9]+)?$") {
        return 404;
    }
    limit_req zone=nie_assets burst=20 nodelay;
    limit_conn nie_conn 8;
    limit_req_status 429;
    limit_conn_status 429;
    proxy_pass http://127.0.0.1:8810;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    include snippets/proxy-client-ip.inc;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Derived assets decoded on demand (models, textures, cfg.bin JSON, audio, video), rate limited
# because one model assembly costs seconds of CPU.
location / {
    limit_req zone=nie_assets burst=40 nodelay;
    limit_conn nie_conn 8;
    limit_req_status 429;
    limit_conn_status 429;
    proxy_pass http://127.0.0.1:8810;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    include snippets/proxy-client-ip.inc;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Access-Control-Allow-Origin "*" always;
}
