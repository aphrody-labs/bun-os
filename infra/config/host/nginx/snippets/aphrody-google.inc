# SPDX-License-Identifier: Apache-2.0
# Google access of the Bun OS backend (crates/bun-os-google `bun-os-google serve`, 127.0.0.1:8796):
# status, the owner's OAuth consent and callback, token broker and Google API reads (admin bearer in the service).
# Included inside the aphrody.com server block, before the generic /api/ location.
location ^~ /api/google/ {
    proxy_pass http://127.0.0.1:8796;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120s;
    client_max_body_size 64k;
    add_header Cache-Control "no-store" always;
    limit_req zone=aphrody_webos_api burst=20 nodelay;
}
