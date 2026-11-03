@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Load bunos.sys in the test VM and exercise it from both clients. Run over ssh by `vm.sh test`.
cd /d C:\bunos
certutil -f -addstore Root driver\WDRLocalTestCert.cer >nul || exit /b 10
certutil -f -addstore TrustedPublisher driver\WDRLocalTestCert.cer >nul || exit /b 11
pnputil /add-driver driver\bunos.inf /install || exit /b 12
sc query BunOS
sc start BunOS
sc query BunOS | findstr /i RUNNING || exit /b 13
bunos-nt.exe status || exit /b 14
bunos-nt.exe ping "hello from the Bun OS test VM" || exit /b 15
if exist ts\bun.exe (cd ts && bun.exe test test\nt-driver.test.ts & cd ..)
sc stop BunOS
sc query BunOS
echo BUNOS-DRIVER-TEST-OK
