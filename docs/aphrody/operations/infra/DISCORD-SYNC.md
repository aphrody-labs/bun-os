<!-- SPDX-License-Identifier: Apache-2.0 -->

# Synchronisation propriétaire <-> Omar sur Discord (2026-10-09)

Le serveur Discord Aphrody porte désormais l'état partagé, les événements, les demandes, les rapports et les accords
entre le propriétaire (`aphrody-dev`, PC APHRODY `10.200.77.4`) et Omar (`KyrioFox`, PC `10.200.77.10`), sans fichier
`.coord`, sans minuterie ad hoc ni DM manuel. Cartographie en lecture seule via l'API le 2026-10-09 (aucun identifiant
de jeton ici, aucun contenu de DM). Contexte : [OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md),
[PRIVATE-TUNNEL.md](PRIVATE-TUNNEL.md), [équipe et hôtes](../workspace/team-and-hosts.md).

## 1. Cartographie du serveur (avant la mise en place)

Guilde `1554189180030947338` « Aphrody · AI Lab », propriétaire `goku_duo` (281114294152724491), 4 membres, aucun webhook,
1 intégration (bot Aphrody), niveau de vérification 0.

| Rôle                         | Droits                              | Remarques                                                                      |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `@everyone`                  | aucun                               | n'a accès à aucun salon (VIEW_CHANNEL refusé dans chaque catégorie)            |
| `Aphrody` (géré, bot)        | administrateur                      | bot Aphrody `1544463751279812740`                                              |
| `Aphrody Administrator`      | administrateur                      | porté par `goku_duo` et `omlar_` : les deux voient et peuvent tout             |
| `AI Researcher`              | droits de lecture/écriture standard | aucun membre ; voit `start-here` et `chat`                                     |
| `Server Booster` (géré)      | aucun                               | `goku_duo`                                                                     |

| Catégorie / salon                                                                | Visible par                               | Contenu constaté                                                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `01 · Accueil` / `#start-here` `1557354118710829117`                             | bot, Aphrody Administrator, AI Researcher | 1 message épinglé (START-HERE) ; rapports de workers Codex du 2026-10-08 (bot)                                     |
| `02 · Tunnel et hôtes` / `#tunnel-omar` `1557354144149405806` (ex admin-console) | bot, Aphrody Administrator                | paquets de mise en place d'Omar, prompts Codex, consignes tunnel/SSH/toujours en ligne, échanges propriétaire-Omar |
| `02` / `#ops-alerts` `1557354148637315212`                                       | bot, Aphrody Administrator                | rapports « WireGuard, connexions vérifiées » toutes les 10 min jusqu'au 2026-10-09 11:26 (producteur arrêté)       |
| `02` / `#chat` `1557358568523571225`                                             | bot, Aphrody Administrator, AI Researcher | hub A2A, 2 messages du 2026-10-07                                                                                  |
| DM bot <-> Omar `1557348890347573279`                                            | les deux                                  | consentement et prompt Codex (contenu non reproduit)                                                               |

Aucun droit existant n'a été modifié. Fait à signaler : le rôle `Aphrody Administrator` donne à Omar les droits
d'administration de tout le serveur (pas seulement du tunnel) ; le garder ou le restreindre est une décision du
propriétaire.

## 2. Salons créés

Catégorie `03 · Synchronisation` (droits recopiés de `02 · Tunnel et hôtes` : bot et `Aphrody Administrator`
seulement, `@everyone` refusé, donc visible du propriétaire, d'Omar et des bots d'administration).

| Salon              | Rôle                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#sync-etat`       | un message d'état épinglé, édité en place chaque minute (membres, IP publiques, handshakes, ports SSH/VNC/bureau/MCP, conteneurs, unités en échec, accords en attente)                                                               |
| `#sync-evenements` | événements automatiques : `member.online/offline`, `service.up/down`, `container.started/stopped/unhealthy/healthy`, `task.failed/recovered`, `report.received`, `message.received` (Omar, métadonnées seules), `agreement.complete` |
| `#sync-demandes`   | demandes, prompts, rapports, accords ; ✅ pour accuser réception                                                                                                                                                                     |

Identifiants et paramètres (non secrets) : `tools/config/host/discord-sync.json`. Les salons sont retrouvés par nom
(idempotent) ; ne pas recréer ceux supprimés par la directive du 2026-10-09.

## 3. Convention de messages

```text
APHRODY-SYNC/1 <kind> <type>
Texte court en français
{"v":1,"kind":"event","type":"member.online","id":"…","at":"…","from":"…","to":["omar"],"needsAck":true,"ref":"…","data":{…}}
```

Le JSON compact est dans un bloc de code `json` (3 accents graves). `kind` : `state`, `event`, `request`, `report`,
`agreement`, `ack`. Messages d'au plus 1900 caractères, jamais de secret (jeton, clé, mot de passe VNC).

