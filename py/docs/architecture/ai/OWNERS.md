<!-- SPDX-License-Identifier: Apache-2.0 -->
# Logique IA, inférence et RAG

Relevé du 2026-10-05 (les trois checkouts sont depuis fusionnés dans le monorepo). Architecture commune :
plan Aphrody.

| Contrat | Propriétaire observé | Consommation |
| --- | --- | --- |
| Kernels RAG et classement | [rag-core Rust](../../../../crates/aphrody-rag-core/src/lib.rs) | Extension PyO3 `crates/ai/rag-python`, compilée dans la roue Python |
| Conversion NumPy/buffers | [adaptateur partagé](../../../packages/aphrody/src/aphrody/_rag_vectors.py) | Forensic float32 et RAPTOR float64 ; façade historique conservée |
| Inférence Python unifiée | [façade](../../../packages/aphrody/src/aphrody/inference/unified.py) | Un seul client HTTP/Harmony existant ; exécution chez le fournisseur configuré |
| Produit IA natif | [Aphrody AI](../../../../crates/ai/ai/src/lib.rs) | Fournisseurs, modèles, agents et RAG appartiennent à Aphrody |
| Calcul vectoriel Bun | [math/vectors](../../../../packages/yolo-core/src/math/vectors.ts) | Redis et adaptateurs Gemma ; aucun import métier dans le module de calcul |
| Runtime et ressources natives | Yolo | SDK et artefacts versionnés ; pas de copie des moteurs dans Python |

## Changements qualifiés

La normalisation, les produits matriciels, moyennes, distances et mises à jour
RAPTOR passent par une même adaptation de buffers. Les kernels restent natifs.
Les règles numériques float32 et float64 restent distinctes, notamment le seuil
de normalisation float64. Les sorties restent modifiables ; strides, endian,
axes vides et propagation des non-finis sont couverts par les tests existants.
Le module Forensic n'importe toujours pas les dépendances de graphe RAPTOR.

`UnifiedInferenceClient` ne fabrique plus de réponse locale ou distante. Il
réutilise `OpenAICompatibleReasoningClient`, transmet historique, système,
modèle et paramètres, puis rapporte les compteurs du fournisseur ou une estimation
explicitement identifiée par `usage_source`. Le modèle demandé prime ; à défaut,
le modèle du client s'applique, y compris les identifiants hors catalogue Gemma.

Migration consommateur : fournir `base_url` ou `APHRODY_INFERENCE_ENDPOINT`.
Jan conserve le défaut loopback port 1337. Les backends local, Jan, OpenAI et
Harmony utilisent ce transport. `thought` en préremplissage est refusé et
Gemini Web renvoie une erreur explicite orientant vers son client dédié.
Les erreurs HTTP et les réponses mal formées ne deviennent pas des succès.
Cette modification intentionnelle remplace l'ancien comportement simulé.

Yolo conserve les exports historiques des fonctions vectorielles, désormais
réexportées depuis leur propriétaire pur. Un test de bundle vérifie que Redis
n'embarque plus le graphe Gemma via cet import.

## Limites et suite nécessaire

- Le sampler et le client Gemma historiques délèguent désormais à la façade
  unifiée ; les CLI, MCP et HTTP suivent ce même chemin. Les helpers de benchmark
  et entraînement Gemma restent des surfaces distinctes non qualifiées comme
  exécution de modèles dans ce lot.
- Les contrats de vecteurs Bun et Rust ne sont pas interchangeables : accumulation
  JS double précision, refus des dimensions/non-finis et clamp côté Bun ; contrat
  f32 différent côté Rust. Une consolidation interlangage nécessite un binding
  qualifié et des tests numériques, pas un déplacement textuel.
- Le cosinus de `aphrody-memory` reste une implémentation séparée. La commande
  `scripts/build/rust/cargo-serial.sh check -p aphrody-memory --lib --locked`
  est refusée localement (code 64), avec routage imposé vers la fabrique VPS.
  Aucun code Rust modifié, aucun résultat Cargo revendiqué.
- Aucun modèle chargé, appel fournisseur externe, poids, index privé ou cookie
  utilisé. Tests HTTP loopback et extension native déjà installée seulement.
- Pas de nouvelle wheel, de runtime reconstruit, d'installation ou de déploiement.
  La consolidation globale IA des trois dépôts reste ouverte.

## CLI, MCP et HTTP — suite du 2026-10-05

Le [transport](../../../packages/aphrody/src/aphrody/inference/transport.py) est
commun à Harmony et à l'inférence unifiée. Le sampler ne crée plus de réponse ni
de compteurs simulés. Le streaming relaie les deltas SSE du fournisseur, avec
bornes de texte par événement/ligne et fermeture à la fin du consommateur.
L'itération asynchrone ne bloque plus la boucle d'événements ; une annulation
pendant une lecture synchrone attend sa fin, bornée par le timeout HTTP.

Le [service Gemma](../../../packages/aphrody/src/aphrody/gemma4/service.py)
possède la description des modèles et les résultats d'échantillonnage utilisés
par le SDK, le CLI et le MCP. La liste des outils enregistrés dérive du registre
MCP existant. Les comptes d'images/audio ne sont pas des médias : leur utilisation
comme entrées de génération échoue explicitement. Aucun repli silencieux depuis
Gemini Web/Antigravity vers le modèle local ; les stores et clients authentifiés
existants sont conservés. Le streaming Antigravity/Vertex non pris en charge est
refusé, et les erreurs fournisseur sont propagées.

Le [serveur HTTP](../../../packages/aphrody/src/aphrody/gemma4/server.py) adapte
les requêtes au même service : historique complet, paramètres et compteurs du
fournisseur préservés ; champs non supportés et upstream pointant vers lui-même
refusés. Un compteur absent reste identifié comme estimation. Les réponses
streaming correspondent aux événements reçus, pas à des mots reconstruits après
une génération complète. Tests via SDK, vrai sous-processus CLI, MCP et HTTP
loopback ; pas de génération avec des poids ni d'appel distant authentifié.

Yolo possède maintenant un [registre commun de capacités](../../../../packages/yolo-core/src/tools/registry.ts),
indépendant des enveloppes MCP et HTTP. `yolo ai list` expose le sous-ensemble IA ;
`yolo ai call yolo_ai_infer '{"prompt":"question"}'` utilise les mêmes schémas,
validation, contexte et fournisseur que MCP/API. Configurer
`YOLO_INFERENCE_ENDPOINT`, éventuellement `YOLO_INFERENCE_MODEL` et
`YOLO_INFERENCE_API_KEY`. Python conserve `APHRODY_INFERENCE_ENDPOINT` et les
arguments explicites de son client : aucun nouveau magasin de configuration.

Blocage Rust vérifié sur la fabrique : verrou lourd occupé (`flock -n` retourne 1)
et révision Aphrody distante `d06d00738a8f26857d8c057609a182a1e81e9994`, différente
du pin demandé `82d336f0e96c450a7323721506ba799965c6ce12`. Aucun job concurrent
interrompu, aucun contournement local, aucune suppression Rust sans qualification.
Le CLI Rust expose déjà `aphrody-command` par réexport ; les autres migrations
natives et les helpers ML restants ne sont pas déclarés achevés.

La capture installée `bun run cli:help --only yolo,aphrody-python --no-recursive`
recense un binaire et une absence (`aphrody-python`), code 1. Les nouvelles
commandes sont qualifiées depuis les sources ; ni binaire installé ni serveur
MCP persistant n'a été remplacé ou redémarré.
