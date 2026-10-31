<!-- SPDX-License-Identifier: Apache-2.0 -->

# omar-kit

Kit Windows « zéro ligne de commande » pour l'administrateur (Omar) : un exe `Aphrody-Omar.exe`, un menu en français, le guide
[docs/operations/omar-guide.md](../../../docs/operations/omar-guide.md). Il installe aphrody (et yolo quand ils sont publiés pour Windows),
Git et WireGuard (winget), crée ses clés **sur son PC**, importe le fichier d'accès de l'équipe (tunnel privé, SSH, serveurs),
copie le dépôt par Git (connexion GitHub par le gestionnaire d'identifiants), déclare le MCP dans Claude Desktop/Code, vérifie que tout
est prêt, lance un entraînement simplifié sur un serveur (`aphrody train run` par SSH, simulation par défaut, confirmation OUI) et expose
`aphrody winclean`, `doctor`, `model`, `infra ssh`, `yolo` derrière des boutons (menu « Mon PC »).

## Double clic

Le double-clic sur l'exe ouvre le menu console. `Aphrody-Setup.exe`
(`../setup`, rôle administrateur) installe le kit dans `%LOCALAPPDATA%\Aphrody\Omar`.

## Côté équipe

1. Omar envoie `a-envoyer-a-l-equipe.txt` (clés publiques WireGuard et SSH). Ajouter sa clé SSH à `tools/config/host/ssh/omar.authorized_keys` et sa clé WireGuard à la déclaration du tunnel (propriétaires : claim `omar-access`).
2. Fichier d'accès, **hors du dépôt**, envoyé en privé :
   `bun packages/infra/product/src/admin/commands/access-pack.ts --tunnel tools/config/host/wireguard/aphrody-tunnel.json --peer omar --wg-block <sortie de wg-client omar --format paste> --train-host <hôte> --host-keys <lignes known_hosts> --out <dossier privé>/aphrody-omar-acces.json`
   (aucune clé privée dedans ; refuse d'écrire dans le dépôt ; le bloc WireGuard est validé : pas de PostUp, pas de route par défaut).
3. Pack : `bun scripts/release/stage-omar-kit.ts [--smoke]` écrit dans `packages/infra/product/dist/` (ignoré par Git) le zip à envoyer, l'archive de mise à jour, `SHA256SUMS` et `omar-kit.manifest.json`. Exe compilé par Bun, marqué (icône, version) par le même rcedit/Wine que creator-kit, **non signé** (aucune clé de signature dans le dépôt).
4. Publication : l'artefact `omar-kit` (kind `kit`, `windows-x86_64`, zip + `.tar.gz` plate) est déclaré dans `tools/config/downloads.json` ; `scripts/release/publish-downloads.ts release` lance ce stage et publie ; le kit lit `latest.json` de downloads.aphrody.com et recoupe `SHA256SUMS`.

## Développement

`bun test`, `bun check --noEmit -p tsconfig.json` dans ce dossier. Le moteur de mise à jour, le journal de crash et les arguments viennent de `../creator-kit/src/lib`. Les scripts distants sont dans `src/remote/*.sh` (testés pour de vrai avec `sh`).
Non testé sur un vrai Windows : winget, UAC, `wireguard /installtunnelservice`, raccourcis, presse-papiers, connexion GitHub, aphrody/yolo Windows (non publiés au 2026-10-06).
