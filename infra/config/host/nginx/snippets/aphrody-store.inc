# SPDX-License-Identifier: Apache-2.0
# Bun OS Store repositories on aphrody.com, served from the persistent store (built on the VPS by
# apps/webos/store/cli.ts). Included in the aphrody.com server block; installed as /etc/nginx/snippets/aphrody-store.inc.
#   /repo/os/x86_64/      pacman (libalpm) repo `aphrody`, signed; key /repo/os/aphrody.gpg
#   /repo/apk/            apk repo (APKINDEX.tar.gz signed) and keys/
#   /repo/flatpak/        OSTree repo, aphrody.flatpakrepo, .flatpakref
#   /repo/android/        APK catalog
#   /repo/redox/          Redox pkgar repo (pkg source https://aphrody.com/repo/redox; x86_64-unknown-redox/ plus the x86_64/ alias)
#   /downloads/os/        OS images (Bun OS Redox desktop); both built by factory/os/rust-desktop.ts
#   /npm/                 npm registry protocol (packuments are <scope>/<name>.json, tarballs under <name>/-/)
#   /cargo/               cargo sparse registry (index/, dl/<crate>/<version>/download)
location ^~ /repo/ {
    alias /home/ubuntu/apps/webos/store/repo/;
    autoindex off;
    default_type application/octet-stream;
    types {
        application/json json;
        application/vnd.flatpak.repo flatpakrepo;
        application/vnd.flatpak.ref flatpakref;
        application/vnd.android.package-archive apk;
        application/gzip gz;
        image/png png;
        image/webp webp;
        application/xml xml;
    }
    add_header Cache-Control "no-cache" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options nosniff always;
}
location ^~ /downloads/os/ {
    alias /home/ubuntu/apps/webos/store/downloads/os/;
    autoindex off;
    default_type application/octet-stream;
    types { application/json json; }
    add_header Cache-Control "no-cache" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options nosniff always;
}
location ^~ /npm/ {
    alias /home/ubuntu/apps/webos/store/npm/;
    # Scoped names arrive as /npm/@aphrody%2fname and are decoded to /npm/@aphrody/name by nginx.
    try_files $uri.json $uri =404;
    default_type application/octet-stream;
    types { application/json json; application/gzip tgz; }
    add_header Cache-Control "no-cache" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options nosniff always;
}
location ^~ /cargo/ {
    alias /home/ubuntu/apps/webos/store/cargo/;
    # Index files carry no extension and hold one JSON object per line; cargo ignores the content type.
    default_type application/octet-stream;
    types { application/json json; }
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
}
