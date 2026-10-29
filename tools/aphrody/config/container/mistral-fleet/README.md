<!-- SPDX-License-Identifier: Apache-2.0 -->
# Mistral.rs sur le GPU dédié d'Omar

Le moteur est le binaire Rust officiel Mistral.rs **0.9.4**, précompilé CUDA
12.8 pour Ada/SM89, dans son image Linux AMD64 épinglée. Docker Desktop d'Omar
possède l'exécution ; aucune compilation, allocation GPU ou inférence ne part
du PC de développement. Le modèle vient du catalogue GPU Aphrody et du volume
protégé déjà vérifié, sans téléchargement flottant ni copie de données privées.

Le [contrat](runtime-contract.json) distingue déclaration et qualification.
L'[upstream 0.9.4](https://github.com/EricLBuehler/mistral.rs/blob/v0.9.4/docs/src/content/docs/reference/supported-models.md)
déclare `Gemma4ForConditionalGeneration` et ISQ pour les modèles multimodaux.
Cela ne démontre ni la consommation mémoire ni la génération sur la RTX 4060.
Les processeurs images/audio, les LoRA entraînées, les embeddings et le
multi-nœud nécessitent leurs propres poids et preuves ; cette configuration ne
les présente pas comme activés.

L'[image officielle](https://github.com/EricLBuehler/mistral.rs/blob/v0.9.4/Dockerfile.cuda-all)
ne compile rien au démarrage. Le tag `cuda128-sm89-0.9.4` a été résolu par
`docker manifest inspect` sur le VPS le 2026-10-09, puis le manifeste AMD64 a
été épinglé dans [Compose](compose.yaml). Aucun artefact Windows CUDA n'est
qualifié ; le chemin courant est le moteur Rust Linux dans Docker d'Omar.
Le [workflow officiel de release](https://github.com/EricLBuehler/mistral.rs/blob/v0.9.4/.github/workflows/release.yml)
déclare la construction et la publication de ce tag CUDA/SM89. Le digest est
vérifié, mais aucune signature de provenance n'a été qualifiée dans ce lot.

## Plan et application

Le propriétaire Infra vérifie d'abord la configuration sur **Omar**, avec le
fichier hôte protégé qui fournit `APHRODY_GPU_MODEL_PATH` (chemin interne du
snapshot de poids vérifié). Il tire l'image et confirme le volume de modèle.

```sh
docker compose --env-file <host-protected.env> -f compose.yaml config --quiet
docker compose --env-file <host-protected.env> -f compose.yaml pull probe
```

Le binaire CUDA lie `libcuda.so.1` avant même de traiter son aide. La sonde
sans GPU `run --rm probe` a donc échoué sur le VPS sans driver, après un pull
réussi. Sur Omar qualifié, utiliser le profil qui injecte le driver, avec une
commande de métadonnées exclusivement : aucun poids chargé et aucun port
publié par ces `run`, sans `--service-ports`.

```sh
docker compose --env-file <host-protected.env> -f compose.yaml run --rm --no-deps standalone --version
docker compose --env-file <host-protected.env> -f compose.yaml run --rm --no-deps standalone serve --help
```

L'allocation GPU est exclusive : arrêter le service vLLM **déclaré** et vérifier
sa sortie avant d'appliquer `standalone`. Ne jamais lancer en même temps
Mistral.rs, vLLM et un train GPU. Pour rollback, arrêter Mistral.rs puis
reprendre le profil vLLM déjà qualifié ; conserver les volumes et les poids.

```sh
docker compose --env-file <host-protected.env> -f compose.yaml up -d --no-build standalone
```

Le moteur écoute uniquement sur `127.0.0.1:8181` du PC d'Omar. Mistral.rs n'a
pas d'authentification Bearer dans ce contrat : ne jamais publier ce port sur
le mesh ou Internet. La façade `aphrody ai gateway` porte l'authentification
des consommateurs ; le MCP unique reste `aphrody-mcp`, sans `--mcp-port`
Mistral.rs et sans second agent disposant de shell privilégié.

## Consommateur Rust commun

Configurer le provider dans le home Aphrody d'Omar, en préservant le reste du
fichier. `model` doit être exactement l'identité renvoyée
par `GET http://127.0.0.1:8181/v1/models`, pas une identité inventée.

```toml
model_provider = "mistralrs"
model = "<model-id-returned-by-the-running-engine>"

[model_providers.mistralrs]
name = "Mistral.rs Rust CUDA"
base_url = "http://127.0.0.1:8181/v1"
wire_api = "chat"
```

`ModelFactory` résout ce provider pour les agents, CLI, desktop et MCP. Le
nouvel adaptateur gateway réutilise le même `ModelClient` :

```sh
aphrody ai gateway serve --provider mistralrs --addr 127.0.0.1:8786
```

`--provider configured` prend le provider actif du home, sans
inventer de checkpoint entraîné ni de nouveau builtin. Le gateway actuel est un
contrat **chat texte** : historique, sampling, streaming et usage. Les appels
d'outils et les entrées vision riches restent sur `ModelClient`/MCP ; des
résultats d'outils sans identifiant sont refusés, jamais transformés en succès.
Le token `APHRODY_AI_HTTP_TOKEN` du gateway et celui d'un upstream authentifié
sont distincts. Un bind hors loopback est refusé sans ce token dans le store
d'environnement protégé de l'hôte (`APHRODY_OS_AUTH_TOKEN` reste un alias lu).

Après chargement réel, qualifier `/v1/models`, un chat non streaming, le SSE,
l'erreur de modèle inconnu, l'annulation et le rollback avant activation
persistante dans le Mesh. Un `/health` 200 ne suffit pas.

## Surfaces et propriétaires

| Surface | Propriétaire et qualification de ce lot |
| --- | --- |
| CUDA, ISQ4, paged attention, préfixes | Binaire Mistral.rs déclaré ; mémoire et génération GPU encore à qualifier |
| Chat texte, historique, sampling, SSE, usage | `model-client` → adaptateur `gateway` ; tests source sur VPS |
| Outils, vision et contrats structurés | `ModelClient` et MCP existants ; pas de parité ajoutée au gateway texte |
| RAG, mémoire, index et contexte | Owners Aphrody `rag*`, `embed`, `memory`, `context` ; aucune base copiée dans le moteur |
| Train, checkpoints et LoRA | Owner `train` ; poids/adaptateurs et compatibilité distincts du candidat Gemma |
| Réseau, release et service persistant | Infra/Mesh de l'hôte ; allocation GPU exclusive et activation après vrai chat/rollback |
| CLI, desktop et agents | `ModelFactory` existant ; provider déclaré dans le home et modèle réellement servi |

## Preuves source du 2026-10-09

La configuration Compose est validée par `docker compose config --quiet` sur
le VPS. L'image épinglée a réellement été tirée et son digest/plateforme
`linux/amd64` vérifiés : **4 018 102 654 octets** (environ 3,74 GiB). Les deux
sondes binaires retournent 127 pour `libcuda.so.1` absent ; leurs options ne
sont donc qualifiées ici que par les sources/docs officielles, pas par l'aide
du binaire exécuté. Aucun faux driver ni modèle n'a été chargé.

Le snapshot factory `3b8609da0159d988ea86d95771f381eabdc9b1f7`
compile le gateway et passe **48 tests**, dont la conservation des échanges/
options/usage, les deux chemins de streaming incomplet, le refus d'un autre
modèle et le refus du bind mesh anonyme. Le lockfile généré par Cargo conserve
les deux nouvelles dépendances internes du gateway. L'intégration finale
réconcilie aussi `aphrody-identity`, `aphrody-m3-tokens` et `aphrody-svg` sur
`1.0.0-canary.1`, versions déjà déclarées dans HEAD par leur lot propriétaire ;
aucune dépendance tierce n'est actualisée.
Le Clippy strict du gateway passe. Le check `x86_64-pc-windows-msvc` via
`cargo-xwin` passe sur le VPS ; il qualifie les sources du consommateur
Windows, sans constituer un artefact installé sur Omar. Le check CLI complet
passe aussi ; son Clippy strict est bloqué hors lot par quatre `unused_mut`
déjà présents dans `crates/os/ostd/proc/src/no_window.rs` (lignes 37/48/60/68),
dont la claim concurrente est préservée.

Le snapshot `e8b07f5333a30bf3a252b7d67996cf90f4506e80` passe les quatre tests
CLI gateway, dont une vraie requête HTTP locale : Bearer valide → modèles,
credential absent → erreur 401, sans catalogue de remplacement. La découverte
et la sonde CLI utilisent une connexion directe bornée à trois secondes.

À la qualification initiale du 2026-10-09 à 19:10 UTC, le PC d'Omar était
injoignable. Ces preuves VPS ne confirment aucun pull, lancement ou chat
Mistral.rs sur son GPU. Le runtime demeure un candidat déclaré ; le serveur
vLLM précédent n'est pas remplacé par cette preuve source.
