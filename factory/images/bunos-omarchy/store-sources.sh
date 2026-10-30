#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Bun OS Store sources of the desktop session, so cosmic-store (PackageKit + AppStream pool, Flatpak remotes) lists
# Bun OS apps with their real names, icons and screenshots:
#   pacman  [aphrody]  https://aphrody.com/repo/os/$arch (signed; key https://aphrody.com/repo/os/aphrody.gpg)
#           aphrody-appstream-data installs the repository catalog into /usr/share/swcatalog/{xml,icons}
#   flatpak aphrody    https://aphrody.com/repo/flatpak/aphrody.flatpakrepo (signed, appstream with icons)
#           flathub    runtimes of the aphrody apps
# Repositories are built by apps/webos/store (VPS) and served by nginx (infra/config/host/nginx/snippets/aphrody-store.inc).
set -eu
ORIGIN=${BUNOS_STORE_ORIGIN:-https://aphrody.com}
key=$(mktemp)
curl -fsSL "$ORIGIN/repo/os/aphrody.gpg" -o "$key"
fpr=$(gpg --show-keys --with-colons "$key" | awk -F: '/^fpr/{print $10; exit}')
pacman-key --add "$key"
pacman-key --lsign-key "$fpr"
rm -f "$key"
grep -q '^\[aphrody\]' /etc/pacman.conf || printf '\n[aphrody]\nSigLevel = Required DatabaseRequired\nServer = %s/repo/os/$arch\n' "$ORIGIN" >>/etc/pacman.conf
pacman -Sy --noconfirm --needed aphrody/aphrody-appstream-data
flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak remote-add --system --if-not-exists aphrody "$ORIGIN/repo/flatpak/aphrody.flatpakrepo"
flatpak update --system --appstream aphrody || true
appstreamcli refresh-cache --force || true
