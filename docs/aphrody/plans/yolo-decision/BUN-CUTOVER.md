> **Legacy fork notice (2026-10-29).** This document predates the move to the unmodified upstream `bun` npm package (`1.4.4-canary.20261028.1`). The abandoned Bun fork, its fork-only commands, `bun:*` modules and `toolchains/bun` named here are history, not current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Consommateurs Python du Bun Yolo natif

`aphrody.decision` garde ses contrats applicatifs, son Agent Pydantic AI, son
graphe Pydantic Graph et ses évaluations. Le consommateur emprunte le client
`Yolo` de l'unique SDK Bun (`bun_yolo`), avec son `Runtime` vérifié ; aucune
inférence, supervision ou validation de distributions n'est copiée ici.

```python
from aphrody.decision import YoloDecision, decide_async_json

# bun_client : Yolo appartenant à l'appelant, SDK et binaire qualifiés.
decision = await YoloDecision.from_bun(bun_client).decide(inputs)
serialized = await decide_async_json(inputs.model_dump_json(), bun_client=bun_client)
assert decision.executed is False
```

Le client SDK reçoit le modèle, le seuil `minimum_confidence`, le délai et zéro
retry. Bun valide le seuil avant d'appeler le fournisseur ; Rust renvoie les
`selections`, y compris `None` pour une abstention. Python vérifie seulement la
liaison de la réponse au catalogue applicatif. L'appelant termine les opérations
du client avant de fermer son `Runtime` ; cet adaptateur ne les ouvre ni ne les
ferme. La deadline du graphe annule la coroutine SDK ; la terminaison du processus
possédé relève du superviseur Bun et de sa qualification native.

## Usage explicite

`JevResponse.usage` et `DecisionOutput.usage` valent un comptage fourni ou `None`.
Le champ est obligatoire, tout comme les deux compteurs d'un usage fourni. Une
absence ou un objet partiel échoue ; un vrai zéro doit être déclaré explicitement.
Le JSON applicatif conserve `"usage": null`, sans estimation de tokens ou coût.

Pydantic AI 2.55.0 impose un `RequestUsage` non nullable pour sa comptabilité
interne. Quand le fournisseur ne mesure pas les tokens, l'adaptateur ajoute
`details.aphrody_provider_usage_missing=1` et
`ModelResponse.metadata.aphrody_provider_usage=None`. Ses compteurs internes
par défaut ne sont pas des mesures fournisseur : utiliser l'usage nullable de
`DecisionOutput` pour toute sortie ou facturation. La borne porte sur un appel
et un délai, sans promesse de budget tokens sur un usage inconnu.

## Condition de bascule native

Les fixtures valident cette injection, la sélection/abstention, l'annulation,
la conservation d'usage et les évaluations existantes. Elles ne qualifient pas
un artefact installé. Avant d'activer le client sur un hôte :

1. Vérifier le manifeste SDK, le target, les hashes/provenance et les capacités
   `process.stdin`/`process.wait` de l'ABI additive 1.6. L'ancienne ABI 1.4/1.5
   échoue explicitement avant tout lancement privé.
2. Qualifier le binaire Bun exact avec le worker `bun:yolo` et des réponses
   synthétiques passant par le propriétaire Rust : primitives, usage nul ou
   fourni, seuil invalide, abstention, annulation et fermeture stdout/stderr.
3. Exécuter le même graphe depuis le Python consommateur, puis l'installation
   hors checkout et le host `bun:python` sélectionné. Fournisseurs payants,
   clés, corpus et sessions ne sont pas nécessaires aux fixtures.
4. Injecter ce client vérifié dans l'application avant de retirer les anciennes
   routes. Les preuves doivent identifier le binaire et le SDK réellement chargés.

Le gate consommateur adjacent `test_bun_decision_native.py` est opt-in via
`BUN_YOLO_NATIVE_GATE=1`. L'appelant fournit `BUN_YOLO_EXECUTABLE`,
`BUN_YOLO_REVISION`, `YOLO_RUNTIME_HOME` et le `PYTHONPATH` du SDK qualifié ; le
test ne recherche ni ne copie un moteur. Son fournisseur synthétique passe
réellement par `bun:yolo`/Rust et les pipes du superviseur natif. L'absence d'une
preuve ABI/binaire reste un gate en attente, même si les fixtures passent.

## Host TypeScript et portée SDK

`BunDecisionBridge` dans `decision/bridge.ts` emprunte un `PythonAsync` déjà
qualifié. L'appelant fournit explicitement le dossier du SDK installé, le SHA-256
du manifeste, le chemin du binaire Bun, son SHA-256 et sa révision. Le bridge
capture cette configuration et transporte un JSON `aphrody.yolo.bun-bridge/1`
borné à 1 MiB ; un deuxième appel simultané échoue `ERR_DECISION_BUSY`.

```typescript
import { BunDecisionBridge } from "./decision/bridge";

await using bridge = new BunDecisionBridge(python, {
  runtime: { directory: sdkDirectory, manifestSha256 },
  bun: { executable: bunExecutable, sha256: bunSha256, revision: bunRevision },
  provider: { kind: "jev", baseURL: providerURL, model: selectedModel },
});
const proposalJSON = await bridge.decideJson(inputJSON);
```

