# Bun OS test signing (workstation)

`test-signing.ps1` owns the one development code-signing certificate, **CN=Bun OS Test Signing, O=Aphrody**
(RSA 3072, SHA-256, private key non-exportable, in `LocalMachine\My`), trusted in `LocalMachine\Root` and
`LocalMachine\TrustedPublisher`. Every Bun OS Windows binary we ship to this machine (`.exe`, `.dll`, `.msix`,
driver `.sys`/`.cat`) is signed with it:

```sh
sudo.exe pwsh -NoProfile -File factory/windows/signing/test-signing.ps1 setup          # once, idempotent
sudo.exe pwsh -NoProfile -File factory/windows/signing/test-signing.ps1 sign <files>   # SHA-256 + RFC 3161 timestamp, then verify
sudo.exe pwsh -NoProfile -File factory/windows/signing/test-signing.ps1 status
sudo.exe pwsh -NoProfile -File factory/windows/signing/test-signing.ps1 remove         # undo
```

User-mode binaries signed this way are trusted with Secure Boot on. Kernel drivers are different: Windows loads a
driver signed by a private certificate only in test-signing mode (`bcdedit /set testsigning on`), and with Secure
Boot enabled that boot setting is locked ("protected by Secure Boot policy"). To load `bunos.sys` on this machine,
one of:

1. Disable Secure Boot in the UEFI firmware setup (manual, at the firmware screen), then
   `sudo.exe bcdedit /set testsigning on` and reboot. Windows shows "Test Mode"; some anti-cheat systems refuse to run
   with Secure Boot off or test signing on. Undo: `bcdedit /set testsigning off`, re-enable Secure Boot.
2. Production: attestation signing through the Microsoft Partner Center hardware program (EV code-signing
   certificate required); the driver then loads with Secure Boot on and no test mode.

State on 2026-11-03: certificate created (thumbprint `1E67DBDB0D46A61CF57D286A5562DD76675D4E87`), Secure Boot on,
test signing off, BitLocker off, HVCI off.
