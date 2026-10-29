# Pipeline Aphrody unifiée

Cette page décrit l’ancien pipeline à dépôts séparés. Les owners et commandes
ont depuis migré vers les workspaces de ce monorepo ; le catalogue root
`tools/config/pipeline.json` n’est pas une preuve que les anciens workspaces ou leurs
scripts existent encore. Vérifier chaque package dans le checkout courant et
consulter `docs/plans/infra/PLAN.md` pour l’état actuel. L’historique est gardé
comme contexte, pas comme procédure de release active.

## Runners

Chaque étape s’exécute dans `<workspaceRoot>/<repo>` :

- `bun` (défaut) : `bun <command>`, donc un script de `package.json` ;
- `just` : `just <command>`, une recette du `Justfile`. Les dépôts Rust purs
  (`aphrody-contracts`, `aphrody-shell`, `aphrody-native`) n’ont pas de
  `package.json` ; les dépôts Bun + Rust exposent leurs gates Cargo
  (`check`, `clippy`, `test`, `fmt-check`) par la même voie.

Les commandes listées plus bas appartiennent au plan historique et doivent être
requalifiées contre les manifests actuels avant de les exécuter.

## Commandes

```bash
bun run pipeline                 # afficher le graphe
aphrody-infra pipeline --stage check    # dry run : dépôt, manifeste et script/recette de chaque étape
bun run pipeline:stage format    # format/check docs
bun run pipeline:stage lint      # lint polyglotte (oxlint, clippy)
bun run pipeline:stage types     # type-check Rust/Bun/TS
bun run pipeline:stage unit-and-ui
bun run pipeline:stage build
bun run pipeline:stage release
bun run pipeline:stage all
```

Les stages parallèles sont isolés par dépôt ; le build et la release restent
ordonnés. Le build suit le graphe des dépendances Bun : `aphrody-compat`, puis
`aphrody-ui` (paquets M3 et `@aphrody/bun` sur la crate `aphrody-bun`),
`aphrody-web`, `aphrody-ai` et `aphrody-os`. Le Next 16 canary est consommé par
les applications qui le déclarent dans leur catalogue Bun, avec une seule
compilation du site par release.

L’ancien stage `release` exécutait `verify:release` d'`aphrody-ai` puis
`release:bundle` d'`aphrody-infra`, c'est-à-dire
`scripts/build/build-aphrody-stack-release.sh` : depuis un clone propre du
superprojet `aphrody-src` sur ext4 dans le conteneur `aphrody/build-linux:26.04` (ex-WSL Ubuntu-24.04, désinstallée ; préparé par
`scripts/prepare-release-workspace.sh` (not in repo), sous-modules à leur gitlink), il
construit le bundle unique de la VPS — la release Aphrody (cinq services, smoke
local attesté par `SMOKE.json`), et enregistre les 13 SHA des
sous-modules dans `BUNDLE.json` et `RELEASE_SHA`
([`IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md)). NIE et IECode ne
publient plus de release VPS selon cet état historique. Les tests Shell des
adaptateurs sont appelés directement (`bash scripts/test-atomic-deploy-<stack>.sh`)
quand le fixture correspondant est disponible ; aucun script racine
`test:adapters` n’est déclaré.

## Production

Ce pipeline historique ne constitue pas une autorisation de déployer. Pour un
déploiement actuel, revalider l’état et les prérequis dans le plan Infra et le
runbook immuable avant toute activation. La commande CLI Rust, quand elle est
explicitement choisie, est `aphrody-infra deploy --target vps --stack bundle --release
/home/ubuntu/apps/infra/bundles/ID --apply`, qui active Aphrody, chacun par son adaptateur atomique (Nginx validé, sondes loopback et HTTPS,
rollback), enregistre `BUNDLE.previous.json` et restaure les étapes déjà
activées si une étape échoue. `--stack <pile>` active une seule
pile. Les crawlers, mirrors et jobs lourds ne font pas partie du chemin
critique.

## Connaissance monorepo

```bash
bun scripts/tools/workspace/ecosystem.ts          # catalogue docs/ecosystem (--check en gate)
aphrody scan tree                                 # taille et nombre de fichiers par groupe
aphrody scan manifests                            # manifestes Cargo, package.json, pyproject
```

Le catalogue `docs/ecosystem/` recense dépôts, crates, binaires, features, paquets
Bun et uv, l’arbre exact des commandes clap et chaque outil MCP ; il est extrait de
la source et `--check` échoue quand la sortie commitée a dérivé. L’ancien scan
`bun run knowledge:scan` (`learn-monorepo.ts` et `config/knowledge-scope.json` (not in repo),
retirés le 2026-10-05) supposait un superprojet à sous-modules que ce monorepo n’a
plus.
