// SPDX-License-Identifier: Apache-2.0
// Pixel-Perfect Codex Chat View (parité exacte codex-desktop-chat-main.png & docs/UI-DESIGN.md §4.1).
// Zero debug telemetry noise, zero AI slop, pure high-precision coding assistant.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "./web-runtime";
import { clsx } from "clsx";
import { Badge, Button, CircleButton, Icon, Popover, toast, usePopover } from "@aphrody/m3-primitives";
import { Markdown, ToolCall, type ToolCallPair } from "@aphrody/m3-ai";

type DictationRecognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  start(): void;
  stop(): void;
};

type DictationWindow = Window & {
  SpeechRecognition?: new () => DictationRecognition;
  webkitSpeechRecognition?: new () => DictationRecognition;
};

export interface ChatModelOption {
  id: string;
  name: string;
  provider: string;
  context_window?: number;
  capabilities?: string[];
  description?: string;
  badge?: string;
  defaultEffort?: string;
}
import {
  aphrodyReply,
  aphrodyRpc,
  ensureAphrodyInitialized,
  isTauri,
  aphrodySessionStream,
  copyToNativeClipboard,
  pickDirectory,
  pickFile,
  tauriInvoke,
  runRagSearch,
} from "./tauri-bridge";
import { buildTurnInputItems } from "./routes/explorer/ai-helpers";
import { useChatStore } from "./stores/chat-store";
import { TITLE_GRADIENT_STOPS } from "./brand-tokens";

export type PromptBarShape = "empty" | "content" | "docked";

/** Gemini prompt bar corner state: 40px empty, 32px with content, docked 24 24 0 0 once a conversation runs or the feed scrolls. */
export function promptBarShape(state: { hasTurns: boolean; scrolled: boolean; hasContent: boolean }): PromptBarShape {
  if (state.hasTurns || state.scrolled) return "docked";
  return state.hasContent ? "content" : "empty";
}

/** Assistant sparkle mark, filled with the title gradient (greeting and assistant mark only). */
export function SparkleMark({ size = 24 }: { size?: number }) {
  const id = "app-sparkle-gradient";
  return (
    <svg className="app-sparkle" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          {TITLE_GRADIENT_STOPS.map((stop, i) => (
            <stop key={stop} offset={i / (TITLE_GRADIENT_STOPS.length - 1)} stopColor={stop} />
          ))}
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5C11.5 16.9 7.1 12.5 1.5 12 7.1 11.5 11.5 7.1 12 1.5Z"
      />
    </svg>
  );
}

export type ApprovalItem = {
  id: string | number;
  kind: "fileChange" | "permissions" | "userInput";
  title: string;
  path?: string;
  diff?: string;
  reason?: string;
  message?: string;
  network?: string;
  choices?: string[];
  status: "pending" | "approved" | "denied" | "session";
  submitting?: boolean;
  backendGeneration?: number;
  threadId?: string;
  turnId?: string;
  itemId?: string;
};

export type FileChangeItem = {
  id: string;
  path: string;
  diff: string;
  kind?: "Created" | "Modified" | "Deleted" | string;
  status: "pending" | "applied" | "rejected";
  threadId?: string;
  turnId?: string;
  itemId?: string;
};

export type Turn =
  | {
      id: string;
      role: "user";
      content: string;
      attachments?: string[];
      turnId?: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      streaming?: boolean;
      turnId?: string;
      itemId?: string;
    }
  | {
      id: string;
      role: "tool";
      pair: ToolCallPair;
      turnId?: string;
      itemId?: string;
    }
  | { id: string; role: "fileChange"; fileChange: FileChangeItem }
  | { id: string; role: "approval"; approval: ApprovalItem };

export interface ThreadSummary {
  id: string;
  name?: string;
  preview?: string;
  createdAt: number;
  updatedAt?: number;
  cwd?: string;
}

export function buildThreadRenamePayload(threadId: string, name: string): { threadId: string; name: string } {
  return { threadId, name };
}

export function buildThreadForkPayload(threadId: string, turnId?: string): { threadId: string; turnId?: string } {
  return turnId ? { threadId, turnId } : { threadId };
}

export function buildThreadCompactPayload(threadId: string): {
  threadId: string;
} {
  return { threadId };
}

export function shouldAutoCompactThread(
  turn: { status?: string; items?: { type?: string }[] } | undefined,
  displayedTurns: number,
  compactedAtTurns = 0,
): boolean {
  return (
    turn?.status === "completed" &&
    displayedTurns - compactedAtTurns >= 25 &&
    !turn.items?.some(item => item.type === "contextCompaction")
  );
}

export interface ThreadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ThreadSummary[];
  activeThreadId?: string;
  onSelectThread?: (id: string) => void;
  onRenameThread?: (threadId: string, name: string) => void | Promise<void>;
  onForkThread?: (threadId: string, turnId?: string) => void | Promise<void>;
  onCompactThread?: (threadId: string) => void | Promise<void>;
}

/**
 * ThreadDrawer kept for backward compatibility and testing.
 * In the modern UI, threads are rendered directly in SpacesSidebar.
 */
