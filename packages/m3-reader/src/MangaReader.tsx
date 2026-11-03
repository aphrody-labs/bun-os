"use client";
import { useModePageRestoration } from "./use-mode-page-restoration";

/**
 * Lecteur de scan manga complet, 100 % client.
 *
 * Deux modes togglables :
 *  - Paginé   : Swiper (Keyboard, Zoom, Virtual, Mousewheel), RTL réel,
 *               double-page optionnelle sur grand écran.
 *  - Vertical : défilement webtoon virtualisé via `@tanstack/react-virtual`
 *               (mesure dynamique des planches, overscan raisonnable).
 *
 * URL resolution and chapter persistence are supplied by the host.
 */

import { type ReactElement, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  ScrollText,
  Square,
} from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard, Mousewheel, Zoom } from "swiper/modules";

// eslint-disable-next-line import/no-unassigned-import -- Swiper layout and interactions require this stylesheet.
import "swiper/css";
// eslint-disable-next-line import/no-unassigned-import -- Swiper layout and interactions require this stylesheet.
import "swiper/css/zoom";

import {
  SHOW_STRIP_MAX,
  type ViewMode,
  useFullscreen,
  useSwiperSync,
  useVerticalScrollSync,
  virtualRowStyle,
} from "./use-reader-core";

export type MangaReaderProps = {
  pages: string[];
  title: string;
  direction?: "rtl" | "ltr";
  prevHref?: string | null;
  nextHref?: string | null;
  prevPages?: string[] | null;
  nextPages?: string[] | null;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  apiPageHref?: (page: number) => string | null;
  resolveAssetUrl?: (path: string) => string;
  resolveMirrorUrl?: (url: string) => string | null;
  renderChapterLink?: (props: { href: string; children: ReactNode; className: string; ariaLabel: string }) => ReactNode;
};

const LG_BREAKPOINT = 1024; // Tailwind `lg`

const identityAssetUrl = (path: string) => path;

