# Guide d'Utilisation Réelle : A2A, AG-UI et MCP-UI

Ce guide fournit des recettes de code concrètes et éprouvées pour utiliser l'écosystème **A2A (Agent-to-Agent)**, **AG-UI Protocol (Streaming)** et **MCP-UI (Apps Génératives)** dans les applications desktop Aphrody et les services autonomes Bun.

---

## 1. Pilotage de la Flotte Multi-Agents dans l'Application Desktop

### 1.1 Accéder à l'Espace Studio A2A

Dans l'application desktop Aphrody :
1. Cliquez sur l'onglet **Studio** dans la barre de navigation latérale.
2. Sélectionnez la section **Flotte A2A & Apps MCP** (icône `hub`).
3. L'interface propose 4 onglets :
   - **Inspecteur Flotte A2A & Claims** : Visualise les pairs connectés (`agy`, `codex`, `claude`), leurs compétences, leurs verrous de ressources (`.coord/claims`) et permet de leur envoyer des enveloppes directes.
   - **Chronologie de Délégation** : Affiche les étapes successives d'exécution et les transitions d'état entre agents.
   - **Bac à sable Apps MCP-UI** : Démonstrateur des applications interactives générées par les outils MCP (visualiseur de tokens, palette M3 dynamique).
   - **Flux d'Événements AG-UI** : Simulateur de streaming pour tester la réaction de l'accumulateur d'événements.

### 1.2 Ouvrir le Volet Flotte depuis Codex Chat

Dans la vue de chat principale (`CodexChatRoute`) :
1. Cliquez sur le bouton rond **Hub** (icône `hub`) situé en haut à droite dans l'en-tête de la discussion.
2. Le tiroir supérieur s'ouvre sans masquer la conversation en cours, affichant en temps réel `<A2APeerInspector />` et `<A2ATaskTimeline />`.
3. Vous pouvez surveiller les subagents lancés en arrière-plan sans interrompre la frappe dans le composer.

---

## 2. Ingestion et Rendu d'un Flux d'Événements AG-UI

Pour brancher un flux SSE venant d'un agent distant ou d'un serveur d'application local :

```typescript
import { AgUiEventAccumulator, EventType } from "@aphrody/m3-ai";
import { SseAgentConnection } from "@aphrody/ag-ui-client";

// 1. Initialiser l'accumulateur
const accumulator = new AgUiEventAccumulator();

// 2. Se connecter au flux SSE natif Bun
const connection = new SseAgentConnection({
  url: "http://localhost:3000/api/agent/stream",
  onEvent: (event) => {
    // Ingestion atomique de l'événement
    accumulator.push(event);

    // Récupération de l'instantané d'affichage pour React
    const state = accumulator.getState();
    updateUi({
      status: state.status,
      items: state.items,
      currentText: state.currentText,
      subagents: state.subagents,
    });
  },
  onError: (err) => {
    console.error("Erreur de flux agent :", err);
  },
});

await connection.connect();
```

---

## 3. Rendu Automatique d'Applications MCP-UI dans les Réponses

Pour autoriser un outil MCP à afficher une application interactive directement dans le flux de messages :

### 3.1 Déclaration côté serveur de l'outil MCP (JSON Schema)

L'outil renvoie soit un URI de ressource UI, soit directement un fragment HTML valide :

```json
{
  "content": [
    {
      "type": "text",
      "text": "Tableau de bord généré avec succès."
    }
  ],
  "_meta": {
    "ui": {
      "resourceUri": "ui://mcp.local/analytics-dashboard.html"
    }
  }
}
```

### 3.2 Rendu côté interface utilisateur avec `<ToolCall />`

Le composant `<ToolCall />` de `@aphrody/m3-ai` détecte automatiquement la présence d'une application MCP et monte le composant `<McpAppCard />` :

```tsx
import { ToolCall } from "@aphrody/m3-ai";

function MessageItem({ toolPair }) {
  return (
    <ToolCall
      pair={toolPair}
      defaultExpanded={true}
    />
  );
}
```

Si le résultat contient du HTML ou un `resourceUri`, une iframe sandboxée est instanciée avec synchronisation automatique du thème clair/sombre de Material Design 3.

---

## 4. Émettre une Enveloppe de Coordination A2A

Pour déléguer une tâche à un agent pair depuis un script ou un composant :

```typescript
import { coordEnvelopeToAgUiEvent } from "@aphrody/m3-ai";

const envelope = {
  v: 1,
  ts: new Date().toISOString(),
  id: `env-${Date.now()}`,
  from: "agy",
  to: "codex",
  kind: "ask",
  topic: "rust.cargo.check",
  body: "Vérifier la compilation de crates/ui/app sous cargo-serial.",
};

// Conversion en événement standard AG-UI pour notification utilisateur
const uiEvent = coordEnvelopeToAgUiEvent(envelope);
```

---

## 5. Commandes de Validation & Tests

Pour s'assurer de la conformité du code :

```bash
# Vérification des types dans tous les paquets concernés
bun run --filter "@aphrody/ag-ui" typecheck
bun run --filter "@aphrody/mcp-ui" typecheck
bun run --filter "@aphrody/m3-ai" typecheck
bun run --filter "@aphrody/app-ui" typecheck

# Exécution de l'ensemble des tests unitaires
bun test packages/ag-ui
bun test packages/mcp-ui
bun test packages/m3-ai
bun test packages/app-ui
```