- `request` / `agreement` avec `"needsAck":true` dans `#sync-demandes` : le bot ajoute ✅ ; chaque destinataire (`to`,
  par défaut l'autre humain) réagit ; le bot répond par un message `ack` (`ref` = identifiant de la demande) et, quand
  tous ont répondu, publie `agreement.complete` et consigne `agreements/<id>.json` dans l'état.
- `report` écrit par Omar (ou son Codex) dans `#sync-demandes`, `#tunnel-omar` ou le DM : déposé dans `inbox/<message>.json`
  et annoncé par `report.received`. Les autres messages d'Omar produisent `message.received` (lien, taille, pièces jointes).
- Lecture par A2A/Codex : `cli.ts read <etat|evenements|demandes> [--kind K] [--after ID] [--limit N]` (JSONL).
- Écriture : `cli.ts post <salon> --kind K --type T --text "…" [--json '{…}'] [--to omar] [--from owner] [--ack]` ;
  avec `--outbox`, dépôt dans `outbox/` publié au prochain passage (producteurs sans jeton Discord).

## 4. Mécanisme sur le vps

- Code : `scripts/tools/infra/discord-sync/` (`protocol.ts`, `collect.ts`, `sync.ts`, `api.ts`, `cli.ts`, tests
  `discord-sync.test.ts`), déployé par `scripts/tools/infra/discord-sync/install.sh [--plan] [hôte]` dans
  `~/apps/discord-sync` (root, lecture seule).
- Unités du catalogue : `aphrody-discord-sync.service` (oneshot, `User=ubuntu`, `EnvironmentFile=/etc/aphrody-discord.env`,
  `StateDirectory=aphrody-discord-sync`, `CAP_NET_ADMIN` seulement pour `wg show`, `ProtectSystem=strict`) et
  `aphrody-discord-sync.timer` (45 s après le démarrage, puis chaque minute). Journaux : `journalctl -u aphrody-discord-sync`.
- Sources de l'état : `wg show wg1` (sous-commandes sans clé privée), sondes TCP des membres (22, 5900, 8795, 8793),
  tunnel inverse d'Omar (`127.0.0.1:22010`), faits Linux du vps et de dbfr (SSH), bloc `NET_LIVE_*` du PC propriétaire
  poussé par `net-env --push vps` (tâche `\Aphrody\Net Env Probe`, uniquement les lignes `NET_LIVE_*`, vers
  `/var/lib/aphrody-discord-sync/net-live.env`). Les conteneurs de build éphémères (`yolo-rel-*`) sont ignorés.
- Omar est « en ligne » si son handshake wg1 date de moins de 180 s ou si son tunnel inverse écoute ; « hors ligne »
  n'est publié qu'après 2 mesures consécutives.
- Un verrou (`tick.lock`) empêche deux passages simultanés ; en cas d'échec Discord, l'état d'avant est conservé et
  les événements sont recalculés au passage suivant ; message d'état supprimé : recréé et épinglé.
- Retirés (qualifiés ci-dessous) : `aphrody-omar-watch` (timer, service, `/usr/local/libexec/aphrody-omar-watch`,
  état), `~/.aphrody/discord-watch.py` et ses curseurs, ainsi que les unités `aphrody-drive-sync.{service,timer}`
  retirées par la directive du 2026-10-09 mais restées actives (échec en boucle relevé par la synchronisation).

## 5. Preuves (2026-10-09, vps)

- Tests : `bun test scripts/tools/infra/discord-sync` 20 passent, oxlint et oxfmt propres, `tsc --noEmit` propre.
- Salons créés et droits identiques à la catégorie 02 ; message d'état créé, épinglé (message système d'épinglage
  retiré), puis édité en place à chaque passage (`"status":"edited"`).
- Événement Omar simulé depuis les données wg (`--fixture`, handshake de 9999 s) : `member.offline` publié au 2e passage,
  `member.online` au passage suivant ; événements `container.*` et `task.failed/recovered` observés en réel.
- Demande à accusé : enregistrée en attente, ✅ du bot posé, suppression du message : entrée purgée au passage suivant.
  Dépôt sortant publié puis supprimé. Reprise : `systemctl restart aphrody-discord-sync.timer`, passage suivant sans
  état de référence (`"baseline":false`). Messages de test supprimés ; seul le message d'état épinglé subsiste.
- Non testé en réel : ✅ d'un humain (aucune session humaine disponible ; couvert par test avec faux Discord) et
  rapport structuré posté par Omar.

## 6. Reste à faire

- Omar : réagir ✅ aux demandes qui lui sont adressées ; poster ses rapports Codex en messages `APHRODY-SYNC/1 report`.
- Propriétaire : décider du rôle `Aphrody Administrator` d'Omar (section 1) ; côté Codex/A2A, consommer `cli.ts read`
  plutôt que `.coord` pour les échanges avec Omar.
- Les unités `aphrody-discord-control-plane` et `aphrody-discord-lab-telemetry` (retirées, désactivées) existent encore
  sur le vps ; hors périmètre ici.

## Fiche factuelle (#sync-fiche)

`#sync-fiche` porte un message épinglé avec le fichier `fiche-aphro-omar.md` : réseau en direct (wg1, SSH, VNC, ports,
conteneurs, adresses publiques), inventaire WireGuard (clés publiques), variables d'Omar, alias SSH, état de boot, tâches
planifiées du PC propriétaire et liste « Ce qu'Omar doit compléter » cochée d'après les sondes. Le PC propriétaire
génère la fiche chaque minute (`net-env --fiche vps`, tâche `Net Env Probe`) et la dépose sur le vps ; le tick la fusionne
avec la partie déclarée par Omar (rapport `APHRODY-SYNC/1 report fiche`, champs libres : nom d'utilisateur, ports, services,
tâches de boot), édite le message seulement si le contenu change et écrit `fiche-merged.md`, relue par le PC puis recopiée dans
le bloc `fiche-auto-sync` du fichier mémoire. Aucun secret : lignes `private|preshared|password|secret|token=` retirées.
