// SPDX-License-Identifier: Apache-2.0
// Quick ask bar & Command Palette suggestions: Magpie-inspired unified spotlight
// (calculator, past threads, canonical navigation, system commands, and recent files).
// Pure, local and non-saturating: nothing typed here leaves the machine before submit.
import { filterThreads, type ThreadSummary } from "./history";
import type { SearchSources } from "./preferences";
import { desktopRoutes } from "./desktop-navigation";

export type CalculatorSuggestion = {
  kind: "calculator";
  expression: string;
  value: string;
};

export type ThreadSuggestion = {
  kind: "thread";
  thread: ThreadSummary;
};

export type NavigationSuggestion = {
  kind: "navigation";
  id: string;
  label: string;
  description: string;
  route: string;
  icon: string;
  keywords: string[];
};

export type CommandSuggestion = {
  kind: "command";
  id: string;
  label: string;
  description: string;
  command: string;
  icon: string;
  keywords: string[];
  /** Menu command run on activation; its accelerator is shown in the palette. */
  menu?: "new-session" | "open-file" | "open-folder";
};

export type RecentFileItem = {
  name: string;
  path: string;
  isDir?: boolean;
  icon?: string;
  description?: string;
};

export type FileSuggestion = {
  kind: "file";
  id: string;
  name: string;
  path: string;
  isDir?: boolean;
  icon?: string;
  description?: string;
};

export type Suggestion =
  CalculatorSuggestion | ThreadSuggestion | NavigationSuggestion | CommandSuggestion | FileSuggestion;

export const CANONICAL_NAVIGATION_TARGETS: NavigationSuggestion[] = [
  {
    kind: "navigation",
    id: "nav-chat",
    label: "Aller au chat",
    description: "Conversation Codex et agent autonome",
    route: desktopRoutes.chat,
    icon: "chat",
    keywords: ["chat", "codex", "conversation", "agent", "ia", "ask", "parler"],
  },
  {
    kind: "navigation",
    id: "nav-files",
    label: "Aller aux fichiers",
    description: "Explorateur de fichiers (service Spacedrive)",
    route: desktopRoutes.files,
    icon: "folder_open",
    keywords: ["fichiers", "files", "explorer", "dossier", "spacedrive", "documents"],
  },
  {
    kind: "navigation",
    id: "nav-models",
    label: "Aller aux Modèles",
    description: "Hub de modèles locaux et gestion VRAM / GPU",
    route: desktopRoutes.models,
    icon: "model_training",
    keywords: ["modèles", "modeles", "models", "llm", "ia", "gpu", "vram", "weights"],
  },
  {
    kind: "navigation",
    id: "nav-settings",
    label: "Ouvrir les Paramètres",
    description: "Configuration du poste de travail et raccourcis",
    route: desktopRoutes.settings,
    icon: "settings",
    keywords: ["paramètres", "parametres", "settings", "config", "options", "preferences"],
  },
  {
    kind: "navigation",
    id: "nav-recents",
    label: "Aller aux Récents",
    description: "Historique des fichiers récents",
    route: "/recents",
    icon: "history",
    keywords: ["recents", "récents", "fichiers recents"],
  },
  {
    kind: "navigation",
    id: "nav-sources",
    label: "Aller aux sources",
    description: "Emplacements et adaptateurs de stockage",
    route: "/sources",
    icon: "device_hub",
    keywords: ["sources", "storage", "stockage", "disques"],
  },
];

export const CANONICAL_COMMANDS: CommandSuggestion[] = [
  {
    kind: "command",
    id: "cmd-new-session",
    label: "> new",
    description: "Nouveau chat",
    command: "new",
    icon: "edit_square",
    keywords: ["new", "nouveau", "chat", "session"],
    menu: "new-session",
  },
  {
    kind: "command",
    id: "cmd-open-file",
    label: "> open",
    description: "Ouvrir un fichier",
    command: "open",
    icon: "description",
    keywords: ["open", "ouvrir", "fichier", "file"],
    menu: "open-file",
  },
  {
    kind: "command",
    id: "cmd-open-folder",
    label: "> open-folder",
    description: "Ouvrir un dossier",
    command: "open-folder",
    icon: "folder_open",
    keywords: ["open", "ouvrir", "dossier", "folder"],
    menu: "open-folder",
  },
  {
    kind: "command",
    id: "cmd-models",
    label: "> models",
    description: "Inspecter et gérer les modèles d'IA installés",
    command: "models",
    icon: "model_training",
    keywords: ["models", "modèles", "modeles", "catalogue", "ia"],
  },
  {
    kind: "command",
    id: "cmd-clear",
    label: "> clear",
    description: "Effacer la saisie et réinitialiser l'affichage",
    command: "clear",
    icon: "clear_all",
    keywords: ["clear", "effacer", "nettoyer", "vider", "reset"],
  },
  {
    kind: "command",
    id: "cmd-theme",
    label: "> theme",
    description: "Basculer entre le mode clair et le mode sombre",
    command: "theme",
    icon: "contrast",
    keywords: ["theme", "thème", "dark", "light", "sombre", "clair"],
  },
  {
    kind: "command",
    id: "cmd-settings",
    label: "> settings",
    description: "Accéder aux paramètres de l'application",
    command: "settings",
    icon: "settings",
    keywords: ["settings", "paramètres", "config"],
  },
];

/** Recent files must come from the current user's file history, never seeded machine paths. */
export const DEFAULT_RECENT_LOCATIONS: RecentFileItem[] = [];

/**
 * Evaluate an arithmetic expression: numbers (`,` or `.` decimals), `+ - * / % ^`, `x`/`×`/`÷`,
 * parentheses and unary signs. Returns null for anything else, so plain questions never match.
 */
