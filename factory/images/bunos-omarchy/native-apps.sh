#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Aphrody launchers of the desktop session. Rio, the COSMIC apps and the icon themes come from their upstream packages
# (rio, cosmic-*, papirus-icon-theme) with their own .desktop files and icons; this adds the Aphrody apps, which run as
# GNOME Web (WebKitGTK) application-mode windows with their own profiles, icon and name.
set -eu
A=/usr/share/applications
I=/usr/share/icons/hicolor/scalable/apps
mkdir -p "$A" "$I"
cat >"$I/aphrody.svg" <<'S'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#6750a4"/><path d="M20 44V20h14a8 8 0 0 1 0 16H26" fill="none" stroke="#eaddff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
S
app() { # id name comment exec categories
  cat >"$A/$1.desktop" <<D
[Desktop Entry]
Type=Application
Name=$2
Comment=$3
Exec=$4
Icon=aphrody
StartupWMClass=org.gnome.Epiphany
Categories=$5
Terminal=false
D
}
app aphrody-browser "Aphrody Browser" "Browse the web (WebKitGTK)" "epiphany --new-window https://aphrody.com" "Network;WebBrowser;"
app aphrody-chat "Aphrody Chat" "Chat with the Bun OS model backend" "epiphany --application-mode --profile=/tmp/aphrody-chat https://aphrody.com/workspace/os" "Network;Chat;"
app aphrody-search "Aphrody Search" "Search apps, packages, crates and docs of Bun OS" "epiphany --application-mode --profile=/tmp/aphrody-search https://aphrody.com/?app=search" "Utility;"
