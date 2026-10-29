# Orchestration RG ↔ Niers

Ce document est le registre opératoire commun aux deux dépôts. Il décrit ce
qui est réellement synchronisé, ce qui ne l'est pas, et les preuves à rejouer.
Le fichier de référence est dans `rg` afin de ne pas dupliquer une logique
d'automatisation dans Niers.

## Frontière des responsabilités

| Surface | Dépôt canonique | Consommateurs | Règle |
| --- | --- | --- | --- |
| Formats IEVR, parseurs Rust/Bun, manifests, données de jeu et outils NIE.exe | `nie` | services NIE, poste de travail | Les données lourdes et dérivées restent locales et ne sont jamais auto-ajoutées. |
| Miroirs SQLite, `var/`, `target/`, `.next/`, cache modèle | machine qui exécute le service | services locaux | Artefacts régénérables, hors Git et hors synchronisation. |
| CDN originaux et variantes | service partagé du VPS | Niers | `cdn-variants.service` reste actif : l'arrêter casserait le site. |

`nie/data/azalee` (ex-`nie/apps/azalee/data` : l'app `apps/azalee` (not in repo) de
`niers` n'existe plus) est encore un chemin de compatibilité consommé par le
MCP et certains scripts. L'API publique Azalée est désormais montée dans
`rg-api.service`; il n'existe plus de démon `azalee-api` séparé. Il ne s'agit
pas d'une seconde source de code web. Le nettoyage automatique ne supprime
donc pas ce répertoire.

Les dépôts ne sont jamais fusionnés par un `pull` : chacun suit son propre
remote et sa propre branche. Un changement transversal est un changement
coordonné dans deux commits, reliés par le registre de livraison, pas un
`git merge` entre arborescences.

## Commande canonique

Depuis `../rg` :

```bash
# lecture seule : état des deux arbres et fichiers qui seraient checkpointés
bun scripts/ops/repo-sync.ts --repo all --commit --dry-run --json

# synchronisation volontaire : fast-forward, checkpoint sûr, push de chaque dépôt
bun scripts/ops/repo-sync.ts --repo all --pull --commit --push

# même opération sur un VPS accessible par une clé SSH
REPO_SYNC_VPS=mon-alias \
REPO_SYNC_REMOTE_RG_ROOT=../rg \
REPO_SYNC_REMOTE_NIE_ROOT=~/nie \
bun scripts/ops/repo-sync.ts --repo all --pull --commit --push --vps
```

`--pull` fait `fetch --prune` puis `merge --ff-only`. Un arbre modifié est
refusé : aucun stash, reset, rebase ou force-push n'est caché dans le script.
`--commit` crée `chore(sync): checkpoint <UTC>` seulement après
`git diff --check`. Les chemins secrets, bases SQLite, `.env`, sources Astro,
`node_modules`, `.next`, `target`, `var`, `outputs` et caches sont refusés avant
`git add`. `--push` exige la branche demandée et un arbre propre. Le script ne
lance jamais `deploy.ts`, ne redémarre jamais un service et ne modifie jamais
le contenu d'un autre dépôt.

La variable `REPO_SYNC_AUTOCOMMIT=1` active le checkpoint sans option CLI ;
`REPO_SYNC_PUSH=1` active le push. Elles sont désactivées par défaut. Le
wrapper `bun run ops:sync` est volontairement explicite et le contrôle rapide
est disponible avec `bun run ops:sync:check`.

## Publication coordonnée

`release-stack.ts` orchestre le même enchaînement sans mélanger les deux dépôts :
Git, régénération des données et miroir, formats, WASM, serveur de modèles,
gates Azalée, build bleu/vert, CDN/nginx puis sondes publiques. Le mode par
défaut est sans écriture :

```bash
bun run release:check
```

Les mutations sont explicites et arrêtent la chaîne à la première étape en
échec :

```bash
# prévisualisation sur le slot B, sans promotion
bun run release:preview

# promotion du slot déjà validé
bun run release:promote

# publication directe après les mêmes gates (push Git inclus)
bun run release:deploy
```

`--dry-run` affiche les mutations sans les exécuter. `--skip-*` permet une
reprise bornée, mais ne transforme pas une compilation en preuve navigateur :
la validation réelle doit encore charger `/avatar`, importer PNG et GLB/gzip,
exporter, sauvegarder/restaurer et ouvrir un partage. Une promotion n'est
autorisée qu'après le smoke test public et la vérification des réponses HTTP.

## Politique Markdown

La règle de livraison est : tout Markdown source du produit, de sa
documentation ou d'un paquet distribué est suivi par Git. Le contrôle qui a
servi à cette livraison est reproductible :

```bash
git ls-files '*.md' | wc -l
git ls-files --others --exclude-standard '*.md'
git ls-files --others -i --exclude-standard '*.md'
```

Les sorties générées (SEO `public/llm*.md`, rapports de crawl, snapshots de
`data/`), dépendances (`node_modules`, `.venv`), builds et caches restent
ignorées : les versionner ne fournirait pas une source révisable et ferait
entrer des données locales dans l'autocommit. Les instructions privées
Les notes locales d'outillage restent également hors publication ;
leur présence et leur rôle sont documentés dans les règles de chaque dépôt.
Toute exception doit être ajoutée explicitement au `.gitignore`, relue par un
agent, puis validée par `git diff --check` avant le checkpoint.

## Contrôle Git manuel sur le VPS

L'ancienne unité `rg-repo-sync.service` est retirée dans le catalogue Infra.
Le 2026-10-04, le VPS catalogué rapporte `LoadState=not-found` et
`ActiveState=inactive`. Ses fichiers service/timer liés aux anciens checkouts
ont été supprimés ; ne pas les réinstaller. Le contrôle utilise le propriétaire
Infra (`aphrody-infra git --help`) avec les dépôts explicitement configurés.
Preuves de qualification hôte.
Pour un checkpoint volontaire,
lancer directement `bun scripts/ops/repo-sync.ts --repo all --commit` après
vérification de l'arbre ; aucune unité ou variable d'environnement ne l'active
automatiquement.

## Poste local et accès SSH

Le script supporte un poste local et un VPS distincts, mais ne devine pas un
hôte. Sur la machine où ce registre a été vérifié le 2026-09-05, l'alias
`vps-tunnel`/`ovh-vps-direct` n'est pas défini ; `newvps` pointe vers un hôte
qui ne contient ni `../rg` ni `~/nie`. Il serait donc
incorrect de déclarer la synchronisation locale comme fonctionnelle. Pour
l'activer, créer un alias SSH non interactif avec une clé dédiée et les deux
racines présentes, puis renseigner `REPO_SYNC_VPS`,
`REPO_SYNC_REMOTE_RG_ROOT` et `REPO_SYNC_REMOTE_NIE_ROOT`. La sonde à
exécuter avant activation est :

```bash
ssh -o BatchMode=yes "$REPO_SYNC_VPS" \
  "test -d '${REPO_SYNC_REMOTE_RG_ROOT:-../rg}' && test -d '${REPO_SYNC_REMOTE_NIE_ROOT:-~/nie}'"
```

Tant que cette sonde échoue, le timer local reste un checkpoint local et ne
prétend pas synchroniser une machine absente.

## Allègement et nettoyage contrôlé

Le cache GLB de `nie-model-serve` est régénérable. Le pruner refuse un service
actif par défaut, ne suit aucune symlink, ne touche pas `VERSION` et n'accepte
que `~/nie/var/model-cache` :

```bash
# aperçu (conserve les fichiers de moins de 24 h)
bun scripts/ops/prune-runtime.ts --max-gib 6 --dry-run

# après arrêt contrôlé de nie-model-serve, purge vers 6 Gio
sudo systemctl stop nie-model-serve.service
bun scripts/ops/prune-runtime.ts --max-gib 6 --min-age-hours 0
sudo systemctl start nie-model-serve.service
curl --fail --silent http://127.0.0.1:8790/health
```

`--prune-debug-target` peut retirer uniquement `nie/target/debug` après une
lecture de `/proc`; il ne s'exécute pas si un processus utilise un exécutable
de ce répertoire. `target/release` (not in repo) (generated or machine-local artifact; presence depends on the build host), les données de jeu, les bases, les logs et
les caches d'outils ne sont pas effacés par défaut.

Le serveur modèle est configuré avec un budget CPK et un pool bornés, sans
préchargement global : `NIE_CPK_CACHE_BUDGET_GIB=4`, deux workers,
quatre threads HTTP, file de 128, cache mémoire explicite de 128 Mio,
`MemoryHigh=5G`, `MemoryMax=7G`, `MemorySwapMax=1G`, `CPUWeight=80`.
Cette stratégie privilégie une latence de premier modèle contre un pic de
14 Gio créé par le preload de 6 387 modèles. Toute modification de ces bornes
doit être suivie de `/health`, d'une requête GLB réelle et d'une mesure
`systemctl show`.

## Preuves minimales avant publication

```bash
bun scripts/ops/repo-sync.ts --repo all --pull --commit --push
git -C ~/nie status --short --branch
systemctl is-active website-web.service nie-model-serve.service cdn-variants.service
```

Pour le wiki Azalée intégré, rejouer ensuite les tests pertinents de Website, le type-check, le lint/build et
le smoke navigateur (imports PNG/GLB, export, sauvegarde/restauration,
partage). Une compilation verte n'est pas une preuve de rendu WebGPU ni de
fichier média 200. Pour Niers, utiliser les tests ciblés documentés dans
`nie/docs/FUSION.md` et ne jamais publier une mesure pixel-perfect sans
comparaison mesurée.
