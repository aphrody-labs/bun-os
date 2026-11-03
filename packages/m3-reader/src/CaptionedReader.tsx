"use client";
import { useModePageRestoration } from "./use-mode-page-restoration";

/**
 * Lecteur de planches légendées (recueil illustré, interview) — format manga + légende.
 *
 * Deux modes :
 *  - Vertical (défaut) : défilement webtoon, image puis texte en dessous.
 *  - Paginé : une planche à la fois (Swiper). Sur grand écran, layout
 *    planche | texte côte à côte pour que les légendes longues ne mangent
 *    plus l'image. Clic sur la planche → lightbox plein écran.
 *
 * Les pages sans image ni texte sont filtrées côté public (slots admin vides).
 * LTR par défaut. Affiche le `number` éditorial (pas seulement l'index).
 */

import type React from "react";
import type { ReactNode } from "react";
import { type ReactElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFocusTrap } from "./use-focus-trap";
import { BookOpen, ChevronLeft, ChevronRight, Maximize2, Minimize2, ScrollText, X, ZoomIn } from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Mousewheel, Virtual, Zoom } from "swiper/modules";

// eslint-disable-next-line import/no-unassigned-import -- Swiper layout and interactions require this stylesheet.
import "swiper/css";
// eslint-disable-next-line import/no-unassigned-import -- Swiper layout and interactions require this stylesheet.
import "swiper/css/zoom";
// eslint-disable-next-line import/no-unassigned-import -- Swiper layout and interactions require this stylesheet.
import "swiper/css/virtual";

import {
  SHOW_STRIP_MAX,
  type ViewMode,
  useFullscreen,
  useSwiperSync,
  useVerticalScrollSync,
  virtualRowStyle,
} from "./use-reader-core";

export type CaptionedReaderPage = {
  /** Numéro affiché (auto 1…N, modifiable côté admin). */
  number?: number | null;
  image?: string | null;
  /**
   * Transcription — présente pour les premières planches seulement.
   * Au-delà, la fiche envoie `text: null` et `aDuTexte: true`, et le lecteur
   * demande le texte au fournisseur de transcriptions au fil du défilement :
   * embarquer les 313 transcriptions d'un recueil pesait 412 Ko de charge RSC
   * pour une planche lue.
   */
  text?: string | null;
  /** La planche PORTE une transcription, même si elle n'est pas encore chargée. */
  aDuTexte?: boolean;
  /** Transcription relue à l'image : pas d'avertissement de lecture douteuse. */
  verifiee?: boolean;
};

export type ReaderTranscription = {
  text: string;
  page: number;
  verified: boolean;
};

export type CaptionedReaderProps = {
  pages: CaptionedReaderPage[];
  title: string;
  resolveAssetUrl?: (path: string) => string;
  imageSrc?: (url: string, width: number) => string;
  imageSrcSet?: (url: string, widths: number[]) => string | null;
  loadTranscriptions?: (pages: number[], signal: AbortSignal) => Promise<Record<string, string>>;
  renderTranscription?: (transcription: ReaderTranscription) => ReactNode;
  preloadCount?: number;
};

type ResolvedPage = {
  /** Numéro affiché (édition admin) — pas forcément = position dans le lecteur. */
  number: number;
  imageUrl: string | null;
  text: string | null;
  /** Une transcription existe côté serveur, chargée ou non. */
  aDuTexte: boolean;
  /** Transcription acquittée à la main (drapeau porté par la fiche). */
  verifiee: boolean;
};

function pageNumber(p: CaptionedReaderPage, fallback: number): number {
  const raw = p.number as unknown;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && String(raw).trim() && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw));
  }
  return fallback;
}

