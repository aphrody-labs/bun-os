// SPDX-License-Identifier: Apache-2.0
// One kit as an M3 surface: the kit's groups are tabs, its actions are cards, a run shows its
// log and every question of the kit (typed « OUI » confirmations included) is an M3 dialog.
import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  answered,
  idleRun,
  kitCatalog,
  reduceRun,
  startKit,
  typedOk,
  visibleActions,
  type KitAction,
  type KitCatalog,
  type KitEvent,
  type KitField,
  type KitInput,
  type KitName,
  type KitRun,
  type RunState,
} from "../../kit-bridge";
import { Icon } from "@aphrody/m3-primitives";

type RunAction = { type: "event"; event: KitEvent } | { type: "answered" } | { type: "reset" };

function runReducer(state: RunState, action: RunAction): RunState {
  if (action.type === "reset") return { ...idleRun, status: "running" };
  if (action.type === "answered") return answered(state);
  return reduceRun(state, action.event);
}

interface KitDialogProps {
  title: string;
  message: string;
  /** Free text, or a word that must be typed back (`expect`). */
  input?: { label: string; expect?: string };
  confirmLabel: string;
  onClose(value: string | null): void;
}

/** M3 basic dialog on the native modal `<dialog>` (focus trap, Escape cancels). */
export function KitDialog({ title, message, input, confirmLabel, onClose }: KitDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  const valid = !input || (input.expect ? typedOk(input.expect, value) : true);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onClose(input ? value : "oui");
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="kit-dialog-title"
      onCancel={event => {
        event.preventDefault();
        onClose(null);
      }}
      className="m-auto w-[min(560px,calc(100vw-48px))] rounded-extra-large bg-surface-container-high p-6 text-on-surface backdrop:bg-scrim/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 id="kit-dialog-title" className="text-headline-small">
          {title}
        </h2>
        <p className="whitespace-pre-wrap text-body-large text-on-surface-variant">{message}</p>
        {input && (
          <label className="flex flex-col gap-2 text-label-large">
            {input.label}
            <input
              autoFocus
              value={value}
              onChange={event => setValue(event.target.value)}
              aria-invalid={!valid}
              className="h-14 rounded-extra-small border border-outline bg-transparent px-4 text-body-large text-on-surface focus:border-primary focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button
            aria-label="Annuler"
            title="Annuler"
            type="button"
            onClick={() => onClose(null)}
            className="min-h-12 rounded-full px-6 text-label-large text-primary hover:bg-primary/10"
          >
            <Icon name="close" size={18} />
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="min-h-12 rounded-full bg-primary px-6 text-label-large text-on-primary disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: KitField;
  value: string | boolean | undefined;
  onChange(value: string | boolean): void;
}) {
  const id = `kit-field-${field.name}`;
  if (field.kind === "boolean")
    return (
      <label htmlFor={id} className="flex min-h-12 items-center gap-3 text-body-large">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={event => onChange(event.target.checked)}
          className="size-5 accent-primary"
        />
        {field.label}
      </label>
    );
  const common =
    "h-14 w-full rounded-extra-small border border-outline-variant bg-transparent px-4 text-body-large text-on-surface focus:border-primary focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";
  return (
    <label htmlFor={id} className="flex flex-col gap-2 text-label-large">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.kind === "select" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
          className={common}
        >
          <option value="">Par défaut</option>
          {field.options?.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          required={field.required}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          type={field.kind === "url" ? "url" : "text"}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
          className={common}
        />
      )}
      {field.help && <span className="text-body-medium text-on-surface-variant">{field.help}</span>}
    </label>
  );
}

const statusLabel: Record<RunState["status"], string> = {
  idle: "",
  running: "En cours…",
  asking: "Une question attend ta réponse",
  done: "Terminé",
  failed: "Terminé avec une erreur",
  stopped: "Arrêté",
};

