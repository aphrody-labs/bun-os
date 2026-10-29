> **Legacy fork notice (2026-10-29).** This document predates the move to the unmodified upstream `bun` npm package (`1.4.4-canary.20261028.1`). The abandoned Bun fork, its fork-only commands, `bun:*` modules and `toolchains/bun` named here are history, not current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Yolo : modèle de décision privé

Demande propriétaire du 2026-10-13 : exploiter Pydantic dans Python via le fork
Bun/PyO3/Buv, créer Yolo et un SDK compatible TypeSafe en étudiant le clone
explicitement demandé de `typesafe-ai/system-one-adapter-python`.

## Propriétaires et contrat

Aphrody conserve l'application dans `aphrody.decision`. Rust `aphrody-jev`
conserve inférence, routage, validation des distributions et sélection avec
abstention. Le fork Bun fournit `bun:python`/`buv:python`, CPython, le host natif,
PyO3 et `bun uv`. Aucun de ces moteurs n'est recopié dans Python. Yolo reste un
backend privé : une décision propose une action et ne l'exécute ni ne l'autorise.

`DecisionInput` expose objectif, observations explicitement sélectionnées,
catalogue d'actions, modèle, seuil et délai. Le graphe Pydantic Graph lance un
Agent Pydantic AI sans outil exécutable et sans retries, avec un adaptateur de
modèle déléguant exactement un appel au serveur Rust `/v1/systemone`.
Le seuil est envoyé à Rust comme `minimum_confidence`; son champ `selections`
est obligatoire. Python ne recalcule ni confiance ni sélection. Les sorties
portent candidat, sélection/abstention, distribution, modèle et usage.
La voie SDK Bun empruntée et l'usage explicitement non mesuré (`None`) sont
décrits dans [la bascule consommateurs](BUN-CUTOVER.md). Les chemins HTTP et le
host existants sont conservés jusqu'aux gates natifs du binaire Bun et de
l'ABI SDK 1.6 ; les fixtures applicatives ne qualifient pas cette activation.
HTTP distant sans TLS, credentials dans URL et redirections sont refusés.
Le client HTTP emprunté peut recevoir l'authentification du service privé.
Les helpers acceptent un token explicite; le pont lit uniquement la référence
host privée `APHRODY_YOLO_DECISION_TOKEN`, sans aucune découverte de clé fournisseur.
Le pont JSON `decide_json` utilise un endpoint configuré explicitement, sans
découverte de credentials ou de fournisseur. Instrumentation Agent/Graph désactivée.

## Ressources Pydantic exploitées

