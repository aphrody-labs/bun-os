# SPDX-License-Identifier: Apache-2.0
# Bun OS test signing on a development workstation (PowerShell: the certificate store and Authenticode are
# Windows-only APIs). Run elevated (e.g. `sudo.exe pwsh -NoProfile -File factory/windows/signing/test-signing.ps1 setup`).
#
#   setup            create (once) the "Bun OS Test Signing" code-signing certificate in LocalMachine\My and trust it
#                    in LocalMachine\Root and LocalMachine\TrustedPublisher; idempotent
#   sign <files...>  Authenticode-sign files (.exe .dll .sys .cat .msix ...) with SHA-256 and an RFC 3161 timestamp
#   status           certificate, trust, Secure Boot and test-signing state
#   remove           delete the certificate from the three stores (undo of setup)
#
# User-mode binaries signed this way are trusted on this machine with Secure Boot on. Kernel drivers signed with it
# load only when Windows runs in test-signing mode, which Secure Boot forbids: see docs/NTCORE.md (driver loading).
param([Parameter(Position = 0)][string]$Command = "status", [Parameter(Position = 1, ValueFromRemainingArguments)][string[]]$Files)
$ErrorActionPreference = "Stop"
$Subject = "CN=Bun OS Test Signing, O=Aphrody"

function Get-Cert { Get-ChildItem Cert:\LocalMachine\My | Where-Object Subject -eq $Subject | Sort-Object NotAfter -Descending | Select-Object -First 1 }
function Get-SignTool {
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object FullName -match '\\x64\\' |
    Sort-Object { [version]($_.Directory.Parent.Name -replace '[^\d.]', '') } -Descending | Select-Object -First 1 -ExpandProperty FullName
}

switch ($Command) {
  "setup" {
    $cert = Get-Cert
    if (-not $cert) {
      $cert = New-SelfSignedCertificate -Subject $Subject -Type CodeSigningCert -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddYears(5)
      Write-Output "created $($cert.Thumbprint)"
    }
    $public = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cert.Export("Cert"))
    foreach ($name in "Root", "TrustedPublisher") {
      $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($name, "LocalMachine")
      $store.Open("ReadWrite")
      if (-not ($store.Certificates | Where-Object Thumbprint -eq $cert.Thumbprint)) { $store.Add($public); Write-Output "trusted in LocalMachine\$name" }
      $store.Close()
    }
    Write-Output "certificate $($cert.Thumbprint) valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
  }
  "sign" {
    $cert = Get-Cert
    if (-not $cert) { throw "run 'setup' first" }
    $signtool = Get-SignTool
    if (-not $signtool) { throw "signtool.exe not found (Windows SDK signing tools)" }
    foreach ($f in $Files) {
      & $signtool sign /sm /s My /sha1 $cert.Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $f
      if ($LASTEXITCODE -ne 0) { throw "signing failed: $f" }
      & $signtool verify /pa /q $f
      if ($LASTEXITCODE -ne 0) { throw "verification failed: $f" }
      Write-Output "signed $f"
    }
  }
  "status" {
    $cert = Get-Cert
    $secureBoot = try { Confirm-SecureBootUEFI } catch { "unsupported" }
    $testSigning = [bool](bcdedit /enum "{current}" | Select-String -Quiet "testsigning\s+Yes")
    [pscustomobject]@{
      Certificate      = if ($cert) { $cert.Thumbprint } else { $null }
      TrustedRoot      = [bool]($cert -and (Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $cert.Thumbprint))
      TrustedPublisher = [bool]($cert -and (Get-ChildItem Cert:\LocalMachine\TrustedPublisher | Where-Object Thumbprint -eq $cert.Thumbprint))
      SecureBoot       = $secureBoot
      TestSigning      = $testSigning
    } | Format-List
  }
  "remove" {
    foreach ($store in "My", "Root", "TrustedPublisher") {
      Get-ChildItem "Cert:\LocalMachine\$store" | Where-Object Subject -eq $Subject | Remove-Item
    }
    Write-Output "removed"
  }
  default { throw "usage: test-signing.ps1 setup|sign <files>|status|remove" }
}
