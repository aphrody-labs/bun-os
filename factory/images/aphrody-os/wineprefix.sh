#!/bin/sh
# SPDX-License-Identifier: MIT
# Called by rootfs.sh for the win32 image: creates the Wine prefix of user aphrody at image build time,
# so the first browser boot does not spend minutes in wineboot. Runs Wine from the build container (the
# same Alpine wine package as the image) with HOME=/home/aphrody linked to the image's home, so every
# path Wine records is the run-time path. Real Windows binaries are never copied in; only the fork's
# own MSVC-built bun.exe from pins.json.
set -eu
R=$1
apk add --no-cache wine wine_gecko >/dev/null
id aphrody >/dev/null 2>&1 || adduser -D -H -u 1000 -s /bin/sh aphrody
rm -rf /home/aphrody; ln -s "$R/home/aphrody" /home/aphrody
chown 1000:1000 "$R/home/aphrody"
as() { su aphrody -s /bin/sh -c "export HOME=/home/aphrody WINEPREFIX=/home/aphrody/.wine WINEDEBUG=-all WINEDLLOVERRIDES='mscoree=;winemenubuilder.exe=d'; $*"; }
as "wineboot -i && wineserver -w"
as "wine winecfg.exe /v win11 && wineserver -w"
# Desktop "shell" (taskbar + Start menu) is the default desktop of every program in this prefix.
as "wine reg.exe add 'HKCU\Software\Wine\Explorer' /v Desktop /d shell /f && wine reg.exe add 'HKCU\Software\Wine\Explorer\Desktops' /v shell /d 1280x800 /f && wineserver -w"
C=$R/home/aphrody/.wine/drive_c
install -D -m 0755 /inputs/bun-windows-x64.exe "$C/Program Files/Aphrody/Bun/bun.exe"
chown -R 1000:1000 "$C/Program Files/Aphrody"
# Start menu and desktop shortcuts (Wine's WScript.Shell CreateShortcut writes real .lnk files).
cat >"$C/users/Public/aphrody-shortcuts.vbs" <<'V'
Set sh = CreateObject("WScript.Shell")
Sub Link(dir, name, target, args)
  Set l = sh.CreateShortcut(dir & "\" & name & ".lnk")
  l.TargetPath = target : l.Arguments = args : l.Save
End Sub
menu = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs"
desk = sh.SpecialFolders("Desktop")
For Each d In Array(menu, desk)
  Link d, "File Explorer", "C:\windows\explorer.exe", "C:\"
  Link d, "Notepad", "C:\windows\notepad.exe", ""
  Link d, "Command Prompt", "C:\windows\system32\cmd.exe", ""
  Link d, "Registry Editor", "C:\windows\regedit.exe", ""
  Link d, "Bun", "C:\windows\system32\cmd.exe", "/k ""C:\Program Files\Aphrody\Bun\bun.exe"" --version"
Next
Link menu, "Wine File Manager", "C:\windows\system32\winefile.exe", ""
Link menu, "Control Panel", "C:\windows\system32\control.exe", ""
Link menu, "Wine Configuration", "C:\windows\system32\winecfg.exe", ""
V
as "wine wscript.exe //B 'C:\users\Public\aphrody-shortcuts.vbs' && wineserver -w" || echo "shortcuts: wscript failed" >&2
rm -f "$C/users/Public/aphrody-shortcuts.vbs"
ls "$C/ProgramData/Microsoft/Windows/Start Menu/Programs" || true
rm -f /home/aphrody
chown -R 1000:1000 "$R/home/aphrody"
