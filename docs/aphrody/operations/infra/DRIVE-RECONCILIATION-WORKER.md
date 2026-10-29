<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rapprochement privé des Agent Homes Drive

Le job Workspace `drive-review` rapproche les sept contrats DBFR (`AGENTS`, `SOUL`,
`IDENTITY`, `USER`, `TOOLS`, `HEARTBEAT`, `BOOT`, tous en `.md`) avec leur référence validée
et les documents natifs Google. Le timer déclaré continue ce travail quand les clients
Codex, Claude ou AGY sont fermés. La configuration propriétaire est
[`tools/config/host/agent-sync-vps.json`](../../../../infra/config/host/agent-sync-vps.json) ; son ordre
est téléchargement → revue → réplication → indexation. Le plan n'exécute aucune tâche :

```sh
bun packages/infra/workspace/src/agent-home-drive-sync.ts --config tools/config/host/agent-sync-vps.json
```

L'activation relève du plan/apply Infra déclaré. Le worker se lance ensuite avec le même
argument `--config` et `--apply`, depuis le bundle installé. Avant activation, qualifier un
tick sans changement puis une fixture contrôlée, avec les artefacts installés et leurs
empreintes exactes. Cette documentation ne démarre pas le timer.

Le premier tick vérifie les sept IDs, dossier parent, types, révisions, SHA natifs/locaux et
références. Il fige ces entrées dans `receiptRoot/<inputSHA>/inputs.json` et
`inputs/<name>.{local.md,native.json,baseline.md,baseline.native.json}`. Le hash comprend
tous les IDs, révisions et SHA ainsi que les empreintes des modules propriétaires ; aucun
contenu ou credential ne paraît dans les reçus publics. Répertoires `0700`, fichiers
réguliers `0600`, un seul lien physique, même UID et parents sans symlink sont imposés.

L'intention `review.json` et `active.json` est durable avant l'envoi par le SDK existant
`@aphrody/a2a`. `messageId` et `contextId` sont `drive-review-<inputSHA>` ; le peer déclaré
est `codex`, avec `returnImmediately:true`, `historyLength:0`. Le jeton reste dans le
fichier privé déclaré ; seules les requêtes l'utilisent en mémoire, après contrôle ASCII
et limite de 4096 octets. Aucun jeton ni contenu de conversation n'est copié.

Un ACK valide est persisté avant le retour du tick. Les passages suivants utilisent
`getTask` sans historique ; un ACK perdu utilise `listTasks` par contexte, sans artefacts.
Trois recherches sans résultat ou plusieurs tâches correspondantes bloquent l'entrée,
sans nouvel envoi. Un échec de la tâche garde également ce tombstone. Une entrée active
empêche les générations suivantes de soumettre des revues supplémentaires.

La tâche produit seulement `reconciliation-plan.json` et les propositions/explications
privées dans `reconciliation/`. Le validator Google propriétaire exporte
`refreshRevisions(api,owner,paths,binding)`, `preflight(api,owner,paths)` et
`apply(api,owner,paths)` ; aucun nouveau RPC, serveur MCP ou CLI alternatif n'est créé.
`paths` fournit home, state, stage, plan, journalRoot, lock et folder. `binding` fournit
inputManifestPath, expectedInputHash, originalPlanPath et originalPlanSha.

Le worker lie le plan aux entrées gelées, conserve `reviewed-plan.original.json` et son
SHA, puis rafraîchit les révisions avant préflight. Le tick suivant le fait **encore juste
avant préflight et apply** et persiste le nouveau SHA. Le refresh autorise uniquement une
rotation opaque de `revisionId` si tous les snapshots originaux restent identiques au Doc
actuel, hormis cette seule clé. Les requests, propositions et autres champs du plan restent
liés à l'original ; toute vraie modification distante exige une nouvelle revue après
résolution de l'entrée active.

Les proposals des Docs modifiés sont les octets RAW de `textRun.content` simulés, avec
indices UTF-16 et conservation des LF intérieurs, espaces et VT. Les fonctions pures
`modelDocument`, `simulate`, `renderedModel`, `verifyPlainProposal` permettent leur
validation locale. Le renderer `nativeMarkdown` ne fournit pas les octets de proposition.
Zéro requests conserve exactement le local et vérifie séparément la référence. Le writer
impose les révisions Google, les opérations minimales et les gardes de topologie/styles.

