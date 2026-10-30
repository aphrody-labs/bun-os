# SPDX-License-Identifier: Apache-2.0
# Stopgap (ADR-003): /api/store/* proxied to the Bun aphrody-store.service until crates/aphrody-webos-repos is merged
# into aphrody-webos-server. Drop the include of this file when the Rust router serves /api/store/.
location ^~ /api/store/ {
    limit_req zone=aphrody_webos_api burst=40 nodelay;
    proxy_pass http://127.0.0.1:8791;
}
