# SPDX-License-Identifier: Apache-2.0
# Aphrody Chat inference gateway (apps/webos/services/chat.ts, 127.0.0.1:8794): OpenAI-compatible SSE.
# Included inside the aphrody.com server block, before the generic /api/ location.
location ^~ /api/chat/ {
    proxy_pass http://127.0.0.1:8794;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;
    proxy_buffering off;
    proxy_request_buffering on;
    client_max_body_size 1m;
    limit_req zone=aphrody_webos_api burst=20 nodelay;
}
