# factory/iso: the Bun OS live/installation medium

The monthly `bunos-YYYY.MM.DD-x86_64.iso` of [RELEASES.md](../../docs/ops/RELEASES.md), built the Arch way: Arch's
own `mkarchiso` (archiso) on the profile in `profile/`, derived from Arch's `releng` profile (archiso 92).

| Item         | Value                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Boot         | UEFI only, systemd-boot (`bootmodes=('uefi.systemd-boot')`), kernel `linux-bun` from `[bunos-testing]`   |
| Packages     | `factory/wsl/packages.base` (the base set) + `profile/packages.x86_64` (bunos-cli, bunos-desktop, COSMIC) |
| Repositories | `[bunos-testing]` (`SigLevel = Required`, Store key `A4B3EFE520B09C8184ACF571BFCB340002617BD7`), `[core]`, `[extra]` |
| Identity     | `/usr/lib/os-release`: `ID=bunos`, `ID_LIKE=arch`, `BUILD_ID=rolling`, `IMAGE_VERSION=<date>`, no `VERSION_ID` |
| Session      | `graphical.target`, `display-manager.service` = `cosmic-greeter.service`; root autologin on tty1/ttyS0    |

```sh
factory/iso/build.sh        # on the build host: ~/build/storage/artifacts/iso/bunos-<date>-x86_64.iso (+ .sha256 .b2sum .sig)
factory/iso/qualify.sh      # QEMU/KVM + OVMF boot, serial report, screendump, <iso>.qualify/receipt.json
```

`build.sh` installs the Store key as the `bunos` pacman keyring of the live system (`pacman-init.service`
populates it at boot), writes the image date for `bunos-os-release` (a pacman hook on `usr/lib/os-release`,
since Arch's `filesystem` package owns that file), and creates the unit links. `qualify.sh` passes
`bunos.qualify=1` through SMBIOS type 11 (`io.systemd.boot.kernel-cmdline-extra`), so the shipped boot entry is
unchanged; `bunos-boot-report.service` then prints the system state, the greeter state and a signed
`[bunos-testing]` sync on the serial console.
