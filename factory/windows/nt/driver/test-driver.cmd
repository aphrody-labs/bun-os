@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Owner-run, elevated, after load-driver.cmd: exercise \\.\BunOS end to end. bunos-nt.exe is beside this script in
rem the bundle, or on PATH after the System32 link. Run: C:\Windows\System32\sudo.exe cmd /c test-driver.cmd
setlocal
cd /d "%~dp0"
set NT=bunos-nt.exe
if not exist "%NT%" set NT=..\..\bin\bunos-nt.exe
if not exist "%NT%" set NT=bunos-nt

echo [bunos] version:
"%NT%" version || exit /b 1
echo [bunos] caps:
"%NT%" caps || exit /b 1
echo [bunos] ping:
"%NT%" ping bun-os || exit /b 1
echo [bunos] events (process,image for 5s; spawn a process in another window to see creates):
"%NT%" events process,image 5
echo [bunos] ok.
endlocal
