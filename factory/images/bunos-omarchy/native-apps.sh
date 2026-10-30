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

# Microsoft and Google web apps: the official services in Chromium app windows (shared profile, so one sign-in per
# account covers every app of that vendor). Names point at the vendors' own services; icons come from the installed
# Papirus theme, nothing of the vendors is bundled. Desktop apps that are open source come from Arch packages
# (code = Code-OSS, msedit, android-tools, ttf-cascadia-code, chromium).
webapp() { # id name comment url icon categories
  cat >"$A/$1.desktop" <<D
[Desktop Entry]
Type=Application
Name=$2
Comment=$3
Exec=chromium --app=$4 --class=$1
Icon=$5
StartupWMClass=$1
Categories=$6
Terminal=false
D
}
webapp ms-outlook "Outlook" "Microsoft Outlook on the web" "https://outlook.office.com/mail/" ms-outlook "Office;Email;"
webapp ms-word "Word" "Microsoft Word on the web" "https://www.office.com/launch/word" ms-word "Office;WordProcessor;"
webapp ms-excel "Excel" "Microsoft Excel on the web" "https://www.office.com/launch/excel" ms-excel "Office;Spreadsheet;"
webapp ms-powerpoint "PowerPoint" "Microsoft PowerPoint on the web" "https://www.office.com/launch/powerpoint" ms-powerpoint "Office;Presentation;"
webapp ms-onedrive "OneDrive" "Microsoft OneDrive on the web" "https://onedrive.live.com/" onedrive "Office;FileManager;"
webapp ms-teams "Microsoft Teams" "Microsoft Teams on the web" "https://teams.microsoft.com/v2/" teams "Office;Chat;VideoConference;"
webapp ms-onenote "OneNote" "Microsoft OneNote on the web" "https://www.onenote.com/notebooks" onenote "Office;"
webapp ms-todo "Microsoft To Do" "Microsoft To Do on the web" "https://to-do.office.com/tasks/" ms-todo "Office;ProjectManagement;"
webapp google-gmail "Gmail" "Gmail on the web" "https://mail.google.com/" gmail "Network;Email;"
webapp google-drive "Google Drive" "Google Drive on the web" "https://drive.google.com/" google-drive "Office;FileManager;"
webapp google-docs "Google Docs" "Google Docs on the web" "https://docs.google.com/document/" google-docs "Office;WordProcessor;"
webapp google-sheets "Google Sheets" "Google Sheets on the web" "https://docs.google.com/spreadsheets/" google-sheets "Office;Spreadsheet;"
webapp google-slides "Google Slides" "Google Slides on the web" "https://docs.google.com/presentation/" google-slides "Office;Presentation;"
webapp google-calendar "Google Calendar" "Google Calendar on the web" "https://calendar.google.com/" google-calendar "Office;Calendar;"
webapp google-meet "Google Meet" "Google Meet on the web" "https://meet.google.com/" google-meet "Network;VideoConference;"
webapp google-maps "Google Maps" "Google Maps on the web" "https://www.google.com/maps" google-maps "Education;Geography;"
webapp google-photos "Google Photos" "Google Photos on the web" "https://photos.google.com/" google-photos "Graphics;Photography;"
webapp youtube "YouTube" "YouTube on the web" "https://www.youtube.com/" youtube "AudioVideo;Video;"
webapp google-gemini "Gemini" "Google Gemini on the web" "https://gemini.google.com/" google-gemini "Utility;"
