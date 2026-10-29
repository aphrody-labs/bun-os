#!/usr/bin/env bash
# Bun OS WSL layer: upstream .NET SDK 10 + PowerShell (opt in with BUNOS_DOTNET=1 in bunos-wsl.sh). Runs inside the rootfs
# (arch-chroot) with Bun installed and /opt/bunos/{factory,buncc} in place. Also exercised by .github/workflows/dotnet-linux.yml.
# The tarballs are pinned in factory/dotnet-linux/pins.json and verified by `buncc dotnet install` (SHA-512 .NET, SHA-256 pwsh).
set -euo pipefail
root=${BUNOS_ROOT:-/opt/bunos}
prefix=${BUNOS_DOTNET_PREFIX:-$root/dotnet-linux}
grep -vE '^\s*(#|$)' "$root/factory/wsl/packages.dotnet" | pacman -S --needed --noconfirm -
(cd "$root" && for what in sdk10 pwsh; do bun "$root/buncc/src/cli.ts" dotnet install "$what" --run --prefix "$prefix"; done)
ln -sf "$prefix/bin/dotnet" /usr/local/bin/dotnet
ln -sf "$prefix/bin/pwsh" /usr/local/bin/pwsh
printf 'export DOTNET_ROOT=%s/dotnet\nexport DOTNET_CLI_TELEMETRY_OPTOUT=1\n' "$prefix" >/etc/profile.d/dotnet.sh
grep -qx /usr/local/bin/pwsh /etc/shells || echo /usr/local/bin/pwsh >>/etc/shells
install -Dm644 "$root/factory/dotnet-linux/pwsh/Microsoft.PowerShell_profile.ps1" /etc/skel/.config/powershell/Microsoft.PowerShell_profile.ps1
DOTNET_ROOT="$prefix/dotnet" /usr/local/bin/dotnet --list-sdks
/usr/local/bin/pwsh -NoProfile -c '$PSVersionTable.PSVersion.ToString()'
