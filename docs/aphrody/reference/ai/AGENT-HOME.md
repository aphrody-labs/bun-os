<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent Home : profils, espaces et sessions

Ce document décrit comment organiser le contexte durable d'un agent Aphrody.
Le générateur des inventaires locaux est
[`agent-home.ts`](../../../../packages/workspace/src/agent-home.ts) ; les
fichiers d'amorçage sont intégrés dans
[`onboard.rs`](../../../../crates/aphrody-agent-home/src/onboard.rs) depuis
`plugins/aphrody/home`.

## Modèle de portée

| Élément | Contenu | Portée et règle |
| --- | --- | --- |
| Profil | Configuration d'un domaine (`aphrody`, `ie`) | Isolé des autres domaines |
| Espace de travail | Instructions, identité, préférences et mémoire curatée | Un espace actif par profil |
| Session | Échange natif d'un agent | Reste dans le store de cet agent |
| Dépôt | Code, docs et règles locales du projet | Le dépôt courant fait autorité pour la tâche |

Le cwd indique le projet de travail ; il ne définit pas le profil et ne prouve
pas l'identité d'une session. Les miroirs de session ne sont exploitables que
si leur marqueur de domaine est présent. Les associations historiques fondées
sur le cwd ou l'heure sont des candidates, pas une attribution certaine.

## Fichiers de l'espace

| Fichier | Rôle | Durée |
| --- | --- | --- |
| `AGENTS.md` | Règles durables, périmètre et méthode | Long terme, révisé avec les règles |
| `SOUL.md` | Ton, personnalité et limites | Long terme |
| `IDENTITY.md` | Nom et description courte de l'agent | Long terme |
| `USER.md` | Préférences stables de l'utilisateur | Long terme, sans journal quotidien |
| `TOOLS.md` | Outils détectés et routage local | Généré ou actualisé depuis l'état installé |
| `BOOT.md` | Vérifications courtes au début d'une session | Exécuté à chaque démarrage concerné |
| `BOOTSTRAP.md` | Configuration de première utilisation | Ponctuel, retiré après configuration |
| `MEMORY.md` | Index curaté de faits, décisions et procédures utiles | Long terme, privé au profil |
| `memory/YYYY-MM-DD.md` | Notes datées récupérables à la demande | Historique du profil |
| `sessions/<agent>/` | Sessions natives ou miroir prévu par l'outil | Privé, ne pas éditer comme de la mémoire |

Ne duplique pas un même fait dans plusieurs couches : mets les préférences dans
`USER.md`, les règles dans `AGENTS.md`, les faits durables dans `MEMORY.md`, et
les détails temporaires dans une note datée. Les documents de projet et leurs
instructions restent dans leur dépôt. Ne copie pas les corpus ou les secrets
dans le profil.

## Gestion des homes

Le propriétaire est le crate
[`aphrody-agent-home`](../../../../crates/aphrody-agent-home/src/lib.rs) ; la ligne de
commande est `aphrody agent-home` (sortie JSON, `--state` et `--homes-dir`
globaux). Un argument de home est un nom (résolu sous la racine) ou un chemin.

| Besoin | API Rust | Commande |
| --- | --- | --- |
| Racine des homes | `homes::HomesRoot` | `aphrody agent-home roots` |
| Instancier un gabarit externe | `template::instantiate_template` | `aphrody agent-home new <nom> --template <dir> [--set clé=valeur] [--avatar ...] [--agent-id ...] [--force]` |
| Champs de profil | `user::UserProfile` | `aphrody agent-home profile <home> [--avatar ...] [--agent-id ...] [--set clé=valeur]` |
| Révision du contenu | `revision::home_revision` | `aphrody agent-home revision <home> [--files]` |
| Fusion / synchronisation | `merge::merge_homes`, `merge::sync_homes`, `merge::restore_backup` | `aphrody agent-home merge <source> <cible> [--policy lww\|keep-target\|take-source] [--apply]`, `sync <a> <b> [--apply]`, `restore <backup> <home>` |
| Renommage | `rename::rename_home` | `aphrody agent-home rename <ancien> <nouvel-id> [--apply]` |

### Racine des homes

Ordre de résolution : `$APHRODY_HOMES_DIR`, puis `homes_dir` de la table
`[agent_home]` de `<state>/config.toml`, puis `<state>/workspaces` (défaut
inchangé). Une valeur relative est jointe au dossier d'état. Avec la racine par
défaut, `workspace-<nom>` reste lu en repli et un `agent_id` résout toujours
vers `<state>/workspace-<agent>` ; avec une racine configurée (hôte
multi-utilisateur), tout home est `<racine>/<nom assaini>` (`discord:42` donne
`discord-42`).

### Gabarit externe

