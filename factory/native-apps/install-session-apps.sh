#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Installs the native session apps of the Pop!_OS/COSMIC session image from the Bun OS apt feed (suite resolute:
# packages built from our aphrody-labs forks in the ubuntu:26.04 builder, see infra/config/host/libexec/aphrody-native-apps).
# Run as root during the image build:  sh install-session-apps.sh [origin]
set -eu
ORIGIN=${1:-https://aphrody.com}
APPS=${BUNOS_SESSION_APPS:-"rio aphrody-chat aphrody-search spacedrive cosmic-files cosmic-term cosmic-edit cosmic-store cosmic-player cosmic-settings cosmic-calculator"}
# Ubuntu's "rio" is a Diamond Rio MP3 CLI; ours is the Rio terminal and must win.
apt-get remove -y rio >/dev/null 2>&1 || true
install -d /usr/share/keyrings /etc/apt/preferences.d
curl -fsSL "$ORIGIN/repo/apt/aphrody-apt.gpg" -o /usr/share/keyrings/aphrody-apt.gpg
echo "deb [signed-by=/usr/share/keyrings/aphrody-apt.gpg] $ORIGIN/repo/apt resolute main" >/etc/apt/sources.list.d/aphrody-resolute.list
# Our fork builds take precedence over same-named archive packages (cosmic-*, rio).
printf 'Package: *\nPin: release o=Aphrody,n=resolute\nPin-Priority: 1001\n' >/etc/apt/preferences.d/aphrody-resolute
apt-get update
available=""
for p in $APPS; do
  if apt-cache policy "$p" | grep -q "aphrody.com/repo/apt resolute"; then available="$available $p"; else echo "not in the feed yet: $p" >&2; fi
done
# shellcheck disable=SC2086
[ -z "$available" ] || apt-get install -y --no-install-recommends $available
