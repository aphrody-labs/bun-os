<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hub A2A et MCP persistants sur le VPS (2026-10-09)

Remplace le relais Codex provisoire du 2026-10-09 (tmux `codex-relay-*`, tunnel
`tunnel.ps1`, ports 23888/23889 pilotés à la main), supprimé de Windows et du VPS.
Il n'existe plus qu'un hub A2A et un MCP HTTP, sur le VPS ; Windows s'y connecte par
un tunnel SSH supervisé. Aucun A2A local ne tourne sur Windows ni sur dbfr.

## Topologie

| Rôle | VPS (loopback) | Windows (loopback, via tunnel) | Unité |
| --- | --- | --- | --- |
| Hub A2A | `127.0.0.1:23888` | `127.0.0.1:24888` | `aphrody-a2a.service` (systemd utilisateur, `Restart=always`) |
| MCP HTTP | `127.0.0.1:23889` | `127.0.0.1:24889` | `aphrody-mcp-http.service` (idem) |
| Tunnel | | `aphrody infra ssh tunnel` | tâche planifiée `\Aphrody\Native\hub-tunnel` |
| Synchronisation | | | `aphrody-sync.timer` (VPS) |

Le catalogue du tunnel est `tools/config/hub-tunnel-catalog.json` (décalage 1000) ;
le lanceur est `tools/config/hub-tunnel.cmd`. La tâche a deux déclencheurs : ouverture
de session et répétition chaque minute (`MultipleInstances=IgnoreNew`). Le tunnel
quitte avec le code 0 : la répétition, et non le redémarrage sur échec, le relance.

Le MCP 8793 de dbfr (`aphrody-mcp-http-dbfr`, RAG des débats Discord) reste. L'ancien A2A 8788 de dbfr est retiré.

## Jetons

- Hub A2A : `~/.aphrody/private/a2a/bearer` (VPS) et
  `%USERPROFILE%\.aphrody\private\a2a-hub.token` (Windows), même valeur, ACL
  restreintes. Variables clientes : `APHRODY_A2A_HUB_URL`, `APHRODY_A2A_TOKEN_FILE`,
  `APHRODY_HOST_ID`, `APHRODY_A2A_PEER_ID` (par agent).
- MCP HTTP : `~/.aphrody/private/mcp/mcp-http.env` (`APHRODY_MCP_HTTP_TOKEN`).
Aucun jeton n'est dans un dépôt, une unité ou une ligne de commande.

## Commandes

```sh
aphrody a2a peers                         # pairs enregistrés de tous les hôtes (présence 180 s)
aphrody a2a send "texte" --target codex-vps   # message vers un pair
aphrody a2a inbox [--ack] [--all]         # boîte du pair courant
aphrody a2a register                      # annonce explicite de présence
```

Avec `APHRODY_A2A_HUB_URL` défini, chaque commande hub enregistre aussi la présence
du pair courant. Le serveur stocke un fichier atomique par pair sous
`<coord-dir>/peers` (`GET`/`POST /peers`, bearer obligatoire).

## Déploiement continu du VPS

`aphrody-sync.timer` (2 min après le boot puis 5 min après chaque fin) lance
`~/.local/bin/aphrody-sync` : `git fetch` du checkout unique, passe si arbre sale,
branche différente de `main` ou non fast-forward ; sinon `cargo build --release -p
aphrody --locked` sous `nice`/`ionice` et `flock` du verrou de build, installation
atomique de `aphrody` dans `~/.local/bin`, liens `aphrody-mcp`, `aphrody-infra`,
`aphrody-kernel` vers ce binaire, redémarrage des deux unités. L'état est
`~/.aphrody/deploy/state.json` (`sha`, `status`, `at`).

## Reprise

- Unité tuée (`kill -9`) : `Restart=always`, retour en 2 s.
- Tunnel coupé : la répétition de la tâche le relance en moins d'une minute
  (mesuré : 24888 et 24889 revenus en 53 s, deux fois).
- Redémarrage du VPS : unités utilisateur avec `linger`.
- Une tâche de code interrompue par un redémarrage n'est jamais rejouée
  automatiquement.
