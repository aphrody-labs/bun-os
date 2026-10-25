// SPDX-License-Identifier: Apache-2.0
// Command Palette: Unified Spotlight launcher for Aphrody (inspired by Magpie, newdee/magpie).
// Accessible in-window launcher triggered by Ctrl+K / Cmd+K or Ctrl+Shift+P / Cmd+Shift+P.
// Pure, synchronous, non-saturating search across navigation, commands, files, threads, and calculator.
// Conforms to LOW_VISION accessibility guidelines (all typography >= 18px).

import { Icon, Kbd } from "@aphrody/m3-primitives";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadPreferences, savePreferences } from "./preferences";
import { getDefaultSuggestions, suggest, type Suggestion } from "./quickbar-suggest";
import { useChatStore } from "./stores/chat-store";
import { desktopRoutes } from "./desktop-navigation";
import { dispatchMenuCommand, isMacPlatform, menuShortcut } from "./menu-commands";

export interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandPalette({ open: controlledOpen, onOpenChange }: CommandPaletteProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [actionError, setActionError] = useState("");
  const [activating, setActivating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const threads = useChatStore(state => state.threads);
  const setActiveThreadId = useChatStore(state => state.setActiveThreadId);
  const prefs = loadPreferences();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
      if (!next) {
        setDraft("");
        setHighlight(0);
      }
    },
    [isControlled, onOpenChange],
  );

  // Global keyboard listener for Ctrl+K / Cmd+K and Ctrl+Shift+P / Cmd+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (
        (isCmdOrCtrl && (e.key === "k" || e.key === "K")) ||
        (isCmdOrCtrl && e.shiftKey && (e.key === "p" || e.key === "P"))
      ) {
        e.preventDefault();
        setOpen(!isOpen);
      }
    };

    const handleCustomOpen = () => setOpen(true);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("aphrody:open-command-palette", handleCustomOpen);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("aphrody:open-command-palette", handleCustomOpen);
    };
  }, [isOpen, setOpen]);

  // Focus input automatically upon opening
  useEffect(() => {
    if (isOpen) {
      // oxlint-disable-next-line react/set-state-in-effect -- réinitialise la saisie et la surbrillance à chaque ouverture de la palette
      setDraft("");
      setHighlight(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Map threads from chat store to ThreadSummary format
  const threadSummaries = useMemo(
    () =>
      threads.map(t => ({
        id: t.id,
        title: t.name || t.preview || "Sans titre",
        updatedAt: t.updatedAt ?? t.createdAt,
      })),
    [threads],
  );

  // Derive suggestions using Magpie engine
  const suggestions = useMemo(() => {
    if (!isOpen) return [];
    if (!draft.trim()) {
      return getDefaultSuggestions(prefs.sources, 8);
    }
    return suggest(draft, threadSummaries, prefs.sources, { limit: 10 });
  }, [draft, isOpen, threadSummaries, prefs.sources]);

  // Reset highlight within range when suggestions list changes
  useEffect(() => {
    if (suggestions.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- la surbrillance suit la liste : réinitialisée à chaque changement de suggestions
      setHighlight(-1);
    } else {
      setHighlight(0);
    }
  }, [suggestions.length]);

  const activateItem = async (item: Suggestion) => {
    if (activating) return;
    setActivating(true);
    setActionError("");
    try {
      if (item.kind === "navigation") {
        navigate(item.route);
      } else if (item.kind === "command" && item.menu) {
        dispatchMenuCommand(item.menu);
      } else if (item.kind === "command") {
        switch (item.command) {
          case "models":
            navigate(desktopRoutes.models);
            break;
          case "clear":
            setDraft("");
            break;
          case "settings":
            navigate(desktopRoutes.settings);
            break;
          case "theme":
            await savePreferences({
              ...prefs,
              theme: prefs.theme === "dark" ? "light" : "dark",
            });
            break;
          default:
            throw new Error("Cette commande n'est pas disponible.");
        }
      } else if (item.kind === "file") {
        navigate(`/explorer?path=${encodeURIComponent(item.path)}`);
      } else if (item.kind === "thread") {
        setActiveThreadId(item.thread.id);
        navigate(desktopRoutes.chat);
      } else if (item.kind === "calculator") {
        if (!navigator.clipboard?.writeText) throw new Error("Le presse-papiers n'est pas disponible.");
        await navigator.clipboard.writeText(item.value);
      }
      setOpen(false);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setActivating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setHighlight(prev => (prev + 1) % suggestions.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setHighlight(prev => (prev - 1 + suggestions.length) % suggestions.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0 && highlight >= 0 && highlight < suggestions.length) {
        void activateItem(suggestions[highlight]);
      } else if (draft.trim()) {
        // Transfer the exact text to the composer; the user sends it from Chat.
        navigate(desktopRoutes.chat, { state: { initialPrompt: draft } });
        setOpen(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- overlay plein écran : le clic sur le fond ferme la palette, il n'y a pas de contrôle interactif à l'élément
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- overlay plein écran modal : un <dialog> natif changerait le positionnement et le focus existants
      role="dialog"
      aria-modal="true"
      aria-label="Palette de commandes"
      aria-busy={activating}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-20 backdrop-blur-sm"
      onClick={e => {
        if (e.target === e.currentTarget) {
          setOpen(false);
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-outline-variant/40 bg-surface-container-high p-4 text-on-surface shadow-2xl">
        {/* Search header input */}
        <div className="relative flex items-center">
          <Icon name="search" size={24} className="pointer-events-none absolute left-4 text-on-surface-variant" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="command-palette-suggestions"
            aria-activedescendant={highlight >= 0 ? `command-palette-item-${highlight}` : undefined}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Rechercher ou exécuter une action..."
            className="h-16 w-full rounded-2xl bg-surface-container-highest pr-20 pl-14 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
          />
          <div className="absolute right-4 flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
          </div>
        </div>

        {actionError && (
          <p role="alert" className="m-0 mt-3 text-body-large text-error">
            {actionError}
          </p>
        )}

        {/* Suggestions list */}
        <div className="mt-3 max-h-[460px] overflow-y-auto pr-1">
          {suggestions.length > 0 ? (
            <ul
              id="command-palette-suggestions"
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- la liste de suggestions est un listbox ARIA du combobox (un select natif ne permet pas la liste filtrée)
              role="listbox"
              aria-label="Résultats de recherche"
              className="m-0 flex list-none flex-col gap-1 p-0"
            >
              {suggestions.map((item, index) => {
                const isSelected = index === highlight;
                const iconName =
                  item.kind === "calculator"
                    ? "calculate"
                    : item.kind === "thread"
                      ? "history"
                      : item.kind === "navigation"
                        ? item.icon
                        : item.kind === "command"
                          ? item.icon
                          : (item.icon ?? (item.isDir ? "folder" : "description"));

                const badgeLabel =
                  item.kind === "navigation"
                    ? "Navigation"
                    : item.kind === "command"
                      ? "Commande"
                      : item.kind === "file"
                        ? item.isDir
                          ? "Dossier"
                          : "Fichier"
                        : item.kind === "thread"
                          ? "Fil"
                          : "Calcul";

                return (
                  // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- option de liste : la sélection clavier passe par le champ de saisie, l'élément n'est pas focusable
                  <li
                    key={
                      item.kind === "thread"
                        ? item.thread.id
                        : item.kind === "navigation"
                          ? item.id
                          : item.kind === "command"
                            ? item.id
                            : item.kind === "file"
                              ? item.id
                              : "calculator"
                    }
                    id={`command-palette-item-${index}`}
                    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- options d'une liste filtrée pilotée au clavier depuis le champ de saisie (aria-activedescendant)
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => void activateItem(item)}
                    onMouseEnter={() => setHighlight(index)}
                    className={`flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-3 text-body-large transition-colors ${
                      isSelected
                        ? "bg-secondary-container text-on-secondary-container font-semibold"
                        : "text-on-surface hover:bg-on-surface/8"
                    }`}
                  >
                    <div className="flex items-center gap-3.5 overflow-hidden">
                      <Icon
                        name={iconName}
                        size={24}
                        className={`shrink-0 ${isSelected ? "text-primary" : "text-on-surface-variant"}`}
                      />
                      <div className="flex flex-col overflow-hidden text-left">
                        {item.kind === "calculator" ? (
                          <div className="truncate">
                            <span className="text-on-surface-variant">{item.expression} = </span>
                            <strong className="text-title-small">{item.value}</strong>
                          </div>
                        ) : item.kind === "thread" ? (
                          <span className="truncate text-label-large">{item.thread.title}</span>
                        ) : item.kind === "navigation" ? (
                          <div className="flex flex-col truncate">
                            <span className="truncate text-label-large font-semibold">{item.label}</span>
                            <span className="truncate text-body-large opacity-80">{item.description}</span>
                          </div>
                        ) : item.kind === "command" ? (
                          <div className="flex flex-col truncate">
                            <span className="truncate font-mono text-label-large font-semibold">{item.label}</span>
                            <span className="truncate text-body-large opacity-80">{item.description}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col truncate">
                            <span className="truncate text-label-large font-semibold">{item.name}</span>
                            <span className="truncate font-mono text-body-large opacity-80">{item.path}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-surface-container-highest px-3 py-1 text-label-large font-medium text-on-surface-variant">
                        {badgeLabel}
                      </span>
                      {item.kind === "command" && item.menu
                        ? menuShortcut(item.menu, isMacPlatform()).map(k => <Kbd key={k}>{k}</Kbd>)
                        : null}
                      {isSelected && <Kbd>↵</Kbd>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <Icon name="search_off" size={36} className="mb-2 text-on-surface-variant opacity-60" />
              <p className="m-0 text-title-small text-on-surface">Aucun résultat pour « {draft} »</p>
              <p className="m-0 mt-1 text-body-large text-on-surface-variant">
                Appuyez sur Entrée pour ouvrir ce texte dans le chat.
              </p>
            </div>
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="mt-3 flex items-center justify-between border-t border-outline-variant/30 pt-3 text-label-large text-on-surface-variant">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="ml-1">Naviguer</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span className="ml-1">Sélectionner</span>
            </span>
          </div>
          <span className="flex items-center gap-1 font-mono text-label-large">
            <span>Tapez</span>
            <strong className="text-primary font-bold">{">"}</strong>
            <span>pour les commandes</span>
          </span>
        </div>
      </div>
    </div>
  );
}
