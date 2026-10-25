// SPDX-License-Identifier: Apache-2.0
// Quick ask bar: the frameless `quickbar` window toggled by the global Alt+Space shortcut
// (crates/ui/app/src/quickbar.rs). Questions go to the agent through the same
// process boundary as the main window: `aphrody_rpc` (app-server JSON-RPC) for
// thread/start + turn/start and `aphrody_session_stream` for the streamed answer.
// Suggestions (calculator, matching threads), the in-bar history and first-run onboarding are
// local: they read app-server threads and `preferences`, and send nothing before submit.
import { Channel, invoke } from "./web-runtime";
import { AphrodyAvatar } from "@aphrody/identity";
import { Icon, Kbd, Tooltip } from "@aphrody/m3-primitives";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadSummary } from "./history";
import { HistoryPanel, listAllThreads } from "./history-panel";
import { Onboarding } from "./onboarding";
import { hydratePreferences, loadPreferences, type Preferences, savePreferences } from "./preferences";
import { type Attachment, buildInput, imageDataUrl } from "./quickbar-input";
import { CANONICAL_COMMANDS, suggest, type Suggestion } from "./quickbar-suggest";
import { emitTo } from "./web-runtime";
import { MENU_EVENTS } from "./menu-commands";

type Notification = {
  method?: string;
  params?: {
    threadId?: string;
    delta?: string;
    item?: { type?: string; text?: string };
    turn?: { status?: string; error?: { message?: string } };
  };
};

type RpcResponse = {
  result?: Record<string, unknown>;
  error?: { message?: string };
};

let requestId = 0;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const request = method === "initialized" ? { method, params } : { id: ++requestId, method, params };
  const response = await invoke<RpcResponse>("aphrody_rpc", { request });
  if (response.error) throw new Error(response.error.message ?? "Aphrody RPC failure");
  return response.result ?? {};
}

async function handshake() {
  try {
    await rpc("initialize", {
      clientInfo: { name: "aphrody-quickbar", version: "1.0.0" },
    });
  } catch (error) {
    if (!(error instanceof Error) || !/already initialized/i.test(error.message)) throw error;
  }
  await rpc("initialized");
}

const quickbar = (action: Record<string, unknown>) => invoke<void>("aphrody_quickbar", { action });

function IconAction({
  icon,
  label,
  onClick,
  disabled,
  className = "",
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip label={label}>
      <span className="inline-flex">
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={`inline-flex size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/8 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-38 disabled:hover:bg-transparent ${className}`}
        >
          <Icon name={icon} size={22} />
        </button>
      </span>
    </Tooltip>
  );
}

