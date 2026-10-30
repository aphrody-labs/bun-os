# SPDX-License-Identifier: Apache-2.0
# Real Hyprland session gateway (apps/webos/services/wayland.ts, 127.0.0.1:8793): WebSocket stream, bearer auth in the gateway.
# Included inside the aphrody.com server block, before the generic /api/ location.
location ^~ /api/wayland/ {
    proxy_pass http://127.0.0.1:8793;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    proxy_request_buffering off;
    limit_req zone=aphrody_webos_api burst=200 nodelay;
}