Un gabarit est un dossier de contenu de home. L'instanciation copie son contenu
(mêmes exclusions que la révision), remplace `{{agent_id}}`, `{{home_name}}`,
`{{date}}` et `{{user.<clé>}}` dans les fichiers texte, complète les fichiers
canoniques absents depuis les gabarits intégrés, écrit les champs utilisateur
dans `USER.md`, puis renomme le dossier préparé sur la destination. `--force`
déplace l'ancien home vers `.<nom>.replaced-<horodatage>` au lieu de le supprimer.

### Champs de profil

Le frontmatter de `USER.md` porte `avatar` (chemin relatif au home, contenu
par la garde, ou URL `https:`/`data:`), `agent_id` (identifiant verbatim),
`updated_at` (ISO-8601 UTC, mis à jour par chaque écriture de profil, fusion
appliquée ou renommage) et `template_revision` (révision du gabarit d'origine).
Ces champs ne sont pas injectés dans le prompt.

### Révision `sha256-v1`

1. Parcours récursif sans suivre les liens symboliques ; exclusion des dossiers
   `.aphrody`, `.git`, `.coord`, `db`, `cache`, `locks`, `logs`, `sessions`,
   `node_modules` (à toute profondeur) et des fichiers finissant par `.tmp`,
   `.lock`, `.sqlite`, `.sqlite-wal`, `.sqlite-shm`, `.db`, `.db-wal`,
   `.db-shm`, `-journal`.
2. Chemins relatifs en `/`, UTF-8, sans saut de ligne, triés par octets UTF-8.
3. Manifeste : une ligne `<sha256 hex> <taille décimale> <chemin>\n` par fichier.
4. Révision : `sha256-v1:` suivi du SHA-256 hexadécimal du manifeste.

Bun la recalcule sans FFI avec
[`agent-home-revision.ts`](../../../../packages/workspace/src/agent-home-revision.ts)
(`Bun.CryptoHasher("sha256")`) ; un vecteur de référence commun est testé des
deux côtés. `SyncSnapshot.revision_sha256` applique le même manifeste aux sept
documents synchronisés, dans l'ordre du contrat ; `SyncSnapshot.revision`
(BLAKE3) reste la clé des registres mémoire et entraînement.

### Fusion et synchronisation

Règles par fichier : absent de la cible, copié avec son mtime ; identique,
ignoré ; présent seulement dans la cible, jamais supprimé. Les souvenirs
(`MEMORY.md`, `memory/**`) font l'union par paragraphes : rien n'est perdu.
Les autres conflits suivent la politique : dernier écrivain (mtime le plus
récent, égalité au profit de la cible) par défaut, ou `keep-target`,
`take-source`. Simulation par défaut ; `--apply` sauvegarde d'abord tout le
contenu de la cible sous `.aphrody/backups/merge-<horodatage>/` et vérifie que
la révision de la copie égale celle du plan avant d'écrire. `sync` enchaîne
`a vers b` puis `b vers a`, une sauvegarde vérifiée par côté.

### Renommage

`rename <ancien> <nouvel-id> --apply` déplace le dossier par un seul `rename`
(refus entre systèmes de fichiers), réécrit dans le home les références
absolues à l'ancien dossier et `agent_id` dans `USER.md`, `MEMORY.md` et
`memory/**`, puis les références de `<state>/config.toml` et
`<state>/aphrody.json`. En cas d'échec, les contenus d'origine sont restaurés
et le dossier revient en place. Le rapport donne l'ancien et le nouvel espace
de noms de services (Redis, `PostgreSQL`) pour la migration des stockages externes
par leur propriétaire.

## Conventions Markdown

- Utiliser UTF-8, fins de ligne LF, une ligne vide entre blocs et aucun espace
  de fin de ligne.
- Mettre un seul titre `#` au début, puis des titres hiérarchiques sans saut de
  niveau.
- Garder le frontmatter YAML valide et limité aux champs lus par le parseur.
- Préférer des listes courtes et des tableaux uniquement pour comparer des
  champs de même nature.
- Écrire les chemins du dépôt en liens relatifs vérifiables ; ne pas inclure
  de chemin machine, secret, identifiant de session ou extrait de conversation.
- Dater les notes volatiles et marquer explicitement ce qui est observé,
  inféré ou à vérifier.

## Pratiques recoupées

- OpenClaw distingue les fichiers d'amorçage, les notes quotidiennes et la
  mémoire curatée, et recommande un espace par agent :
  [Agent workspace](https://docs.openclaw.ai/agent-workspace) et
  [Agent runtime](https://docs.openclaw.ai/concepts/agent).
- Hermes Agent isole la mémoire, les sessions et la configuration par profil ;
  ses fichiers de mémoire sont bornés :
  [Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
  et [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

Ces modèles externes éclairent l'organisation ; les contrats effectifs sont
ceux du parseur Aphrody, du générateur et des règles du dépôt courant.
