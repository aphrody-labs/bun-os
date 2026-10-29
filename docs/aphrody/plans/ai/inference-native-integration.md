<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inférence native — plan propriétaire

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).

Décisions communes : [plan AI](native-integration-master.md).
Inventaire initial : 2026-10-01 ; état courant à qualifier par lot.
Aucune parité live Ollama/vLLM/mistral.rs déduite des sources.

## Owners et frontières

| Capacité | Owner et contrat |
| --- | --- |
| Providers/streaming | `aphrody-model-client`, `ModelClient`/`ModelStreamEvent` ; identités dans `providers` |
| Tour agent | `engine`/`agent-runtime` |
| Weights/catalog/GPU/stores | `models`, stores protégés |
| GGUF/mtmd/LoRA/grammar | `koharu-llama`/`koharu-llama-sys` |
| Safetensors/vision/paged attention | Mistral.rs Rust 0.9.4 précompilé, runtime déclaré par Infra ; consommateur `model-client` |
| ONNX | `infer`, fallback execution provider |
| Façade API locale | `gateway` sur les owners `ModelClient` |
| Retry/cache/cost | `llm-infra` |
| Antigravity | Client `antigravity` + adapter `model-antigravity` |
| Gemini CLI | Adaptateur produit externe ; distinct du moteur local |

Ne pas supprimer la façade serveur gateway en fusionnant son client avec
model-client. Migrer chat/ai avant retrait de router. Les enveloppes Jev et les
clients OCR ne constituent pas une seconde façade OpenAI identique.

## Queue et gates

| Ordre | Travail | Preuve requise |
| --- | --- | --- |
| 1 | Qualifier NVML et lecteur Ollama dans `models` | Tests, absence driver → CPU, host gating, wasm préservé |
| 2 | Résoudre un tag Ollama en GGUF installé | Store read-only, `OLLAMA_MODELS`, manifests/blobs, refus `..` |
| 3 | `InProcessLlama` sur koharu-llama | `ModelClient`, streaming/cancellation ; migration agent-runtime/Jev/app-server/CLI puis retrait daemon/supervisor/caps |
| 4 | Qualifier le moteur Rust Mistral.rs sur Omar | Image CUDA/SM89 épinglée, GPU exclusif, vrai chat/SSE/annulation ; Windows CUDA et autres modèles restent séparés |
| 5 | Unifier façade API et consommateurs | Parité gateway/routes ; chat/ai sur model-client ; retrait des doublons qualifiés |
| 6 | Migrer OCR VLM vers mtmd | Même contrat OCR sans CLI par page |

Endpoints utilisateur externes restent des backends sélectionnés, pas un
fallback local implicite. Ollama/vLLM : HTTP en processus, aucun import Python
ni lancement de leurs binaries. `infer/src/llama.rs` discovery reste utile aux
consommateurs CLI/bench jusqu'à migration.

## Sous-ensemble rapporté le 2026-10-01

`models/src/accel.rs` utilise NVML ; parser public `parse_nvidia_smi` conservé.
`models/src/ollama.rs` décrit `OllamaName::parse`, `OllamaStore::{discover,at,resolve,list}`
et `OllamaModel::{gguf_path,layer,read_text}`. Stockage :
`registry.ollama.ai/library:latest`, `blobs/sha256-<hex>`,
`application/vnd.ollama.image.model`. Qualifier contre le pin choisi.

## Dépendances et risques

Les versions/pins des crates restent dans Cargo manifests/lockfile ; les
artefacts runtime sont épinglés dans leur contrat Infra. Le
[plan AI](native-integration-master.md) fixe la sélection.
Sélectionner les artefacts CUDA/Metal/etc. explicitement, jamais par défaut. Candle/tokenizers
peuvent exister en plusieurs versions ; aucun type partagé sans qualification.
NVML charge `libnvidia-ml` dynamiquement ; WSL : `/usr/lib/wsl/lib`.
Aucun poids ni secret déplacé par la migration.

Checks/tests/Clippy ciblés via le wrapper sérialisé et la fabrique propriétaire.
Présence des APIs et lecture des manifests ne valent pas test d'exécution.

## Lot Rust GPU du 2026-10-09

Le crate sans consommateur `engine-mistralrs` et ses dépendances ont été retirés par `81d968bf69`. La nouvelle demande propriétaire sélectionne un **moteur Rust réel**, fourni par l'image officielle Mistral.rs 0.9.4 CUDA 12.8/SM89, plutôt que de restaurer le crate retiré. Le manifeste AMD64 vérifié par le VPS est épinglé dans [le runtime Infra](../../../../tools/aphrody/config/container/mistral-fleet/README.md).

Le custom provider Mistral.rs pointe sur le moteur privé d'Omar, sans Python ni moteur Rust copié dans Aphrody. Le gateway reprend l'environnement canonique `APHRODY_AI_HTTP_TOKEN` et refuse un bind hors loopback sans credential.

Qualification encore ouverte : pull/sonde du runtime d'Omar, chargement ISQ4
et consommation mémoire réelle, chat et SSE, annulation, rollback vLLM puis
activation Mesh. Le port Mistral.rs `8181` reste exclusivement loopback ;
la façade gateway possède l'authentification sur le mesh. Les builds Cargo
passent par la fabrique VPS ; aucun Cargo, chargement GPU ou moteur lourd sur
le PC de développement. Le gateway actuel expose chat texte/historique/
sampling/usage, et refuse les outils non pairés ; `ModelClient`/MCP conservent
les contrats complets outils/vision. Aucune parité totale n'est déduite de ce lot.