export function ThreadDrawer({
  isOpen,
  onClose,
  threads,
  activeThreadId,
  onSelectThread,
  onRenameThread,
  onForkThread,
  onCompactThread,
}: ThreadDrawerProps) {
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const handleStartRename = (t: ThreadSummary) => {
    setEditingThreadId(t.id);
    setEditingName(t.name || t.preview || "");
  };

  const handleSaveRename = (threadId: string) => {
    const trimmed = editingName.trim();
    if (trimmed && onRenameThread) {
      void onRenameThread(threadId, trimmed);
    }
    setEditingThreadId(null);
  };

  const filteredThreads = threads.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (t.name || t.preview || "").toLowerCase();
    const cwd = (t.cwd || "").toLowerCase();
    return title.includes(q) || cwd.includes(q);
  });

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- panneau latéral modal stylé par classes : l'élément dialog natif changerait le rendu par défaut
        role="dialog"
        aria-label="Historique des sessions"
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-surface-container-high border-l border-outline-variant/40 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
          <div className="flex items-center gap-2 text-title-small font-bold text-on-surface">
            <Icon name="history" size={20} className="text-primary" />
            <span>Historique des sessions</span>
          </div>
          <Button variant="text" size="icon" onClick={onClose} aria-label="Fermer le tiroir" title="Fermer">
            <Icon name="close" size={20} />
          </Button>
        </div>

        {threads.length > 3 && (
          <div className="p-3 border-b border-outline-variant/20">
            <div className="relative flex items-center">
              <Icon name="search" size={18} className="absolute left-2.5 text-on-surface-variant pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filtrer les sessions..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-container text-body-medium text-on-surface placeholder:text-on-surface-variant/60 border border-outline-variant/40 focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus:border-primary"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {filteredThreads.length === 0 ? (
            <div className="py-12 text-center text-body-medium text-on-surface-variant">
              {threads.length === 0
                ? "Aucune session : envoyez un message pour en créer une"
                : "Aucune session ne correspond : modifiez la recherche"}
            </div>
          ) : (
            filteredThreads.map(t => {
              const isActive = t.id === activeThreadId;
              const isEditing = editingThreadId === t.id;
              const displayName = t.name || t.preview || "Session sans titre";
              const formattedDate = new Date(t.createdAt > 1e11 ? t.createdAt : t.createdAt * 1000).toLocaleDateString(
                [],
                {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              );

              if (isEditing) {
                return (
                  <div
                    key={t.id}
                    className="rounded-2xl bg-surface-container-highest p-3 border border-primary/50 shadow-sm flex flex-col gap-2"
                  >
                    <label
                      htmlFor={`thread-rename-${t.id}`}
                      className="text-label-small font-medium text-on-surface-variant"
                    >
                      Renommer la session
                    </label>
                    <input
                      id={`thread-rename-${t.id}`}
                      type="text"
                      className="w-full rounded-xl bg-surface-container px-3 py-1.5 text-body-medium text-on-surface border border-outline focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus:border-primary"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleSaveRename(t.id);
                        if (e.key === "Escape") setEditingThreadId(null);
                      }}
                      autoFocus
                      placeholder="Nom de la session..."
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        aria-label="Annuler"
                        title="Annuler"
                        variant="text"
                        size="sm"
                        onClick={() => setEditingThreadId(null)}
                      >
                        <Icon name="close" size={18} />
                      </Button>
                      <Button
                        aria-label="Enregistrer"
                        title="Enregistrer"
                        variant="filled"
                        size="sm"
                        onClick={() => handleSaveRename(t.id)}
                      >
                        <Icon name="save" size={18} />
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={t.id}
                  className={`group rounded-2xl p-3 transition-colors border ${
                    isActive
                      ? "bg-secondary-container/50 border-secondary/50 text-on-secondary-container shadow-xs"
                      : "bg-surface-container border-outline-variant/30 hover:bg-surface-container-highest text-on-surface"
                  }`}
                >
                  <button
                    type="button"
                    className="block w-full cursor-pointer text-left"
                    onClick={() => {
                      onSelectThread?.(t.id);
                      onClose();
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-body-medium truncate flex-1" title={displayName}>
                        {displayName}
                      </span>
                      {isActive && (
                        <Badge variant="accent" size="sm">
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-label-small text-on-surface-variant">
                      <span>{formattedDate}</span>
                      {t.cwd && (
                        <span className="truncate max-w-36" title={t.cwd}>
                          · {t.cwd.replace(/\\/g, "/").split("/").findLast(Boolean)}
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="mt-2 pt-2 border-t border-outline-variant/20 flex items-center justify-end gap-1">
                    {onRenameThread && (
                      <Button
                        variant="text"
                        size="icon"
                        className="h-8 w-8 text-on-surface-variant hover:text-on-surface"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleStartRename(t);
                        }}
                        title="Renommer la session"
                        aria-label="Renommer la session"
                      >
                        <Icon name="edit" size={16} />
                      </Button>
                    )}
                    {onForkThread && (
                      <Button
                        variant="text"
                        size="icon"
                        className="h-8 w-8 text-on-surface-variant hover:text-on-surface"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          void onForkThread(t.id);
                          onClose();
                        }}
                        title="Bifurquer le fil"
                        aria-label="Bifurquer le fil"
                      >
                        <Icon name="call_split" size={16} />
                      </Button>
                    )}
                    {onCompactThread && (
                      <Button
                        variant="text"
                        size="icon"
                        className="h-8 w-8 text-on-surface-variant hover:text-on-surface"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          void onCompactThread(t.id);
                        }}
                        title="Compacter le fil"
                        aria-label="Compacter le fil"
                      >
                        <Icon name="compress" size={16} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

export function DiffViewer({ diff, filename }: { diff: string; filename?: string }) {
  const lines = diff.split("\n");

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
      {filename && (
        <div className="border-b border-outline-variant/20 bg-surface-container px-3 py-1.5 text-label-medium font-mono text-on-surface-variant flex items-center gap-2">
          <Icon name="edit_document" size={16} />
          <span className="truncate">{filename}</span>
        </div>
      )}
      <div className="overflow-x-auto p-2 font-mono text-body-small leading-5 max-h-72">
        {lines.map((line, idx) => {
          let lineClass = "text-on-surface/80";
          let bgClass = "";
          if (line.startsWith("+") && !line.startsWith("+++")) {
            lineClass = "text-emerald-400 font-medium";
            bgClass = "bg-emerald-500/10";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            lineClass = "text-rose-400 font-medium";
            bgClass = "bg-rose-500/10";
          } else if (line.startsWith("@@")) {
            lineClass = "text-cyan-400 font-semibold";
            bgClass = "bg-cyan-500/10";
          }
          return (
            // oxlint-disable-next-line react/no-array-index-key -- lignes de sortie append-only sans identité stable ni unicité garantie du contenu
            <div key={idx} className={`px-2 py-0.5 whitespace-pre ${bgClass} ${lineClass}`}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Changement de fichier dans la timeline.
 * Règle No-Slop : Créé / Modifié / Supprimé, chemin, 'Voir le diff', AUCUN line count.
 */
export function FileChangeCard({
  path,
  kind = "Modified",
  diff,
  onViewDiff,
}: {
  path: string;
  kind?: "Created" | "Modified" | "Deleted" | string;
  diff?: string;
  onViewDiff?: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);

  const kindLabel =
    kind === "Created" || kind === "created"
      ? "Créé"
      : kind === "Deleted" || kind === "deleted"
        ? "Supprimé"
        : "Modifié";

  const kindTone =
    kindLabel === "Créé"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : kindLabel === "Supprimé"
        ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
        : "bg-blue-500/15 text-blue-400 border-blue-500/30";

  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-high/60 p-3.5 my-2 shadow-xs transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={clsx("px-2 py-0.5 rounded-md text-label-small font-semibold border", kindTone)}>
            {kindLabel}
          </span>
          <span className="font-mono text-body-medium text-on-surface truncate">{path}</span>
        </div>

        {diff && (
          <button
            type="button"
            onClick={() => {
              if (onViewDiff) onViewDiff();
              else setShowDiff(!showDiff);
            }}
            className="text-label-medium text-primary hover:underline cursor-pointer shrink-0"
          >
            {showDiff ? "Masquer le diff" : "Voir le diff"}
          </button>
        )}
      </div>

      {showDiff && diff && (
        <div className="mt-2.5 pt-2 border-t border-outline-variant/20">
          <DiffViewer diff={diff} filename={path} />
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalItem;
  onDecide: (decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
}) {
  const isPending = approval.status === "pending";

  return (
    <div
      role="alert"
      className="my-3 rounded-2xl border border-amber-500/40 bg-surface-container-high p-4 text-on-surface shadow-md"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon name="gavel" size={20} className="text-amber-500" />
        <h3 className="m-0 text-title-small font-semibold text-on-surface">{approval.title}</h3>
        <span className="flex-1" />
        {!isPending && (
          <Badge
            variant={approval.status === "approved" || approval.status === "session" ? "accent" : "error"}
            size="sm"
          >
            {approval.status === "approved"
              ? "Autorisé"
              : approval.status === "session"
                ? "Autorisé pour ce projet"
                : "Refusé"}
          </Badge>
        )}
      </div>

      {approval.reason && <p className="m-0 mb-2 text-body-medium text-on-surface-variant">{approval.reason}</p>}

      {approval.network && (
        <div className="mb-2 flex items-center gap-1.5 text-label-medium text-on-surface-variant">
          <Icon name="public" size={16} />
          <span className="font-mono">{approval.network}</span>
        </div>
      )}

      {approval.path && (
        <div className="mb-2 flex items-center gap-1.5 text-label-medium text-on-surface-variant">
          <Icon name="description" size={16} />
          <span className="font-mono">{approval.path}</span>
        </div>
      )}

      {approval.diff && (
        <div className="mb-3">
          <DiffViewer diff={approval.diff} filename={approval.path} />
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="filled"
            size="sm"
            disabled={approval.submitting}
            onClick={() => onDecide("decline")}
            className="bg-error text-on-error hover:bg-error/90 font-medium"
          >
            Refuser (Défaut)
          </Button>
          <Button variant="tonal" size="sm" disabled={approval.submitting} onClick={() => onDecide("accept")}>
            Autoriser une fois
          </Button>
          <Button variant="text" size="sm" disabled={approval.submitting} onClick={() => onDecide("acceptForSession")}>
            Autoriser pour ce projet
          </Button>
        </div>
      )}
    </div>
  );
}

export interface CodexChatProps {
  turns: Turn[];
  busy: boolean;
  ready?: boolean;
  settingsLocked?: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  attachedFiles?: string[];
  onAddAttachment?: (file: string) => void;
  onRemoveAttachment?: (file: string) => void;
  onSend: () => void;
  onStop: () => void;
  onNewSession: () => void;
  onClearSession: () => void;
  model: string;
  onModelChange: (model: string) => void;
  effort?: string;
  onEffortChange?: (effort: string) => void;
  accessMode?: "full" | "ask" | "readonly";
  onAccessModeChange?: (mode: "full" | "ask" | "readonly") => void;
  modelOptions: ChatModelOption[];
  cwd: string;
  onCwdChange: (cwd: string) => void;
  sessionTitle?: string;
  onApprovalDecision?: (approval: ApprovalItem, decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
  threads?: ThreadSummary[];
  onSelectThread?: (id: string) => void;
  activeThreadId?: string;
  onRenameThread?: (threadId: string, name: string) => void | Promise<void>;
  onForkThread?: (threadId: string, turnId?: string) => void | Promise<void>;
  onCompactThread?: (threadId: string) => void | Promise<void>;
}

// Référence stable : valeur par défaut des pièces jointes (évite un tableau neuf à chaque rendu).
const NO_ATTACHMENTS: string[] = [];

export function CodexChat({
  turns,
  busy,
  ready = true,
  settingsLocked = false,
  draft,
  onDraftChange,
  attachedFiles = NO_ATTACHMENTS,
  onAddAttachment,
  onRemoveAttachment,
  onSend,
  onStop,
  onNewSession,
  onClearSession,
  model,
  onModelChange,
  effort = "Minimal",
  onEffortChange,
  accessMode = "full",
  onAccessModeChange,
  modelOptions,
  cwd,
  onCwdChange,
  sessionTitle,
  onApprovalDecision,
  activeThreadId,
  onRenameThread,
  onForkThread,
}: CodexChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const promptShape = promptBarShape({
    hasTurns: turns.length > 0,
    scrolled,
    hasContent: draft.trim().length > 0 || attachedFiles.length > 0,
  });

  const plusPopover = usePopover();
  const modelPopover = usePopover();
  const accessPopover = usePopover();

  // Auto-scroll on turns update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- turns et busy sont des déclencheurs volontaires : l'effet défile en bas à chaque nouveau message ou changement d'état d'exécution, sans les lire
  }, [turns, busy]);

  const handleCommitTitleRename = () => {
    const trimmed = editTitleDraft.trim();
    if (trimmed && activeThreadId && onRenameThread) {
      void onRenameThread(activeThreadId, trimmed);
    }
    setIsEditingTitle(false);
  };

  const handleCopyTranscript = async () => {
    if (turns.length === 0) return;
    const formatted = turns
      .map(t => {
        if (t.role === "tool") return `[TOOL] ${t.pair.name}\n${t.pair.resultRaw ?? ""}`;
        if (t.role === "fileChange") return `[FILE CHANGE] ${t.fileChange.path}\n${t.fileChange.diff}`;
        if (t.role === "approval") return `[APPROVAL] ${t.approval.title} (${t.approval.status})`;
        return `[${t.role.toUpperCase()}]\n${t.content}`;
      })
      .join("\n\n");
    await copyChatText(formatted, "Échange copié");
  };

  const handlePickAddFile = async () => {
    plusPopover.setOpen(false);
    const picked = await pickFile("Joindre un fichier", cwd);
    if (picked) {
      if (onAddAttachment) {
        onAddAttachment(picked);
      } else {
        onDraftChange(draft ? `${draft}\n${picked}` : picked);
      }
    }
  };

  const handlePickAddFolder = async () => {
    plusPopover.setOpen(false);
    if (busy || settingsLocked) return;
    const picked = await pickDirectory("Sélectionner un dossier projet", cwd);
    if (picked) {
      onCwdChange(picked);
      toast.success(`Dossier actif : ${picked.split(/[/\\]/).pop()}`);
    }
  };

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<DictationRecognition | null>(null);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  interface SlashCommandItem {
    command: string;
    desc: string;
    icon: string;
    badge: string;
  }

  const SLASH_COMMANDS: SlashCommandItem[] = useMemo(
    () => [
      {
        command: "/goal",
        desc: "Définir un objectif pour l’agent",
        icon: "track_changes",
        badge: "Agent",
      },
      {
        command: "/plan",
        desc: "Préparer un plan avec l’agent",
        icon: "lightbulb",
        badge: "Plan",
      },
      {
        command: "/rag",
        desc: "Recherche connaissances (RAG)",
        icon: "search_insights",
        badge: "RAG",
      },
      {
        command: "/model",
        desc: "Changer de modèle actif",
        icon: "bolt",
        badge: "Modèles",
      },
      {
        command: "/clear",
        desc: "Réinitialiser la conversation",
        icon: "delete_sweep",
        badge: "Session",
      },
    ],
    [],
  );

  const showSlashMenu = useMemo(() => {
    const trimmed = draft.trim();
    return trimmed.startsWith("/") && !trimmed.includes(" ") && trimmed.length <= 12;
  }, [draft]);

  const filteredSlashCommands = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c: SlashCommandItem) => c.command.toLowerCase().startsWith(q));
  }, [draft, SLASH_COMMANDS]);

  const handleSelectSlashCommand = (cmd: string) => {
    if (cmd === "/clear") {
      onDraftChange("/clear");
    } else {
      onDraftChange(`${cmd} `);
    }
  };

  const handleInsertGoal = () => {
    plusPopover.setOpen(false);
    onDraftChange(draft ? `${draft}\n/goal ` : "/goal ");
  };

  const handleInsertPlan = () => {
    plusPopover.setOpen(false);
    onDraftChange(draft ? `${draft}\n/plan ` : "/plan ");
  };

  const handleInsertRag = () => {
    plusPopover.setOpen(false);
    onDraftChange(draft ? `${draft}\n/rag ` : "/rag ");
  };

  const handleDictation = () => {
    const SpeechRecognition =
      (window as DictationWindow).SpeechRecognition || (window as DictationWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast.info("Dictée indisponible : ce webview ne prend pas en charge SpeechRecognition");
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Recognition may already have stopped after an error.
      }
      setIsListening(false);
      toast.info("Dictée arrêtée");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "fr-FR";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        toast.success("Dictée démarrée");
      };

      recognition.onresult = event => {
        let textResult = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          textResult += event.results[i][0].transcript;
        }
        if (textResult) {
          onDraftChange(draft ? `${draft.trim()} ${textResult.trim()}` : textResult.trim());
        }
      };

      recognition.addEventListener("error", () => {
        setIsListening(false);
      });

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      toast.error("Micro inaccessible : autorisez le microphone pour l'application puis réessayez");
    }
  };

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col bg-surface relative overflow-hidden text-body-large codex-chat-pane">
      {/* Top Header - Titre du fil centré et actions discrètes */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-outline-variant/20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitleDraft}
                onChange={e => setEditTitleDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleCommitTitleRename();
                  if (e.key === "Escape") setIsEditingTitle(false);
                }}
                className="px-3 py-1 rounded-xl bg-surface-container-high border border-primary text-title-medium font-bold text-on-surface focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 max-w-sm"

                placeholder="Nom du fil..."
              />
              <CircleButton
                icon="check"
                variant="standard"
                size="sm"
                onClick={handleCommitTitleRename}
                title="Valider"
              />
              <CircleButton
                icon="close"
                variant="standard"
                size="sm"
                onClick={() => setIsEditingTitle(false)}
                title="Annuler"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="m-0 text-title-medium font-semibold text-on-surface truncate">
                {sessionTitle || "Nouveau chat"}
              </h1>
              {activeThreadId && onRenameThread && (
                <CircleButton
                  icon="edit"
                  variant="standard"
                  size="sm"
                  onClick={() => {
                    setEditTitleDraft(sessionTitle || "");
                    setIsEditingTitle(true);
                  }}
                  title="Renommer le chat"
                  aria-label="Renommer le chat"
                />
              )}
            </div>
          )}
        </div>

        {/* Action icons en haut à droite : ... , layout, + */}
        <div className="flex items-center gap-1.5 shrink-0">
          <CircleButton
            icon="add"
            variant="standard"
            size="md"
            onClick={onNewSession}
            disabled={busy}
            title="Nouveau chat"
            aria-label="Nouveau chat"
          />
          {turns.length > 0 && (
            <CircleButton
              icon="content_copy"
              variant="standard"
              size="md"
              onClick={() => void handleCopyTranscript()}
              title="Copier l'échange"
              aria-label="Copier l'échange"
            />
          )}
          {turns.length > 0 && (
            <CircleButton
              icon="delete_sweep"
              variant="standard"
              size="md"
              onClick={onClearSession}
              disabled={busy}
              title="Fermer ce chat"
              aria-label="Fermer ce chat"
            />
          )}
        </div>
      </div>

      {/* Main conversation feed: centred reading column (--app-reading-column, 760px) */}
      <div
        ref={scrollRef}
        onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-6 scroll-smooth"
      >
        <div className="app-reading-column min-w-0 space-y-6">
          {turns.length === 0 ? (
            <div className="flex h-96 flex-col justify-end pb-8">
              <h2 className="app-greeting">
                <SparkleMark size={32} />
                <span className="app-greeting-text">Bonjour, par quoi commence-t-on ?</span>
              </h2>
            </div>
          ) : (
            turns.map(turn => {
              if (turn.role === "approval") {
                return (
                  <div key={turn.id} className="w-full">
                    <ApprovalCard
                      approval={turn.approval}
                      onDecide={decision => onApprovalDecision?.(turn.approval, decision)}
                    />
                  </div>
                );
              }

              if (turn.role === "fileChange") {
                return (
                  <div key={turn.id} className="w-full">
                    <FileChangeCard
                      path={turn.fileChange.path}
                      kind={turn.fileChange.kind}
                      diff={turn.fileChange.diff}
                    />
                  </div>
                );
              }

              if (turn.role === "tool") {
                return (
                  <div key={turn.id} className="w-full my-2">
                    <ToolCall pair={turn.pair} />
                  </div>
                );
              }

              // User Message Turn : bulle compacte arrondie (radius 28px, surface-container-high, max 75%)
              if (turn.role === "user") {
                return (
                  <div key={turn.id} className="flex flex-col items-end w-full py-1">
                    <div className="max-w-[75%] rounded-[28px] bg-surface-container-high px-6 py-3.5 text-body-large text-on-surface break-words shadow-xs">
                      <div className="whitespace-pre-wrap">{turn.content}</div>
                    </div>
                    {turn.attachments && turn.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end mt-2 max-w-[75%]">
                        {turn.attachments.map(filePath => {
                          const filename = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
                          return (
                            <div
                              key={filePath}
                              className="app-chip flex items-center gap-1.5 px-3 py-1 bg-surface-container text-label-large text-on-surface"
                            >
                              <span className="material-symbol text-title-small text-primary">description</span>
                              <span className="truncate max-w-xs">{filename}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Assistant Turn : texte brut à gauche, sans bulle, markdown propre, code Google Sans Code, actions au survol
              return (
                <div key={turn.id} className="group flex flex-col py-2 w-full text-left">
                  <div className="flex w-full items-start gap-3">
                    <span className="mt-1">
                      <SparkleMark size={24} />
                    </span>
                    <div
                      className="min-w-0 flex-1 bg-transparent text-body-large text-on-surface"
                      aria-busy={turn.streaming || undefined}
                    >
                      <Markdown content={turn.content} size="large" className="break-words font-sans" />
                    </div>
                  </div>
                  {/* Copier ou bifurquer un fil réellement disponible. */}
                  <div className="mt-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <CircleButton
                      icon="content_copy"
                      variant="standard"
                      size="sm"
                      onClick={() => void copyChatText(turn.content, "Message copié")}
                      title="Copier le message"
                      aria-label="Copier le message"
                    />
                    {activeThreadId && onForkThread && ready && !busy && (
                      <CircleButton
                        icon="call_split"
                        variant="standard"
                        size="sm"
                        onClick={() => void onForkThread(activeThreadId)}
                        title="Bifurquer ce chat"
                        aria-label="Bifurquer ce chat"
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Composer en bas - centré, clamp(560px, 72%, 960px) */}
      <div className={clsx("w-full px-4 shrink-0", promptShape === "docked" ? "pb-0" : "pb-6")}>
        <div className="app-reading-column min-w-0 relative">
          {/* Menu d'autocomplétion des commandes IA instantanées */}
          {showSlashMenu && filteredSlashCommands.length > 0 && (
            <div className="absolute bottom-full mb-3 left-0 right-0 max-w-lg bg-surface-container-high border border-outline-variant/40 rounded-2xl p-2 shadow-2xl z-50 text-body-large">
              <div className="px-3 py-1 text-label-small font-bold text-on-surface-variant uppercase tracking-wider">
                Commandes IA instantanées
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {filteredSlashCommands.map((cmd, idx) => (
                  <button
                    key={cmd.command}
                    type="button"
                    onClick={() => handleSelectSlashCommand(cmd.command)}
                    className={clsx(
                      "flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large transition-colors cursor-pointer text-left",
                      idx === selectedSlashIndex
                        ? "bg-secondary-container text-on-secondary-container font-semibold"
                        : "text-on-surface hover:bg-surface-container-highest",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbol text-title-small text-primary">{cmd.icon}</span>
                      <span className="font-mono text-label-large font-bold">{cmd.command}</span>
                      <span className="text-body-large text-on-surface-variant truncate max-w-[200px]">{cmd.desc}</span>
                    </div>
                    <span className="text-label-small text-primary bg-primary/10 px-2 py-0.5 rounded-full font-medium">
                      {cmd.badge}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="app-prompt-bar p-4" data-shape={promptShape}>
            {/* Input Textarea */}
            <textarea
              value={draft}
              onChange={e => onDraftChange(e.target.value)}
              onKeyDown={e => {
                if (showSlashMenu && filteredSlashCommands.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedSlashIndex(prev => (prev + 1) % filteredSlashCommands.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedSlashIndex(
                      prev => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
                    );
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    if (filteredSlashCommands[selectedSlashIndex]) {
                      handleSelectSlashCommand(filteredSlashCommands[selectedSlashIndex].command);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (ready && !busy && (draft.trim() || attachedFiles.length > 0)) onSend();
                } else if (e.key === "Escape" && busy) {
                  e.preventDefault();
                  onStop();
                }
              }}
              placeholder="Que voulez-vous faire ?"
              rows={2}
              className="w-full bg-transparent resize-none border-0 text-body-large text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus:ring-0 leading-relaxed font-sans"
            />

            {/* Attached files chips under textarea */}
            {attachedFiles && attachedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-2 pt-1 border-t border-outline-variant/15">
                {attachedFiles.map(filePath => {
                  const filename = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
                  return (
                    <div
                      key={filePath}
                      className="app-chip flex items-center gap-2 px-3 py-1 bg-surface-container text-label-large text-on-surface"
                    >
                      <span className="material-symbol text-title-small text-primary">attach_file</span>
                      <span className="truncate max-w-xs">{filename}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment?.(filePath)}
                        className="size-6 rounded-full flex items-center justify-center hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                        title="Retirer le fichier"
                        aria-label={`Retirer ${filename}`}
                      >
                        <span className="material-symbol text-title-small">close</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Controls Row */}
            <div className="mt-3 flex items-center justify-between gap-3 pt-1 border-t border-outline-variant/15">
              {/* Left Controls : + (menu Add & Tools), Badge Accès complet, Plug icon with dot */}
              <div className="flex items-center gap-2">
                {/* Bouton + et Popover Menu */}
                <Popover.Root open={plusPopover.open} onOpenChange={plusPopover.setOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="size-10 rounded-full flex items-center justify-center bg-surface-container hover:bg-surface-container-highest text-on-surface transition-colors cursor-pointer border border-outline-variant/30"
                      title="Ajouter ou outils"
                      aria-label="Ajouter ou outils"
                    >
                      <span className="material-symbol text-title-medium">add</span>
                    </button>
                  </Popover.Trigger>
                  <Popover.Content
                    align="start"
                    sideOffset={12}
                    className="w-80 rounded-2xl bg-surface-container-high border border-outline-variant/30 p-2 shadow-2xl z-50 text-body-large"
                  >
                    {/* Section Ajouter */}
                    <div className="px-3 py-1.5 text-label-medium font-bold text-on-surface-variant">
                      Outils & fichiers
                    </div>
                    <div className="space-y-0.5 mb-2">
                      <button
                        type="button"
                        onClick={handlePickAddFile}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-label-large text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                      >
                        <span className="material-symbol text-title-small text-primary">attach_file</span>
                        <span>Fichiers et dossiers</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy || settingsLocked}
                        onClick={handlePickAddFolder}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-label-large text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                      >
                        <span className="material-symbol text-title-small text-primary">folder_open</span>
                        <span>Dossier de travail</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInsertRag}
                        className="flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="material-symbol text-title-small text-primary">search_insights</span>
                          <span>Recherche connaissances</span>
                        </div>
                        <span className="text-label-small text-on-surface-variant font-mono">/rag</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInsertGoal}
                        className="flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="material-symbol text-title-small text-primary">track_changes</span>
                          <span>Objectif autonome</span>
                        </div>
                        <span className="text-label-small text-on-surface-variant font-mono">/goal</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInsertPlan}
                        className="flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="material-symbol text-title-small text-primary">lightbulb</span>
                          <span>Mode plan</span>
                        </div>
                        <span className="text-label-small text-on-surface-variant font-mono">/plan</span>
                      </button>
                    </div>
                  </Popover.Content>
                </Popover.Root>

                {/* Badge d'accès 'Accès complet' en rouge/orange */}
                <Popover.Root open={accessPopover.open} onOpenChange={accessPopover.setOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="app-chip flex items-center gap-1.5 px-3 py-1.5 text-label-large font-medium text-on-tertiary-container bg-tertiary-container hover:bg-tertiary-container/80 transition-colors cursor-pointer"
                      title={`Niveau d'accès : ${accessMode === "full" ? "accès complet" : accessMode === "ask" ? "demander avant modifications" : "lecture seule"}`}
                    >
                      <span className="material-symbol text-title-small" aria-hidden="true">
                        warning
                      </span>
                      <span className="app-chip-label">
                        {accessMode === "full"
                          ? "Accès complet"
                          : accessMode === "ask"
                            ? "Demander avant modifications"
                            : "Lecture seule"}
                      </span>
                    </button>
                  </Popover.Trigger>
                  <Popover.Content
                    align="start"
                    sideOffset={12}
                    className="w-64 rounded-2xl bg-surface-container-high border border-outline-variant/30 p-2 shadow-2xl z-50"
                  >
                    <div className="px-3 py-1 text-label-medium font-bold text-on-surface-variant">
                      Politique d'accès
                    </div>
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        disabled={busy || settingsLocked}
                        onClick={() => {
                          onAccessModeChange?.("full");
                          accessPopover.setOpen(false);
                        }}
                        className={clsx(
                          "flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large cursor-pointer text-left",
                          accessMode === "full"
                            ? "bg-amber-500/20 text-amber-400 font-bold"
                            : "text-on-surface hover:bg-surface-container-highest",
                        )}
                      >
                        <span>Accès complet (Bypass)</span>
                        {accessMode === "full" && <span className="material-symbol text-title-small">check</span>}
                      </button>
                      <button
                        type="button"
                        disabled={busy || settingsLocked}
                        onClick={() => {
                          onAccessModeChange?.("ask");
                          accessPopover.setOpen(false);
                        }}
                        className={clsx(
                          "flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large cursor-pointer text-left",
                          accessMode === "ask"
                            ? "bg-secondary-container text-primary font-bold"
                            : "text-on-surface hover:bg-surface-container-highest",
                        )}
                      >
                        <span>Demander avant modif</span>
                        {accessMode === "ask" && <span className="material-symbol text-title-small">check</span>}
                      </button>
                      <button
                        type="button"
                        disabled={busy || settingsLocked}
                        onClick={() => {
                          onAccessModeChange?.("readonly");
                          accessPopover.setOpen(false);
                        }}
                        className={clsx(
                          "flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large cursor-pointer text-left",
                          accessMode === "readonly"
                            ? "bg-secondary-container text-primary font-bold"
                            : "text-on-surface hover:bg-surface-container-highest",
                        )}
                      >
                        <span>Lecture seule</span>
                        {accessMode === "readonly" && <span className="material-symbol text-title-small">check</span>}
                      </button>
                    </div>
                  </Popover.Content>
                </Popover.Root>

                {/* Icône outils avec puce dorée */}
                <button
                  type="button"
                  onClick={() => plusPopover.setOpen(true)}
                  className="relative size-10 rounded-full flex items-center justify-center hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                  title="Extensions et outils"
                  aria-label="Extensions et outils"
                >
                  <span className="material-symbol text-title-medium">anchor</span>
                  <span className="absolute top-2 right-2 size-2 rounded-full bg-amber-400 ring-2 ring-surface-container-high" />
                </button>
              </div>

              {/* Right Controls : Sélecteur de modèle ('⚡ GPT-6 Luna Minimal ˅'), Micro, Bouton envoi/stop */}
              <div className="flex items-center gap-2">
                {/* Sélecteur de modèle Popover pixel-perfect */}
                <Popover.Root open={modelPopover.open} onOpenChange={modelPopover.setOpen}>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="app-chip flex items-center gap-2 px-3.5 py-2 bg-surface-container hover:bg-surface-container-highest text-label-large font-medium text-on-surface transition-colors cursor-pointer"
                      title={
                        settingsLocked
                          ? "Modèle de ce chat. Créez un nouveau chat pour changer de modèle."
                          : `Modèle : ${model || "Aucun modèle configuré"}`
                      }
                    >
                      <span className="material-symbol text-primary text-title-small" aria-hidden="true">
                        bolt
                      </span>
                      <span className="app-chip-label font-semibold">{model || "Choisir un modèle"}</span>
                      {onEffortChange && (
                        <span className="app-chip-label text-on-surface-variant font-normal">{effort}</span>
                      )}
                      <span className="material-symbol text-on-surface-variant text-title-small" aria-hidden="true">
                        expand_more
                      </span>
                    </button>
                  </Popover.Trigger>
                  <Popover.Content
                    align="end"
                    sideOffset={12}
                    className="w-80 rounded-2xl bg-surface-container-high border border-outline-variant/30 p-2 shadow-2xl z-50 text-body-large"
                  >
                    <div className="px-3 pt-2 pb-1 text-label-medium text-on-surface-variant/80">
                      Sélectionner un modèle
                    </div>
                    <div className="px-3 pb-2 text-label-small font-semibold text-primary">
                      Modèles configurés par votre agent
                    </div>

                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {modelOptions.length === 0 ? (
                        <p className="px-3 py-2 text-body-medium text-on-surface-variant">Aucun modèle configuré.</p>
                      ) : (
                        modelOptions.map(option => (
                          <button
                            key={option.id}
                            type="button"
                            disabled={busy || settingsLocked}
                            onClick={() => {
                              onModelChange(option.id);
                              modelPopover.setOpen(false);
                            }}
                            className={clsx(
                              "flex w-full items-center justify-between px-3 py-2 rounded-xl text-label-large text-left transition-colors disabled:opacity-50",
                              model === option.id
                                ? "bg-secondary-container/70 text-on-secondary-container font-semibold"
                                : "text-on-surface hover:bg-surface-container-highest",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{option.name}</span>
                              <span className="block text-label-small text-on-surface-variant">{option.provider}</span>
                            </span>
                            {model === option.id && (
                              <span className="material-symbol text-title-small text-primary">check</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>

                    {/* Le sélecteur d’effort exige un contrat fourni par le parent. */}
                    {onEffortChange && (
                      <div className="mt-2 pt-2 border-t border-outline-variant/20 px-2">
                        <div className="text-label-small text-on-surface-variant mb-1.5">Niveau d'effort</div>
                        <div className="flex items-center gap-1">
                          {(["None", "Low", "Medium", "High", "Minimal"] as const).map(lvl => (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() => {
                                onEffortChange?.(lvl);
                                modelPopover.setOpen(false);
                              }}
                              className={clsx(
                                "flex-1 py-1 text-label-small font-medium rounded-lg text-center transition-colors cursor-pointer",
                                effort === lvl
                                  ? "bg-primary text-on-primary font-bold shadow-xs"
                                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-highest",
                              )}
                            >
                              {lvl}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Popover.Content>
                </Popover.Root>

                {/* Micro dictée */}
                <button
                  type="button"
                  onClick={handleDictation}
                  className={clsx(
                    "size-11 rounded-full flex items-center justify-center transition-all cursor-pointer",
                    isListening
                      ? "bg-error text-on-error animate-pulse shadow-md"
                      : "hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface",
                  )}
                  title={isListening ? "Arrêter la dictée vocale (en cours...)" : "Dictée vocale"}
                  aria-label={isListening ? "Arrêter la dictée vocale (en cours...)" : "Dictée vocale"}
                >
                  <span className="material-symbol text-title-medium font-bold">mic</span>
                </button>

                {/* Bouton rond d'envoi primary devenant Stop pendant l'exécution */}
                <button
                  type="button"
                  onClick={busy ? onStop : onSend}
                  disabled={!busy && (!ready || (!draft.trim() && attachedFiles.length === 0))}
                  className={clsx(
                    "size-11 rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer",
                    busy
                      ? "bg-error text-on-error hover:bg-error/90 animate-pulse"
                      : draft.trim()
                        ? "bg-primary text-on-primary hover:bg-primary/92 active:scale-95"
                        : "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed",
                  )}
                  title={busy ? "Arrêter la génération" : "Envoyer"}
                  aria-label={busy ? "Arrêter la génération" : "Envoyer"}
                >
                  {busy ? (
                    <span className="material-symbol text-title-medium font-bold">stop</span>
                  ) : (
                    <span className="material-symbol text-title-medium font-bold">arrow_upward</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function chatRpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return aphrodyRpc(method, params);
}

function chatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /Server returned HTTP [0-9]+|HTTP [0-9]+|Failed to fetch|fetch failed|NetworkError/i.test(message)
    ? "Connexion au service indisponible."
    : message;
}

async function copyChatText(text: string, success: string): Promise<void> {
  if (await copyToNativeClipboard(text)) toast.success(success);
  else toast.error("Copie impossible : le presse-papiers est indisponible.");
}

type RouteIntent = {
  prompt?: string;
  cwd?: string;
  contextFiles?: string[];
};

/** Intention entrante (state de navigation ou query string) : prompt initial, dossier et fichiers de contexte. */
function readRouteIntent(location: { search: string; state: unknown }): RouteIntent {
  const state = location.state as {
    initialPrompt?: string;
    prompt?: string;
    cwd?: string;
    contextFiles?: string[];
  } | null;

  const searchParams = new URLSearchParams(location.search);
  const queryPrompt = searchParams.get("prompt") || searchParams.get("q");
  const queryFile = searchParams.get("file");

  const incomingPrompt =
    state?.initialPrompt ||
    state?.prompt ||
    queryPrompt ||
    (queryFile ? `À propos du fichier ${queryFile} :\n` : undefined);

  return {
    prompt: incomingPrompt,
    cwd: state?.cwd,
    contextFiles: state?.contextFiles,
  };
}

/** Ref mise à jour après chaque rendu (layout effect) : effets et callbacks lisent la dernière valeur sans dépendance. */
function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function CodexChatRoute() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const threadLoadEpoch = useRef(0);
  const [draft, setDraft] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [turnId, setTurnId] = useState<string>();
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([]);
  const [connectionError, setConnectionError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const stopRequested = useRef(false);
  const compactedAtTurns = useRef(new Map<string, number>());
  const approvalReplies = useRef(new Set<string>());
  const confirmedApprovalReplies = useRef(new Set<string>());

  // Connect cleanly with useChatStore (shared with SpacesSidebar)
  const {
    threads,
    activeThreadId,
    sessionTitle,
    model,
    effort,
    accessMode,
    cwd,
    newSessionRequested,
    setThreads,
    setActiveThreadId,
    setSessionTitle,
    setModel,
    setAccessMode,
    setCwd,
    clearNewSessionRequest,
  } = useChatStore();

  const threadIdRef = useRef<string | null>(activeThreadId);

  const location = useLocation();
  const navigate = useNavigate();

  // Handle incoming routing query or state
  // Brouillon et pièces jointes dérivés de la navigation entrante, appliqués pendant le rendu (ajustement d'état).
  const [consumedLocation, setConsumedLocation] = useState<typeof location | null>(null);
  if (location !== consumedLocation) {
    setConsumedLocation(location);
    const intent = readRouteIntent(location);
    if (intent.prompt) {
      setDraft(intent.prompt);
    }
    if (intent.contextFiles && intent.contextFiles.length > 0) {
      const contextFiles = intent.contextFiles;
      setAttachedFiles(prev => Array.from(new Set([...prev, ...contextFiles])));
    }
  }

  // Effets de bord de la navigation entrante : dossier du store puis remplacement de l'entrée d'historique.
  useEffect(() => {
    const intent = readRouteIntent(location);
    if (intent.cwd) {
      setCwd(intent.cwd);
    }

    if (intent.prompt || intent.cwd || intent.contextFiles) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate, setCwd]);

  const loadThreads = async () => {
    const res = await chatRpc("thread/list", { limit: 20 });
    const rawList = Array.isArray(res.threads) ? res.threads : Array.isArray(res.data) ? res.data : undefined;
    if (!rawList) throw new Error("Historique indisponible.");
    const loaded: ThreadSummary[] = rawList.map((value: unknown) => {
      const t = value as ThreadSummary;
      if (typeof t.id !== "string" || !t.id) throw new Error("Historique invalide.");
      return {
        id: t.id,
        name: t.name,
        preview: t.name || t.preview,
        createdAt: t.createdAt,
        cwd: t.cwd,
      };
    });
    setThreads(loaded);
  };

  const switchThread = async (id: string) => {
    const epoch = ++threadLoadEpoch.current;
    setLoadingThread(true);
    try {
      // Ensure resumed
      await chatRpc("thread/resume", { threadId: id });

      const res = (await chatRpc("thread/read", {
        threadId: id,
        includeTurns: true,
      })) as {
        thread?: {
          id: string;
          name?: string;
          preview?: string;
          cwd?: string;
          model?: string;
          turns?: Array<{
            id: string;
            items?: Array<{
              id: string;
              type: string;
              text?: string;
              content?: Array<{ type: string; text?: string }>;
              toolName?: string;
              args?: Record<string, unknown>;
              path?: string;
              diff?: string;
              kind?: string;
            }>;
          }>;
        };
      };

      if (epoch !== threadLoadEpoch.current) return;
      if (!res.thread || res.thread.id !== id) throw new Error("Le serveur n’a pas retourné ce chat.");
      setActiveThreadId(id);
      threadIdRef.current = id;
      if (res.thread?.cwd) setCwd(res.thread.cwd);
      if (res.thread?.model) setModel(res.thread.model);
      const activeSummary = threads.find(t => t.id === id);
      setSessionTitle(res.thread?.name || res.thread?.preview || activeSummary?.name || activeSummary?.preview);

      const reconstructed: Turn[] = [];
      for (const t of res.thread?.turns ?? []) {
        for (const item of t.items ?? []) {
          if (item.type === "userMessage" || (item.type === "userInput" && item.text)) {
            reconstructed.push({
              id: item.id || `msg-${Date.now()}`,
              role: "user",
              content:
                item.text ??
                item.content?.flatMap(part => (typeof part.text === "string" ? [part.text] : [])).join("\n") ??
                "",
              turnId: t.id,
            });
          } else if (item.type === "agentMessage") {
            reconstructed.push({
              id: item.id || `msg-${Date.now()}`,
              role: "assistant",
              content: item.text ?? "",
              turnId: t.id,
              itemId: item.id,
            });
          } else if (item.type === "mcpToolCall") {
            reconstructed.push({
              id: item.id || `tool-${Date.now()}`,
              role: "tool",
              pair: {
                id: item.id,
                name: item.toolName ?? "tool",
                argsRaw: JSON.stringify(item.args ?? {}, null, 2),
                args: item.args ?? null,
                resultRaw: item.text ?? null,
                result: null,
                status: "completed",
                title: item.toolName ?? "tool",
              },
              turnId: t.id,
              itemId: item.id,
            });
          } else if (item.type === "fileChange" && item.diff) {
            reconstructed.push({
              id: item.id || `patch-${Date.now()}`,
              role: "fileChange",
              fileChange: {
                id: item.id,
                path: item.path ?? "fichier",
                kind: item.kind ?? "Modified",
                diff: item.diff,
                status: "applied",
                turnId: t.id,
                itemId: item.id,
              },
            });
          }
        }
      }
      setTurns(reconstructed);
    } catch (e) {
      if (epoch !== threadLoadEpoch.current) return;
      setActiveThreadId(threadIdRef.current);
      toast.error(`Impossible de charger le fil : ${chatErrorMessage(e)}`);
      throw e;
    } finally {
      if (epoch === threadLoadEpoch.current) setLoadingThread(false);
    }
  };

  // Latest-value ref : l'effet de sélection appelle toujours le switchThread du dernier rendu.
  const switchThreadRef = useLatestRef(switchThread);

  // Sidebar selections use the same owner-backed history load as route actions.
  useEffect(() => {
    if (!ready || !activeThreadId || activeThreadId === threadIdRef.current) return;
    if (busy) {
      setActiveThreadId(threadIdRef.current);
      toast.info("Arrêtez l’exécution avant de changer de chat.");
      return;
    }
    void switchThreadRef.current(activeThreadId).catch(() => {});
  }, [activeThreadId, ready, busy, setActiveThreadId, switchThreadRef]);

  // React to new session request from SpacesSidebar
  useEffect(() => {
    if (newSessionRequested) {
      clearNewSessionRequest();
      if (busy) {
        setActiveThreadId(threadIdRef.current);
        const summary = threads.find(thread => thread.id === threadIdRef.current);
        setSessionTitle(summary?.name || summary?.preview);
        toast.info("Arrêtez l’exécution avant de créer un nouveau chat.");
        return;
      }
      threadLoadEpoch.current++;
      // oxlint-disable-next-line react/set-state-in-effect -- la demande vient du store partagé (SpacesSidebar) : la remise à zéro du chargement doit suivre la consommation de cette demande dans cet effet
      setLoadingThread(false);
      setTurns([]);
      setDraft("");
      setAttachedFiles([]);
      setTurnId(undefined);
      threadIdRef.current = null;
    }
  }, [newSessionRequested, clearNewSessionRequest, busy, threads, setActiveThreadId, setSessionTitle]);

  // Backend initialization and catalog must succeed before a message can be sent.
  // Ne se rejoue qu'au montage et au bouton « Réessayer » : les valeurs de départ sont figées à l'ouverture de l'effet.
  const initSnapshot = useLatestRef({
    model,
    cwd,
    activeThreadId,
    setModel,
    setCwd,
    loadThreads,
    switchThread,
  });
  useEffect(() => {
    const snap = initSnapshot.current;
    let active = true;
    void (async () => {
      try {
        await ensureAphrodyInitialized();
        const listed = await chatRpc("model/list");
        if (!Array.isArray(listed.data)) throw new Error("Catalogue de modèles indisponible.");
        const data = listed.data as Array<{
          id: string;
          provider: string;
          default?: boolean;
        }>;
        const options = data.map(entry => {
          if (typeof entry.id !== "string" || typeof entry.provider !== "string")
            throw new Error("Catalogue de modèles invalide.");
          return { id: entry.id, name: entry.id, provider: entry.provider };
        });
        if (!active) return;
        setModelOptions(options);
        const selected = data.find(entry => entry.id === snap.model) ?? data.find(entry => entry.default) ?? data[0];
        snap.setModel(selected?.id ?? "");
        try {
          const res = await tauriInvoke<{ cwd?: string }>("aphrody_system_cwd");
          if (active && res?.cwd && !snap.cwd) snap.setCwd(res.cwd);
        } catch {
          /* A browser host can use the backend's configured directory. */
        }
        await snap.loadThreads();
        if (active && snap.activeThreadId) await snap.switchThread(snap.activeThreadId);
        if (active) setReady(true);
      } catch (error) {
        if (active) setConnectionError(chatErrorMessage(error));
      }
    })();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- connectionAttempt est le seul déclencheur voulu (montage et bouton « Réessayer ») ; les autres valeurs sont lues via initSnapshot
  }, [connectionAttempt, initSnapshot]);

  const handleApprovalDecision = async (
    approval: ApprovalItem,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => {
    const newStatus = decision === "accept" ? "approved" : decision === "acceptForSession" ? "session" : "denied";

    const replyKey = `${approval.backendGeneration ?? ""}:${approval.id}`;
    if (approvalReplies.current.has(replyKey) || confirmedApprovalReplies.current.has(replyKey)) return;
    approvalReplies.current.add(replyKey);
    const updateApproval = (patch: Partial<ApprovalItem>) =>
      setTurns(items =>
        items.map(item =>
          item.role === "approval" &&
          item.approval.id === approval.id &&
          item.approval.backendGeneration === approval.backendGeneration
            ? { ...item, approval: { ...item.approval, ...patch } }
            : item,
        ),
      );
    updateApproval({ submitting: true });

    try {
      await aphrodyReply({
        id: approval.id,
        result: { decision },
        backendGeneration: approval.backendGeneration,
      });
      confirmedApprovalReplies.current.add(replyKey);
      updateApproval({ status: newStatus, submitting: false });
      toast.success(
        decision === "accept"
          ? "Action autorisée"
          : decision === "acceptForSession"
            ? "Action autorisée pour ce projet"
            : "Action refusée",
      );
    } catch (e) {
      updateApproval({ submitting: false });
      toast.error(`Décision non envoyée : ${chatErrorMessage(e)}`);
    } finally {
      approvalReplies.current.delete(replyKey);
    }
  };

  const handleNotification = (payload: unknown) => {
    const notification = payload as {
      id?: string | number;
      method?: string;
      backendGeneration?: number;
      params?: {
        threadId?: string;
        thread_id?: string;
        name?: string;
        turnId?: string;
        itemId?: string;
        delta?: string;
        path?: string;
        diff?: string;
        reason?: string;
        network?: string;
        item?: {
          id?: string;
          type?: string;
          text?: string;
          toolName?: string;
          path?: string;
          diff?: string;
          kind?: string;
          args?: Record<string, unknown>;
          result?: Record<string, unknown>;
        };
        turn?: {
          id?: string;
          status?: string;
          error?: { message?: string };
          items?: { type?: string }[];
        };
      };
    };

    const params = notification.params;
    const targetThreadId = params?.threadId ?? params?.thread_id;

    if (notification.method === "thread/name/updated") {
      const tId = targetThreadId;
      const newName = params?.name;
      if (tId && newName) {
        setThreads(threads.map(it => (it.id === tId ? { ...it, name: newName, preview: newName } : it)));
        if (tId === threadIdRef.current) {
          setSessionTitle(newName);
        }
      }
      return;
    }

    if (notification.method === "thread/compacted") {
      const tId = targetThreadId;
      if (tId && tId === threadIdRef.current) {
        void switchThread(tId).catch(() => {});
      }
      void loadThreads().catch(error => toast.error(chatErrorMessage(error)));
      return;
    }

    if (targetThreadId && targetThreadId !== threadIdRef.current) return;

    if (notification.method === "turn/started") {
      setTurnId(params?.turn?.id);
      setBusy(true);
      return;
    }

    // Inline Server Requests (Approvals)
    if (notification.method === "item/commandExecution/requestApproval") {
      if (notification.id === undefined) {
        console.warn("Command execution approval has no request ID; cannot safely reply");
        return;
      }
      // Command execution belongs to the separate native shell app, not this consumer webview.
      void aphrodyReply({
        id: notification.id,
        result: { decision: "decline" },
        backendGeneration: notification.backendGeneration,
      }).catch(error => console.warn("Command execution was declined by the UI host", error));
      return;
    }

    if (notification.method === "item/fileChange/requestApproval") {
      if (notification.id === undefined) {
        toast.error("Demande d’autorisation invalide : identifiant manquant.");
        return;
      }
      const reqId = notification.id;
      const approval: ApprovalItem = {
        id: reqId,
        kind: "fileChange",
        title: "Autorisation requise : Modification de fichier",
        path: params?.path,
        diff: params?.diff,
        reason: params?.reason,
        status: "pending",
        backendGeneration: notification.backendGeneration,
        threadId: params?.threadId,
        turnId: params?.turnId,
        itemId: params?.itemId,
      };

      setTurns(items =>
        items.some(
          item =>
            item.role === "approval" &&
            item.approval.id === reqId &&
            item.approval.backendGeneration === approval.backendGeneration,
        )
          ? items
          : [...items, { id: `approval-${reqId}`, role: "approval", approval }],
      );
      if (accessMode === "full") void handleApprovalDecision(approval, "accept");
      return;
    }

    // Delta text update keyed by itemId or latest assistant
    if (notification.method === "item/agentMessage/delta") {
      const delta = params?.delta ?? "";
      const targetItemId = params?.itemId;
      setTurns(items => {
        if (targetItemId) {
          const foundIdx = items.findIndex(it => it.role === "assistant" && it.itemId === targetItemId);
          if (foundIdx !== -1) {
            const updated = [...items];
            const prev = updated[foundIdx] as {
              id: string;
              role: "assistant";
              content: string;
              streaming?: boolean;
              turnId?: string;
              itemId?: string;
            };
            updated[foundIdx] = {
              ...prev,
              content: prev.content + delta,
              streaming: true,
            };
            return updated;
          }
        }
        const last = items.at(-1);
        if (last && last.role === "assistant" && last.streaming) {
          return [...items.slice(0, -1), { ...last, content: last.content + delta }];
        }
        return [
          ...items,
          {
            id: targetItemId ?? `msg-${Date.now()}`,
            role: "assistant",
            content: delta,
            streaming: true,
            itemId: targetItemId,
            turnId: params?.turnId,
          },
        ];
      });
    } else if (notification.method === "item/completed" && params?.item?.type === "agentMessage") {
      const targetItemId = params.item.id;
      const text = params.item.text ?? "";
      setTurns(items => {
        if (targetItemId) {
          const foundIdx = items.findIndex(
            it => it.role === "assistant" && (it.itemId === targetItemId || it.id === targetItemId),
          );
          if (foundIdx !== -1) {
            const updated = [...items];
            updated[foundIdx] = {
              id: targetItemId,
              role: "assistant",
              content: text,
              streaming: false,
              itemId: targetItemId,
              turnId: params.turnId,
            };
            return updated;
          }
        }
        return [
          ...items.filter(item => !(item.role === "assistant" && item.streaming)),
          {
            id: targetItemId ?? `msg-${Date.now()}`,
            role: "assistant",
            content: text,
            streaming: false,
            itemId: targetItemId,
            turnId: params?.turnId,
          },
        ];
      });
    } else if (notification.method === "item/started" && params?.item?.type === "mcpToolCall") {
      const toolName = params.item.toolName ?? "tool";
      const callId = params.item.id ?? `tool-${Date.now()}`;
      const pair: ToolCallPair = {
        id: callId,
        name: toolName,
        argsRaw: JSON.stringify(params.item.args ?? {}, null, 2),
        args: params.item.args ?? null,
        resultRaw: null,
        result: null,
        status: "running",
        title: toolName,
      };
      setTurns(items => [
        ...items,
        {
          id: callId,
          role: "tool",
          pair,
          itemId: callId,
          turnId: params.turnId,
        },
      ]);
    } else if (notification.method === "item/completed" && params?.item?.type === "mcpToolCall") {
      const callId = params.item.id;
      const toolName = params.item.toolName ?? "tool";
      const result = params.item.result;
      const resultText = params.item.text ?? (result ? JSON.stringify(result, null, 2) : "");
      setTurns(items =>
        items.map(item => {
          if (
            item.role === "tool" &&
            (callId
              ? item.id === callId || item.itemId === callId
              : item.pair.name === toolName && item.pair.status === "running")
          ) {
            return {
              ...item,
              pair: {
                ...item.pair,
                resultRaw: resultText,
                result: result ?? null,
                status: result?.ok === false ? "error" : "completed",
              },
            };
          }
          return item;
        }),
      );
    } else if (notification.method === "item/completed" && params?.item?.type === "fileChange" && params.item.diff) {
      const callId = params.item.id ?? `patch-${Date.now()}`;
      setTurns(items => [
        ...items,
        {
          id: callId,
          role: "fileChange",
          fileChange: {
            id: callId,
            path: params.item?.path ?? "fichier",
            kind: params.item?.kind ?? "Modified",
            diff: params.item?.diff ?? "",
            status: "applied",
            itemId: callId,
            turnId: params.turnId,
          },
        },
      ]);
    } else if (notification.method === "turn/completed") {
      stopRequested.current = false;
      setBusy(false);
      setTurnId(undefined);
      if (params?.turn?.status === "failed") {
        toast.error(
          params.turn.error?.message ?? "Le tour a échoué : relancez le message ou consultez les logs app-server",
        );
      } else if (
        params?.turn?.status === "completed" &&
        params.turn.items?.some(item => item.type === "contextCompaction")
      ) {
        if (activeThreadId) compactedAtTurns.current.set(activeThreadId, turns.length);
        toast.success("Compactage du fil terminé");
      }
      void loadThreads().catch(error => toast.error(chatErrorMessage(error)));

      // Auto-compact context (NHITL / YOLO continuous mode)
      // When turns accumulate (>= 25), trigger compact to maintain fast inference & low memory.
      if (
        activeThreadId &&
        shouldAutoCompactThread(params?.turn, turns.length, compactedAtTurns.current.get(activeThreadId))
      ) {
        void chatRpc("thread/compact/start", {
          threadId: activeThreadId,
        }).catch(err => console.warn("Auto-compact context skipped:", err));
      }
    }
  };

  const notificationHandler = useLatestRef(handleNotification);

  // The native broker already broadcasts each event. Use its event bus once;
  // browser hosts use the scoped SSE stream instead of a second native channel.
  useEffect(() => {
    if (!activeThreadId || isTauri()) return;

    let unsub: (() => void) | undefined;
    let active = true;

    aphrodySessionStream(activeThreadId, payload => {
      if (!active) return;
      notificationHandler.current(payload);
    })
      .then(cleanup => {
        if (!active) cleanup();
        else unsub = cleanup;
        return null;
      })
      .catch(error => {
        if (active) {
          setConnectionError(chatErrorMessage(error));
          setReady(false);
        }
      });

    return () => {
      active = false;
      unsub?.();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- connectionAttempt déclenche la reconnexion du flux (bouton « Réessayer ») sans être lu dans l'effet
  }, [activeThreadId, connectionAttempt, notificationHandler]);

  // General notification listener (fallback for process-wide and thread events)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const nativeListen = window.__TAURI__?.event?.listen ?? (isTauri() ? listen : undefined);
    if (nativeListen) {
      void nativeListen("aphrody://notification", ({ payload }: { payload: unknown }) =>
        notificationHandler.current(payload),
      )
        .then(stop => {
          if (cancelled) stop();
          else unlisten = stop;
          return null;
        })
        .catch(error => {
          if (!cancelled) {
            setConnectionError(chatErrorMessage(error));
            setReady(false);
          }
        });
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [notificationHandler]);

  const handleSend = async () => {
    const text = draft.trim();
    if ((!text && attachedFiles.length === 0) || busy || loadingThread || !ready || connectionError) return;

    // Instant local commands with zero latency
    if (text === "/clear") {
      handleNewSession();
      return;
    }

    if (text.startsWith("/model ")) {
      const targetModel = text.slice(7).trim();
      if (targetModel) {
        if (activeThreadId) {
          toast.info("Créez un nouveau chat pour changer de modèle.");
          return;
        }
        const option = modelOptions.find(entry => entry.id === targetModel || entry.name === targetModel);
        if (!option) {
          toast.error("Ce modèle n’est pas configuré.");
          return;
        }
        setModel(option.id);
      }
      setDraft("");
      return;
    }

    if (text.startsWith("/rag ")) {
      const query = text.slice(5).trim();
      if (!query) {
        toast.info("Indiquez les termes à rechercher : /rag <requête>");
        return;
      }
      setTurns(items => [...items, { id: `user-${Date.now()}`, role: "user", content: text }]);
      setDraft("");
      try {
        const ragRes = await runRagSearch(query, 5);
        let responseContent = `### Recherche Connaissances Locales (RAG)\n**Requête** : \`${query}\`\n\n`;
        if (ragRes.results && ragRes.results.length > 0) {
          responseContent += `**${ragRes.results.length} résultats pertinents trouvés dans la base documentaire :**\n\n`;
          for (const item of ragRes.results) {
            responseContent += `- 📄 **\`${item.path}\`** ${item.line ? `(ligne ${item.line})` : ""} ${item.score ? `· Score : ${(item.score * 100).toFixed(0)}%` : ""}\n`;
            if (item.text) {
              responseContent += `  > ${item.text.slice(0, 180)}${item.text.length > 180 ? "..." : ""}\n`;
            }
          }
        } else if (ragRes.rawText && ragRes.rawText.trim()) {
          responseContent += ragRes.rawText;
        } else {
          responseContent += `*Aucun fragment documentaire ne correspond exactement à "${query}".*`;
        }
        setTurns(items => [
          ...items,
          {
            id: `rag-${Date.now()}`,
            role: "assistant",
            content: responseContent,
          },
        ]);
      } catch (err) {
        setTurns(items => [
          ...items,
          {
            id: `rag-${Date.now()}`,
            role: "assistant",
            content: `❌ Erreur recherche RAG : ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      }
      return;
    }

    stopRequested.current = false;
    setBusy(true);
    const filesToSend = [...attachedFiles];
    try {
      let currentId = activeThreadId;
      if (!currentId) {
        const params: Record<string, unknown> = {
          approvalPolicy: accessMode === "full" ? "never" : "on-request",
          sandbox:
            accessMode === "full" ? "danger-full-access" : accessMode === "ask" ? "workspace-write" : "read-only",
        };
        if (model.trim()) params.model = model.trim();
        if (cwd.trim()) params.cwd = cwd.trim();
        const created = (await chatRpc("thread/start", params)) as {
          thread: { id: string };
        };
        if (!created.thread?.id) throw new Error("Le serveur n’a pas créé de chat.");
        currentId = created.thread.id;
        setActiveThreadId(currentId);
        threadIdRef.current = currentId;
      }
      const inputItems = buildTurnInputItems(text, filesToSend);

      const started = (await chatRpc("turn/start", {
        threadId: currentId,
        input: inputItems,
      })) as { turn: { id: string } };
      if (!started.turn?.id) throw new Error("Le serveur n’a pas confirmé l’envoi du message.");
      const belongsToTurn = (item: Turn) =>
        (item.role === "fileChange"
          ? item.fileChange.turnId
          : item.role === "approval"
            ? item.approval.turnId
            : item.turnId) === started.turn.id;
      setTurns(items => [
        ...items.filter(item => !belongsToTurn(item)),
        {
          id: `user-${started.turn.id}`,
          role: "user",
          content: text,
          attachments: filesToSend.length ? filesToSend : undefined,
          turnId: started.turn.id,
        },
        ...items.filter(belongsToTurn),
      ]);
      setDraft("");
      setAttachedFiles([]);
      setTurnId(started.turn.id);
      if (stopRequested.current) await requestInterrupt(currentId, started.turn.id);
    } catch (e) {
      stopRequested.current = false;
      setBusy(false);
      toast.error(chatErrorMessage(e));
    }
  };

  const requestInterrupt = async (threadId: string, activeTurnId: string) => {
    try {
      const result = await chatRpc("turn/interrupt", {
        threadId,
        turnId: activeTurnId,
      });
      if (result.status !== "interrupt_requested") throw new Error("L’arrêt n’a pas été confirmé.");
    } catch (error) {
      stopRequested.current = false;
      toast.error(`Arrêt impossible : ${chatErrorMessage(error)}`);
    }
  };

  const handleStop = () => {
    if (!busy || stopRequested.current) return;
    stopRequested.current = true;
    if (threadIdRef.current && turnId) void requestInterrupt(threadIdRef.current, turnId);
  };

  const handleNewSession = () => {
    if (!busy) {
      threadLoadEpoch.current++;
      setLoadingThread(false);
      setActiveThreadId(null);
      threadIdRef.current = null;
      setTurnId(undefined);
      setSessionTitle(undefined);
      setTurns([]);
      setDraft("");
      setAttachedFiles([]);
    }
  };

  const handleForkThread = async (id: string, forkedTurnId?: string) => {
    try {
      setLoadingThread(true);
      const params: { threadId: string; turnId?: string } = { threadId: id };
      if (forkedTurnId) {
        params.turnId = forkedTurnId;
      }
      const res = (await chatRpc("thread/fork", params)) as {
        thread?: { id: string; name?: string; preview?: string };
      };
      const forkedId = res.thread?.id;
      if (!forkedId || forkedId === id) throw new Error("Le serveur n’a pas créé de nouveau chat.");
      await loadThreads();
      await switchThread(forkedId);
      toast.success("Fil bifurqué");
    } catch (e) {
      toast.error(`Bifurcation impossible : ${chatErrorMessage(e)}`);
    } finally {
      setLoadingThread(false);
    }
  };

  const handleCompactThread = async (id: string) => {
    try {
      await chatRpc("thread/compact/start", buildThreadCompactPayload(id));
      toast.info("Compactage du fil lancé");
      await loadThreads();
    } catch (e) {
      toast.error(`Compactage impossible : ${chatErrorMessage(e)}`);
    }
  };

  return (
    <div className="h-full w-full overflow-hidden bg-surface flex flex-col">
      {connectionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-error-container text-on-error-container"
        >
          <span>{connectionError}</span>
          <Button
            aria-label="Réessayer"
            title="Réessayer"
            variant="text"
            onClick={() => {
              setConnectionError(undefined);
              setReady(false);
              setConnectionAttempt(attempt => attempt + 1);
            }}
          >
            <Icon name="refresh" size={18} />
          </Button>
        </div>
      )}
      {loadingThread && <output className="block px-4 py-2 text-on-surface-variant">Chargement du chat…</output>}
      <CodexChat
        turns={turns}
        busy={busy}
        ready={ready && !connectionError && !loadingThread}
        settingsLocked={!!activeThreadId}
        draft={draft}
        onDraftChange={setDraft}
        attachedFiles={attachedFiles}
        onAddAttachment={file => setAttachedFiles(prev => Array.from(new Set([...prev, file])))}
        onRemoveAttachment={file => setAttachedFiles(prev => prev.filter(f => f !== file))}
        onSend={() => void handleSend()}
        onStop={handleStop}
        onNewSession={handleNewSession}
        onClearSession={handleNewSession}
        model={ready ? model : ""}
        onModelChange={setModel}
        effort={effort}
        accessMode={accessMode}
        onAccessModeChange={setAccessMode}
        modelOptions={modelOptions}
        cwd={cwd}
        onCwdChange={setCwd}
        sessionTitle={sessionTitle}
        onApprovalDecision={handleApprovalDecision}
        threads={threads}
        onSelectThread={id => void switchThread(id).catch(() => {})}
        activeThreadId={activeThreadId ?? undefined}
        onForkThread={handleForkThread}
        onCompactThread={handleCompactThread}
      />
    </div>
  );
}