function resolvePages(pages: CaptionedReaderPage[], resolveAssetUrl: (path: string) => string): ResolvedPage[] {
  const out: ResolvedPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p) continue;
    const img = typeof p.image === "string" && p.image.trim() ? p.image.trim() : null;
    const text = typeof p.text === "string" && p.text.trim() ? p.text.trim() : null;
    const aDuTexte = p.aDuTexte === true || text !== null;
    // Une planche sans image ET sans transcription est un emplacement vide
    // réservé côté studio : elle ne se montre pas au public.
    if (!img && !aDuTexte) continue;
    out.push({
      number: pageNumber(p, i + 1),
      imageUrl: img ? resolveAssetUrl(img) : null,
      text,
      aDuTexte,
      verifiee: p.verifiee === true,
    });
  }
  return out;
}

/** Combien de planches autour de la courante on charge d'avance. */
const FENETRE_TEXTE = 6;

/**
 * Transcriptions chargées à la demande.
 *
 * La fiche n'embarque que les premières ; celles qu'on approche sont demandées
 * par fenêtres au fournisseur transmis par l'hôte. Une planche déjà connue n'est
 * jamais redemandée, et un échec réseau laisse simplement la planche sans
 * texte — jamais d'erreur jetée à la figure d'un lecteur qui feuillette.
 */
function useTextesPlanches(
  loadTranscriptions: CaptionedReaderProps["loadTranscriptions"],
  items: ResolvedPage[],
  current: number,
): Map<number, string> {
  const [charges, setCharges] = useState<Map<number, string>>(() => new Map());
  // Les numéros déjà demandés (succès ou échec) : sans cette mémoire, une
  // planche sans transcription serait redemandée à chaque défilement.
  const demandes = useRef<Set<number>>(new Set());

  // Candidats : planches proches sans texte. Le filtre `demandes` (ref) est
  // appliqué dans l'effet, jamais pendant le rendu.
  const manquants = useMemo(() => {
    if (!loadTranscriptions) return [];
    const de = Math.max(0, current - FENETRE_TEXTE);
    const a = Math.min(items.length, current + FENETRE_TEXTE + 1);
    const out: number[] = [];
    for (let i = de; i < a; i++) {
      const it = items[i];
      if (!it || !it.aDuTexte || it.text !== null) continue;
      if (charges.has(it.number)) continue;
      out.push(it.number);
    }
    return out;
  }, [loadTranscriptions, items, current, charges]);

  useEffect(() => {
    const aCharger = manquants.filter(n => !demandes.current.has(n));
    if (aCharger.length === 0) return;
    for (const n of aCharger) demandes.current.add(n);
    const stop = new AbortController();
    loadTranscriptions!(aCharger, stop.signal)
      .then(textes => ({ textes }))
      .then((d: { textes?: Record<string, string> }) => {
        const recus = Object.entries(d.textes ?? {});
        if (recus.length === 0) return undefined;
        setCharges(prec => {
          const suiv = new Map(prec);
          for (const [n, t] of recus) suiv.set(Number(n), t);
          return suiv;
        });
        return undefined;
      })
      .catch(() => {
        /* hors ligne ou navigation : la planche reste sans texte */
      });
    return () => stop.abort();
  }, [manquants, loadTranscriptions]);

  return charges;
}

// Défauts stables : une fonction littérale par défaut change à chaque rendu.
const identiteUrl = (path: string): string => path;
const identiteImage = (url: string): string => url;
const sansSrcSet = (): null => null;

