<!-- SPDX-License-Identifier: Apache-2.0 -->
# Équipe et contexte opérationnel

Contexte opérationnel du 2026-10-09 ; vérifier les observations datées avant usage.
Les règles sont dans [AGENTS.md](../../AGENTS.md), les contrats dans
[PLAN.md](../../PLAN.md) et les preuves dans [MEMORY.md](../../MEMORY.md).
Les choix de développement/build suivent le [contexte](windows-native.md).

## 1. Équipe et identités
| Qui | GitHub | Discord | Rôle |
|---|---|---|---|
| Propriétaire (yoyo) | `aphrody-dev` | `goku_duo` 281114294152724491 | Yoyo : propriétaire, admin de tout Aphrody Labs |
| Omar | `KyrioFox` (confirmé par le propriétaire 2026-10-08) | `omlar_` 1527405876695142620 | admin DBFR ; les accès techniques existants ne définissent pas une autorité globale |
| Bot Aphrody | — | `Aphrody` 1544463751279812740 | ops, annonces |

Org GitHub `aphrody-labs` (3 membres, dépôts privés, lecture par défaut). Salon admin : `#admin-console` 1557354144149405806.

## 5. Hôtes et tunnel privé wg1 (10.200.77.0/24)
| Hôte | IP wg1 | Accès | Notes |
|---|---|---|---|
| vps (hub) | 10.200.77.1 | `ssh vps` (ubuntu) | endpoint public 51.77.147.152:51821, `wg-quick@wg1`, fabrique de build, llama-server 8798/8799, bots Discord, downloads |
| ancien wsl | 10.200.77.2 | — | allocation historique, aucun workflow de développement |
| dbfr | 10.200.77.3 | `ssh dbfr` (ubuntu) | prod, `wg-quick@wg1` |
| aphro-pc (Windows, propriétaire) | 10.200.77.4 | — | tunnel natif Aphrody (tâche `\Aphrody\Aphrody WG aphro-pc`), MCP HTTP 127.0.0.1:8793 |
| omar (Windows) | 10.200.77.10 | — | installation en cours via son Codex |

- WireGuard est natif Rust dans `aphrody infra wg` (`plan|up|down|show|render|syncconf|keygen|pubkey|driver install`). Linux : noyau/boringtun ; Windows : WireGuardNT 1.1 vérifié sha256. Inventaire : `tools/config/host/wireguard/aphrody-tunnel.json`.
- Clés privées : restent sur leur hôte (`~/.aphrody/wireguard/aphrody.key`, ACL restreinte). Seules les clés publiques circulent.
- SSH mesh (en cours) : compte `omar` sur vps/dbfr (sudo NOPASSWD journalisé), OpenSSH Server Windows joignable uniquement depuis 10.200.77.0/24.

## 6. Contrôle à distance (computer use / bureau à distance)
- `aphrody infra remote serve --bind <ip-wg1>:8795` : bureau à distance JPEG/WebSocket + visionneuse navigateur, jeton `APHRODY_REMOTE_TOKEN`.
- `aphrody-mcp http` sur 8793 (bearer `APHRODY_MCP_HTTP_TOKEN`) ; build Windows avec `--features aphrody-mcp/winclean` pour les outils `computer_*`. Côté client : `RemoteComputerBackend` (session MCP stateful, `APHRODY_REMOTE_MCP_TOKEN`).
- Pare-feu : ports 8795/8793 (et 5900 VNC) ouverts **uniquement** depuis 10.200.77.4.
- En cours : unification computer use + VNC (`rustvncserver` serveur, `vnc-rs` client) + wg + remote + winclean + shell en un modèle de cible unique ; RDP (IronRDP) plus tard. RustDesk interdit (AGPL).

## 7. Build et release
- `cargo build --release --locked -p aphrody -p aphrody-mcp --features aphrody-mcp/winclean` produit le binaire complet Windows.
- Release publique : `bun run downloads:publish plan|build|release|verify --revision <sha>` → https://downloads.aphrody.com (`latest.json`). La release publiée au 2026-10-08 (5bf7eed5a) n'a pas encore `wg`/`remote` : nouvelle release en cours.
- Conteneur de build unique en cours dans `tools/config/container/`.

## 8. En cours (2026-10-08) — ne pas dupliquer, coordonner
- Omar : tunnel + remote + MCP + SSH sur son PC (prompt Codex en 8 blocs + étape 12 dans `#admin-console`), jetons à remettre hors Discord.
- Unification remote/VNC, conteneur de build, release downloads, SSH mesh : agents actifs, voir `git log` et `.coord/claims` avant de toucher `crates/infra/{remote-desktop,wireguard}`, `crates/ai/agent-tools`, `tools/config/container`.
- Sécurité à traiter : routes REST hors `/mcp` non authentifiées ; secret Discord possiblement exposé dans `#admin-console` (19:44, à révoquer).

## 9. Rapport attendu de chaque agent
Fait / non fait / bloqué, commits (sha), gates exécutés et leurs résultats, ce qui n'est pas testé en réel. Jamais de secret dans un rapport.
