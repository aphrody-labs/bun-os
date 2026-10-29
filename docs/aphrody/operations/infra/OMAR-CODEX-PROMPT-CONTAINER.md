> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Prompt Codex d'Omar : conteneur Aphrody, tunnels A2A et MCP, boot (2026-10-09)

Complète [OMAR-CODEX-PROMPT.md](OMAR-CODEX-PROMPT.md) (WireGuard, SSH, tâches toujours en ligne) et s'appuie sur
l'accord n°2 signé par Omar le 2026-10-09T13:29Z. À coller en un seul message dans Codex lancé en PowerShell 7
natif Windows (pas WSL) : `codex --sandbox danger-full-access --ask-for-approval never`.

```text
MISSION (Codex, PC Windows d'Omar, PowerShell 7 natif, pas WSL).
Mets à jour le fork Bun d'Aphrody et Aphrody, installe le conteneur Aphrody à jour comme service Windows, crée les tunnels A2A et MCP vers le hub (vps), et rends tout persistant au démarrage. Exécute chaque étape 1 à 8 toi-même, de bout en bout, sans demander de confirmation ; ne t'arrête que sur un vrai blocage, en disant lequel. Termine par le rapport (étape 9). Les étapes déjà faites (« déjà installé », tâche existante) ne sont pas des erreurs : vérifie et continue.

PORTÉE (accord n°2, signé par Omar) : composants Aphrody, conteneur, tâches \Aphrody\*, WireGuard wg1, OpenSSH, bureau/VNC/MCP Aphrody, outils de build. Hors portée : documents, comptes, mots de passe et sessions personnels d'Omar ; désactiver ses protections ; installer autre chose. Il révoque quand il veut.

RÈGLES DE SÉCURITÉ (absolues)
- Ne lis, n'affiche, ne journalise, ne copie jamais une clé privée, un jeton ou un mot de passe (*.key, *.token, *.env, id_ed25519 sans .pub). Les jetons sont générés localement et restent dans $AH\private.
- Rien de secret dans Discord, un commit, un journal ou le rapport. Les jetons du hub (A2A, MCP) sont remis à Omar hors bande par le propriétaire ; si absents, note-le dans le rapport et continue.
- Ne réactive ni Defender ni le pare-feu (désactivés exprès sur les PC de dev).
- Commits éventuels : identité git d'Omar, branche omar/<sujet>, jamais main.

FAITS
- Hub vps : SSH omar@51.77.147.152 ; A2A 127.0.0.1:23888 et MCP HTTP 127.0.0.1:23889 sur le vps (jeton bearer, protégés). wg1 : hub 10.200.77.1, Omar 10.200.77.10, owner 10.200.77.4.
- Tunnels autorisés par le hub pour la clé d'Omar : inverses (-R) 28788 (A2A d'Omar), 28999 (MCP du conteneur), 28793 (MCP HTTP), 28795, 25900, 22010, 22011 ; directs (-L) uniquement 23888 et 23889 du loopback du vps.
- Ports locaux sur le PC d'Omar : A2A 8788, conteneur Aphrody 8999 (loopback), MCP HTTP 8793.
- Variables (redéfinis-les à chaque session) : $Repo = "C:\src\aphrody" ; $AH = "$env:USERPROFILE\.aphrody" ; $P = "$AH\private" ; $Bin = "$env:LOCALAPPDATA\Aphrody\bin"

1) FORK BUN À JOUR (jamais bun.sh ni winget Oven-sh.Bun)
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/aphrody-labs/bun/main/scripts/aphrody/install.ps1'))) -Version 1.4.3
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path" ; bun --version     # attendu : 1.4.3-aphrody.3 ou plus récent
if (Test-Path "C:\bun") { git -C C:\bun pull --ff-only } ; [Environment]::SetEnvironmentVariable('APHRODY_BUN_CHECKOUT','C:\bun','User')

2) APHRODY À JOUR (binaire de la release vérifié par SHA-256 ; si le téléchargement coupe, relance : le serveur coupe parfois les flux HTTP/2)
irm https://downloads.aphrody.com/install.ps1 | iex
$env:Path = "$Bin;$env:Path" ; aphrody --version ; aphrody-mcp http --help | Select-Object -First 3
Dépôt (privé : le compte GitHub d'Omar doit y avoir accès ; 403/404 = blocage à signaler) :
if (Test-Path $Repo) { git -C $Repo pull --ff-only } else { New-Item -ItemType Directory -Force C:\src | Out-Null ; git clone --filter=blob:none https://github.com/aphrody-labs/aphrody.git $Repo }
git -C $Repo log --oneline -1 ; Test-Path "$Repo\scripts\install\container-service.ts"     # True attendu

3) DOCKER DESKTOP ET IMAGE APHRODY
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements --disable-interactivity     # « déjà installé » est normal
Démarre-le si besoin : Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" -WindowStyle Hidden ; attends jusqu'à 5 min que `docker info` réussisse.
Réglages Docker Desktop : démarrage automatique à l'ouverture de session activé ; mémoire 8 Go minimum si le PC a 16 Go ou plus ; moteur Linux.
Construis l'image à jour (elle n'embarque que les binaires vérifiés de la release, aucun secret) :
Set-Location $Repo ; docker build -f tools/config/container/Dockerfile --target runtime -t aphrody:runtime .
En échec réseau (curl 92), relance la même commande : les couches déjà faites sont réutilisées. Contrôle : docker run --rm aphrody:runtime aphrody --version

4) SERVICE CONTENEUR (sans élévation, tâche interactive sans fenêtre, à l'ouverture de session)
[Environment]::SetEnvironmentVariable('APHRODY_PC','omar','User') ; $env:APHRODY_PC = 'omar'
Set-Location $Repo ; aphrody infra boot apply --host local --entry Container     # tâche cachée \Aphrody\Container (bun scripts/install/container-service.ts)
Start-ScheduledTask -TaskPath '\Aphrody\' -TaskName Container ; Start-Sleep 40
docker ps --format '{{.Names}} {{.Status}}' | Select-String aphrody-pc ; Invoke-RestMethod http://127.0.0.1:8999/healthz
Le jeton du conteneur est généré dans $P\aphrody_mcp_http_token (ne l'affiche pas ; un jeton de l'ancien script dans $HOME\.aphrodyprivate y est déplacé).

5) A2A LOCAL (serveur A2A d'Omar, tâche au démarrage)
Génère $P\a2a.token s'il n'existe pas (32 octets aléatoires en hexadécimal, icacls : lui + SYSTEM seulement), comme à l'étape 6 de OMAR-CODEX-PROMPT.md.
Crée la tâche \Aphrody\ « Aphrody A2A omar » : exécute `aphrody a2a serve --bind 127.0.0.1:8788 --coord-dir "$AH\coord"` avec APHRODY_A2A_COORD_TOKEN lu depuis $P\a2a.token, déclencheur à l'ouverture de session, relance chaque minute en cas d'échec (5 fois), durée illimitée, cachée (action `conhost.exe --headless "<programme>" <arguments>`, principal Interactive (toi), Settings.Hidden, comme `aphrody infra boot` (docs/operations/infra/BOOT.md)).
Contrôle : Invoke-RestMethod http://127.0.0.1:8788/ping

6) TUNNELS A2A ET MCP VERS LE HUB (une seule tâche persistante)
Clé : ~/.ssh/id_ed25519 (étape 7 de OMAR-CODEX-PROMPT.md ; sa clé PUBLIQUE doit être installée sur le hub par le propriétaire : tant que ce n'est pas fait, la tâche réessaie seule).
Commande de la tâche \Aphrody\ « Aphrody Omar tunnel » (ouverture de session + relance chaque minute, cachée, durée illimitée) :
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$env:USERPROFILE\.ssh\id_ed25519" -R 127.0.0.1:28788:127.0.0.1:8788 -R 127.0.0.1:28999:127.0.0.1:8999 -R 127.0.0.1:28793:127.0.0.1:8793 -L 127.0.0.1:24888:127.0.0.1:23888 -L 127.0.0.1:24889:127.0.0.1:23889 omar@51.77.147.152
Variante par wg1 si le handshake est établi : même commande avec omar@10.200.77.1.
Variables utilisateur : APHRODY_A2A_HUB_URL=http://127.0.0.1:24888 ; APHRODY_MCP_HUB_URL=http://127.0.0.1:24889 (jetons du hub dans $P\hub-a2a.token et $P\hub-mcp.token, remis par le propriétaire hors bande, jamais en variable).
Contrôle : Get-NetTCPConnection -State Listen -LocalPort 24888,24889 ; aphrody a2a register ; aphrody a2a peers

7) DÉMARRAGE (boot) : tout doit revenir seul après redémarrage
Get-ScheduledTask -TaskPath '\Aphrody\' | Get-ScheduledTaskInfo | Format-Table TaskName,LastTaskResult,LastRunTime
Attendus : Container, Aphrody A2A omar, Aphrody Omar tunnel, et celles de OMAR-CODEX-PROMPT.md (WG, Remote Desktop, MCP HTTP, reverse). Docker Desktop démarre à l'ouverture de session (réglage de l'étape 3). Les tâches interactives attendent l'ouverture de session d'Omar : dis-le dans le rapport. Ne redémarre pas le PC sans qu'Omar le demande.

8) VÉRIFICATION
docker ps ; Invoke-RestMethod http://127.0.0.1:8999/healthz ; Invoke-RestMethod http://127.0.0.1:8788/ping
ssh -o BatchMode=yes omar@51.77.147.152 "curl -s -m 5 http://127.0.0.1:28788/ping; curl -s -m 5 http://127.0.0.1:28999/healthz"     # voit tes ports depuis le hub

9) RAPPORT FINAL (Omar le poste en DM au propriétaire ou dans #admin-console ; AUCUN secret)
- bun --version ; aphrody --version ; docker --version ; git -C $Repo rev-parse --short HEAD ; docker image inspect aphrody:runtime --format '{{.Created}}'
- état du conteneur aphrody-pc (healthy ?), des tâches \Aphrody\, ports en écoute (8788, 8999, 8793, 24888, 24889)
- clé publique ~/.ssh/id_ed25519.pub et nom d'utilisateur Windows ($env:USERNAME), si pas encore communiqués
- jetons du hub reçus : oui/non (jamais leur valeur)
- ce qui a échoué, pourquoi, ce qui reste à faire côté Omar ou côté propriétaire

ROLLBACK (seulement si demandé)
Unregister-ScheduledTask -TaskPath '\Aphrody\' -TaskName Container -Confirm:$false ; Unregister-ScheduledTask -TaskPath '\Aphrody\' -TaskName 'Aphrody A2A omar','Aphrody Omar tunnel' -Confirm:$false ; docker rm -f aphrody-pc
```
