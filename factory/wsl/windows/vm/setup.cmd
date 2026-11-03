@echo off
rem SPDX-License-Identifier: Apache-2.0
rem First logon of the driver-test VM (autounattend.xml). %1 = config CD drive. Log: C:\bunos-setup.log
set CD=%1
set LOG=C:\bunos-setup.log
echo setup start %DATE% %TIME% > %LOG%
rem Test-signed kernel drivers load only with test signing on (VM only; Secure Boot is off in this VM's firmware).
bcdedit /set testsigning on >> %LOG% 2>&1
rem Win32-OpenSSH from the config CD (offline, no Windows Update): sshd service, firewall rule, host key login.
msiexec /i %CD%\OpenSSH-Win64.msi /qn /norestart ADDLOCAL=Server /L*v C:\openssh-msi.log
echo msiexec exit %ERRORLEVEL% >> %LOG%
copy /y %CD%\authorized_keys C:\ProgramData\ssh\administrators_authorized_keys >> %LOG% 2>&1
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "*S-1-5-32-544:F" /grant "SYSTEM:F" >> %LOG% 2>&1
sc config sshd start= auto >> %LOG% 2>&1
netsh advfirewall firewall add rule name=sshd dir=in action=allow protocol=TCP localport=22 >> %LOG% 2>&1
rem The driver package and the client ride on the same CD.
xcopy /e /i /y %CD%\bunos C:\bunos >> %LOG% 2>&1
echo setup done %DATE% %TIME% >> %LOG%
shutdown /r /t 5 /c "bunos test signing"
