<!-- SPDX-License-Identifier: Apache-2.0 -->

# MCP de la flotte depuis DBFR

> Autorité actuelle (2026-10-09) : Omar administre DBFR ; Yoyo / aphrody-dev administre tout Aphrody Labs. Les observations et accès historiques ci-dessous ne donnent pas une autorité plus large. La correction de déclaration ne prouve aucune modification des droits actifs.

## État qualifié le 7 octobre 2026

DBFR (`10.200.77.3`) atteint le hub VPS (`10.200.77.1`) par SSH sur WireGuard.
La connexion utilise une clé Ed25519 dédiée, créée sur DBFR et conservée uniquement
dans `/home/ubuntu/.ssh/aphrody_fleet_vps`, en mode `0600`. Aucune clé privée
WireGuard, PC, WSL, GitHub ou de fournisseur n'a été réutilisée ou exportée.

Le 7 octobre à 14:49:35 UTC, une connexion SSH stdio réelle a négocié MCP
`2025-11-25`, reçu **364 outils** (14 Yolo, 11 M3), puis appelé
`aphrody_a2a_call` avec `ListTasks`. Le relais a renvoyé HTTP `200`.
Cette vérification n'a soumis aucune tâche LLM et n'a affiché aucun historique
ni contenu d'artefact. Le serveur installé à cette heure renvoyait encore des
artefacts malgré `includeArtifacts: false` ; seule leur présence a été relevée.
La qualification des clients Claude au protocole moderne attend l'activation
du nouveau binaire par Infra.

## Déclarations et installation

- [Déclaration MCP DBFR](../../../../infra/config/host/agent-fleet-mcp-dbfr.json), installée
  dans `/home/ubuntu/.aphrody/fleet/agent-fleet-mcp.json`, mode `0600`.
- [Alias SSH DBFR](../../../../infra/config/host/user/dbfr-aphrody-vps-wg.ssh.conf), installé
  dans `/home/ubuntu/.ssh/aphrody-fleet-vps.conf`, mode `0600`.
- [Audit Discord](../../../../scripts/aphrody/audit/discord/fleet-membership.ts) : lecture
  des seules métadonnées d'application, de guilde, de membres et de permissions
  par le propriétaire Discord Kit. Les identifiants restent dans leur fichier
  protégé, chargé par `loadCredentials` ; ils ne figurent jamais dans les sorties.

La déclaration lance `ssh -F /home/ubuntu/.ssh/aphrody-fleet-vps.conf`, puis
`/home/ubuntu/.bun/bin/bun /home/ubuntu/apps/lab/fleet-mcp.mjs` sur le hub. Ce lanceur
sert le seul serveur `aphrody-mcp` et charge ses credentials A2A sur le VPS.
Il ne configure aucun serveur MCP `yolo` ou `aphrody-kernel` séparé.

L'option `-F` sélectionne un fichier dédié et laisse les autres alias SSH de DBFR
intacts. L'identité du hub est vérifiée avec `HostKeyAlias 51.77.147.152`,
`StrictHostKeyChecking yes` et les clés d'hôte déjà approuvées sur DBFR.
`BatchMode yes` empêche toute attente de mot de passe.

Seule la clé **publique** dédiée a été ajoutée au fichier `authorized_keys`
d'Ubuntu sur le VPS. La ligne comporte `from="10.200.77.3",restrict` : elle
n'accepte que la source WireGuard DBFR et désactive les redirections, le PTY et
les autres possibilités couvertes par `restrict`. Toutes les lignes antérieures
ont été conservées, après une sauvegarde privée vérifiée par SHA-256.
Les commandes distantes s'exécutent comme `ubuntu` ; aucune commande forcée
n'a été configurée. La clé reste dédiée à la source DBFR.

## Vérification et réversibilité

L'Infra native permet de vérifier la route sans lancer d'agent de code :

```sh
/home/aphro/.local/bin/aphrody infra ssh exec --host dbfr --json \
  --cmd 'ssh -F /home/ubuntu/.ssh/aphrody-fleet-vps.conf -T aphrody-vps-wg /usr/bin/true'

/home/aphro/.local/bin/aphrody infra ssh exec --host dbfr --json \
  --cmd 'ssh -F /home/ubuntu/.ssh/aphrody-fleet-vps.conf -T aphrody-vps-wg /usr/bin/printenv SSH_CONNECTION'
```

La seconde vérification a relevé la route `10.200.77.3 → 10.200.77.1:22`.
Pour requalifier MCP, utiliser la déclaration DBFR avec un client standard :
`initialize`, `notifications/initialized`, `tools/list`, puis l'appel de lecture
`ListTasks` avec `pageSize: 1`, `historyLength: 0`, `includeArtifacts: false`.
Ne jamais enregistrer les réponses brutes, les prompts ou les credentials dans
un rapport. Le probe privé et les reçus sont dans
`~/.aphrody/automation/fleet-dbfr/` sur le poste de contrôle ; ils contiennent
uniquement les assertions et métadonnées nécessaires.

Les sauvegardes de cette installation restent dans
`/home/ubuntu/.aphrody/automation/fleet-dbfr-access/` sur leurs hôtes respectifs.
Une révocation retire uniquement la ligne de la nouvelle clé publique du VPS ;
elle ne restaure pas aveuglément tout `authorized_keys` et préserve les ajouts
ultérieurs. Un retour de configuration utilise les sauvegardes vérifiées du
fichier géré concerné, sans remplacer `.ssh/config`, les clés d'hôte ni les
configurations des autres clients.

## Discord et Omar

L'audit natif a confirmé le bot Aphrody et le propriétaire dans la guilde
`1554189180030947338`. Le compte Omar `1527405876695142620` est membre et
dispose de `Manage Guild` ; l'ancien alias `1323725494184841256` renvoie `404`.
Le compte présent est désormais le principal de
[la politique administrateur](../../../../infra/config/host/omar-admin.json).
L'ancien compte reste un alias. Le moniteur Codex d'Omar a été supprimé le 2026-10-09. Le réconciliateur
administrateur relit sa politique toutes les deux minutes.

À 14:52:14 UTC, le peer WireGuard Omar `10.200.77.10` était déclaré, mais n'avait
encore aucun handshake, endpoint ou octet transféré. Sa présence et ses droits
Discord ne constituent pas une connexion réseau de son PC.

## Portée restante

Codex, Claude et AGY ne sont pas présents dans le PATH de DBFR ni dans les
emplacements d'installation usuels vérifiés. Le transport MCP DBFR fonctionne
indépendamment de ces installations et donne accès aux capacités et au relais
du hub. Les credentials de fournisseur restent sur leurs hôtes d'origine.
Une connexion MCP et un appel A2A de lecture ne prouvent ni l'exécution d'une
nouvelle tâche de modèle, ni une synchronisation des mémoires privées entre
fournisseurs, ni la connexion du PC d'Omar.