export function QuickBar() {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const ready = useRef<Promise<void> | null>(null);
  const [prefs, setPrefs] = useState(loadPreferences);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [highlight, setHighlight] = useState(-1);

  const connect = useCallback(() => {
    ready.current ??= handshake().catch((e: unknown) => {
      ready.current = null;
      throw e;
    });
    return ready.current;
  }, []);

  // Threads feed the history suggestions, refreshed on focus and after each answer. Failures
  // stay silent here: the submit path reports app-server errors.
  const refreshThreads = useCallback(() => {
    if (!loadPreferences().sources.history) return;
    void connect()
      .then(() => listAllThreads(rpc, 2))
      .then(setThreads)
      .catch(() => {});
  }, [connect]);

  // Stable identity: HistoryPanel reloads whenever its `rpc` prop changes.
  const historyRpc = useCallback(async (method: string, params?: Record<string, unknown>) => {
    ready.current ??= handshake().catch((e: unknown) => {
      ready.current = null;
      throw e;
    });
    await ready.current;
    return rpc(method, params);
  }, []);

  const suggestions = useMemo(
    () =>
      busy || showHistory
        ? []
        : suggest(draft, threads, prefs.sources, {
            navigationTargets: [],
            files: [],
            commands: CANONICAL_COMMANDS.filter(
              item => item.menu || item.command === "clear" || item.command === "theme",
            ),
          }),
    [draft, threads, prefs.sources, busy, showHistory],
  );

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const focus = () => {
      void hydratePreferences()
        .then(stored => {
          setPrefs(stored);
          setPrefsLoaded(true);
          return stored;
        })
        .catch((e: unknown) => setError(`Preferences: ${String(e)}`));
      refreshThreads();
      inputRef.current?.focus();
    };
    window.addEventListener("focus", focus);
    focus();
    return () => window.removeEventListener("focus", focus);
  }, [refreshThreads]);

  const persist = (next: Preferences) => {
    setPrefs(next);
    void savePreferences(next).catch((e: unknown) => setError(`Preferences: ${String(e)}`));
  };

  const finishOnboarding = () => {
    persist({ ...prefs, onboarded: true });
    inputRef.current?.focus();
  };

  const chooseModelsDir = (modelsDir: string | null) => persist({ ...prefs, modelsDir });

  const openThread = (thread: ThreadSummary) => {
    setActiveThread(thread);
    setShowHistory(false);
    setAnswer("");
    setError("");
    setDraft("");
    inputRef.current?.focus();
  };

  const newThread = () => {
    setActiveThread(null);
    setShowHistory(false);
    setAnswer("");
    setError("");
    inputRef.current?.focus();
  };

  const pick = async (item: Suggestion) => {
    setHighlight(-1);
    setError("");
    try {
      if (item.kind === "thread") {
        openThread(item.thread);
      } else if (item.kind === "calculator") {
        setDraft(item.value);
      } else if (item.kind === "command" && item.menu) {
        // This is a separate webview: relay only to the main window's registered menu listener.
        await emitTo("main", MENU_EVENTS[item.menu]);
        await quickbar({ action: "open_main" });
      } else if (item.kind === "command" && item.command === "clear") {
        setDraft("");
        setAnswer("");
      } else if (item.kind === "command" && item.command === "theme") {
        const next: Preferences = {
          ...prefs,
          theme: prefs.theme === "dark" ? "light" : "dark",
        };
        await savePreferences(next);
        setPrefs(next);
      } else {
        throw new Error("Cette action n'est pas disponible dans la barre rapide.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  // Grow the native window with the answer; the Rust side clamps the height.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      void quickbar({
        action: "resize",
        height: Math.ceil(card.getBoundingClientRect().height) + 16,
      }).catch(() => {});
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const hide = () => void quickbar({ action: "hide" }).catch((e: unknown) => setError(String(e)));

  const attachFile = async () => {
    try {
      const { open } = await import("./web-runtime");
      const picked = await open({
        title: "Joindre un fichier",
        multiple: true,
        directory: false,
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      setAttachments(items => [...items, ...paths.map(path => ({ kind: "file" as const, path }))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const captureScreen = async () => {
    setCapturing(true);
    setError("");
    try {
      const result = await invoke<unknown>("aphrody_capture_primary");
      const url = imageDataUrl(result);
      if (!url) throw new Error("La capture n'a renvoye aucune image.");
      setAttachments(items => [...items, { kind: "image", label: "Capture d'ecran", url }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
      inputRef.current?.focus();
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    if (question.startsWith(">") && suggestions.length === 0) {
      setError("Cette commande n’est pas disponible dans la barre rapide.");
      return;
    }
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      await connect();
      let threadId = activeThread?.id;
      if (threadId) {
        await rpc("thread/resume", { threadId });
      } else {
        const started = (await rpc("thread/start", {})) as {
          thread?: { id?: string };
        };
        threadId = started.thread?.id;
        if (!threadId) throw new Error("thread/start returned no thread id");
        setActiveThread({
          id: threadId,
          title: question,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
      const channel = new Channel<Notification>();
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Channel from the Tauri API exposes a single onmessage slot with ordered delivery; it is not an EventTarget
      channel.onmessage = message => {
        if (message.method === "item/agentMessage/delta") {
          setAnswer(text => text + (message.params?.delta ?? ""));
        } else if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
          setAnswer(message.params.item.text ?? "");
        } else if (message.method === "turn/completed") {
          setBusy(false);
          if (message.params?.turn?.status === "failed") {
            setError(message.params.turn.error?.message ?? "Le tour a echoue.");
          }
          void invoke("aphrody_session_unstream", { threadId }).catch(() => {});
          refreshThreads();
        }
      };
      await invoke("aphrody_session_stream", { threadId, channel });
      await rpc("turn/start", {
        threadId,
        input: buildInput(question, attachments),
      });
      setDraft("");
      setAttachments([]);
    } catch (e) {
      ready.current = null;
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (highlight >= 0) setHighlight(-1);
      else if (showHistory) setShowHistory(false);
      else hide();
    } else if (suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      // Cycle through -1 (the input itself) and every suggestion.
      const span = suggestions.length + 1;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(index => ((index + 1 + step + span) % span) - 1);
    } else if (event.key === "Enter" && highlight >= 0) {
      const item = suggestions[highlight];
      if (item) {
        event.preventDefault();
        void pick(item);
      }
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the card is a layout wrapper whose key handler sees shortcuts from every field inside it
    <div className="flex min-h-screen items-start justify-center p-2" onKeyDown={onKeyDown}>
      <form
        ref={cardRef}
        onSubmit={event => void submit(event)}
        className="w-full rounded-[28px] bg-surface-container-high p-3 text-on-surface shadow-lg"
      >
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the header is a mouse-only window drag handle; keyboard users move the window through the window manager */}
        <header
          className="flex items-center gap-2 pb-2"
          onMouseDown={event => {
            if (event.button === 0 && event.target === event.currentTarget) {
              void import("./web-runtime").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
            }
          }}
        >
          <IconAction
            icon="history"
            label={showHistory ? "Masquer l'historique" : "Historique"}
            onClick={() => setShowHistory(open => !open)}
            className={showHistory ? "bg-secondary-container text-on-secondary-container" : ""}
          />
          <div className="pointer-events-none flex flex-1 items-center justify-center gap-2">
            <Icon name="auto_awesome" size={20} className="text-primary" />
            <span className="text-title-small">Aphrody</span>
            <Kbd>Alt</Kbd>
            <span className="text-label-medium text-on-surface-variant">+</span>
            <Kbd>Espace</Kbd>
          </div>
          <AphrodyAvatar size={32} />
          <IconAction icon="remove" label="Reduire" onClick={hide} />
          <IconAction icon="close" label="Fermer" onClick={hide} />
        </header>

        {prefsLoaded && !prefs.onboarded && (
          <Onboarding modelsDir={prefs.modelsDir} onModelsDir={chooseModelsDir} onDone={finishOnboarding} />
        )}

        {activeThread && (
          <div className="mb-2 flex items-center gap-2 px-2 text-label-large text-on-surface-variant">
            <Icon name="forum" size={18} />
            <span className="flex-1 truncate">{activeThread.title}</span>
            <button
              aria-label="Nouveau fil"
              title="Nouveau fil"
              type="button"
              onClick={newThread}
              className="min-h-10 rounded-full px-3 text-primary hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Icon name="add" size={18} />
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          value={draft}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="quickbar-suggestions"
          aria-activedescendant={highlight >= 0 ? `quickbar-suggestion-${highlight}` : undefined}
          aria-autocomplete="list"
          onChange={event => {
            setDraft(event.target.value);
            setHighlight(-1);
          }}
          placeholder="Posez une question"
          aria-label="Posez une question"
          disabled={busy}
          className="h-14 w-full rounded-full bg-surface-container-highest px-6 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
        />

        {suggestions.length > 0 && (
          <ul
            id="quickbar-suggestions"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- the suggestions are a combobox listbox driven by aria-activedescendant on the input; a native select or datalist cannot render these rows
            role="listbox"
            aria-label="Suggestions"
            className="m-0 mt-2 list-none rounded-2xl bg-surface-container p-1"
          >
            {suggestions.map((item, index) => {
              const key =
                item.kind === "thread"
                  ? item.thread.id
                  : item.kind === "navigation"
                    ? item.id
                    : item.kind === "command"
                      ? item.id
                      : item.kind === "file"
                        ? item.id
                        : "calculator";
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
              const kindBadge =
                item.kind === "navigation"
                  ? "Navigation"
                  : item.kind === "command"
                    ? "Commande"
                    : item.kind === "file"
                      ? item.isDir
                        ? "Dossier"
                        : "Fichier"
                      : null;
              return (
                <li
                  key={key}
                  id={`quickbar-suggestion-${index}`}
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- each suggestion is an option of the combobox listbox above; a native element cannot be an option outside a select
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={event => {
                    event.preventDefault();
                    void pick(item);
                  }}
                  className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-full px-4 text-body-large ${index === highlight ? "bg-secondary-container text-on-secondary-container" : "hover:bg-on-surface/8"}`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <Icon name={iconName} size={20} className="shrink-0 text-on-surface-variant" />
                    {item.kind === "calculator" ? (
                      <span>
                        <span className="text-on-surface-variant">{item.expression} = </span>
                        <strong className="text-title-medium">{item.value}</strong>
                      </span>
                    ) : item.kind === "thread" ? (
                      <span className="truncate">{item.thread.title}</span>
                    ) : item.kind === "navigation" ? (
                      <span className="truncate">{item.label}</span>
                    ) : item.kind === "command" ? (
                      <span className="truncate font-mono">{item.label}</span>
                    ) : (
                      <span className="truncate">{item.name}</span>
                    )}
                  </div>
                  {kindBadge && (
                    <span className="shrink-0 rounded-full bg-surface-container-high px-2.5 py-0.5 text-label-large text-on-surface-variant">
                      {kindBadge}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {showHistory && (
          <HistoryPanel
            rpc={historyRpc}
            activeId={activeThread?.id}
            onOpen={openThread}
            onNewThread={newThread}
            onClose={() => setShowHistory(false)}
          />
        )}

        {attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {attachments.map((item, index) => (
              <li
                // oxlint-disable-next-line react/no-array-index-key -- attachments have no id and the same file can be attached twice, so the index keeps the keys unique
                key={`${item.kind}-${index}`}
                className="flex items-center gap-1 rounded-sm bg-secondary-container py-1 pr-1 pl-3 text-label-medium text-on-secondary-container"
              >
                <Icon name={item.kind === "image" ? "screenshot_monitor" : "description"} size={16} />
                <span className="max-w-60 truncate">{item.kind === "image" ? item.label : item.path}</span>
                <button
                  type="button"
                  aria-label="Retirer"
                  className="inline-flex size-6 items-center justify-center rounded-full hover:bg-on-secondary-container/8"
                  onClick={() => setAttachments(items => items.filter((_, i) => i !== index))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex items-center gap-1">
          <IconAction icon="add" label="Joindre un fichier" onClick={() => void attachFile()} disabled={busy} />
          <div className="flex-1" />
          <IconAction
            icon="present_to_all"
            label="Partage d'ecran indisponible : aucune API de partage Aphrody"
            disabled
          />
          <IconAction
            icon={capturing ? "hourglass_top" : "center_focus_weak"}
            label="Capturer l'ecran"
            onClick={() => void captureScreen()}
            disabled={busy || capturing}
          />
        </div>

        {(answer || busy || error) && (
          <div
            className="mt-2 max-h-96 overflow-y-auto rounded-2xl bg-surface-container px-4 py-3 text-body-medium whitespace-pre-wrap"
            aria-live="polite"
          >
            {error ? (
              <span role="alert" className="text-error">
                {error}
              </span>
            ) : (
              answer || <span className="text-on-surface-variant">Reflexion...</span>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