| Ressource primaire | Utilisation |
| --- | --- |
| [Pydantic](https://github.com/pydantic/pydantic) | Contrats stricts, schémas JSON, sérialisation et validation |
| [pydantic-core](https://github.com/pydantic/pydantic-core) | Extension native de validation consommée via Pydantic, sans copie Rust |
| [Pydantic AI](https://pydantic.dev/docs/ai/core-concepts/agent/) | Agent typé, adaptateur de modèle Jev, limite d'un appel |
| [Pydantic Graph](https://pydantic.dev/docs/ai/graph/graph/) | GraphBuilder typé et workflow borné |
| [Pydantic Evals](https://pydantic.dev/docs/ai/evals/evals/) | Cas étiquetés, séparation train/validation/test et évaluation hors apprentissage |
| [System One Adapter](https://github.com/typesafe-ai/system-one-adapter-python) | Dépendance optionnelle réelle pour comparaisons multi-fournisseurs, testée avec fournisseur synthétique |
| [TypeSafe SDK](https://github.com/typesafe-ai/typesafe-sdk-python) | Types publics, client sync/async, vues Noul/Choice/Score, erreurs et lifecycle réutilisés |
| Logfire API, genai-prices | Dépendances amont consommées, aucune télémétrie ni tarification facturée qualifiée |
| Settings, extra-types, jiter, Monty, HTTPX2 | Inventoriés dans l'organisation; HTTPX2 est consommé par le SDK. Pas de nouveau store de secrets, parseur ou sandbox concurrent |

Pins résolus dans `py/uv.lock` : Pydantic 2.14.1, pydantic-core 2.50.1,
AI/Graph/Evals 2.55.0, typesafe-sdk 0.7.4, system-one-adapter 0.2.1.
Les extras `aphrody[decision]` et `aphrody[decision-compare]` restent optionnels.
L'import principal `aphrody` ne charge pas ces dépendances.

Clone amont temporaire demandé : HEAD
`e1d4cc938204b22fc5a3c3aca7044072fe3f712d`, licence MIT, version 0.2.1.
Sources et tests lus directement; aucun arbre ni algorithme fournisseur copié.
Le SDK Yolo adapte les descriptions JSON facultatives vers les descriptions
textuelles Rust et conserve les primitives et réponses du vrai SDK TypeSafe.
`comparison_client` renvoie le vrai client System One Adapter, pas une imitation.
Les modes fournisseurs, retries correctifs, streaming et diagnostics du paquet
amont ne sont pas des capacités du serveur Rust et ne sont pas revendiqués comme
parité Yolo. Les diagnostics amont restent chez l'appelant et ne sont pas persistés.

## Données et apprentissage

`LabeledDecision` impose provenance (`synthetic` ou `owner_labeled`), split,
identifiant unique et label dans le catalogue. `training_jsonl` exporte seulement
les lignes train fournies; `evaluation_dataset` utilise exclusivement validation
ou test. L'appelant conserve ces données dans son store protégé. Aucune session,
conversation, clé, cookie ou observation réelle n'est capturée automatiquement.

Ce lot fournit un modèle applicatif et un protocole d'inférence, **pas des poids
Yolo entraînés**. La qualification d'une politique apprise exige encore un corpus
autorisé représentatif, objectifs de qualité/calibration, modèle de base choisi,
budget et hôte d'entraînement qualifiés. Réutiliser les propriétaires
`aphrody-train`/Bun pour l'apprentissage; aucun second moteur en Python.

- [x] Contrats Pydantic, Agent, Graph et SDK TypeSafe réels.
- [x] Cas synthétiques, export train et Pydantic Evals.
- [x] Pont natif Bun/CPython/Pydantic et roundtrip HTTP synthétique.
- [ ] Corpus propriétaire et critères de qualité.
- [ ] Entraînement et artefact de poids vérifié.
- [ ] Inference réelle sur cet artefact, calibration et tests hors entraînement.
- [ ] Installation du package et activation du backend privé sur chaque hôte.

## Lifetime natif

Le consommateur Bun `decision/bridge.ts` **emprunte un `PythonAsync` vivant**.
L'appelant ouvre un seul host pour tout le pipeline et le ferme après ses
opérations; le binding ne réinitialise pas CPython par décision. JSON représente
une copie sérialisée, pas des objets ou buffers partagés.

Un échec natif `0xC0000374` (Windows heap corruption) a été observé lorsque des
tests fermaient un host ayant importé Pydantic puis réouvraient le host pour le
workflow dans le même processus Bun. Le roundtrip seul et le pipeline avec un
seul host passent. La cause n'est pas formellement démontrée; l'observation est
cohérente avec les limites de réinitialisation des extensions documentées par
[CPython](https://docs.python.org/3.12/c-api/init.html#c.Py_FinalizeEx) et
[PyO3](https://pyo3.rs/main/doc/src/pyo3/interpreter_lifecycle.rs.html).
La réinitialisation après import d'extensions reste non qualifiée.

## Preuves du 2026-10-13

Windows natif, Bun owner-built `1.4.4` revision
`2ae8fc65fba1d05c423a2433b1195835109942b6`, CPython Aphrody 3.12.15.
Host `bun_python_host.dll` compilé et qualifié séparément par le coordinateur;
ses chemins proviennent de la configuration host, jamais d'un chemin produit.

- 26 tests Python locaux : contrat HTTP/auth (401 et succès), Agent/Graph, abstention, malformed output,
  annulation, erreurs, Evals/splits, SDK sync/async et comparaison amont réelle.
- 2 tests Bun, 13 assertions : identité Bun/Buv, PID CPython = Bun, validation
  pydantic-core, schéma et décision via vrai host + HTTP synthétique.
- Mypy : 6 fichiers, aucune erreur. Ruff lint/format et lock uv contrôlés.
- 35 tests schema/probability/confidence du clone amont passent sans réseau.
  La suite amont fake-model ne collecte pas avec typesafe-sdk 0.7.4 : fixture
  `Score(criteria=[])` rejetée avant exécution. Ce résultat n'est pas une
  qualification complète de l'adaptateur amont.

Aucun appel fournisseur réel, entraînement, poids, wheel installé ou déploiement
de service n'est revendiqué. La `.venv` Python préexistante ne permettait pas
d'importer BaseModel; les gates utilisent un environnement isolé créé par le fork
Bun uv et les pins ci-dessus, sans altérer cet environnement concurrent.
