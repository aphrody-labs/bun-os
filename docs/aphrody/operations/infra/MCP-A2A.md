<!-- SPDX-License-Identifier: Apache-2.0 -->

# MCP et A2A persistants sur le VPS

> **Mise à jour 2026-10-09 : ce qui suit décrit l'ancienne topologie système (ports 8788/8793, `/home/ubuntu/apps/aphrody/shared`).**
> Elle est remplacée par un hub unique en unités utilisateur sur le VPS : A2A `127.0.0.1:23888`, MCP HTTP
> `127.0.0.1:23889`, tunnel Windows 24888/24889, présence des pairs (`aphrody a2a peers|send|inbox|register`) et
> déploiement par `aphrody-sync.timer`. Voir [le hub](../workspace/codex-vps-relay-2026-10-09.md). L'A2A de dbfr
> est retiré ; le MCP 8793 de dbfr ne sert que le RAG des débats Discord.

État **déployé et vérifié au 2026-10-07** : les deux services système privés sur
`vps` sont actifs et activés au démarrage, indépendants des terminaux et des
sessions MCP clientes. Le serveur MCP canonique expose **364 outils uniques** en
HTTP authentifié et en stdio distant. Une tâche Codex réelle a terminé après la
fermeture du client. Les preuves ci-dessous décrivent cet artefact ; les limites
de flotte et les observations historiques du 2026-10-06 restent explicites.

| Unité                      | Commande canonique                                                              | Écoute locale                                                                        | État persistant             |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `aphrody-a2a.service`      | `aphrody a2a serve --bind 127.0.0.1:8788 --coord-dir /home/ubuntu/apps/aphrody/shared/coord` | `127.0.0.1:8788` ; carte d'agent, `/ping`, JSON-RPC, REST, SSE et boîtes de messages | `/home/ubuntu/apps/aphrody/shared/coord` |
| `aphrody-mcp-http.service` | `aphrody-mcp http --bind 127.0.0.1:8793`                                        | `127.0.0.1:8793` ; `/mcp`, `/healthz`, `/api/v1/*`                                   | `/home/ubuntu/.aphrody`     |

Le port **8793** évite le port 8789 réservé au tunnel de calcul WSL. Les unités
restent sur loopback, sans publication nginx. `aphrody-mcp` est le serveur MCP
canonique ; aucune configuration cliente nouvelle n'utilise les anciens alias
`aphrody-mcp`.

