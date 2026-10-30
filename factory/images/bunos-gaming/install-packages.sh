#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# install-packages.sh LIST...: install from configured pacman repositories and the staged Bun OS repo.
# Missing packages are recorded and fail the image build; AUR is not an implicit source owner.
set -euo pipefail
repo=() missing=()
for list in "$@"; do
  while read -r pkg; do
    [ -z "$pkg" ] || [ "${pkg:0:1}" = "#" ] && continue
    if pacman -Si "$pkg" >/dev/null 2>&1 || pacman -Sg "$pkg" >/dev/null 2>&1; then
      repo+=("$pkg")
    else
      missing+=("$pkg")
    fi
  done <"$list"
done
install -d /usr/share/bun-os
printf '%s\n' "${missing[@]}" > /usr/share/bun-os/missing-packages.txt
if [ ${#missing[@]} -gt 0 ]; then
  printf 'Refusing image: %d packages are absent from the configured signed repositories.\n' "${#missing[@]}" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 20
fi
[ ${#repo[@]} -eq 0 ] || pacman -S --noconfirm --needed "${repo[@]}"
