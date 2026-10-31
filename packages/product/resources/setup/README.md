<!-- SPDX-License-Identifier: Apache-2.0 -->

# setup

`Aphrody-Setup.exe`, l'installeur en un clic pour tout le monde : c'est le bouton « Download Aphrody » de
aphrody.com (artefact `aphrody-setup`, kind `desktop`, de `tools/config/downloads.json`). Un double clic, deux questions
(rôles en option), et tout est installé ou réparé, en français, sans ligne de commande :

| Étape               | Ce qu'elle fait                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Ce programme        | se copie dans `%LOCALAPPDATA%\Aphrody\Setup` (réparer, mettre à jour)                         |
| aphrody             | le binaire unique (CLI et serveur MCP) par `install.ps1` du site, empreintes vérifiées        |
| yolo                | l'installateur officiel de yolo sur une release vérifiée                                      |
| Plugins Claude      | aphrody et yolo dans une marketplace locale `aphrody-local`, installés par `claude plugin`    |
| MCP                 | `aphrody-mcp` (ou `aphrody mcp-server`) dans Claude Desktop (sauvegarde avant) et Claude Code |
| Raccourci           | « Aphrody » sur le Bureau (rouvre cet installeur)                                             |
| Rôle administrateur | Git et WireGuard, clés, accès de l'équipe, copie du dépôt, puis `Aphrody-Omar.exe`            |
| Rôle créateur       | `creator-kit.exe` depuis creator.aphrody.com dans `%LOCALAPPDATA%\Aphrody\Creator`            |

Le moteur est celui d'omar-kit (étapes répétables, simulation, téléchargements recoupés avec `SHA256SUMS`, mise à jour
automatique en arrière-plan par l'artefact `aphrody-setup` `.tar.gz`) ; ce paquet n'ajoute que les étapes ci-dessus.
Les composants de downloads.aphrody.com partagent une seule sélection de release par exécution :
`latest.json` est lu une fois, puis les scripts, sommes et artefacts viennent de `/releases/<id>/`.
Les scripts PowerShell sont vérifiés par SHA-256 avant exécution ; `install.ps1` reçoit
`APHRODY_RELEASE` pour conserver la même sélection. Le kit créateur conserve son canal distinct
creator.aphrody.com. Les archives des kits et plugins refusent traversées, liens et entrées
spéciales avant écriture. Les kits restaurent les fichiers précédents en cas d'échec de promotion ;
les plugins sont extraits à part puis remplacés par renommage.

Sans assistant : `Aphrody-Setup.exe --oui [--roles admin,createur] [--simuler]`. Les équivalents en ligne de commande
sont `install.ps1` et `install.sh` du site (composants `all` par défaut).

Construction locale (rien n'est publié) : `bun scripts/release/stage-setup.ts [--smoke]` écrit dans `dist/` (ignoré par
Git) l'exe, son archive de mise à jour, `SHA256SUMS` et `aphrody-setup.manifest.json`, que
`scripts/release/publish-downloads.ts release` publie. L'exe est compilé par Bun, marqué de l'icône pet
(`crates/ui/identity/assets/brand/favicon.ico`) par rcedit sous Wine, et **non signé**.

Développement : `bun test`, `bun check --noEmit -p tsconfig.json`. Non testé sur un vrai Windows : installeur NSIS de l'app
(pas encore produit), `claude plugin` et `claude mcp` réels, raccourcis, UAC.
