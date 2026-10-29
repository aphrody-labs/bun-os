> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Prompt Codex du PC d'Omar (2026-10-09)

Prompt complet, à coller en un seul message dans Codex lancé en PowerShell 7 administrateur
(`codex --sandbox danger-full-access --ask-for-approval never`). Il remplace les blocs postés le 2026-10-08
([OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md) sections 4 et 4 bis) : fork Bun à jour, Aphrody depuis les
sources, WireGuard wg1, bureau + VNC, MCP, SSH Windows et WSL Ubuntu, tunnel inverse et toujours en ligne
(`aphrody infra remote always-online`). Defender et le pare-feu Windows sont désactivés exprès sur les
PC de dev : aucune règle pare-feu à créer.

```text
MISSION (Codex, PC Windows d'Omar, PowerShell 7 administrateur, Windows 10/11 x64).
Mets le PC d'Omar à jour et rends-le pilotable en permanence par le propriétaire (aphro-pc) et les deux VPS, dans les deux sens : fork Bun d'Aphrody, Aphrody construit depuis les sources, tunnel WireGuard wg1, bureau à distance + VNC, MCP computer_*, SSH Windows et WSL Ubuntu, tunnel SSH inverse de secours, tâches auto-réparatrices. Exécute toi-même chaque étape 1 à 10, de bout en bout, sans demander de confirmation ; ne t'arrête que sur un vrai blocage, en disant lequel. Termine par le rapport (étape 11).

RÈGLES DE SÉCURITÉ (absolues)
- Ne lis, n'affiche, ne journalise, ne copie jamais une clé privée, un jeton ou un mot de passe : aucun Get-Content/cat/type sur *.key, *.token, *.password, *.env, *.conf, id_ed25519 (sans .pub). Seule exception : le pipe vers `aphrody infra wg pubkey` (étape 5), qui n'affiche que la clé publique.
- La clé privée WireGuard ne passe jamais par toi : si elle doit être saisie, Omar le fait lui-même dans une autre fenêtre.
- Rien de secret dans Discord, un commit, un journal ou le rapport. Les jetons sont remis au propriétaire hors bande par Omar lui-même.
- Si tu commites dans un dépôt aphrody-labs : identité git d'Omar, branche `omar/<sujet>`, jamais main.
- Ne réactive ni Defender ni le pare-feu Windows (désactivés exprès sur les PC de dev).

FAITS
- wg1 : réseau 10.200.77.0/24, interface Windows `aphrody`. Hub vps 10.200.77.1, endpoint 51.77.147.152:51821, clé publique McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=. dbfr 10.200.77.3. Propriétaire aphro-pc 10.200.77.4.
- Omar = 10.200.77.10/24, clé publique déclarée EXfatxgVFs8Lr9k7QoJ2wiznY5MYO4C19+4gLbGmCEw=.
- Services d'Omar : 22 SSH Windows, 2222 SSH WSL Ubuntu, 8795 bureau à distance, 5900 VNC, 8793 MCP HTTP (127.0.0.1 + portproxy sur 10.200.77.10).
- Tunnel inverse (secours sans handshake) vers omar@51.77.147.152 : 22010→22, 28795→8795, 28793→8793, 22011→2222, 25900→5900 (seuls ports autorisés par le hub).
- Variables (redéfinis-les à chaque session) : $Repo = "C:\src\aphrody" ; $BunRepo = "C:\bun" ; $AH = "$env:USERPROFILE\.aphrody" ; $Bin = "$env:LOCALAPPDATA\Aphrody\bin"

1) PRÉREQUIS (winget ; « déjà installé » n'est pas une erreur ; ajoute --accept-source-agreements --accept-package-agreements --disable-interactivity)
winget install -e --id Git.Git ; winget install -e --id Rustlang.Rustup ; winget install -e --id Kitware.CMake ; winget install -e --id NASM.NASM ; winget install -e --id LLVM.LLVM ; winget install -e --id astral-sh.uv ; winget install -e --id Microsoft.PowerShell
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';C:\Program Files\NASM'
Vérifie : git --version ; rustup --version ; cmake --version ; nasm -v ; uv --version
Le toolchain Rust exact est épinglé par rust-toolchain.toml et s'installe seul au premier cargo. Erreur perl/openssl : winget install -e --id StrawberryPerl.StrawberryPerl.

2) FORK BUN D'APHRODY (jamais bun.sh ni winget Oven-sh.Bun)
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/aphrody-labs/bun/main/scripts/aphrody/install.ps1'))) -Version 1.4.3
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path" ; bun --version     # attendu : 1.4.3-aphrody.2 ou plus récent
Checkout source du fork (docs, contributions) : if (Test-Path $BunRepo) { git -C $BunRepo pull --ff-only } else { git clone --filter=blob:none https://github.com/aphrody-labs/bun.git $BunRepo }
[Environment]::SetEnvironmentVariable('APHRODY_BUN_CHECKOUT', $BunRepo, 'User')

3) DÉPÔT APHRODY (privé : le compte GitHub d'Omar doit y avoir accès ; 403/404 = blocage à signaler)
if (Test-Path $Repo) { git -C $Repo pull --ff-only } else { New-Item -ItemType Directory -Force C:\src | Out-Null ; git clone --filter=blob:none https://github.com/aphrody-labs/aphrody.git $Repo }
Set-Location $Repo ; git log --oneline -1 ; Test-Path crates\infra\infra\src\always_online.rs   # True attendu
bun install

4) APHRODY DEPUIS LES SOURCES (20 à 60 min, un seul build ; ne modifie ni Cargo.lock ni le code)
cargo build --release --locked -p aphrody -p aphrody-mcp --features aphrody-mcp/winclean
Get-Process aphrody, aphrody-mcp -ErrorAction SilentlyContinue | Stop-Process -Force
New-Item -ItemType Directory -Force $Bin | Out-Null ; Copy-Item "$Repo\target\release\aphrody.exe" "$Bin\aphrody.exe" -Force
& "$Bin\aphrody.exe" self install-path --bin "$Bin\aphrody.exe" ; $env:Path = "$Bin;$env:Path"
aphrody --version ; aphrody infra wg --help ; aphrody infra remote --help ; aphrody-mcp http --help
En échec de build : lis la première erreur, installe le prérequis manquant, relance. Seulement si le build reste impossible : irm https://downloads.aphrody.com/install.ps1 | iex (sans outils MCP computer_*).

5) WIREGUARD wg1
aphrody infra wg driver install ; aphrody infra wg driver status
a. Si "$AH\wireguard\aphrody.key" existe : Get-Content "$AH\wireguard\aphrody.key" -Raw | aphrody infra wg pubkey → attendu EXfatxgVFs8Lr9k7QoJ2wiznY5MYO4C19+4gLbGmCEw=, puis d.
b. Sinon, dis à Omar : « Dans une AUTRE fenêtre PowerShell, colle la PrivateKey de ton tunnel (app WireGuard → tunnel → Modifier → ligne PrivateKey) : $k="$env:USERPROFILE\.aphrody\wireguard\aphrody.key"; New-Item -ItemType Directory -Force (Split-Path $k)|Out-Null; Read-Host "PrivateKey" | Set-Content -NoNewline $k » et attends sa confirmation, puis refais a. Ne lui demande JAMAIS de te la coller.
c. Clé perdue : aphrody infra wg keygen (--force seulement pour remplacer un aphrody.key erroné) ; la clé PUBLIQUE affichée va dans le rapport, le propriétaire met à jour le hub.
d. icacls "$AH\wireguard\aphrody.key" /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:F"
e. Arrête tout tunnel de l'app WireGuard vers 51.77.147.152:51821 sans le supprimer (Get-Service 'WireGuardTunnel$*' → Stop-Service, Set-Service -StartupType Disabled).
Test : aphrody infra --root $Repo wg up omar --detach ; Start-Sleep 5 ; aphrody infra --root $Repo wg show aphrody (handshake récent attendu) ; ping -n 3 10.200.77.1 ; ping -n 3 10.200.77.4
Puis rends la main à la tâche de l'étape 9 : aphrody infra --root $Repo wg down aphrody
Sans handshake : 40 dernières lignes de "$AH\wireguard\aphrody.log", UDP sortant 51821 bloqué par la box ?, clé publique correcte ? Continue quand même : le tunnel inverse couvre l'absence de handshake.

6) SECRETS LOCAUX (générés ici, jamais affichés)
$P = "$AH\private" ; New-Item -ItemType Directory -Force $P | Out-Null
function New-Tok($f) { if (Test-Path $f) { return } ; $b = New-Object byte[] 32 ; [Security.Cryptography.RandomNumberGenerator]::Fill($b) ; (-join ($b | ForEach-Object { $_.ToString('x2') })) | Set-Content -NoNewline $f ; icacls $f /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:F" | Out-Null }
New-Tok "$P\remote.token" ; New-Tok "$P\mcp.token"
"APHRODY_MCP_HTTP_TOKEN=$((Get-Content "$P\mcp.token" -Raw).Trim())" | Set-Content -NoNewline "$P\mcp-http.env" ; icacls "$P\mcp-http.env" /inheritance:r /grant:r "${env:USERNAME}:F" /grant:r "SYSTEM:F" | Out-Null
aphrody infra remote token status      # source de chaque secret, jamais la valeur (VNC : dérivé du jeton du bureau)

7) SSH WINDOWS (port 22)
$S = "$env:USERPROFILE\.ssh" ; New-Item -ItemType Directory -Force $S | Out-Null
if (-not (Test-Path "$S\id_ed25519")) { ssh-keygen --% -t ed25519 -f "%USERPROFILE%\.ssh\id_ed25519" -N "" -C omar@KyrioFox }
Get-Content "$S\id_ed25519.pub"        # ligne PUBLIQUE pour le rapport
if ((Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0).State -ne 'Installed') { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 }
Set-Service sshd -StartupType Automatic ; Start-Service sshd
$keys = @(
 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF+IwnaVjBqNuHwnId41Eug0Q76N0u2A8pkWqltPn+hP aphrody-dev@github',
 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM9fIsjABVye9MqLRBc2ddz2hKJdxNPQm22uzcDKrnkw aphrody-owner-pc',
 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICXbajabKOH0cOxwgHWtA3Y4cdT/ZTQcck4c3stty709 aphrody-vps-to-omar-pc')
$adm = [bool]((whoami /groups) -match 'S-1-5-32-544')
$f = if ($adm) { "$env:ProgramData\ssh\administrators_authorized_keys" } else { "$S\authorized_keys" }
$cur = @(if (Test-Path $f) { Get-Content $f }) ; $keys | Where-Object { $k = $_ ; -not ($cur | Where-Object { $_ -like "*$($k.Split(' ')[1])*" }) } | Add-Content -Encoding ascii $f
if ($adm) { icacls $f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null }
(Les lignes sans from= marchent aussi par le tunnel inverse, dont la source est 127.0.0.1.)
if (-not (Select-String -Quiet -Path "$S\config" -Pattern '^Host aphro-pc' -ErrorAction SilentlyContinue)) {
"Host vps`n  HostName 51.77.147.152`n  User omar`nHost vps-wg`n  HostName 10.200.77.1`n  User omar`nHost dbfr`n  HostName 10.200.77.3`n  User omar`nHost aphro-pc`n  HostName 10.200.77.4`n  User aphro`nHost vps vps-wg dbfr aphro-pc`n  IdentityFile ~/.ssh/id_ed25519`n  IdentitiesOnly yes`n  StrictHostKeyChecking accept-new`n  ServerAliveInterval 30" | Add-Content -Encoding ascii "$S\config" }

8) WSL UBUNTU (OpenSSH natif Linux, port 2222 ; WireGuard reste porté par Windows seul)
wsl --status ; wsl -l -v   # sans distribution : wsl --install -d Ubuntu --no-launch, puis wsl -d Ubuntu -u root -- true
Mode réseau mirrored : aphrody infra remote always-online (étape 9) l'écrit dans %USERPROFILE%\.wslconfig puis redémarre WSL.
wsl -d Ubuntu -u root -- sh -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server && printf 'Port 2222\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\n' > /etc/ssh/sshd_config.d/60-aphrody-wsl.conf && grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null || printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf"
$u = (wsl -d Ubuntu -- whoami).Trim()
wsl -d Ubuntu -- sh -c "install -d -m 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && tr -d '\r' < /mnt/c/ProgramData/ssh/administrators_authorized_keys | sed '/^#/d;/^$/d' >> ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys"
(Si $f de l'étape 7 était le authorized_keys utilisateur, remplace le chemin /mnt/c/ProgramData/ssh/administrators_authorized_keys par /mnt/c/Users/$env:USERNAME/.ssh/authorized_keys.)

9) TOUJOURS EN LIGNE (tâches \Aphrody\ relancées toutes les 5 min, veille coupée)
Unregister-ScheduledTask 'Aphrody Omar remote' -Confirm:$false -ErrorAction SilentlyContinue   # ancien garde-fou du 2026-10-08
aphrody infra --root $Repo remote always-online --dry-run
aphrody infra --root $Repo remote always-online
Il crée : Aphrody WG omar (démarrage, SYSTEM), Aphrody Remote Desktop (8795 + VNC 5900), Aphrody MCP HTTP (127.0.0.1:8793 + portproxy 10.200.77.10:8793), Aphrody omar reverse (tunnel inverse, clé ~/.ssh/id_ed25519), Aphrody WSL sshd (2222). Le tunnel inverse ne marche qu'une fois la clé publique d'Omar installée par le propriétaire : il réessaie seul toutes les 5 min.

10) VÉRIFICATION (attends 60 s après l'étape 9)
Get-ScheduledTask -TaskPath \Aphrody\ | Get-ScheduledTaskInfo | Format-Table TaskName,LastTaskResult,LastRunTime
aphrody infra --root $Repo wg show aphrody ; ping -n 3 10.200.77.1 ; ping -n 3 10.200.77.4
Get-NetTCPConnection -State Listen -LocalPort 22,2222,5900,8793,8795 -ErrorAction SilentlyContinue | Format-Table LocalAddress,LocalPort
Invoke-RestMethod http://10.200.77.10:8795/healthz ; Invoke-RestMethod http://127.0.0.1:8793/healthz ; Invoke-RestMethod http://10.200.77.10:8793/healthz
ssh -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$u@127.0.0.1" whoami
ssh -o BatchMode=yes vps whoami ; ssh -o BatchMode=yes aphro-pc whoami   # marchent après installation de la clé d'Omar par le propriétaire
bun "$Repo\packages\engine\core\src\host\cli.ts" net-env --member omar --probe --write
Journaux (sans secret) : "$AH\logs\wg.log", "$AH\wireguard\aphrody.log".

11) RAPPORT FINAL (Omar le poste en DM au propriétaire ou dans #admin-console ; AUCUN secret)
- bun --version ; aphrody --version ; git -C $Repo rev-parse --short HEAD ; git -C $BunRepo rev-parse --short HEAD ; méthode (source ou release)
- clé publique WireGuard (confirmée ou nouvelle) ; sortie de wg show (clés publiques seulement) ; ping 10.200.77.1 et 10.200.77.4
- ligne publique ~/.ssh/id_ed25519.pub ; nom d'utilisateur Windows ($env:USERNAME) et WSL ($u) ; admin=$adm
- ports en écoute, healthz, état des tâches \Aphrody\, ligne NET_STATUS_UP de net-env
- jetons remote.token / mcp.token remis hors bande : oui/non (jamais leur valeur)
- ce qui a échoué, pourquoi, et ce qui reste à faire côté Omar ou côté propriétaire

ROLLBACK (seulement si demandé)
Get-ScheduledTask -TaskPath \Aphrody\ | Unregister-ScheduledTask -Confirm:$false ; aphrody infra --root $Repo wg down aphrody
Get-Process aphrody, aphrody-mcp -ErrorAction SilentlyContinue | Stop-Process -Force ; netsh interface portproxy delete v4tov4 listenaddress=10.200.77.10 listenport=8793
Stop-Service sshd ; Set-Service sshd -StartupType Disabled
```
