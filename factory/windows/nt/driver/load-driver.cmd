@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Owner-run, elevated: load the test-signed bunos.sys kernel driver on THIS machine. Prerequisites the owner sets
rem once (documented, never done by an agent): Secure Boot OFF in firmware, then (elevated)
rem   bcdedit /set testsigning on   &&  reboot
rem and the "Bun OS Test Signing" certificate trusted in LocalMachine\Root and \TrustedPublisher (already done by
rem factory\windows\signing\test-signing.ps1 setup). bunos.sys and bunos.cat here are signed with that certificate.
rem Run:  C:\Windows\System32\sudo.exe cmd /c load-driver.cmd
setlocal
cd /d "%~dp0"

echo [bunos] test-signing / Secure Boot state:
powershell -NoProfile -Command "$s=Confirm-SecureBootUEFI -ErrorAction SilentlyContinue; Write-Host ('  Secure Boot: '+$s); $t=(bcdedit /enum '{current}' | Select-String testsigning); Write-Host ('  '+($t -replace '\s+',' '))"

echo [bunos] add-driver (Driver Store) + create/start the BunOS service:
pnputil /add-driver bunos.inf /install
if errorlevel 1 ( echo [bunos] pnputil failed: Secure Boot must be off and testsigning on, then reboot. & exit /b 1 )
sc start BunOS
if errorlevel 1 ( echo [bunos] sc start BunOS failed ^(see 'sc query BunOS'^). & exit /b 1 )
echo [bunos] loaded. \\.\BunOS is up. Unload with: sc stop BunOS ^&^& pnputil /delete-driver bunos.inf /uninstall
endlocal
