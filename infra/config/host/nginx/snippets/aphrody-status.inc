# SPDX-License-Identifier: Apache-2.0
# aphrody.com/status: the Bun OS automation status page (docs/AUTOMATION.md), static files written by
# factory/automation/status.ts into ~/apps/bunos-status. Locations with add_header repeat the server-level headers.
location = /status {
    alias /home/ubuntu/apps/bunos-status/index.html;
    default_type text/html;
    add_header Cache-Control "no-cache" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cross-Origin-Resource-Policy "same-site" always;
}
location ^~ /status/ {
    alias /home/ubuntu/apps/bunos-status/;
    index index.html;
    add_header Cache-Control "no-cache" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "credentialless" always;
    add_header Cross-Origin-Resource-Policy "same-site" always;
}
