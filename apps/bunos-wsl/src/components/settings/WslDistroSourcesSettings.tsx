/**
 * WSL Distribution Sources Settings Component
 *
 * Manages the HKLM `DistributionListUrl` / `DistributionListUrlAppend`
 * registry values that point `wsl --list --online` / `wsl --install <name>`
 * at community-maintained manifests.
 *
 * Backend in `src-tauri/src/wsl/distro_sources.rs`. All writes require UAC.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { wslService } from "../../services/wslService";
import {
  SUGGESTED_SOURCES,
  type DistroSource,
  type DistroSourceMode,
  type ManifestPreview,
  type SuggestedSource,
} from "../../types/distroSources";

type BannerKind = "success" | "error";

interface Banner {
  kind: BannerKind;
  message: string;
}

export function WslDistroSourcesSettings() {
  const { t } = useTranslation("settings");

  const [currentSource, setCurrentSource] = useState<DistroSource | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [mode, setMode] = useState<DistroSourceMode>("append");

  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isApplying, setIsApplying] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const previewRequestId = useRef(0);
  const mutationInProgress = useRef(false);
  const isMutating = isApplying || isClearing;

  // Refresh the registered source from the registry. Does not touch the
  // user's typed URL — seeding only happens once on initial mount via the
  // separate effect below. This prevents an in-flight apply from clobbering
  // text the user has edited while the UAC prompt is open.
  const refreshCurrent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const src = await wslService.getDistroSource();
      setCurrentSource(src);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = await wslService.getDistroSource();
        if (cancelled) return;
        setCurrentSource(src);
        if (src) {
          setUrlInput(src.url);
          setMode(src.mode);
        }
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePreview = async (urlToPreview?: string) => {
    const url = (urlToPreview ?? urlInput).trim();
    if (!url) {
      setPreviewError(t("distroSources.errors.emptyUrl"));
      return;
    }
    setPreview(null);
    setPreviewError(null);
    setIsPreviewing(true);
    const requestId = ++previewRequestId.current;
    try {
      const result = await wslService.previewDistroManifest(url);
      if (requestId === previewRequestId.current) {
        setPreview(result);
      }
    } catch (e) {
      if (requestId === previewRequestId.current) {
        setPreviewError(String(e));
      }
    } finally {
      if (requestId === previewRequestId.current) {
        setIsPreviewing(false);
      }
    }
  };

  const handleApply = async () => {
    if (mutationInProgress.current) return;
    const url = urlInput.trim();
    if (!url) {
      setBanner({ kind: "error", message: t("distroSources.errors.emptyUrl") });
      return;
    }
    mutationInProgress.current = true;
    setIsApplying(true);
    setBanner(null);
    try {
      await wslService.applyDistroSource({ url, mode });
      setBanner({ kind: "success", message: t("distroSources.applied") });
      await refreshCurrent();
    } catch (e) {
      setBanner({ kind: "error", message: String(e) });
    } finally {
      mutationInProgress.current = false;
      setIsApplying(false);
    }
  };

  const handleClear = async () => {
    if (mutationInProgress.current) return;
    mutationInProgress.current = true;
    setIsClearing(true);
    setBanner(null);
    try {
      await wslService.clearDistroSource();
      setBanner({ kind: "success", message: t("distroSources.cleared") });
      previewRequestId.current += 1;
      setIsPreviewing(false);
      setPreview(null);
      setUrlInput("");
      await refreshCurrent();
    } catch (e) {
      setBanner({ kind: "error", message: String(e) });
    } finally {
      mutationInProgress.current = false;
      setIsClearing(false);
    }
  };

  const handleAddSuggested = async (s: SuggestedSource) => {
    setUrlInput(s.url);
    setMode("append");
    await handlePreview(s.url);
  };

  return (
    <section className="relative overflow-hidden bg-surface-container-low border border-outline-variant rounded-xl p-6">
      <div className="relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
            <svg className="w-5 h-5 text-on-primary-container" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-medium text-on-surface">
              {t("distroSources.title")}
            </h2>
            <p className="text-sm text-on-surface-variant">
              {t("distroSources.description")}
            </p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="mb-6 p-4 bg-warning-container border border-outline-variant rounded-lg">
          <p className="text-xs text-warning">
            <strong>{t("distroSources.warningTitle")}:</strong>{" "}
            {t("distroSources.warningBody")}
          </p>
        </div>

        {/* Status banner */}
        {banner && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${
              banner.kind === "success"
                ? "bg-success-container border border-outline-variant text-success"
                : "bg-error-container border border-outline-variant text-error"
            }`}
          >
            {banner.message}
          </div>
        )}

        {/* Current state */}
        <div className="mb-6 pb-6 border-b border-outline-variant/50">
          <p className="text-xs text-on-surface-variant mb-2">
            {t("distroSources.currentLabel")}
          </p>
          <div className="p-3 bg-surface-container/50 rounded-md text-sm">
            {isLoading ? (
              <span className="text-on-surface-variant">
                {t("distroSources.loading")}
              </span>
            ) : loadError ? (
              <span className="text-error">{loadError}</span>
            ) : currentSource ? (
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-on-surface-variant">
                    {t("distroSources.modeLabel")}
                  </span>
                  <span className="font-mono text-on-surface">
                    {currentSource.mode === "append"
                      ? t("distroSources.modeAppend")
                      : t("distroSources.modeReplace")}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant break-all font-mono">
                  {currentSource.url}
                </div>
              </div>
            ) : (
              <span className="text-on-surface-variant">
                {t("distroSources.noCurrent")}
              </span>
            )}
          </div>
        </div>

        {/* Mode selector */}
        <div className="mb-4">
          <p className="block text-sm font-medium text-on-surface mb-2">
            {t("distroSources.modeLabel")}
          </p>
          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="distro-source-mode"
                value="append"
                checked={mode === "append"}
                onChange={() => setMode("append")}
                className="mt-1"
              />
              <div>
                <div className="text-sm text-on-surface">
                  {t("distroSources.modeAppend")}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {t("distroSources.modeAppendDesc")}
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="distro-source-mode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                className="mt-1"
              />
              <div>
                <div className="text-sm text-on-surface">
                  {t("distroSources.modeReplace")}
                </div>
                <div className="text-xs text-warning">
                  {t("distroSources.modeReplaceWarning")}
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* URL input */}
        <div className="mb-4">
          <label
            htmlFor="distro-source-url"
            className="block text-sm font-medium text-on-surface mb-1"
          >
            {t("distroSources.urlLabel")}
          </label>
          <p className="text-xs text-on-surface-variant mb-2">
            {t("distroSources.urlDesc")}
          </p>
          <div className="flex gap-2">
            <input
              id="distro-source-url"
              type="text"
              value={urlInput}
              onChange={(e) => {
                previewRequestId.current += 1;
                setUrlInput(e.target.value);
                setPreview(null);
                setPreviewError(null);
                setIsPreviewing(false);
              }}
              placeholder="https://example.com/distributions.json"
              className="flex-1 px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-on-surface text-sm font-mono focus:border-success"
            />
            <button
              onClick={() => handlePreview()}
              disabled={isPreviewing || !urlInput.trim()}
              className="px-3 py-2 bg-surface-container border border-outline-variant rounded-lg text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isPreviewing
                ? t("distroSources.previewing")
                : t("distroSources.preview")}
            </button>
          </div>
        </div>

        {/* Preview */}
        {(preview || previewError) && (
          <div className="mb-6 p-3 bg-surface-container/50 rounded-md">
            <p className="text-xs text-on-surface-variant mb-2">
              {t("distroSources.previewLabel")}
            </p>
            {previewError ? (
              <p className="text-sm text-error">{previewError}</p>
            ) : preview && preview.entries.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                {t("distroSources.previewEmpty")}
              </p>
            ) : preview ? (
              <ul className="space-y-1 text-sm">
                {preview.entries.map((e) => (
                  <li
                    key={`${e.flavor}-${e.name}`}
                    className="flex flex-wrap items-baseline gap-2"
                  >
                    <span className="font-mono text-on-surface">
                      {e.name}
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      {e.friendlyName}
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      ({[e.hasAmd64 && "x64", e.hasArm64 && "arm64"]
                        .filter(Boolean)
                        .join(", ") || "no arch"}
                      {e.default ? `, ${t("distroSources.defaultTag")}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={handleApply}
            disabled={isMutating || !urlInput.trim()}
            className="px-4 py-2 bg-success state-layer text-on-success rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying
              ? t("distroSources.applying")
              : t("distroSources.apply")}
          </button>
          <button
            onClick={handleClear}
            disabled={isMutating || (!currentSource && !urlInput.trim())}
            className="px-4 py-2 bg-surface-container hover:bg-surface-container-low border border-outline-variant rounded-lg text-on-surface-variant text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClearing
              ? t("distroSources.clearing")
              : t("distroSources.clear")}
          </button>
        </div>

        {/* Suggested sources */}
        <div className="pt-6 border-t border-outline-variant/50">
          <p className="text-sm font-medium text-on-surface mb-1">
            {t("distroSources.suggestedTitle")}
          </p>
          <p className="text-xs text-on-surface-variant mb-3">
            {t("distroSources.suggestedDesc")}
          </p>
          <ul className="space-y-2">
            {SUGGESTED_SOURCES.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 p-3 bg-surface-container/30 border border-outline-variant/40 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-on-surface">
                    {s.label}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {s.description}
                  </div>
                  <div className="text-xs text-on-surface-variant font-mono break-all mt-1">
                    {s.url}
                  </div>
                </div>
                <button
                  onClick={() => handleAddSuggested(s)}
                  className="shrink-0 px-3 py-1.5 text-xs text-success hover:text-success border border-outline-variant hover:border-success rounded-md transition-colors"
                >
                  {t("distroSources.suggestedAdd")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