/** Détecte le passage sous/au-delà du breakpoint `lg` pour la double-page. */
function useIsLargeScreen(): boolean {
  const [isLarge, setIsLarge] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const sync = () => setIsLarge(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  return isLarge;
}

export function MangaReader({
  pages,
  title,
  direction = "rtl",
  prevHref = null,
  nextHref = null,
  prevPages = null,
  nextPages = null,
  initialPage = 1,
  onPageChange,
  apiPageHref,
  resolveAssetUrl = identityAssetUrl,
  resolveMirrorUrl,
  renderChapterLink,
}: MangaReaderProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<ViewMode>("paged");
  const [dir, setDir] = useState<"rtl" | "ltr">(direction);
  const [spread, setSpread] = useState(false);
  const [current, setCurrent] = useState(() => Math.max(0, Math.min(pages.length - 1, initialPage - 1)));
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
  const { swiperRef, handleSwiper, handleSlideChange } = useSwiperSync(setCurrent);

  const isLarge = useIsLargeScreen();
  // Double-page seulement effective sur grand écran (lisibilité mobile).
  const useSpread = spread && isLarge && mode === "paged";

  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  // Défilement automatique fluide de la bande de vignettes vers la planche active
  useEffect(() => {
    if (mode === "paged" && activeThumbRef.current) {
      activeThumbRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [current, mode]);

  // Résolution des URL absolues une seule fois (les chemins sont stables).
  const urls = useMemo(() => pages.map(resolveAssetUrl), [pages, resolveAssetUrl]);
  const total = urls.length;
  const baseId = useId();

  // Préchargement intelligent des planches en arrière-plan
  useEffect(() => {
    if (urls.length === 0) return;
    // 1. Précharge la page courante, la précédente (retour arrière) et les 3 suivantes
    const indices = [current, current - 1, current + 1, current + 2, current + 3];
    for (const idx of indices) {
      if (idx >= 0 && idx < urls.length) {
        const url = urls[idx];
        if (url === undefined) continue;
        const img = new Image();
        img.src = url;
      }
    }

    // 2. Précharge les 3 premières pages du chapitre suivant en arrière-plan
    if (nextPages && nextPages.length > 0) {
      nextPages.slice(0, 3).forEach(page => {
        const img = new Image();
        img.src = resolveAssetUrl(page);
      });
    }

    // 3. Précharge les 3 dernières pages du chapitre précédent en arrière-plan (si l'utilisateur veut revenir en arrière)
    if (prevPages && prevPages.length > 0) {
      prevPages.slice(-3).forEach(page => {
        const img = new Image();
        img.src = resolveAssetUrl(page);
      });
    }
  }, [current, urls, prevPages, nextPages, resolveAssetUrl]);

  // Repli automatique CDN <-> Bot en cas d'erreur réseau sur une planche
  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      const target = e.currentTarget;
      if (target.dataset.fallbackApplied) return;
      target.dataset.fallbackApplied = "true";
      try {
        const mirror = resolveMirrorUrl?.(target.src);
        if (mirror) target.src = mirror;
      } catch {
        // URL invalide, aucun repli possible
      }
    },
    [resolveMirrorUrl],
  );

  /* ------------------------------ Vertical ------------------------------ */

  const scrollParentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual renvoie des fonctions non mémoïsables (getVirtualItems, measureElement) : le compilateur React doit l'ignorer
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollParentRef.current,
    // Estimation ~ hauteur viewport ; remplacée par la mesure réelle.
    estimateSize: () => (typeof window === "undefined" ? 900 : window.innerHeight),
    overscan: 3,
  });

  // Synchronise le compteur en mode vertical sur la page la plus visible.
  const restoring = useModePageRestoration(mode, current, scrollParentRef, virtualizer, containerRef);
  useVerticalScrollSync(mode, scrollParentRef, virtualizer, setCurrent, restoring);

  useEffect(() => {
    onPageChange?.(current + 1);
  }, [current, onPageChange]);
  const apiPlanche = apiPageHref?.(current + 1) ?? null;

  /* ------------------------------ Contrôles ----------------------------- */

  const goPrevPage = useCallback(() => {
    if (mode === "paged") swiperRef.current?.slidePrev();
    else virtualizer.scrollToIndex(Math.max(0, current - 1), { align: "start" });
  }, [mode, current, swiperRef, virtualizer]);

  const goNextPage = useCallback(() => {
    if (mode === "paged") swiperRef.current?.slideNext();
    else
      virtualizer.scrollToIndex(Math.min(total - 1, current + 1), {
        align: "start",
      });
  }, [mode, current, total, swiperRef, virtualizer]);

  const counter = total ? `${Math.min(current + 1, total)} / ${total}` : "0 / 0";

  return (
    <div
      ref={containerRef}
      className="m3-reader m3-reader-container m3-reader-scroll flex h-[85vh] min-h-[460px] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl bg-surface [&:fullscreen]:h-screen [&:fullscreen]:min-h-screen [&:fullscreen]:rounded-none"
      data-manga-reader
      data-m3-component="MangaReader"
      data-testid="manga-reader"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- le markup SSR doit garder role="region" (contrat crawlable-ssr) ; un <section> sans role changerait la sortie rendue
      role="region"
      aria-label={title}
    >
      {/* Barre de contrôles (HUD) */}
      <div className="m3-reader-hud z-10 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="min-w-0 max-w-[32ch] md:max-w-[45ch] truncate font-sans text-[18px] font-extrabold uppercase tracking-wide text-on-surface drop-shadow-[1px_1px_0px_var(--md-sys-color-shadow)]">
            {title}
          </span>
          <span className="m3-reader-badge bg-primary text-on-primary px-2 py-0.5 text-[18px] font-black">
            <span>{counter}</span>
          </span>
          {/* L'adresse de LA planche affichée, en un clic : la même que celle
					    que rendra `curl`. C'est le seul endroit où la correspondance
					    entre ce qu'on voit et ce qu'on peut récupérer est évidente. */}
          {apiPlanche && (
            <a
              href={apiPlanche}
              className="hidden shrink-0 rounded border border-outline-variant px-1.5 py-0.5 font-mono text-[18px] font-bold uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_10%,transparent)] sm:inline-block"
              title="Cette planche en JSON (image + transcription)"
            >
              API
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {/* Toggle mode lecture */}
          <button
            type="button"
            className={mode === "paged" ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setMode("paged")}
            aria-pressed={mode === "paged"}
            aria-label="Mode de lecture paginé"
            title="Mode paginé"
          >
            <BookOpen size={13} aria-hidden /> Paginé
          </button>
          <button
            type="button"
            className={mode === "vertical" ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setMode("vertical")}
            aria-pressed={mode === "vertical"}
            aria-label="Mode de lecture vertical (webtoon)"
            title="Mode vertical (webtoon)"
          >
            <ScrollText size={13} aria-hidden /> Défilement
          </button>

          {/* Toggle sens de lecture */}
          <button
            type="button"
            className={dir === "rtl" ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setDir(d => (d === "rtl" ? "ltr" : "rtl"))}
            aria-label={
              dir === "rtl" ? "Sens de lecture manga (droite vers gauche)" : "Sens de lecture BD (gauche vers droite)"
            }
            title={dir === "rtl" ? "Sens manga (droite→gauche)" : "Sens BD (gauche→droite)"}
          >
            <MoveHorizontal size={13} aria-hidden />
            {dir === "rtl" ? "RTL" : "LTR"}
          </button>

          {/* Toggle double-page (paginé + grand écran) */}
          <button
            type="button"
            className={useSpread ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setSpread(s => !s)}
            disabled={mode !== "paged" || !isLarge}
            aria-pressed={useSpread}
            aria-label="Affichage double-page (grand écran)"
            title="Double-page (grand écran)"
          >
            {useSpread ? <Columns2 size={13} aria-hidden /> : <Square size={13} aria-hidden />}
            Double
          </button>

          {/* Plein écran */}
          <button
            type="button"
            className="m3-reader-btn"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Quitter le plein écran" : "Activer le plein écran"}
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          >
            {isFullscreen ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
          </button>

          {/* Navigation chapitres */}
          {prevHref ? (
            renderChapterLink ? (
              renderChapterLink({
                href: prevHref,
                children: (
                  <>
                    <ChevronLeft size={13} aria-hidden /> Préc.
                  </>
                ),
                className: "m3-reader-btn",
                ariaLabel: "Chapitre précédent",
              })
            ) : (
              <a href={prevHref} className="m3-reader-btn" aria-label="Chapitre précédent" title="Chapitre précédent">
                <ChevronLeft size={13} aria-hidden /> Préc.
              </a>
            )
          ) : (
            <span className="m3-reader-btn pointer-events-none opacity-40">
              <ChevronLeft size={13} aria-hidden /> Préc.
            </span>
          )}
          {nextHref ? (
            renderChapterLink ? (
              renderChapterLink({
                href: nextHref,
                children: (
                  <>
                    Suiv. <ChevronRight size={13} aria-hidden />
                  </>
                ),
                className: "m3-reader-btn",
                ariaLabel: "Chapitre suivant",
              })
            ) : (
              <a href={nextHref} className="m3-reader-btn" aria-label="Chapitre suivant" title="Chapitre suivant">
                Suiv. <ChevronRight size={13} aria-hidden />
              </a>
            )
          ) : (
            <span className="m3-reader-btn pointer-events-none opacity-40">
              Suiv. <ChevronRight size={13} aria-hidden />
            </span>
          )}
        </div>
      </div>

      {/* Zone de lecture */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-[18px] text-on-surface">
            Aucune planche disponible.
          </div>
        ) : mode === "paged" ? (
          <>
            <Swiper
              key={`${dir}-${useSpread ? "spread" : "single"}`}
              // Le `key` force un remount à chaque changement de sens/double-page :
              // on repart de la planche courante plutôt que de la page 1.
              initialSlide={current}
              dir={dir}
              modules={[Keyboard, Zoom, Mousewheel]}
              className="h-full w-full max-w-full"
              slidesPerView={useSpread ? 2 : 1}
              spaceBetween={useSpread ? 8 : 0}
              keyboard={{ enabled: true }}
              mousewheel={{ forceToAxis: true }}
              zoom={{ maxRatio: 3, toggle: true }}
              onSwiper={handleSwiper}
              onSlideChange={handleSlideChange}
            >
              {urls.map((url, i) => (
                <SwiperSlide key={url} zoom className="flex items-center justify-center">
                  {/* `swiper-zoom-container` requis par le module Zoom (pan/pinch). */}
                  <div className="swiper-zoom-container flex h-full w-full max-w-full items-center justify-center">
                    <img
                      src={url}
                      alt={`${title} — page ${i + 1}`}
                      loading={Math.abs(i - current) <= 1 ? "eager" : "lazy"}
                      draggable={false}
                      className="max-h-full max-w-full object-contain pointer-events-none select-none"
                      onError={handleImageError}
                    />
                  </div>
                </SwiperSlide>
              ))}
            </Swiper>

            {/* Flèches de navigation (respectent le sens RTL/LTR). */}
            <button
              type="button"
              aria-label="Page précédente"
              onClick={goPrevPage}
              className="absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-lg border-2 border-outline bg-surface/85 p-2.5 text-primary shadow-[3px_3px_0px_var(--md-sys-color-shadow)] transition-all hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_10%,var(--md-sys-color-surface))] hover:scale-105 active:translate-y-[calc(-50%+1px)]"
            >
              {dir === "rtl" ? <ChevronRight size={22} aria-hidden /> : <ChevronLeft size={22} aria-hidden />}
            </button>
            <button
              type="button"
              aria-label="Page suivante"
              onClick={goNextPage}
              className="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-lg border-2 border-outline bg-surface/85 p-2.5 text-primary shadow-[3px_3px_0px_var(--md-sys-color-shadow)] transition-all hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_10%,var(--md-sys-color-surface))] hover:scale-105 active:translate-y-[calc(-50%+1px)]"
            >
              {dir === "rtl" ? <ChevronLeft size={22} aria-hidden /> : <ChevronRight size={22} aria-hidden />}
            </button>
          </>
        ) : (
          <div
            ref={scrollParentRef}
            // `tabIndex` requis pour rendre le conteneur défilable au clavier
            // (flèches/PgUp/PgDn) — sinon la lecture verticale est inatteignable.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- zone de lecture défilable au clavier : aucun rôle interactif ne la décrit, retirer tabIndex rendrait le mode vertical inatteignable au clavier
            tabIndex={0}
            className="h-full w-full overflow-y-auto overflow-x-hidden m3-reader-scroll focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary"
            aria-label={`${title} — lecture verticale`}
          >
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map(vi => (
                <div
                  key={`${baseId}-${vi.key}`}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={virtualRowStyle(vi.start)}
                  className="flex justify-center py-2"
                >
                  <img
                    src={urls[vi.index]}
                    alt={`${title} — page ${vi.index + 1}`}
                    loading={Math.abs(vi.index - current) <= 1 ? "eager" : "lazy"}
                    draggable={false}
                    className="h-auto w-full max-w-3xl object-contain border-y md:border-2 border-outline/40 shadow-[0_4px_12px_color-mix(in_oklab,var(--md-sys-color-shadow)_80%,transparent)]"
                    onError={handleImageError}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bande de vignettes (chapitres courts uniquement — cf. SHOW_STRIP_MAX). */}
      {mode === "paged" && total > 0 && total <= SHOW_STRIP_MAX && (
        <div className="z-10 w-full min-w-0 max-w-full bg-surface border-t-2 border-outline px-4 py-3 flex items-center overflow-x-auto m3-reader-scroll">
          <div className="flex gap-2.5 min-w-max mx-auto px-2">
            {urls.map((url, idx) => (
              <button
                key={url}
                ref={current === idx ? activeThumbRef : undefined}
                type="button"
                onClick={() => {
                  setCurrent(idx);
                  swiperRef.current?.slideTo(idx);
                }}
                className={`relative shrink-0 w-12 h-16 rounded-md overflow-hidden border-2 transition-all ${
                  current === idx
                    ? "border-primary scale-105 shadow-[0_0_12px_color-mix(in_oklab,var(--md-sys-color-primary)_40%,transparent)]"
                    : "border-outline shadow-[2px_2px_0px_var(--md-sys-color-shadow)] hover:border-on-surface"
                }`}
              >
                <img
                  src={url}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-full object-cover select-none pointer-events-none"
                  loading="lazy"
                />
                <span className="absolute bottom-0 inset-x-0 bg-surface/85 text-[18px] font-extrabold text-on-surface text-center font-mono py-0.5 border-t border-outline/60">
                  {idx + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tomes longs : la bande de vignettes serait trop lourde (jusqu'à ~282 nœuds)
			    → saut direct à une planche par saisie du numéro. */}
      {mode === "paged" && total > SHOW_STRIP_MAX && (
        <form
          className="z-10 flex items-center justify-center gap-3 border-t-2 border-outline bg-surface px-4 py-3"
          onSubmit={e => {
            e.preventDefault();
            const field = e.currentTarget.elements.namedItem("goto") as HTMLInputElement | null;
            const val = Number(field?.value);
            if (!Number.isFinite(val)) return;
            const i = Math.min(Math.max(val - 1, 0), total - 1);
            setCurrent(i);
            swiperRef.current?.slideTo(i);
          }}
        >
          <label htmlFor={`${baseId}-goto`} className="text-[18px] font-black uppercase tracking-wider text-on-surface">
            Aller à la planche
          </label>
          <input
            id={`${baseId}-goto`}
            name="goto"
            type="number"
            min={1}
            max={total}
            key={current}
            defaultValue={current + 1}
            className="w-20 rounded-md border-2 border-outline bg-surface px-2.5 py-1 text-center text-[18px] font-extrabold tabular-nums text-primary shadow-[2px_2px_0px_var(--md-sys-color-shadow)]"
          />
          <span className="text-[18px] font-bold tabular-nums text-on-surface-variant">/ {total}</span>
          <button type="submit" className="m3-reader-btn-active !py-1 !px-3.5">
            OK
          </button>
        </form>
      )}
    </div>
  );
}
