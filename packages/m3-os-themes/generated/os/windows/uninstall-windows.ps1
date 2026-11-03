# SPDX-License-Identifier: Apache-2.0
# Restores the personalization snapshot taken by install-windows.ps1.
& (Join-Path $PSScriptRoot 'install-windows.ps1') -Uninstall @args