| Phase persistée | Action suivante |
| --- | --- |
| reserved | Retrouver l'ACK par contexte, sans renvoyer |
| submitted | Poller, vérifier les entrées gelées et préflighter le plan original |
| reviewed | Refresh lié à l'original, checkpoint du SHA, préflight et apply |
| applying | Consulter le journal natif ; jamais rejouer une écriture inconnue |
| seeding | Seeder seulement le `fresh-native` du journal complet, avec la garde Google actuelle |
| publishing | Publier les sept contrats vérifiés comme une génération complète |
| complete | Libérer active.json ; les changements suivants pourront être capturés |
| blocked | Garder les preuves privées et suspendre les consommateurs |

Un journal natif complet récupère une réponse apply perdue. Un journal partiel, échoué ou
inconnu interdit le rejeu. Seuls `OWNER_LOCK_BUSY` ou un échec propriétaire attestant
`noWrites:true`, `journalCreated:false` **et** l'absence vérifiée du reçu autorisent une
reprise en reviewed. Un échec du seed conserve le snapshot natif original et ne rejoue pas
apply ; une modification Google concurrente ne permet pas de seeder un état inconnu.

La publication `reviewed-current` est un symlink géré vers
`reviewed-current.generations/<generationSHA>/`. Chaque génération contient uniquement
les sept Markdown `0600` ; le manifeste et les checkpoints sont à côté, hors corpus.
Les SHA locaux et leurs références sont vérifiés avant et après la copie, puis après le
switch atomique. L'ancienne génération reste disponible ; un répertoire préexistant ou
un symlink étranger n'est jamais converti silencieusement. Le tick sans changement peut
initialiser cette projection sans tâche A2A ni écriture Google.

Revue pending/blocked, échec ou publication partielle suspendent `drive-replica` et
`drive-retrieval`. Leurs reçus `waiting` exposent explicitement le compteur correspondant.
La réplication utilise la génération validée, pas les documents actifs éventuellement
modifiés entre deux ticks. Elle vérifie les SHA distants et indexe DBFR via le
propriétaire natif. Le contrat installé et la liaison SSH protégée de l'unité restent des
prérequis du plan Infra. Les configurations sans `driveReview` gardent leur comportement.

Le 2026-10-07, la capture VPS et l'initialisation du pointer ont vérifié sept contrats
inchangés. `aphrody home index reviewed-current --label drive-dbfr-reviewed --profile dbfr`
a scanné et haché les sept fichiers, sans refus ni erreur ni changement. Le CLI canonicalise
la racine et le pipeline conserve des clés `label:relativePath` : ce switch ne duplique pas
la source déjà indexée. Les anciens snapshots staged restent des preuves privées ; le
timer indexe exclusivement la projection validée.

Les opérations de rapprochement, A2A et réplication sont autorisées dans la demande du
propriétaire. Installer les modules Google/review SHA-pinned déclarés, le bundle Workspace,
le contrat de réplication et le bundle Google dont `--seed-reviewed` vérifie les snapshots
contre Google courant. Le module review est
`/home/ubuntu/.aphrody/automation/drive-vps/drive-reconcile-review.mjs` ; sa SHA qualifiée
est inscrite dans la configuration. L'auth existante reste protégée, sans réauth ni copie.

Les reçus Workspace publiés localement ou par SSH utilisent uniquement des compteurs et
états allowlistés. La publication distante est Bun native, écriture temporaire `0600`, fsync
puis rename atomique. `uploaded:0` décrit le downloader historique ; `review_applied:1`
atteste séparément un rapprochement appliqué. Les fichiers de contexte indexés ne
synchronisent ni entraînement ni mémoire interne des fournisseurs ; les transcripts
restent dans leurs magasins protégés.

Les tests utilisent des fixtures privées et le SDK A2A avec un Transport injecté. Ils
couvrent ACK perdu, concurrence, tombstones, snapshots modifiés, refresh avant apply,
journaux complets/partiels, seed/reprise, génération immuable, gates et publication Bun.
Ils ne contactent ni Google ni un LLM. TypeScript strict et lint/format scoped complètent
ces portes ; ils restent distincts de l'activation et du smoke fermé-client du hub.
