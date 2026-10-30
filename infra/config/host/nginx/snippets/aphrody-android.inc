# SPDX-License-Identifier: Apache-2.0
# Android session gateway (aphrody-android-gateway.service, 127.0.0.1:8799): viewer, health and the H.264 WebSocket.
# Bearer auth is enforced by the gateway. Included inside the aphrody.com server block, before the generic /api/ location.
location ^~ /api/android/ {
    proxy_pass http://127.0.0.1:8799;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    proxy_request_buffering off;
}
