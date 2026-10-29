// SPDX-License-Identifier: Apache-2.0
// The public terminal stays inside the browser: Rust/WASM owns the shell and VT grid,
// while its OPFS VFS is shared with the WebOS file manager.
import { openGuestTerminal, type GuestSession, type Snapshot } from "@aphrody/webos-wasm";
import { Button, Icon } from "@aphrody/m3-primitives";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import { getWebOs } from "../../webos-backend";
import { useI18n } from "../../i18n";
import { keyToInput } from "./keys";

const MIN_COLS = 40;
const MAX_COLS = 180;
const MIN_ROWS = 12;
const MAX_ROWS = 60;
const FONT_STORAGE_KEY = "aphrody.terminal.font-size";
const DEFAULT_FONT_SIZE = 18;

function Line({ text, cursorColumn }: { text: string; cursorColumn: number | null }) {
  if (cursorColumn === null) return <div>{text || " "}</div>;
  const padded = text.padEnd(cursorColumn + 1, " ");
  return (
    <div>
      {padded.slice(0, cursorColumn)}
      <span className="bg-primary text-on-primary">{padded[cursorColumn]}</span>
      {padded.slice(cursorColumn + 1)}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function TerminalRoute() {
  const { t } = useI18n();
  const terminal = useRef<GuestSession | null>(null);
  const terminalPanel = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const [fontSize, setFontSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(FONT_STORAGE_KEY));
      return Number.isFinite(stored) && stored >= 12 && stored <= 36 ? stored : DEFAULT_FONT_SIZE;
    } catch {
      return DEFAULT_FONT_SIZE;
    }
  });
  const terminalReady = screen !== null;

  useEffect(() => {
    let cancelled = false;
    getWebOs()
      .then(os => {
        if (cancelled) return;
        // A real Alpine shell: the guest's output is rendered by Rio VT and pushed to React on every change.
        const instance = openGuestTerminal({ cols: 96, rows: 28 });
        instance.onChange(() => setScreen(instance.snapshot()));
        terminal.current = instance;
        setPersistent(os.persistent);
        setScreen(instance.snapshot());
        return undefined;
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      terminal.current?.dispose();
      terminal.current = null;
    };
  }, []);

  useEffect(() => {
    const panel = terminalPanel.current;
    const instance = terminal.current;
    if (!panel || !instance || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const columns = clamp(panel.clientWidth / (fontSize * 0.6), MIN_COLS, MAX_COLS);
      const rows = clamp(panel.clientHeight / (fontSize + 6), MIN_ROWS, MAX_ROWS);
      instance.resize(columns, rows);
      setScreen(instance.snapshot());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    resize();
    return () => observer.disconnect();
  }, [fontSize, terminalReady]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_STORAGE_KEY, String(fontSize));
    } catch {
      // The browser may disable local storage; the current session still works.
    }
  }, [fontSize]);

  const send = useCallback((data: string) => {
    const instance = terminal.current;
    if (!instance || instance.exited) return;
    setScreen(instance.type(data));
    setNotice("");
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyScreen();
      return;
    }
    if (event.metaKey) return;
    const input = keyToInput(event);
    if (input === null) return;
    event.preventDefault();
    send(input);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    send(event.clipboardData.getData("text").replaceAll("\r\n", "\n").replaceAll("\n", "\r"));
  };
  const onCompositionEnd = (event: CompositionEvent<HTMLDivElement>) => {
    if (event.data) send(event.data);
  };
  async function copyScreen() {
    try {
      if (!navigator.clipboard?.writeText || !screen) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(screen.lines.join("\n").trimEnd());
      setNotice(t("terminal.copied"));
    } catch {
      setNotice(t("terminal.clipboardUnavailable"));
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col gap-5 overflow-hidden p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-label-large text-primary">{t("terminal.eyebrow")}</p>
          <h1 className="mt-1 text-headline-medium">{t("terminal.title")}</h1>
          <p className="mt-1 max-w-2xl text-body-medium text-on-surface-variant">{t("terminal.description")}</p>
        </div>
        <div className="flex items-center gap-2" aria-label="Actions du terminal">
          <Button variant="text" size="md" onClick={() => send("help\r")}>
            <Icon name="help" size={18} />
            {t("terminal.help")}
          </Button>
          <Button variant="text" size="md" onClick={() => send("clear\r")}>
            <Icon name="backspace" size={18} />
            {t("terminal.clear")}
          </Button>
          <Button
            variant="text"
            size="md"
            aria-label={t("terminal.fontDecrease")}
            title={t("terminal.fontDecrease")}
            disabled={fontSize <= 12}
            onClick={() => setFontSize(value => Math.max(12, value - 2))}
          >
            <Icon name="text_decrease" size={18} />
          </Button>
          <span className="min-w-9 text-center text-label-medium" aria-live="polite">
            {fontSize}px
          </span>
          <Button
            variant="text"
            size="md"
            aria-label={t("terminal.fontIncrease")}
            title={t("terminal.fontIncrease")}
            disabled={fontSize >= 36}
            onClick={() => setFontSize(value => Math.min(36, value + 2))}
          >
            <Icon name="text_increase" size={18} />
          </Button>
          <Button variant="outline" size="md" onClick={() => void copyScreen()} disabled={!screen}>
            <Icon name="content_copy" size={18} />
            {t("terminal.copy")}
          </Button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-extra-large border border-outline-variant bg-surface-container-low">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
            <span className="text-label-large">{t("terminal.session")}</span>
            <span className="text-label-medium text-on-surface-variant">·</span>
            <span className="text-label-medium text-on-surface-variant">{t("terminal.webAssembly")}</span>
          </div>
          <div className="flex items-center gap-3 text-label-medium text-on-surface-variant">
            <span>{screen ? `${screen.columns} × ${screen.rows}` : t("terminal.starting")}</span>
            {persistent !== null && (
              <span className="rounded-full bg-surface-container-high px-3 py-1">
                {persistent ? t("terminal.persistent") : t("terminal.temporary")}
              </span>
            )}
          </div>
        </div>

        {error ? (
          <div className="m-4 rounded-large bg-error-container p-4 text-on-error-container">
            <p role="alert" className="text-title-medium">
              {t("terminal.startError")}
            </p>
            <p className="mt-1 text-body-medium">{error}</p>
          </div>
        ) : (
          <div ref={terminalPanel} className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
            <div
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- VT grid requires custom key handling and cell rendering
              role="textbox"
              aria-label="Terminal Aphrody. Cliquez puis saisissez une commande."
              aria-multiline="true"
              aria-describedby="terminal-help"
              tabIndex={0}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionEnd={onCompositionEnd}
              className="min-h-full w-max min-w-full rounded-large bg-surface-container-lowest p-4 font-mono whitespace-pre text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${fontSize + 6}px`,
              }}
            >
              {screen?.lines.map((text, row) => (
                <Line
                  // oxlint-disable-next-line react/no-array-index-key -- terminal rows are positional
                  key={row}
                  text={text}
                  cursorColumn={screen.cursor.visible && screen.cursor.row === row ? screen.cursor.col : null}
                />
              ))}
              {!screen && <span className="text-on-surface-variant">{t("terminal.loading")}</span>}
            </div>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-outline-variant px-4 py-3">
          <p id="terminal-help" className="text-label-medium text-on-surface-variant">
            {t("terminal.keyboardHelp")}
          </p>
          <output className="text-label-medium text-on-surface-variant" aria-live="polite">
            {notice || (persistent === false ? t("terminal.temporaryNotice") : "")}
          </output>
        </footer>
      </section>
    </main>
  );
}
