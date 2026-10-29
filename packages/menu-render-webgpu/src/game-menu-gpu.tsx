/**
 * <GameMenuGpu> — wrapper React du renderer WebGPU du menu IEVR.
 *
 * Monte un `<canvas>`, pilote `WebGpuMenuRenderer` dans un `useEffect`, et **retombe**
 * sur le `<GameMenu>` DOM de `@aphrody/menu-render` quand :
 *   - `navigator.gpu` est absent, OU
 *   - `forceFallback` est vrai (tests / forçage), OU
 *   - l'initialisation/le rendu WebGPU échoue.
 *
 * Le fallback réutilise le même contrat `layout`+`overrides` → zéro duplication de la
 * logique de placement.
 *
 * Responsive plein écran : la zone 16:9 max est centrée (letterbox), le drawing-buffer du
 * canvas est dimensionné à `cssW*dpr × cssH*dpr` (devicePixelRatio), le shader projette en
 * repère 1280×720 → pixel-perfect au scale exact (sampler nearest).
 */

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { GameMenu, type MenuLayout, type MenuObjectOverride } from "@aphrody/menu-render";
import { CANVAS_SIZE, computeLetterbox, WebGpuMenuRenderer } from "./renderer";

export interface GameMenuGpuProps {
  /** Layout JSON produit par `iecode menu export <screen>`. */
  layout: MenuLayout;
  /** Base URL des assets PNG (CDN ou /menu-assets). */
  assetBase: string;
  /** Overrides par nom d'objet, pilotés par `useLuaMenu` (visibilité/texte/nombre). */
  overrides?: Record<string, MenuObjectOverride>;
  /** Classe CSS du conteneur externe. */
  className?: string;
  /** Style du conteneur externe (ex. `{ position: 'fixed', inset: 0 }`). */
  style?: CSSProperties;
  /** Callback d'erreur (init/rendu WebGPU). Le composant bascule alors en fallback. */
  onError?: (e: Error) => void;
  /** Force le fallback DOM `<GameMenu>` (tests / pas de WebGPU). */
  forceFallback?: boolean;
}

/** Décide si l'on doit rendre en WebGPU (sinon fallback DOM). Pur, testable. */
export function shouldUseWebGpu(forceFallback: boolean, hasGpu: boolean): boolean {
  if (forceFallback) {
    return false;
  }
  return hasGpu;
}

const hasWebGpu = (): boolean => typeof navigator !== "undefined" && Boolean((navigator as Navigator).gpu);

/**
 * Renderer WebGPU du menu, avec fallback DOM `<GameMenu>`.
 *
 * @example
 * ```tsx
 * const { overrides } = useLuaMenu(luaSource, { funcluaJson });
 * <GameMenuGpu layout={layout} assetBase={CDN} overrides={overrides}
 *              style={{ position: "fixed", inset: 0 }} />
 * ```
 */
export function GameMenuGpu(props: GameMenuGpuProps): ReactNode {
  const { layout, assetBase, overrides, className, style, onError, forceFallback } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGpuMenuRenderer | null>(null);
  const rafRef = useRef<number | null>(null);

  // Détection résolue côté client (évite le mismatch SSR : on commence en fallback).
  const [gpuOk, setGpuOk] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setGpuOk(hasWebGpu());
  }, []);

  const useGpu = shouldUseWebGpu(Boolean(forceFallback), gpuOk) && !failed;

  // Init / teardown du renderer WebGPU.
  useEffect(() => {
    if (!useGpu) {
      return;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    let disposed = false;

    const applyResize = (renderer: WebGpuMenuRenderer): void => {
      const rect = container.getBoundingClientRect();
      const { cssW, cssH } = computeLetterbox(rect.width, rect.height);
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      renderer.resize(cssW, cssH, dpr);
    };

    WebGpuMenuRenderer.create(canvas, layout, assetBase)
      .then(renderer => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        applyResize(renderer);
        if (overrides) {
          renderer.setOverrides(overrides);
        }

        const obs = new ResizeObserver(() => {
          applyResize(renderer);
          renderer.render();
        });
        obs.observe(container);

        const loop = (): void => {
          renderer.render();
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);

        // Stocke l'observer pour cleanup.
        (renderer as unknown as { __obs?: ResizeObserver }).__obs = obs;
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);
        setFailed(true);
      });

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const r = rendererRef.current;
      if (r) {
        (r as unknown as { __obs?: ResizeObserver }).__obs?.disconnect();
        r.destroy();
        rendererRef.current = null;
      }
    };
    // layout/assetBase changent → re-init complet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useGpu, layout, assetBase]);

  // Propagation des overrides Lua sans réinitialiser le renderer.
  useEffect(() => {
    const r = rendererRef.current;
    if (r && overrides) {
      r.setOverrides(overrides);
    }
  }, [overrides]);

  // Fallback DOM : même contrat layout/overrides.
  if (!useGpu) {
    return <GameMenu layout={layout} assetBase={assetBase} overrides={overrides} className={className} style={style} />;
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        alignItems: "center",
        backgroundColor: "#000",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE.w}
        height={CANVAS_SIZE.h}
        style={{ display: "block", imageRendering: "pixelated" }}
      />
    </div>
  );
}
