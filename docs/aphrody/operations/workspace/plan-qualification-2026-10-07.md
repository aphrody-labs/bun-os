<!-- SPDX-License-Identifier: Apache-2.0 -->

# Qualification du plan — 2026-10-07

Reprise de [PLAN.md](../../PLAN.md) dans le worktree principal Aphrody,
révision `5b15ec6b3`. Le dépôt contient une migration M3 non committée et du
travail concurrent déjà staged. Les résultats ci-dessous décrivent cet arbre
de travail ; ils ne qualifient pas un checkout propre de cette révision.

## Documentation

Les propriétaires Workspace ont été invoqués par `/home/aphro/aphrody/bin/yolo` :

- `ops docs links --root /home/aphro/aphrody` échouait sur deux références.
  Le manifeste racine retiré du rapport M3 est désormais identifié comme
  preuve historique absente ; le TODO décrit en texte l'ancien chemin utilisé
  par la CLI installée. Les conclusions historiques sont conservées.
- Après correction : 767 documents contrôlés, 2 429 liens locaux et 2 137
  chemins de code vérifiés ; zéro lien cassé et zéro chemin mort. Les arbres
  amont importés restent exclus selon les règles de cette gate.
- `ops docs generate --root /home/aphro/aphrody` a régénéré les index depuis
  leurs propriétaires. Inventaire observé : 204 crates, 95 paquets dans la
  génération racine et 3 756 documents ; zéro échec de génération.
- `ops docs check --root /home/aphro/aphrody` réussit après cette régénération :
  documents racine, index, écosystème et inventaire documentaire courants,
  zéro échec. `git diff --check` réussit dans le périmètre documentaire modifié.
- Les références générées décrivent les sources présentes, y compris les
  migrations non committées. Leur génération ne prouve aucune installation,
  activation, publication ni réussite des gates Rust/Bun.

La correction du [rapport M3](../../../m3/docs/reports/PRODUCTION-READINESS.md), le
[TODO](../../plans/workspace/CURRENT-BATCH.md) et les index restent avec le lot de migration en
cours. Ce reçu peut être livré indépendamment, sans inclure les modifications
des autres sessions.

## Runtime installé

`yolo runtime verify` réussit pour `yolo-runtime 0.1.0`, ABI 1.4,
installation `0.1.0-ae14394b`. `yolo runtime info --installed --json` expose
la cible `x86_64-unknown-linux-gnu`, révision `0ade1c71ccb5`, récupération des
panics et quatre capacités : `system.stats`, `bench.compute`,
`process.supervise`, `http.probe`.

Ces sondes vérifient l'installation existante. Elles ne démontrent pas une
activation du nouveau fork, une acquisition sur machine fraîche, l'ABI 1.5,
la disponibilité des moteurs browser/desktop ni l'exécution Windows.

## Dépendance Infra à fermer avant installation

La commande actuelle
`/home/aphro/.local/bin/aphrody infra --root /home/aphro/aphrody validate --json`
échoue avant validation : la CLI installée cherche encore l'ancien chemin
config/service-catalog.json. Le catalogue courant est
[tools/config/service-catalog.json](../../../../infra/config/service-catalog.json).

Le journal de la précédente gate de fabrique des consommateurs de
configuration a également été consulté : 74 tests Infra passent, deux
échouent en chargeant les routes nginx sous la racine de sources distante.
Ce journal est une preuve d'échec antérieure, sans nouvelle exécution ni
processus de gate actuellement vérifié. Il ne faut pas relancer un travail
sur la seule base de son claim ou déclarer ses tests verts.

La prochaine livraison Infra doit qualifier les chemins de catalogue dans
le snapshot exact de fabrique, réussir les gates scoped requises, puis
installer le binaire qualifié et refaire la validation native. Restaurer un
catalogue dupliqué à l'ancien emplacement ne ferme pas la migration.

## Limites de clôture du plan

Les six critères de succès de PLAN restent à prouver : absence de recompilation
des moteurs lors d'un changement produit, extension Rust sur SDK léger,
teardown et annulation des ressources, droits natifs, compatibilité et rollback
sur les cibles supportées, puis mesures comparables de build/taille/mémoire.
La gate documentaire et la sonde du runtime ne suffisent pour aucun de ces
critères dans sa portée complète.

Les autres items ouverts du plan conservent leurs exigences : consolidation
du monorepo, MCP unique, kernel/shell, purge CLI, téléchargements, Yolo Windows,
activation et acquisition du runtime, desktop réel,
authentification MCP HTTP, agent-home, parité du graphe, publications et
hygiène des dépôts. Leurs reçus antérieurs servent de points de départ ; ce
lot ne les marque pas terminés. Les échecs globaux web et TypeScript restent
à vérifier dans leurs périmètres propres.