`native_bridge.decide_bun_json` vérifie les pins avant activation, ouvre un
`Runtime(max_operations=1)` de l'unique SDK, puis injecte le client dans le même
Agent et Graph. La méthode synchrone `Yolo.inspect` tourne dans le worker du
host `PythonAsync` existant ; aucun deuxième exécuteur Python n'est créé. Le
superviseur natif borne son attente à la deadline restante, arrête et joint le
processus avant fermeture du `Runtime`. `close()` du bridge refuse les nouveaux
appels et rejoint celui en cours ; il ne ferme pas le host emprunté et n'ajoute
pas de primitive d'annulation. L'API indépendante `Yolo.inspect_async` conserve
son annulation native et ses gates.

Le gate `decision-native-bridge-host.test.ts` vérifie un SDK installé hors
checkout, deux décisions successives dans un seul host, l'usage nul/fourni,
l'abstention Rust, le rejet d'un SHA invalide, un fournisseur loopback silencieux
et la reprise du host après deadline/nettoyage. La qualification Windows x64 et
ses pins sont dans le [reçu de qualification du bridge](../../operations/workspace/bun-yolo-bridge-2026-10-14.md).
L'installation d'une wheel publiée, les modèles et la production restent des
gates distincts.

## Références encore non basculées

| Référence | État et condition |
| --- | --- |
| `decision/workflow.py:decide_json` appelé sans `bun_client` | Conserve le endpoint privé explicite `APHRODY_YOLO_DECISION_ENDPOINT` et son token de service ; aucune bascule automatique à partir d'une variable d'environnement. |
| `decision/bridge.ts:decideJson` et `tests/decision-bridge.test.ts` | Le chemin HTTP explicite reste disponible et testé. Le nouveau `BunDecisionBridge` propose la portée SDK qualifiée ; aucune sélection globale ou activation de service n'est effectuée. |
| `decision/backend.py:JevHTTP` | Transport privé optionnel conservé, avec ses tests d'authentification, TLS et refus de redirection. |
| `decision/typesafe.py:TypeSafeClient`, `AsyncTypeSafeClient` | Alias du vrai SDK TypeSafe HTTP encore conservés ; primitives et réponses publiques diffèrent de la façade brute Bun. Leur remplacement exige un gate de compatibilité, sans fabriquer l'usage absent. |
| `decision/typesafe.py:comparison_client` | Client comparatif optionnel amont conservé ; aucune qualification de modèle ou migration de son moteur revendiquée. |
| Extras `aphrody[decision]`, `aphrody[decision-compare]` et `py/uv.lock` | Pins et packaging préservés. Une façade importable du SDK Bun doit être qualifiée hors checkout avant toute modification de dépendances. |
| Serveur Rust privé Aphrody `/v1/systemone` | Route applicative encore consommée par les chemins HTTP ci-dessus ; ne retirer son intégration qu'après leur bascule mesurée au propriétaire Bun. |

Les données étiquetées, exports train et résultats d'évaluation restent chez
l'appelant. Ni corpus, secrets, poids ni sessions ne sont déplacés par ce lot.

## Propriétaires Rust encore dupliqués

Audit du checkout Aphrody `1db198803bf286aa3281c91dd0c13e58abaae282` et de
`crates/aphrody-jev` dans Bun : les huit fichiers source communs divergent après
normalisation CRLF/LF. Bun sépare maintenant le protocole sans transport des
features facultatives `client` et `server`. Son `Response.usage: Option<Usage>`
conserve l'usage inconnu ; l'ancien crate Aphrody utilise encore `Usage` et
`completion.usage.unwrap_or_default()`. Cette différence interdit une simple
substitution de chemin suivie d'une qualification globale.

| Consommateur | Propriétaire actuel et gate de remplacement |
| --- | --- |
| `Cargo.toml:aphrody-jev`, `crates/ai/jev` | Copie locale encore référencée par le workspace, claim actif `repo-minimal-layout`. Remplacer par un pin publiable du crate canonique Bun après les gates de compatibilité ; aucun chemin absolu entre checkouts. |
| `crates/ai/mcp/src/jev_tools.rs` | Dépendance directe, route `aphrody_jev_decide`, `JevRouter`, validation et abstention du crate local. Qualifier le client canonique, les erreurs et les configurations de fournisseur ; garder la logique MCP applicative. |
| `crates/ai/agent-tools/src/jev.rs` | `JevDecideTool` emprunte `Arc<JevRouter>` et le seuil local. Qualifier l'usage nullable et l'identité des propositions avec la feature canonique `client`. |
| `crates/ai/agent-runtime/src/tools.rs` | Consomme `JevDecideTool` en production ; `aphrody-jev` est une dépendance de tests directe. Rejouer les gates d'enregistrement/cache d'outils et de routing après bascule. |
| `crates/ai/http-error/src/lib.rs` | Référence documentaire au serveur ; aucune dépendance ou moteur Jev à retirer ici. |

Cet audit ne modifie ni ne retire le crate Rust détenu par l'autre claim. Le
bridge Python/TypeScript qualifié n'est pas une preuve de bascule des clients
Rust, de la route privée `/v1/systemone` ou des alias SDK TypeSafe.