function ActionPanel({ kit, action }: { kit: KitName; action: KitAction }) {
  const [input, setInput] = useState<KitInput>({});
  const [state, dispatch] = useReducer(runReducer, idleRun);
  const [confirming, setConfirming] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const run = useRef<KitRun | null>(null);
  const log = useRef<HTMLPreElement>(null);

  useEffect(() => () => void run.current?.cancel().catch(() => undefined), []);
  // Follow the log as it grows.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  });

  const busy = state.status === "running" || state.status === "asking";
  const start = useCallback(async () => {
    setStartError(null);
    dispatch({ type: "reset" });
    try {
      run.current = await startKit(kit, ["run", action.id, JSON.stringify(input)], event =>
        dispatch({ type: "event", event }),
      );
    } catch (error) {
      dispatch({ type: "event", event: { type: "exit", session: 0, code: 1 } });
      setStartError(error instanceof Error ? error.message : String(error));
    }
  }, [kit, action.id, input]);

  const reply = (value: string | null) => {
    dispatch({ type: "answered" });
    void run.current?.answer(value).catch(() => undefined);
  };

  const question = state.question;
  return (
    <section
      aria-labelledby={`kit-action-${action.id}`}
      className="flex flex-col gap-4 rounded-large bg-surface-container-low p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`kit-action-${action.id}`} className="text-title-large">
          {action.title}
        </h2>
        {action.description && <p className="text-body-medium text-on-surface-variant">{action.description}</p>}
      </header>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={event => {
          event.preventDefault();
          if (action.confirm) setConfirming(true);
          else void start();
        }}
      >
        {action.fields?.map(field => (
          <FieldInput
            key={field.name}
            field={field}
            value={input[field.name]}
            onChange={value => setInput(current => ({ ...current, [field.name]: value }))}
          />
        ))}
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-label-large text-on-primary disabled:opacity-40"
          >
            <span className="material-symbol text-title-medium" aria-hidden="true">
              play_arrow
            </span>
            Lancer
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => void run.current?.cancel()}
              className="flex min-h-12 items-center gap-2 rounded-full border border-outline px-6 text-label-large text-primary hover:bg-primary/10"
            >
              <span className="material-symbol text-title-medium" aria-hidden="true">
                stop
              </span>
              {action.longRunning ? "Arrêter" : "Annuler"}
            </button>
          )}
          <output className="text-body-medium text-on-surface-variant">{statusLabel[state.status]}</output>
        </div>
      </form>
      {startError && (
        <p role="alert" className="rounded-medium bg-error-container p-4 text-body-medium text-on-error-container">
          {startError}
        </p>
      )}
      {state.lines.length > 0 && (
        <pre
          ref={log}
          aria-live="polite"
          className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-medium bg-surface-container-highest p-4 font-mono text-body-medium text-on-surface"
        >
          {state.lines.map(line => (
            <span key={line.id} className={line.stream === "err" ? "text-error" : undefined}>
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {confirming && action.confirm && (
        <KitDialog
          title={action.title}
          message={action.confirm.message}
          input={
            action.confirm.typed
              ? {
                  label: `Tape ${action.confirm.typed} pour confirmer`,
                  expect: action.confirm.typed,
                }
              : undefined
          }
          confirmLabel="Continuer"
          onClose={value => {
            setConfirming(false);
            if (value !== null) void start();
          }}
        />
      )}
      {question && (
        <KitDialog
          key={question.id}
          title={question.kind === "confirm" ? "Confirmer" : action.title}
          message={question.question}
          input={
            question.kind === "confirm"
              ? undefined
              : question.kind === "typed"
                ? {
                    label: `Tape ${question.expect ?? "OUI"} pour confirmer`,
                    expect: question.expect ?? "OUI",
                  }
                : { label: "Ta réponse" }
          }
          confirmLabel={question.kind === "text" ? "Valider" : "Confirmer"}
          onClose={value => reply(question.kind === "confirm" ? (value === null ? "non" : "oui") : value)}
        />
      )}
    </section>
  );
}

export interface KitSurfaceProps {
  kit: KitName;
  title: string;
  intro: string;
}

export function KitSurface({ kit, title, intro }: KitSurfaceProps) {
  const [catalog, setCatalog] = useState<KitCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    let active = true;
    kitCatalog(kit, revision > 0)
      .then(result => {
        if (active) {
          setError(null);
          setCatalog(result);
        }
        return undefined;
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [kit, revision]);

  const groups = catalog?.groups.filter(group => visibleActions(catalog, group.id).length > 0) ?? [];
  const groupId = groups.some(group => group.id === params.get("section")) ? params.get("section")! : groups[0]?.id;
  const actions = catalog && groupId ? visibleActions(catalog, groupId) : [];
  const actionId = actions.some(action => action.id === params.get("action")) ? params.get("action")! : actions[0]?.id;
  const action = actions.find(entry => entry.id === actionId);
  const select = (key: "section" | "action", value: string) =>
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      if (key === "section") next.delete("action");
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6" aria-busy={!catalog && !error}>
      <header className="flex flex-col gap-2">
        <h1 className="text-headline-medium">{title}</h1>
        <p className="max-w-prose text-body-large text-on-surface-variant">{intro}</p>
        {catalog && (
          <p className="text-body-medium text-on-surface-variant">
            {catalog.title} · version {catalog.version}
          </p>
        )}
      </header>
      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-large bg-error-container p-6 text-on-error-container">
          <p className="text-body-large">{error}</p>
          <button
            aria-label="Réessayer"
            title="Réessayer"
            type="button"
            onClick={() => {
              setError(null);
              setRevision(value => value + 1);
            }}
            className="min-h-12 self-start rounded-full bg-primary px-6 text-label-large text-on-primary"
          >
            <Icon name="refresh" size={18} />
          </button>
        </div>
      )}
      {catalog && groupId && (
        <>
          <div role="tablist" aria-label={`Sections de ${title}`} className="flex flex-wrap gap-2">
            {groups.map(group => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={group.id === groupId}
                onClick={() => select("section", group.id)}
                className={
                  group.id === groupId
                    ? "flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-4 text-label-large font-semibold text-on-secondary-container"
                    : "flex min-h-12 items-center gap-2 rounded-full px-4 text-label-large text-on-surface-variant hover:bg-secondary-container/20"
                }
              >
                <span className="material-symbol text-title-medium" aria-hidden="true">
                  {group.icon}
                </span>
                {group.title}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="grid gap-6 lg:grid-cols-[minmax(240px,320px)_1fr]">
            <ul aria-label="Actions" className="flex flex-col gap-1">
              {actions.map(entry => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={entry.id === actionId ? "true" : undefined}
                    onClick={() => select("action", entry.id)}
                    className={
                      entry.id === actionId
                        ? "min-h-12 w-full rounded-large bg-secondary-container px-4 py-3 text-left text-label-large text-on-secondary-container"
                        : "min-h-12 w-full rounded-large px-4 py-3 text-left text-label-large text-on-surface hover:bg-secondary-container/20"
                    }
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
            </ul>
            {action && <ActionPanel key={action.id} kit={kit} action={action} />}
          </div>
        </>
      )}
    </div>
  );
}