export function evaluateArithmetic(input: string): number | null {
  const source = input
    .trim()
    .replace(/=\s*$/, "")
    .replace(/[×x]/g, "*")
    .replace(/÷/g, "/")
    .replace(/(\d),(\d)/g, "$1.$2");
  if (!/^[\d\s.+\-*/%^()]+$/.test(source) || !/\d/.test(source) || !/[+\-*/%^]/.test(source)) return null;
  const tokens = source.match(/\d+(?:\.\d+)?|\.\d+|[+\-*/%^()]/g) ?? [];
  if (tokens.join("") !== source.replace(/\s+/g, "")) return null;
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  const primary = (): number => {
    const token = next();
    if (token === "(") {
      const value = sum();
      if (next() !== ")") throw new Error("unbalanced");
      return value;
    }
    if (token === "-") return -power();
    if (token === "+") return power();
    if (token !== undefined && /^[\d.]/.test(token)) return Number(token);
    throw new Error("unexpected token");
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^") {
      next();
      return base ** power(); // right associative
    }
    return base;
  };
  const product = (): number => {
    let value = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const right = power();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };

  try {
    const value = sum();
    return index === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Format a calculator result without binary-float noise (`0.1 + 0.2` -> `0.3`). */
export function formatNumber(value: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 10,
    useGrouping: false,
  }).format(Number(value.toPrecision(15)));
}

/** Case and accent insensitive word-level matching. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Returns true if all words in `query` appear in the combined targets. */
export function matchesQuery(query: string, ...targets: (string | undefined)[]): boolean {
  const normQuery = normalizeText(query).trim();
  if (!normQuery) return false;
  const words = normQuery.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const combined = targets
    .filter(Boolean)
    .map(t => normalizeText(t!))
    .join(" ");
  return words.every(word => combined.includes(word));
}

/** Get default quick-access suggestions (for empty query or initial view in Command Palette). */
export function getDefaultSuggestions(sources: Partial<SearchSources> = {}, limit = 8): Suggestion[] {
  const out: Suggestion[] = [];
  if (sources.navigation !== false) {
    for (const nav of CANONICAL_NAVIGATION_TARGETS) {
      if (out.length >= limit) break;
      out.push(nav);
    }
  }
  if (sources.commands !== false) {
    for (const cmd of CANONICAL_COMMANDS) {
      if (out.length >= limit) break;
      out.push(cmd);
    }
  }
  return out.slice(0, limit);
}

export type SuggestOptions = {
  limit?: number;
  locale?: string;
  files?: RecentFileItem[];
  navigationTargets?: NavigationSuggestion[];
  commands?: CommandSuggestion[];
};

/**
 * Build the suggestion list for the current draft, honoring enabled search sources.
 * Inspired by Magpie (newdee/magpie): multi-provider, prefix triggers ('>'), fast and non-saturating.
 */
export function suggest(
  draft: string,
  threads: ThreadSummary[] = [],
  sources: Partial<SearchSources> = {},
  {
    limit = 5,
    locale = "en",
    files = DEFAULT_RECENT_LOCATIONS,
    navigationTargets = CANONICAL_NAVIGATION_TARGETS,
    commands = CANONICAL_COMMANDS,
  }: SuggestOptions = {},
): Suggestion[] {
  const query = draft.trim();
  if (!query) return [];

  const out: Suggestion[] = [];
  const allowCalculator = sources.calculator !== false;
  const allowHistory = sources.history !== false;
  const allowNavigation = sources.navigation !== false;
  const allowCommands = sources.commands !== false;
  const allowFiles = sources.files !== false;

  // 1. Command Prefix Mode (starts with `>`)
  if (query.startsWith(">")) {
    if (allowCommands) {
      const cmdQuery = query.slice(1).trim();
      for (const cmd of commands) {
        if (out.length >= limit) break;
        if (!cmdQuery || matchesQuery(cmdQuery, cmd.label, cmd.command, cmd.description, ...cmd.keywords)) {
          out.push(cmd);
        }
      }
    }
    return out.slice(0, limit);
  }

  // 2. Calculator Mode
  if (allowCalculator) {
    const value = evaluateArithmetic(query);
    if (value !== null) {
      out.push({
        kind: "calculator",
        expression: query.replace(/=\s*$/, "").trim(),
        value: formatNumber(value, locale),
      });
    }
  }

  // 3. Direct Command Keywords (without `>`)
  if (allowCommands) {
    for (const cmd of commands) {
      if (out.length >= limit) break;
      if (matchesQuery(query, cmd.command, cmd.description, ...cmd.keywords)) {
        out.push(cmd);
      }
    }
  }

  // 4. Navigation Targets
  if (allowNavigation) {
    for (const nav of navigationTargets) {
      if (out.length >= limit) break;
      if (matchesQuery(query, nav.label, nav.description, nav.route, ...nav.keywords)) {
        out.push(nav);
      }
    }
  }

  // 5. Files & Locations
  if (allowFiles) {
    for (const file of files) {
      if (out.length >= limit) break;
      if (matchesQuery(query, file.name, file.path, file.description)) {
        out.push({
          kind: "file",
          id: `file-${file.path}`,
          name: file.name,
          path: file.path,
          isDir: file.isDir,
          icon: file.icon,
          description: file.description,
        });
      }
    }
  }

  // 6. Thread History
  if (allowHistory && threads.length > 0) {
    for (const thread of filterThreads(threads, query)) {
      if (out.length >= limit) break;
      out.push({ kind: "thread", thread });
    }
  }

  return out.slice(0, limit);
}