Les sources de référence sont les [unités et leur catalogue](../../../../infra/config/host/catalog.json),
la [déclaration de flotte](../../../../infra/config/host/agent-fleet.json), le
[plan d'installation Infra](../../../../packages/yolo-core/src/host/plan.ts) et le
[contrat A2A natif](../../../../crates/aphrody-a2a-coord/README.md).

## Exécution et état durable

Les services A2A et MCP HTTP travaillent dans le checkout privé dédié
`/home/ubuntu/apps/aphrody/shared/agent-workspaces/aphrody`, sur `main`. Ils ne travaillent pas dans
le checkout de compilation `/home/ubuntu/build/wsl/aphrody` : celui-ci
sert uniquement de source pour créer le checkout initial. Le plan qualifie la
révision Git du dépôt qui produit le plan, clone sans objets partagés et configure
l'origin privé déclaré. Il préserve le travail d'un checkout existant ; aucun
reset n'est utilisé pour le mettre à jour.

Ce `WorkingDirectory` est aussi nécessaire à la découverte du tool host M3 dans
le build installé : hors du checkout, l'absence de source M3 détectée empêchait
son enregistrement, même avec `APHRODY_M3_TOOL_HOST` configuré. Le wrapper stdio
applique le même cwd ; les deux transports exposent ainsi le même catalogue.

Le fournisseur de l'unité est `codex`, choisi par
`APHRODY_A2A_DEFAULT_PEER=codex`. `CODEX_BIN` vise l'installation native existante
sous `/home/ubuntu/.codex/packages/standalone/current/bin/codex`. L'unité retire
`APHRODY_A2A_DRY_RUN` et `A2A_SOCKET` de son environnement final afin de lancer les
tâches natives. Un nom de fournisseur invalide fait échouer le démarrage. La
disponibilité de Codex et de son authentification doit être vérifiée sur l'hôte ;
le choix d'un fournisseur ne crée aucune authentification.

Le profil sélectionné est `/home/ubuntu/.aphrody/workspaces/aphrody`. Le plan le
crée en mode 0700 et ne copie `AGENTS.md` que si ce fichier est absent. Les autres
documents de home et l'authentification existante restent dans leurs magasins
protégés. Les profils `dbfr` et `ie` conservent leur isolation.

`--coord-dir` est l'unique racine de stockage du listener, y compris pour les
routes historiques. Deux stores natifs y ont des contrats distincts :

| Store                          | Chemin sous `/home/ubuntu/apps/aphrody/shared/coord`              | Usage                                                                            |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `FsTaskStore` du protocole A2A | `a2a/tasks/`                                         | Tâches JSON-RPC/REST, statuts et résultats relus après reconstruction du serveur |
| API de coordination par agent  | `agents/<agent>/tasks/` et `agents/<agent>/mailbox/` | CRUD `/coord/<agent>/tasks` et enveloppes `/coord/<agent>/envelopes`             |

La tâche de protocole s'exécute en arrière-plan dans le serveur. Une fermeture du
flux SSE, du terminal SSH ou du client MCP n'annule pas cette tâche. Une fois
activés par le plan, les services système démarrent au boot avec redémarrage sur
échec et restent indépendants des sessions interactives.

Un **redémarrage du service ou du VPS** conserve les enregistrements sur disque,
mais peut interrompre le processus de code en cours. Le serveur ne rejoue pas
automatiquement une tâche interrompue : relire son état ne prouve pas que son
exécution a repris. La reprise d'une modification de code exige une politique
explicite qui vérifie le travail déjà effectué avant une nouvelle exécution.
Cette limite diffère de la déconnexion d'un client et doit rester visible dans
les comptes rendus d'exploitation.

## Authentification et sandbox

Le plan génère les jetons sur le VPS avec `openssl rand -hex 32`, en conservant
une valeur déjà configurée. Les fichiers d'environnement obligatoires sont
possédés par `root:root`, en mode 0600 :

| Fichier protégé                     | Variable                  | Consommateur                                   |
| ----------------------------------- | ------------------------- | ---------------------------------------------- |
| `/etc/aphrody/aphrody-a2a.env`      | `APHRODY_A2A_COORD_TOKEN` | Listener A2A et client A2A du serveur MCP HTTP |
| `/etc/aphrody/aphrody-mcp-http.env` | `APHRODY_MCP_HTTP_TOKEN`  | Transport MCP HTTP                             |

Avec le jeton A2A configuré, **toutes les routes privées** exigent un bearer,
y compris `/msg`, `/coord`, JSON-RPC, REST, `/jsonrpc`, `/events`, les tâches et
les boîtes de messages. Seuls GET `/ping` et GET
`/.well-known/agent-card.json` restent anonymes. Un listener TCP hors loopback
refuse de démarrer sans credential. Le CLI conserve une compatibilité locale
sans jeton sur loopback ; cette compatibilité n'est pas le mode des unités
déclarées, qui exigent leur fichier d'environnement protégé.

`/mcp` répond 401 sans jeton ou avec un mauvais jeton, et 503 si aucun jeton serveur
n'est configuré. `/healthz` reste accessible sans credential. Une réponse de santé
ne suffit donc pas à qualifier l'authentification.

Pour les clients MCP stdio sur le VPS, le plan provisionne une copie locale
protégée du credential A2A dans
`/home/ubuntu/.aphrody/private/a2a/bearer`, possédée par `ubuntu`, en mode 0600,
sous un répertoire 0700. Le credential reste sur l'hôte. Le client natif
`aphrody_a2a_call` lit `APHRODY_A2A_TOKEN_FILE` à chaque appel, puis utilise
`APHRODY_A2A_TOKEN`, puis `APHRODY_A2A_COORD_TOKEN` si aucun fichier n'est
configuré. Un fichier configuré illisible ou invalide fait échouer l'appel avant
la requête ; il n'entraîne aucun repli vers un accès anonyme.

### Profil d'environnement des clients stdio

`yolo ops mcp-environment` prépare un seul fichier JSON privé par profil pour
le serveur natif `aphrody-mcp`. La commande recueille l'environnement déjà
hérité, les variables autorisées du processus MCP canonique de même UID, les
fichiers JSON explicitement protégés et les blocs `env` des configurations
clientes existantes. Elle refuse les fichiers non privés, les valeurs qui
remplaceraient le domaine ou le `PATH`, les routes serveur historiques et les
valeurs de credential en ligne qui ne sont pas déjà préservées dans le profil.
Un défaut de configuration ne crée aucune authentification.

```sh
yolo ops mcp-environment prepare --output /private/aphrody/mcp --binary /absolute/path/aphrody-mcp --profile aphrody
yolo ops mcp-environment probe --output /private/aphrody/mcp --binary /absolute/path/aphrody-mcp --profile aphrody
yolo ops mcp-environment apply --output /private/aphrody/mcp --binary /absolute/path/aphrody-mcp --profile aphrody --home /home/aphro
```

`prepare` écrit le profil en mode 0600 dans un dossier 0700 et ne renvoie que
les noms de clés, leurs sources, une empreinte et les clés requises manquantes.
`probe` utilise le client natif pour tester le transport stdio et un appel RAG
de lecture ; il n'ajoute pas de second serveur. `apply` ne touche qu'aux
configurations fournisseurs déjà présentes, conserve leurs autres options,
crée des sauvegardes privées et n'écrit qu'après la sonde réussie. C'est une
mutation locale des configurations clientes : l'exécuter seulement sur le home
explicitement visé et après validation du profil. Les tests emploient des
valeurs de fixture ; ils ne lisent ni authentification réelle ni serveur distant.

Les unités tournent sous `ubuntu`, avec `NoNewPrivileges`, `ProtectSystem=strict`,
`ProtectHome=tmpfs`, des chemins d'écriture explicites et aucun droit implicite
sur les sockets de conteneurs. Les deux unités exposent Bun et les binaires
natifs nécessaires en lecture seule. A2A expose également le home SSH en lecture
seule, le home Codex existant et le home Aphrody ; MCP HTTP expose le home
Aphrody, sans exposer le home SSH. Les exceptions `@pkey` permettent les appels
de V8 sous le filtre de syscalls. Les outils doivent être qualifiés dans ce contexte réel :
un `tools/list` réussi ne prouve pas un appel navigateur ou un accès SSH/Git.
L'accès à l'origin `git@github-dev:aphrody-labs/aphrody.git` nécessite notamment
une authentification disponible dans le contexte du service.

Les jetons, conversations, bases, modèles et résultats détaillés des agents
restent dans les magasins privés. Les éventuels comptes rendus Discord ne
publient que les métadonnées autorisées (le plan de contrôle Discord est retiré
depuis le 2026-10-09).

## Transports entre machines

Le transport de flotte déclaré est **SSH authentifié sur WireGuard**. Les clients
Windows, WSL ou VPS doivent disposer d'un peer WireGuard joignable et d'une
authentification SSH autorisée ; une entrée d'inventaire ne prouve pas leur
connectivité.

Un client MCP lance par SSH
`/home/ubuntu/.bun/bin/bun /home/ubuntu/apps/lab/fleet-mcp.mjs`.
Ce [wrapper de lancement](../../../../scripts/aphrody/tools/infra/fleet-mcp.ts)
lit la déclaration privée déployée, fixe le cwd dédié et les commandes des tool
hosts, puis lance le binaire canonique
`/home/ubuntu/.local/bin/aphrody-mcp` en stdio avec le chemin distant
`APHRODY_A2A_TOKEN_FILE=/home/ubuntu/.aphrody/private/a2a/bearer`. Il ne fournit
aucun protocole MCP supplémentaire. Le jeton n'est ni un argument SSH ni une
valeur copiée dans la configuration cliente. Le client peut aussi joindre les
endpoints HTTP loopback à travers un tunnel SSH privé,
avec l'authentification exigée par chaque endpoint. La validation des clés
d'hôte SSH reste active.

Le processus MCP stdio appartient à la connexion cliente. Les tâches qu'il
soumet au service A2A appartiennent au service système VPS : leur durée de vie
ne dépend pas de cette connexion. Le hub peut donc terminer une tâche après la
fermeture du PC client, tant que le VPS et son service restent disponibles.
Les configurations des fournisseurs sont à vérifier séparément sur chaque
machine ; un transport MCP commun ne synchronise pas leur mémoire interne ni
leurs poids de modèle.

Les clients Windows natifs Codex 0.158 et Claude ont été configurés depuis leurs
CLI avec la [déclaration Windows](../../../../infra/config/host/agent-fleet-mcp-windows.json).
Le transport qualifié utilise `C:/Windows/System32/wsl.exe --exec /usr/bin/ssh`
et l'alias strict `aphrody-vps-wg` ; WSL et cet alias doivent rester disponibles.
Deux connexions ont initialisé le serveur, lu ses 364 outils uniques et fermé
proprement le client. La seconde a appelé `ListTasks` avec succès (HTTP 200)
et retrouvé le résultat terminé ; elle n'a pas créé de nouvelle tâche LLM.
Claude indique `Connected`. Les autres MCP et authentifications sont conservés,
avec sauvegardes privées vérifiées et ACL des configurations restaurées.

Le SSH Windows OpenSSH 10.0p2 direct exécute une commande simple, mais son flux
redirigé n'a pas fourni de handshake MCP vivant lors de la qualification. Le
transport WSL est la solution déployée. Les rapports amont
[2448](https://github.com/PowerShell/Win32-OpenSSH/issues/2448) et
[879](https://github.com/PowerShell/openssh-portable/pull/879) donnent du contexte
sur les handles redirigés ; ils n'établissent pas à eux seuls la cause de ce cas.
AGY Windows n'a pas été qualifié.

## Tool hosts Bun intégrés et builds reproductibles

Le kernel du serveur MCP canonique peut charger les registres Yolo et M3 par le
protocole natif `<programme> list` et `<programme> call <nom> <json>`. Ces
processus sont des tool hosts, pas des serveurs MCP supplémentaires. Leur commande
explicite est configurée par `APHRODY_YOLO_TOOL_HOST` et
`APHRODY_M3_TOOL_HOST`. Le kernel découpe cette commande par espaces puis ajoute
`list` ou `call` ; les chemins de cette flotte ne contiennent pas d'espaces.

La qualification du 2026-10-07 a identifié deux problèmes de découverte : le
runtime `yolo` présent sur le VPS ne prend pas en charge `tool`, et les sources
du checkout VPS ne résolvent pas leurs imports de paquets sans `node_modules`.
Un échec de découverte fait échouer le chargement du kernel intégré. Un compte
d'outils MCP inférieur à celui attendu doit donc conserver ce diagnostic ; il
ne suffit pas de constater que le transport HTTP répond.

La [façade Yolo versionnée](../../../../scripts/aphrody/tools/infra/fleet-yolo-tool-host.ts)
importe statiquement `runToolHost` de son propriétaire. Le tool host M3 est
construit directement depuis l'entrée actuelle du package Material
[`@aphrody/m3-mcp`](../../../../material/packages/m3-mcp/src/tool-host.ts). Aucun registre
ni moteur n'est recopié. Depuis la racine du dépôt, les commandes de build sont :

```sh
umask 077
bun build scripts/tools/infra/fleet-yolo-tool-host.ts --target=bun --format=esm --env=disable --reject-unresolved --outfile="$HOME/.aphrody/automation/yolo-tool-host-fleet.mjs"
bun build ../material/packages/m3-mcp/src/tool-host.ts --target=bun --format=esm --env=disable --reject-unresolved --define 'import.meta.dir="/home/ubuntu/apps/aphrody/shared/agent-workspaces/aphrody/../material/packages/m3-mcp/src"' --outfile="$HOME/.aphrody/automation/m3-tool-host-fleet-vps.mjs"
chmod 600 "$HOME/.aphrody/automation/yolo-tool-host-fleet.mjs" "$HOME/.aphrody/automation/m3-tool-host-fleet-vps.mjs"
```

`--env=disable` empêche l'inlining des variables d'environnement dans l'artefact.
`--reject-unresolved` refuse les imports dynamiques non résolus. La définition
M3 fixe les deux chemins d'assets calculés depuis `import.meta.dir` sur le
checkout déclaré ; un bundle placé directement dans `/home/ubuntu/apps/lab` aurait
autrement une racine de données incorrecte. Elle ne modifie pas les sources M3.

Les bundles protégés ont été qualifiés depuis un répertoire temporaire sans
`node_modules`. Leur registre est identique à celui du propriétaire, et un appel
de lecture a été exercé pour chacun :

| Artefact local qualifié      | Registre et appel vérifiés                                                                 | Taille         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------ |
| `yolo-tool-host-fleet.mjs`   | 14 noms uniques ; `yolo_scan` lit le cwd demandé, sans écriture                            | 149 932 octets | `0ae3bf561eb336f524052335c1165d43dafff45765cb42d6318ee97d937007df` |
| `m3-tool-host-fleet-vps.mjs` | 11 noms uniques ; `m3_os_themes_list` renvoie 11 noms de fichiers à générer, sans écriture | 412 831 octets | `0c426ef909116f4a027437f0cb7c41d20687d409efe3a287ad7d22bf57be5f08` |

Le reçu de build ci-dessus date du package source `@aphrody/m3-mcp` 3.3.7. Le
package actuel est `@aphrody/m3-mcp` 1.4.5 ; son entrée Material a actuellement
le même SHA-256,
`ace1a3325c6c9162a238f49c9567ae13f67e6e30978017738f632f1a28dd9aa7`. Cette
égalité de source ne requalifie pas les bundles historiques ni leurs
dépendances pour la version actuelle. La recette historique a été exécutée sur le dépôt au HEAD
`ccb466047601a61a71487a8a45a2807395838a27`, avec la façade Yolo en cours
d'intégration. Ces SHA identifient les artefacts qualifiés et doivent être
recalculés après toute modification de leurs sources ou dépendances.

Une sonde VPS de lecture a confirmé dans le checkout M3 dédié 32 manifests de
paquets, 198 documents Markdown, les trois feuilles CSS exportées de
`m3-tokens` (17 572 octets) et la source des couleurs dynamiques. Le répertoire
des SVG `forks/material-design-icons/symbols/web` était absent. La lecture du
catalogue et des tokens doit être vérifiée via le bundle déployé ; la livraison
des SVG et la génération d'icônes nécessitent leurs assets et restent distinctes
des appels purs de thèmes qualifiés ici. Aucun modèle, dataset ou catalogue
volumineux d'icônes n'a été transféré pour cette qualification.

Infra a déployé ces bundles sous `/home/ubuntu/apps/lab/yolo-tool-host.mjs` et
`/home/ubuntu/apps/lab/m3-tool-host.mjs`, avec leurs commandes explicites dans les
unités et le wrapper SSH stdio. Chaque unité expose
`/home/ubuntu/.bun/bin/bun` en lecture seule sous `ProtectHome=tmpfs`. Les
364 outils uniques mesurés sur les deux transports comprennent les 14 outils
Yolo et les 11 outils M3 ; leurs registres locaux ne remplacent pas cette mesure
du serveur canonique complet.

## Plan, observation et application

Le module Infra compose les unités à partir du catalogue et de ses drop-ins. Son
CLI expose `host-plan` et `host-apply` :

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-a2a aphrody-mcp-http --target vps --observe
```

Lorsque les deux unités sont demandées, le plan ordonne A2A avant MCP, même si
l'ordre fourni est inversé : MCP requiert le fichier d'environnement A2A. Pour
un plan MCP seul, ce fichier doit déjà exister.

Le build natif complet doit conserver les fonctionnalités nécessaires, notamment
`--features mcp-toolbox`. Les options `--binary-from` et `--binary-sha256`
s'appliquent aux **deux** unités : elles installent l'artefact déjà présent sur le
VPS dans chacun des chemins canoniques déclarés, après vérification SHA-256. Le
binaire précédent reste sous le suffixe `.prev`.

Les variables ci-dessous désignent le chemin VPS de l'artefact qualifié, son
SHA-256 de 64 chiffres hexadécimaux et le nombre d'outils mesuré sur ce build.
Elles ne contiennent aucun jeton :

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-a2a aphrody-mcp-http --target vps --binary-from "$APHRODY_FLEET_ARTIFACT" --binary-sha256 "$APHRODY_FLEET_SHA256" --expect-tools "$APHRODY_FLEET_TOOLS" --observe
bun packages/engine/core/src/host/cli.ts host-apply aphrody-a2a aphrody-mcp-http --target vps --binary-from "$APHRODY_FLEET_ARTIFACT" --binary-sha256 "$APHRODY_FLEET_SHA256" --expect-tools "$APHRODY_FLEET_TOOLS" --apply
```

Chaque unité suit les phases préflight, provisionnement, composition et
vérification systemd, installation, `daemon-reload`, `enable --now`, puis
vérifications. Une erreur de préflight arrête l'exécution avant toute mutation de
l'unité concernée ; les unités précédentes peuvent déjà avoir été installées.
Une erreur après l'installation provoque le rollback de l'unité concernée.

Les vérifications de livraison comprennent :

1. Identité SHA-256 et version du binaire installé, unités actives et activées au
   démarrage, écoute exclusivement sur loopback et réponse de santé.
2. 401 sans bearer et avec un bearer incorrect sur les endpoints privés A2A et
   MCP ; accès authentifié à l'API des tâches A2A sans imprimer leur contenu.
3. `tools/list` authentifié avec `--expect-tools` égal au compte mesuré, puis un
   appel utile depuis le fournisseur dans le sandbox du service. Le script
   [mcp-tools-count.ts](../../../../scripts/aphrody/tools/infra/mcp-tools-count.ts) fournit le
   compteur autonome. Il lit les événements SSE progressivement et annule le
   reader dès la réponse JSON-RPC attendue : le transport rmcp peut garder le
   flux ouvert après cette réponse. Les réponses JSON et les erreurs restent
   prises en charge ; la suppression de session conserve l'authentification.
4. Tâche native contrôlée, déconnexion cliente et lecture de son résultat
   persistant ; contrôle séparé de la conservation des enregistrements après
   reconstruction du listener.
5. Permissions des fichiers protégés, conservation des homes et de
   l'authentification, connectivité SSH/WireGuard réellement observée pour chaque
   machine annoncée comme connectée.

La preuve d'activation doit préciser la révision, le SHA-256 installé, la date,
les commandes exécutées, leurs résultats et les limites restantes. Les tests de
source ne remplacent pas cette preuve.

## Preuves d'activation du 2026-10-07

Le build factory `2026-10-07T13-48-44-569Z-354db9af90ce` a produit le binaire
complet avec `mcp-toolbox` depuis le snapshot source
`354db9af90ce13ff04e44cb8f48b04baf04d48e6`. Les chemins canoniques VPS `aphrody` et
`aphrody-mcp` ont tous deux le SHA-256
`2c8f5482183896d66326ff3ca17ccdd4e466fdcdbabce11148f2cbff484dcd0c`.
Cette preuve concerne cet artefact ; les changements ultérieurs de protocole ou
de cache doivent être qualifiés puis livrés avant de lui attribuer leurs effets.

| Vérification                    | Résultat observé                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Unités A2A et MCP HTTP          | `active/running`, `enabled`, cwd `/home/ubuntu/apps/aphrody/shared/agent-workspaces/aphrody`                 |
| Authentification A2A            | 401 sans jeton et avec un mauvais jeton ; 200 sur l'API de coordination privée authentifiée     |
| Authentification MCP HTTP       | 401 sans jeton et avec un mauvais jeton ; `tools/list` authentifié réussi                       |
| Catalogue MCP HTTP et stdio SSH | 364 noms uniques sur chacun, dont 14 Yolo et 11 M3                                              |
| Exécution Codex native          | Tâche `01a116ae-9ab8-751d-8520-371a6fcaca86`, état `COMPLETED` obtenu après fermeture du client |
| Contrôles de cette tâche        | 7/7 : cwd dédié, `main`, Bun, CLI native, accès GitHub, hooks MCP et checkout sans modification |
| Portes source Bun du lot        | 48 tests ciblés et 5 tests SSE réussis ; TypeScript, lint et format réussis                     |

Le test SSE reproduit un serveur qui garde les réponses initialize et les deux
pages tools/list ouvertes : le compteur retourne avant leur fermeture. Cette
correction a permis de qualifier le plan MCP HTTP. Les premières tentatives
avaient vérifié les 401, puis échoué au compteur avant d'appliquer le rollback ;
elles n'établissaient aucune activation complète.

L'accès GitHub ci-dessus a été exercé par Codex dans le service A2A. Il ne
qualifie pas un accès SSH direct depuis le sandbox du service MCP HTTP, où le
home SSH reste masqué. Aucun redémarrage du VPS avec une tâche de code en cours
n'a été qualifié par ce smoke ; la conservation des enregistrements et l'absence
de rejeu automatique restent les contrats décrits plus haut.

## Preuves d’activation finales du 2026-10-07

Le snapshot factory `c8ec56bc70d1f29c2f21f7f42bcde61fff267dc3` a produit
l’artefact natif complet avec `mcp-toolbox` (298 220 552 octets), SHA-256
`737f87d9a3ae1822dcc9741eaa1e16dce61ee5ac963e35de3deeda157d2b57d5`.
Cet artefact remplace le binaire `2c8f5482…` sur les deux chemins canoniques
VPS. Le SHA est vérifié aussi dans les namespaces des deux services : A2A
a été relancé après MCP, sans tâche active, pour charger le nouvel inode.

- A2A et MCP HTTP : actifs et activés au démarrage ; 401 sans jeton et avec
  un mauvais jeton, 200 authentifié et 364 outils uniques (14 Yolo, 11 M3).
- Protocole hérité et moderne : initialisation et catalogue qualifiés ;
  discovery et les cinq résultats modernes ont `resultType=complete`,
  `ttl=0` et cache privé. Claude WSL réel indique `Connected`. Claude Windows
  natif 2.1.285 indique aussi `Connected` via WSL/SSH ; ce client négocie
  `2025-11-25`, et le client WSL qualifie le protocole moderne `2026-07-28`.
- Portes source : 60 tests coordination, 124 tests MCP réussis et un ignoré ;
  strict Clippy tous targets sans dépendances réussi sur le snapshot exact.
  Le check coordination Windows MSVC a réussi dans la factory DBFR.
- Les six fichiers protégés contrôlés gardent leurs SHA et permissions.
- Le client Bun A2A SDK a reçu l’ACK `WORKING` en 8 ms puis s’est fermé.
  La tâche `01a11701-83ff-7475-8bfa-35a26646f98b` est ensuite
  `COMPLETED`, avec un artefact et 7/7 vérifications : cwd dédié, main,
  Bun, CLI native, GitHub, hooks MCP et checkout sans modification.

Les listeners natifs restent sur loopback. Les relais WireGuard déclarés
`10.200.77.1:8788` et `10.200.77.1:8793` sont acceptés par le contrôle
de ports ; une adresse publique, wildcard ou un relais non déclaré est refusé.
Les 18 tests de plan hôte et les contrôles TypeScript/lint/format passent.

## Synchronisation Drive indépendante des clients

Historique : `aphrody-drive-sync.service` et son timer sont retirés du catalogue
depuis le 2026-10-09 ; leurs unités ont été supprimées du dépôt.

Le [worker VPS](../../../../infra/config/host/agent-sync-vps.json) utilise le propriétaire
Yolo Google et le pipeline agent home natif. Le timer
`aphrody-drive-sync.timer` est `active/waiting` et `enabled`. Son service
`aphrody-drive-sync.service` est un oneshot : il revient à `inactive/dead`
avec `Result=success` entre les passages ; cet état ne signifie pas que le timer
est arrêté. Il ne dépend pas du PC ou de WSL.

Les passages qualifiés ont confirmé le téléchargement de sept éléments dans le
staging privé et sept nouveaux candidats de retrieval. Leur indexation native a
ajouté sept documents et 89 chunks, avec zéro vecteur. Une sauvegarde native a
précédé l'indexation ; après vérification du même label d'index, les sept copies
locales temporaires ont été retirées. Cette mesure établit l'ingestion et
l'indexation textuelle de ces éléments, sans établir une indexation vectorielle
ni une synchronisation de mémoire interne chez les fournisseurs.

Le home cloud était initialement vide. Le 2026-10-07, ses sept documents DBFR
et leurs sept références Markdown/natives validées ont été copiés depuis le
magasin privé WSL, avec le checkpoint d'origine : 22 fichiers, vérifiés par
SHA-256, en 0600, uniquement sur les chemins DBFR déclarés. Une sauvegarde du
checkpoint cloud initial est conservée ; aucun fichier d'authentification n'a
été copié par ce bootstrap et aucun document existant divergent n'a été remplacé.
Le passage Google natif qui suit retrouve trois documents inchangés, deux
locaux en avance et deux distants staged, avec zéro contenu unsupported et
zéro upload. La référence d'origine est conservée pour le rapprochement à
trois voies ; elle n'est pas remplacée par une version distante non revue.

Le rapprochement privé du 2026-10-07 a ensuite appliqué quatre mises à jour
Docs minimales (89 insertions et 45 suppressions de spans), avec
`writeControl.requiredRevisionId`, puis trois promotions locales. Les sept
snapshots après écriture conservent les tabs, paragraphes, styles, enveloppes
et caractères non concernés. Les originaux, propositions et reçus restent
en 0600 dans le magasin privé ; aucun contenu de document n’est publié.
Cette application est distincte du timer de téléchargement et ne suffit pas
à prouver un rapprochement bidirectionnel récurrent.

Le [rapprochement récurrent](DRIVE-RECONCILIATION-WORKER.md) est désormais
activé avec le worker Bun gelé `b066500744b6e1bffd1187f922afe2a2e51c24a4e8ca6f054484ad5b3b05e6e1`.
Les sept artefacts installés correspondent à leurs SHA et le credential Google
conserve son SHA et son mode 0600. Le passage réel de 15:52 UTC a qualifié
les quatre jobs avec zéro échec : sept documents Drive inchangés, sept
références vérifiées, 45 fichiers protégés copiés et deux homes DBFR
indexés (32 éléments indexés au total). Le reçu est publié et frais, sans
revue en attente ; le oneshot termine avec `Result=success`, et son timer
reste actif et activé au démarrage.

Les générations des sept contrats sont immuables et publiées par une bascule
atomique de `reviewed-current`. La revue réserve son intention avant
l’envoi A2A, reprend son task ID durable et rafraîchit les révisions Docs
avant la préflight et avant l’application. Les consommateurs attendent une
génération vérifiée ; une application partielle bloque son rejeu.
Le passage stable ci-dessus qualifie la récurrence et la propagation ; la
branche d’écriture est couverte par les tests et le rapprochement réel des
quatre Docs décrit plus haut.

La première activation a refusé le module Google de 31 Mio à cause de la
limite de documents. La correction distingue les modules (64 Mio) des
documents (4 Mio), avec SHA, UID, mode 0600 et lien unique toujours contrôlés.
Les 37 tests ciblés du contrôleur/worker passent, ainsi que TypeScript strict,
lint et format ; le validateur Google compte 41 tests réussis. L’autre
contrôle de sandbox a routé les journaux Infra vers
`APHRODY_INFRA_ROOT=/home/ubuntu/.aphrody/automation/drive-vps`, au lieu du
répertoire système en lecture seule ; un SSH réel dans ce sandbox réussit.

L’ancien label `drive-dbfr-staged` a été vidé par le propriétaire natif
après la bascule de policy et une sauvegarde vérifiée en 0600 : neuf documents
retirés de l’index, zéro erreur, fichiers privés conservés. Le store VPS DBFR
contient sept documents validés et 98 chunks. Les copies WSL vérifiées
conservent aussi ces sept documents ; les authentifications des fournisseurs
restent dans leurs magasins propres.

Le reçu VPS local `/home/ubuntu/apps/lab/state/agent-sync-vps-status.json` est distinct
du reçu WSL. Le plan de contrôle Discord peut le lire via
`sync.cloudAutomationReportPath` et n'affiche que les métadonnées autorisées. Un
reçu absent, invalide, âgé de plus de 180 secondes ou daté dans le futur ne
prouve aucun succès ; l'échec d'un job est affiché explicitement. Les credentials
Google et les documents restent dans leurs magasins privés.

## Limites encore ouvertes

- Le PC d'Omar est hors ligne lors de cette qualification. Sa présence dans
  l'inventaire ne prouve pas une connexion WireGuard/SSH ni une exécution agente.
- Les SVG Material Symbols sont absents du checkout VPS observé. Le catalogue
  MCP et la génération pure de thèmes sont qualifiés ; les appels nécessitant
  ces SVG restent à qualifier avec leurs assets.

## Rollback

L'étape `remove` du plan arrête et désactive l'unité, retire son fichier installé
et recharge systemd. Les checkouts, boîtes de messages, tâches, homes et fichiers
d'environnement restent présents. Ce rollback ne restaure pas automatiquement
le binaire `.prev` : un retour de binaire passe par un nouveau plan Infra avec
l'artefact précédent et son SHA-256 vérifié.

## Preuves historiques du 2026-10-06

Ces observations décrivent les anciens artefacts et une qualification WSL, pas
l'activation du nouveau plan VPS du 2026-10-07.

- Les unités composées ont démarré sur WSL, avec des ports alternatifs et le
  sandbox alors déclaré. `/healthz`, `tools/list`, `/ping`, la carte d'agent et
  `/msg` ont répondu. Les outils navigateur navigate, markdown, screenshot, pdf,
  snapshot, fetch et `re_triage` ont été exercés.
- Sans l'exception `SystemCallFilter=@pkey`, V8 a provoqué un SIGSYS
  (`status=31/SYS`) lors de `pkey_alloc`.
- `systemd-analyze security --offline` a donné 1,7 aux deux unités de cette
  qualification, contre 3,9 pour
  `aphrody-llama-gemma4`, 7,1 pour `aphrody-fonts-proxy` et 7,5 pour
  `aphrody-downloads`. Ces scores ne qualifient pas les nouveaux bindings de home.
- `upstream_list`, seul des cinq outils `upstream_*` alors exercé, a échoué faute
  de checkout contenant `tools/config/upstream-sources.json` dans le répertoire de
  travail.
- Le port VPS 8789 était occupé par le tunnel de calcul WSL et ne pouvait pas
  accueillir l'unité MCP. Le plan courant utilise 8793. Les observations
  `GatewayPorts yes`, ufw et accès depuis une adresse administrateur concernaient
  ce tunnel historique, sans établir l'état réseau courant.
- L'ancien transport MCP n'avait qu'une vérification du header Host. Le build
  installé exposait 127 outils, SHA-256 abrégé `722433e7…` ; 137 outils étaient
  attendus dans une variante toolbox d'après les sources de cette date. Ces
  nombres ne sont pas le compte attendu du build courant, qui doit être mesuré.
- Les fichiers `aphrody-mcp-http.env` et `aphrody-a2a.env` étaient absents ; le
  fichier du gateway retiré `aphrody-ai-http.env` n'était pas chargé. A2A était
  déclaré en `APHRODY_A2A_DRY_RUN=1`, sans lancement des fournisseurs. Ces
  constatations ne s'appliquent pas aux nouvelles déclarations source.
- Les binaires venaient de `/home/ubuntu/.local/bin`, sans arbre de release
  immuable pour ce plan. Le nouveau plan contrôle l'installation par SHA-256 et
  conserve le précédent binaire pour un retour qualifié.