export function CaptionedReader({
  pages,
  title,
  resolveAssetUrl = identiteUrl,
  imageSrc = identiteImage,
  imageSrcSet = sansSrcSet,
  loadTranscriptions,
  renderTranscription,
  preloadCount = 4,
}: CaptionedReaderProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const items = useMemo(() => resolvePages(pages, resolveAssetUrl), [pages, resolveAssetUrl]);
  const total = items.length;

  const [mode, setMode] = useState<ViewMode>("vertical");
  const [current, setCurrent] = useState(0);
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
  const { swiperRef, handleSwiper, handleSlideChange } = useSwiperSync(setCurrent);
  /** Lightbox plein écran sur la planche courante (indépendant du mode). */
  const [lightbox, setLightbox] = useState(false);

  const textesCharges = useTextesPlanches(loadTranscriptions, items, current);
  /** Le texte d'une planche : celui de la fiche, sinon celui chargé après coup. */
  const texteDe = useCallback(
    (p: ResolvedPage | undefined): string | null => (p ? (p.text ?? textesCharges.get(p.number) ?? null) : null),
    [textesCharges],
  );
  useFocusTrap(lightboxRef, lightbox, () => setLightbox(false));

  // Clamp l'index si le nombre de pages change (édition live / revalidation).
  useEffect(() => {
    if (current >= total && total > 0) setCurrent(total - 1);
    if (total === 0) setCurrent(0);
  }, [total, current]);

  // Précharge planche courante ± voisines.
  useEffect(() => {
    if (total === 0) return;
    for (const idx of [current - 1, current, current + 1, current + 2]) {
      const url = items[idx]?.imageUrl;
      if (!url) continue;
      const img = new Image();
      img.src = url;
    }
  }, [current, items, total]);

  // Détection côté client uniquement (`document` absent au rendu serveur).
  const [fullscreenDispo, setFullscreenDispo] = useState(false);
  useEffect(() => {
    setFullscreenDispo(
      typeof document !== "undefined" &&
        document.fullscreenEnabled &&
        typeof containerRef.current?.requestFullscreen === "function",
    );
  }, []);

  /* ------------------------------ Vertical ------------------------------ */

  const scrollParentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer ne renvoie pas de valeur mémoïsable ; il n'est appelé qu'au rendu, sans passer ses résultats aux dépendances de hooks.
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => (typeof window === "undefined" ? 1100 : Math.round(window.innerHeight * 0.95)),
    // Marge de préchargement réglée sur les capacités : 4 planches rendent le
    // défilement continu sur un scan de 1 à 2 Mo, mais les précharger sur un
    // mobile en 2G dépense des données pour des pages qu'on ne verra
    // peut-être jamais. `prechargement` vaut 1 sur réseau lent, 6 sur une
    // machine confortable.
    overscan: Math.max(2, preloadCount),
  });

  // oxlint-disable react-hooks/exhaustive-deps -- swiperRef est une ref stable (renvoyée par useSwiperSync) ; `.current` est lu à l'appel, pas à la création du callback
  const goTo = useCallback(
    (idx: number) => {
      const i = Math.min(Math.max(idx, 0), Math.max(0, total - 1));
      setCurrent(i);
      if (mode === "paged") swiperRef.current?.slideTo(i);
      else virtualizer.scrollToIndex(i, { align: "start" });
    },
    [mode, total, virtualizer],
  );
  // oxlint-enable react-hooks/exhaustive-deps

  const restoring = useModePageRestoration(mode, current, scrollParentRef, virtualizer, containerRef);
  useVerticalScrollSync(mode, scrollParentRef, virtualizer, setCurrent, restoring);

  // Navigation clavier des planches.
  //
  // Une SEULE source de vérité : ce handler, qui passe par `goTo` (donc
  // `slideTo` en mode paginé). Le module `Keyboard` de Swiper est
  // volontairement absent : il écoute lui aussi `keydown`, sur `document`,
  // et faisait AVANCER DEUX FOIS — Swiper glissait d'une planche et émettait
  // `slideChange` (`setCurrent(index)`), puis ce handler ajoutait +1 par-dessus.
  // `current` se décalait durablement de la planche affichée, si bien que la
  // transcription montrée à côté du scan était celle d'une AUTRE page (mesuré
  // sur un recueil de 20 planches : compteur « n°3 · 3/20 » sur la planche 2).
  useEffect(() => {
    const actif = lightbox || mode === "paged";
    if (!actif) return;
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      const tag = cible?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || cible?.isContentEditable) return;
      switch (e.key) {
        case "Escape":
          if (lightbox) setLightbox(false);
          return;
        case "ArrowLeft":
          e.preventDefault();
          goTo(current - 1);
          return;
        case "ArrowRight":
          e.preventDefault();
          goTo(current + 1);
          return;
        case "Home":
          e.preventDefault();
          goTo(0);
          return;
        case "End":
          e.preventDefault();
          goTo(total - 1);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, mode, total, current, goTo]);

  const goPrevPage = useCallback(() => {
    goTo(current - 1);
  }, [current, goTo]);

  const goNextPage = useCallback(() => {
    goTo(current + 1);
  }, [current, goTo]);

  const openLightbox = useCallback(
    (idx?: number) => {
      if (typeof idx === "number") setCurrent(idx);
      const item = items[typeof idx === "number" ? idx : current];
      if (item?.imageUrl) setLightbox(true);
    },
    [items, current],
  );

  // `min-h-10`/`min-w-10` (40 px) : les commandes du lecteur mesuraient 28 à
  // 30 px de haut, sous le seuil tactile. Le padding reste serré à partir de
  // `sm`, où l'on pointe à la souris.
  // Balayage horizontal dans la visionneuse : sur mobile elle n'offrait que deux
  // flèches de 44 px posées sur l'image — le geste naturel (faire glisser la
  // planche) ne faisait rien. Seuil de 48 px, et on ignore les gestes
  // majoritairement verticaux pour ne pas voler un défilement.
  const toucheRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    toucheRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const depart = toucheRef.current;
      toucheRef.current = null;
      const t = e.changedTouches[0];
      if (!depart || !t) return;
      const dx = t.clientX - depart.x;
      const dy = t.clientY - depart.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      // `goTo` et non `setCurrent` : il fait suivre le Swiper sous-jacent,
      // sans quoi refermer la visionneuse laisserait la planche paginée sur
      // l'ancienne page.
      goTo(dx < 0 ? current + 1 : current - 1);
    },
    [current, goTo],
  );

  const currentItem = items[current];
  const currentNum = currentItem?.number ?? current + 1;
  const counter = total ? `n°${currentNum} · ${Math.min(current + 1, total)}/${total}` : "0 / 0";
  const currentText = texteDe(currentItem);
  const currentImage = currentItem?.imageUrl ?? null;

  if (total === 0) {
    return (
      <div className="m3-reader-frame flex min-h-[200px] items-center justify-center rounded-xl p-8 text-[18px] text-on-surface-variant">
        Aucune page à afficher pour le moment.
      </div>
    );
  }

  const legendBlock = (
    <div className="flex h-full min-h-0 flex-col p-4 bg-surface border-t-2 lg:border-t-0 lg:border-l-2 border-outline">
      <div className="mb-2 shrink-0 flex items-center justify-between">
        <span className="m3-reader-badge bg-primary text-on-primary px-2 py-0.5 text-[18px] font-black">
          <span>PLANCHE {currentNum}</span>
        </span>
        <span className="text-[18px] font-bold tabular-nums text-on-surface-variant">
          {current + 1} / {total}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 m3-reader-scroll">
        {currentText ? (
          (renderTranscription?.({
            text: currentText,
            page: currentNum,
            verified: currentItem?.verifiee ?? false,
          }) ?? currentText)
        ) : currentItem?.aDuTexte ? (
          // La planche PORTE une transcription : dire « aucune description »
          // pendant qu'elle arrive ferait croire à une lacune du corpus.
          <p className="text-[18px] italic text-on-surface-variant">Chargement de la transcription…</p>
        ) : (
          <p className="text-[18px] italic text-on-surface-variant">Aucune description pour cette page.</p>
        )}
      </div>
    </div>
  );

  return (
    <section
      ref={containerRef}
      className="m3-reader m3-reader-container m3-reader-scroll flex h-[84svh] min-h-[460px] w-full min-w-0 flex-col overflow-hidden rounded-xl bg-surface [contain:inline-size] [&:fullscreen]:h-screen [&:fullscreen]:min-h-screen [&:fullscreen]:rounded-none"
      data-captioned-reader
      data-m3-component="CaptionedReader"
      data-testid="captioned-reader"
      aria-label={title}
    >
      {/* Barre de contrôles (HUD) */}
      <div className="m3-reader-hud z-10 flex flex-nowrap items-center gap-2 px-3 py-2.5 sm:flex-wrap">
        <span className="mr-1 hidden min-w-0 max-w-[40ch] truncate font-sans text-[18px] font-extrabold uppercase tracking-wide text-on-surface drop-shadow-[1px_1px_0px_var(--md-sys-color-shadow)] sm:block">
          {title}
        </span>
        <span className="m3-reader-badge bg-primary text-on-primary px-2 py-0.5 text-[18px] font-black sm:ml-auto">
          <span>{counter}</span>
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0 sm:gap-2">
          <button
            type="button"
            className={mode === "vertical" ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setMode("vertical")}
            aria-pressed={mode === "vertical"}
            aria-label="Mode vertical (planche + texte)"
            title="Mode vertical (planche + texte)"
          >
            <ScrollText size={14} aria-hidden />
            <span className="hidden sm:inline">Défilement</span>
          </button>
          <button
            type="button"
            className={mode === "paged" ? "m3-reader-btn-active" : "m3-reader-btn"}
            onClick={() => setMode("paged")}
            aria-pressed={mode === "paged"}
            aria-label="Mode paginé"
            title="Mode paginé"
          >
            <BookOpen size={14} aria-hidden />
            <span className="hidden sm:inline">Paginé</span>
          </button>
          <button
            type="button"
            className="m3-reader-btn"
            onClick={() => openLightbox()}
            disabled={!currentImage}
            aria-label="Agrandir la planche"
            title="Agrandir la planche"
          >
            <ZoomIn size={14} aria-hidden />
          </button>
          {fullscreenDispo && (
            <button
              type="button"
              className="m3-reader-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Quitter le plein écran" : "Activer le plein écran"}
              title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            >
              {isFullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
            </button>
          )}
        </div>
      </div>

      {/* Zone de lecture */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface">
        {mode === "paged" ? (
          /* Layout côte à côte ≥ lg : planche fixe à gauche, texte scrollable
					   à droite — les légendes longues ne réduisent plus l'image. */
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            {/* Zone planche */}
            <div className="relative min-h-[52%] min-w-0 flex-[1.6] lg:h-full lg:min-h-0 lg:flex-[1.15]">
              <Swiper
                key="captioned-ltr"
                initialSlide={current}
                dir="ltr"
                modules={[Zoom, Virtual, Mousewheel]}
                className="h-full w-full"
                slidesPerView={1}
                mousewheel={{ forceToAxis: true }}
                zoom={{ maxRatio: 3, toggle: true }}
                virtual
                onSwiper={handleSwiper}
                onSlideChange={handleSlideChange}
              >
                {items.map((item, i) => (
                  <SwiperSlide
                    // oxlint-disable-next-line react/no-array-index-key -- liste dérivée de `items` dans un ordre stable ; le numéro de planche seul peut se répéter
                    key={`db-page-${item.number}-${i}`}
                    virtualIndex={i}
                    zoom={Boolean(item.imageUrl)}
                    className="flex items-center justify-center"
                  >
                    <div className="swiper-zoom-container flex h-full w-full items-center justify-center bg-surface">
                      {item.imageUrl ? (
                        <button
                          type="button"
                          className="group relative flex h-full w-full cursor-zoom-in items-center justify-center border-0 bg-transparent p-0"
                          onClick={() => openLightbox(i)}
                          aria-label={`Agrandir la page ${item.number}`}
                        >
                          <img
                            src={imageSrc(item.imageUrl, 1080)}
                            srcSet={imageSrcSet(item.imageUrl, [828, 1080, 1920]) || undefined}
                            sizes="(min-width: 1024px) 900px, 100vw"
                            alt={`${title} — page ${item.number}`}
                            loading={Math.abs(i - current) <= 1 ? "eager" : "lazy"}
                            draggable={false}
                            className="max-h-full max-w-full object-contain transition-opacity group-hover:opacity-95"
                          />
                          <span className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-outline-variant bg-surface/60 px-2 py-1 text-[18px] font-bold uppercase tracking-wider text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100">
                            Agrandir
                          </span>
                        </button>
                      ) : (
                        <div className="px-6 text-center text-[18px] text-on-surface-variant">
                          Page {item.number} — pas d&apos;image
                        </div>
                      )}
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>

              <button
                type="button"
                aria-label="Page précédente"
                onClick={goPrevPage}
                disabled={current <= 0}
                className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full border border-outline bg-surface/60 p-3 text-on-surface transition-colors hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_10%,var(--md-sys-color-surface))] disabled:opacity-38"
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Page suivante"
                onClick={goNextPage}
                disabled={current >= total - 1}
                className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full border border-outline bg-surface/60 p-3 text-on-surface transition-colors hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_10%,var(--md-sys-color-surface))] disabled:opacity-38"
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            </div>

            {/* Légende — panneau scrollable indépendant (ne compresse plus l'image). */}
            <div className="min-h-0 max-h-[38%] shrink-0 border-t border-outline bg-surface/90 px-3 py-2.5 sm:max-h-[48%] sm:px-5 sm:py-4 lg:max-h-none lg:w-[min(420px,38%)] lg:overflow-hidden lg:border-l lg:border-t-0">
              {legendBlock}
            </div>
          </div>
        ) : (
          <div
            ref={scrollParentRef}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- conteneur défilant : le focus clavier est requis pour le défilement (WCAG 2.1.1)
            tabIndex={0}
            // `overscroll-y-auto` et non `contain` : arrivé en bout de lecteur,
            // la molette doit rendre la main au document. Avec `contain`, le
            // lecteur avalait le geste et la page restait bloquée — on ne
            // pouvait plus descendre vers la suite de la fiche sans sortir la
            // souris de la zone. Le risque d'origine (l'inertie mobile qui
            // éjectait le lecteur en pleine lecture) est traité autrement : les
            // planches s'accrochent au défilement, donc le mouvement s'arrête
            // franchement sur une page au lieu de filer.
            //
            // `snap-y snap-proximity` : le « vrai effet de page » — le
            // défilement s'arrête franchement sur une planche au lieu de
            // s'immobiliser entre deux images. `proximity` et non `mandatory` :
            // la liste est virtualisée (éléments montés/démontés en cours de
            // route, hauteurs mesurées après coup), et une accroche
            // obligatoire se bat avec ces remesures — elle produit des sauts au
            // moment où une planche entre dans la fenêtre.
            className="h-full w-full snap-y snap-proximity overflow-y-auto overflow-x-hidden overscroll-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary"
            aria-label={`${title} — lecture verticale`}
          >
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map(vi => {
                const item = items[vi.index];
                if (!item) return null;
                return (
                  <div
                    key={`${baseId}-${vi.key}`}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={virtualRowStyle(vi.start)}
                    className="snap-start snap-always border-b border-outline-variant/40 px-2 py-4 sm:px-4 sm:py-6"
                  >
                    <div className="group/planche mx-auto flex w-full max-w-3xl flex-col gap-3">
                      <span className="text-[18px] font-bold uppercase tracking-[0.2em] text-primary/70">
                        Page {item.number}
                      </span>
                      {item.imageUrl ? (
                        <button
                          type="button"
                          className="group relative cursor-zoom-in border-0 bg-transparent p-0 text-left focus-visible:outline-none"
                          onClick={() => openLightbox(vi.index)}
                          aria-label={`Ouvrir la page ${item.number} en plein écran`}
                        >
                          <img
                            src={imageSrc(item.imageUrl, 1080)}
                            srcSet={imageSrcSet(item.imageUrl, [828, 1080, 1920]) || undefined}
                            sizes="(min-width: 768px) 768px, 100vw"
                            alt={`${title} — page ${item.number}`}
                            // Trois planches de part et d'autre chargées d'avance :
                            // avec une seule, tourner la page laissait un rectangle
                            // vide le temps du téléchargement d'un scan de 1 à 2 Mo.
                            loading={Math.abs(vi.index - current) <= 3 ? "eager" : "lazy"}
                            // `high` sur la planche courante : le navigateur la sert
                            // avant les voisines préchargées.
                            fetchPriority={vi.index === current ? "high" : "auto"}
                            decoding="async"
                            draggable={false}
                            className="h-auto w-full rounded-sm bg-surface object-contain shadow-[0_0_24px_color-mix(in_oklab,var(--md-sys-color-shadow)_45%,transparent)] transition-[transform,box-shadow] duration-300 ease-out will-change-transform group-hover:scale-[1.015] group-hover:shadow-[0_0_60px_color-mix(in_oklab,var(--md-sys-color-shadow)_75%,transparent)] group-focus-visible:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
                          />
                          {/* Appel au plein écran, révélé au survol de la planche. */}
                          <span className="pointer-events-none absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface/70 px-2.5 py-1.5 text-[18px] font-bold uppercase tracking-wider text-on-surface-variant opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                            <ZoomIn size={12} aria-hidden />
                            Plein écran
                          </span>
                        </button>
                      ) : (
                        <div className="flex min-h-[120px] items-center justify-center rounded border border-dashed border-outline-variant/60 bg-surface/40 text-[18px] text-on-surface-variant">
                          Pas d&apos;image pour cette page
                        </div>
                      )}
                      {texteDe(item) ? (
                        <div className="rounded-md border border-outline/40 bg-surface/50 px-4 py-3">
                          {renderTranscription?.({
                            text: texteDe(item) as string,
                            page: item.number,
                            verified: item.verifiee,
                          }) ?? texteDe(item)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bande de vignettes (recueils courts). */}
      {mode === "paged" && total > 0 && total <= SHOW_STRIP_MAX && (
        <div className="z-10 flex items-center gap-4 overflow-x-auto border-t border-outline bg-surface/90 px-4 py-3 scrollbar-thin">
          <div className="mx-auto flex gap-2">
            {items.map((item, idx) => (
              <button
                // oxlint-disable-next-line react/no-array-index-key -- liste dérivée de `items` dans un ordre stable ; le numéro de planche seul peut se répéter
                key={`thumb-${item.number}-${idx}`}
                type="button"
                onClick={() => goTo(idx)}
                className={`relative h-16 w-12 flex-shrink-0 overflow-hidden rounded border-2 transition-all ${
                  current === idx
                    ? "scale-105 border-primary shadow-[0_0_10px_color-mix(in_oklab,var(--md-sys-color-primary)_40%,transparent)]"
                    : "border-outline-variant/60 hover:border-outline"
                }`}
                title={`Page ${item.number}`}
                aria-label={`Aller à la page ${item.number}`}
                aria-current={current === idx ? "true" : undefined}
              >
                {item.imageUrl ? (
                  <img
                    // Vignette de 48×64 px : elle chargeait le scan source (jusqu'à
                    // 5 Mio) pour un timbre-poste, jusqu'à 40 fois par fiche.
                    src={imageSrc(item.imageUrl, 96)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-surface-container-highest text-[18px] text-on-surface-variant">
                    txt
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-surface/70 text-center font-mono text-[18px] font-bold text-on-surface">
                  {item.number}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Saut direct pour les longs recueils. */}
      {mode === "paged" && total > SHOW_STRIP_MAX && (
        <form
          className="z-10 flex items-center justify-center gap-3 border-t-2 border-outline bg-surface px-4 py-3"
          onSubmit={e => {
            e.preventDefault();
            const field = e.currentTarget.elements.namedItem("goto") as HTMLInputElement | null;
            const wanted = Number(field?.value);
            if (!Number.isFinite(wanted)) return;
            // Cherche d'abord par numéro éditorial, sinon par position 1-based.
            const byNumber = items.findIndex(it => it.number === Math.trunc(wanted));
            if (byNumber >= 0) goTo(byNumber);
            else goTo(Math.trunc(wanted) - 1);
          }}
        >
          <label htmlFor={`${baseId}-goto`} className="text-[18px] font-black uppercase tracking-wider text-on-surface">
            Aller à n°
          </label>
          <input
            id={`${baseId}-goto`}
            name="goto"
            type="number"
            key={currentNum}
            defaultValue={currentNum}
            className="w-20 rounded-md border-2 border-outline bg-surface px-2.5 py-1 text-center text-[18px] font-extrabold tabular-nums text-primary shadow-[2px_2px_0px_var(--md-sys-color-shadow)]"
          />
          <button type="submit" className="m3-reader-btn-active !py-1 !px-3.5">
            OK
          </button>
        </form>
      )}

      {/* Lightbox agrandissement planche */}
      {lightbox && currentImage && (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- clic sur le fond = fermeture ; la touche Échap est gérée par useFocusTrap (onEscape)
        <div
          ref={lightboxRef}
          // `tabIndex={-1}` : requis par `useFocusTrap`, qui donne le focus au
          // panneau à l'ouverture. Sans piège, la tabulation continuait DERRIÈRE
          // la visionneuse plein écran — le focus disparaissait pour l'utilisateur
          // clavier et pour le lecteur d'écran.
          tabIndex={-1}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- dialogue modal géré par useFocusTrap (aria-modal, piège de focus) ; <dialog> natif imposerait showModal()
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — page ${currentNum} agrandie`}
          className="fixed inset-0 z-[100] flex flex-col bg-surface/95"
          onClick={() => setLightbox(false)}
        >
          <div className="flex items-center gap-3 border-b-2 border-outline bg-surface px-4 py-3">
            <span className="min-w-0 flex-1 truncate font-sans text-[18px] font-extrabold uppercase tracking-wide text-on-surface">
              {title}
            </span>
            <span className="m3-reader-badge bg-primary text-on-primary px-2 py-0.5 text-[18px] font-black">
              <span>n°{currentNum}</span>
            </span>
            <button
              type="button"
              className="m3-reader-btn ml-auto"
              onClick={e => {
                e.stopPropagation();
                setLightbox(false);
              }}
              aria-label="Fermer"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- simple arrêt de propagation : empêche la fermeture par clic sur le fond, sans action clavier propre */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4"
            onClick={e => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <img
              src={currentImage}
              alt={`${title} — page ${currentNum}`}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
            <button
              type="button"
              aria-label="Page précédente"
              onClick={() => goTo(current - 1)}
              disabled={current <= 0}
              className="absolute top-1/2 left-4 -translate-y-1/2 rounded-lg border-2 border-outline bg-surface/90 p-3 text-primary shadow-[3px_3px_0px_var(--md-sys-color-shadow)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_10%,var(--md-sys-color-surface))] transition-all disabled:opacity-38"
            >
              <ChevronLeft size={22} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Page suivante"
              onClick={() => goTo(current + 1)}
              disabled={current >= total - 1}
              className="absolute top-1/2 right-4 -translate-y-1/2 rounded-lg border-2 border-outline bg-surface/90 p-3 text-primary shadow-[3px_3px_0px_var(--md-sys-color-shadow)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,var(--md-sys-color-surface))] active:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_10%,var(--md-sys-color-surface))] transition-all disabled:opacity-38"
            >
              <ChevronRight size={22} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
