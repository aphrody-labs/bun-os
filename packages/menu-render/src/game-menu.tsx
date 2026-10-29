/**
 * <GameMenu> — renderer React pixel-perfect pour un écran de menu IEVR.
 *
 * Canvas de référence : 1280×720 px.
 * Chaque MenuObject est positionné en absolu selon son transform G4PKM :
 *   - left/top = pivot (x, y)
 *   - transform-origin = anchorX*100% anchorY*100%
 *   - CSS transform = scale(scaleX, scaleY) rotate(rot rad)
 *   - z-index = drawPriority
 *
 * Le conteneur 1280×720 est rendu responsive via un CSS scale depuis l'origine
 * haut-gauche, en conservant le ratio exact (letterbox si nécessaire).
 *
 * Police du jeu : la font "nie_main" est chargée via @font-face si le fichier
 * est disponible sous assetBase/fonts/nie_main.woff2.
 * Fallback : sans-serif (le rendu reste positionnel-correct).
 *
 * Animations open/close : Web Animations API, déclenchées au mount.
 * Les keyframes sont intentionnellement simplifiées (fade-in) en attendant
 * l'extraction complète des motions G4MT depuis le G4PKM.
 */

import type { CSSProperties, ReactNode } from "react";
import type { MenuLayout, MenuObject } from "./types";
import { useEffect, useRef, useState } from "react";

/* ── constantes ───────────────────────────────────────────────────────────── */

const CANVAS_W = 1280;
const CANVAS_H = 720;
const ANCHOR_SCALE = 100;
const OPEN_ANIM_DURATION = 320;
const OPEN_ANIM_STAGGER = 40;
const DEFAULT_SPRITE_W = 256;
const DEFAULT_SPRITE_H = 64;
const DEG_PER_RAD = 180 / Math.PI;

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Construit l'URL d'un asset PNG depuis assetBase + pngUrl du sprite.
 * assetBase peut être une URL absolue (CDN) ou un chemin relatif (dev local).
 * Evite le double slash.
 */
const assetUrl = (assetBase: string, pngUrl: string): string => {
  let base = assetBase;
  if (assetBase.endsWith("/")) {
    base = assetBase.slice(0, -1);
  }
  let path = pngUrl;
  if (!pngUrl.startsWith("/")) {
    path = `/${pngUrl}`;
  }
  return `${base}${path}`;
};

/** Convertit les radians du contrat en degrés CSS. */
const radToDeg = (rad: number): number => rad * DEG_PER_RAD;

const drawTypeToBlendMode = (drawType: number): CSSProperties["mixBlendMode"] => {
  switch (drawType) {
    case 1: {
      return "screen"; // Additive approximatif en CSS
    }
    case 2: {
      return "multiply";
    }
    default: {
      return "normal";
    }
  }
};

/**
 * Construit le style CSS positionnel d'un MenuObject.
 *
 * Strategie de placement :
 *   - L'element est left/top = (x, y) = position du pivot dans le canvas.
 *   - transform-origin = anchorX*width anchorY*height (relatif a l'element).
 *     Pour le positionnement CSS, l'origine du transform est dans l'element,
 *     donc on doit decaler l'element pour que son pivot tombe en (x,y) :
 *       left = x - anchorX * w
 *       top  = y - anchorY * h
 *   - CSS transform = scale * rotate (ordre G4 : scale puis rotate).
 */
const objectStyle = (obj: MenuObject, w: number, h: number): CSSProperties => {
  const { drawPriority, drawType, transform } = obj;
  const left = transform.x - transform.anchorX * w;
  const top = transform.y - transform.anchorY * h;
  const deg = radToDeg(transform.rot);
  const blendMode = drawTypeToBlendMode(drawType);

  return {
    height: `${h}px`,
    imageRendering: "pixelated",
    left: `${left}px`,
    mixBlendMode: blendMode,
    position: "absolute",
    top: `${top}px`,
    transform: `scale(${transform.scaleX}, ${transform.scaleY}) rotate(${deg}deg)`,
    transformOrigin: `${transform.anchorX * ANCHOR_SCALE}% ${transform.anchorY * ANCHOR_SCALE}%`,
    width: `${w}px`,
    zIndex: drawPriority,
  };
};

/* ── @font-face injection ─────────────────────────────────────────────────── */

const injectFontFace = (assetBase: string): void => {
  if (typeof document === "undefined") {
    return;
  }
  const id = "__iecode_nie_font__";
  if (document.getElementById(id)) {
    return;
  }

  let base = assetBase;
  if (assetBase.endsWith("/")) {
    base = assetBase.slice(0, -1);
  }
  const style = document.createElement("style");
  style.id = id;
  // nie_main = police principale IEVR (a extraire des CPK).
  // Fallback : Noto Sans JP (couvre kanji) + sans-serif.
  style.textContent = `
@font-face {
  font-family: "nie_main";
  src: url("${base}/fonts/nie_main.woff2") format("woff2"),
       url("${base}/fonts/nie_main.ttf") format("truetype");
  font-display: swap;
}
@font-face {
  font-family: "nie_bold";
  src: url("${base}/fonts/nie_bold.woff2") format("woff2"),
       url("${base}/fonts/nie_bold.ttf") format("truetype");
  font-display: swap;
}
`;
  document.head.appendChild(style);
};

/* ── animation open (Web Animations API) ─────────────────────────────────── */

/**
 * Joue une animation "open" simplifiee sur un element DOM.
 * En production, les keyframes seront extraites du G4MT (motion IEVR).
 * Pour l'instant : fade-in + legere montee (approximation visuelle).
 */
const playOpenAnim = (el: HTMLElement, delay = 0): void => {
  el.animate(
    [
      { opacity: 0, transform: `${el.style.transform} translateY(8px)` },
      { opacity: 1, transform: el.style.transform },
    ],
    {
      delay,
      duration: OPEN_ANIM_DURATION,
      easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      fill: "forwards",
    },
  );
};

/* ── sous-composants ──────────────────────────────────────────────────────── */

interface PrimitiveBoxProps {
  type: string;
  color: string;
  alpha: number;
}

const PrimitiveBox = ({ alpha, color, type }: PrimitiveBoxProps): ReactNode => {
  let borderRadius = "0";
  if (type === "circle") {
    borderRadius = "50%";
  }
  return (
    <div
      style={{
        backgroundColor: color,
        borderRadius,
        height: "100%",
        opacity: alpha,
        width: "100%",
      }}
    />
  );
};

/**
 * Override d'un objet piloté par l'état Lua (cf. `menuStateToOverrides` dans lua-host).
 * Type local pour garder ce renderer découplé de fengari/inagle ; structurellement
 * compatible avec `MenuObjectOverride` de lua-host.
 */
export interface MenuObjectOverride {
  visible?: boolean | undefined;
  text?: string | undefined;
  number?: number | undefined;
}

interface ObjectNodeProps {
  obj: MenuObject;
  assetBase: string;
  animDelay: number;
  override?: MenuObjectOverride | undefined;
}

const ObjectNode = ({ animDelay, assetBase, obj, override }: ObjectNodeProps): ReactNode => {
  const ref = useRef<HTMLDivElement>(null);

  // Texte piloté par la logique Lua (SetText/SetNumericDisplay) — sinon valeur statique.
  const liveText = override?.text ?? (override?.number !== undefined ? String(override.number) : undefined);

  // Dimensions de l'element = sprite ou primitive ou taille texte estimee
  const spriteW = obj.sprite?.w ?? obj.primitive?.w ?? DEFAULT_SPRITE_W;
  const spriteH = obj.sprite?.h ?? obj.primitive?.h ?? DEFAULT_SPRITE_H;

  useEffect(() => {
    const el = ref.current;
    if (!el || !obj.anim?.open) {
      return;
    }
    playOpenAnim(el, animDelay);
  }, [obj.anim, animDelay]);

  // Visibilité pilotée par la logique Lua (après les hooks, règle des hooks respectée).
  if (override?.visible === false) {
    return null;
  }

  const style = objectStyle(obj, spriteW, spriteH);

  const justifyContent = (): CSSProperties["justifyContent"] => {
    if (obj.text?.align === "left") {
      return "flex-start";
    }
    if (obj.text?.align === "right") {
      return "flex-end";
    }
    return "center";
  };

  return (
    <div ref={ref} data-name={obj.name} data-camera={obj.camera} style={style}>
      {/* Sprite G4TX */}
      {obj.sprite && (
        <img
          src={assetUrl(assetBase, obj.sprite.pngUrl)}
          alt=""
          width={obj.sprite.w}
          height={obj.sprite.h}
          style={{
            display: "block",
            height: "100%",
            imageRendering: "pixelated",
            width: "100%",
          }}
          // Pas de lazy : les sprites de menu doivent s'afficher immediatement
          loading="eager"
          decoding="async"
        />
      )}

      {/* Primitive CMenuCreatePrimitiveComponent */}
      {!obj.sprite && obj.primitive && (
        <PrimitiveBox type={obj.primitive.type} color={obj.primitive.color} alpha={obj.primitive.alpha} />
      )}

      {/* Texte MenuTextSetting */}
      {obj.text && (
        <div
          style={{
            alignItems: "center",
            color: obj.text.color,
            display: "flex",
            fontFamily: `"${obj.text.font}", "Noto Sans JP", sans-serif`,
            fontSize: `${obj.text.size}px`,
            inset: 0,
            justifyContent: justifyContent(),
            lineHeight: 1.2,
            pointerEvents: "none",
            position: "absolute",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          {liveText ?? obj.text.value}
        </div>
      )}
    </div>
  );
};

/* ── conteneur responsive 1280*720 ───────────────────────────────────────── */

const useContainerScale = (containerRef: React.RefObject<HTMLDivElement | null>): number => {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const obs = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { height, width } = entry.contentRect;
      const scaleX = width / CANVAS_W;
      const scaleY = height / CANVAS_H;
      setScale(Math.min(scaleX, scaleY));
    });

    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, [containerRef]);

  return scale;
};

/* ── composant principal ──────────────────────────────────────────────────── */

export interface GameMenuProps {
  /** Layout JSON produit par `iecode menu export <screen>`. */
  layout: MenuLayout;
  /**
   * Base URL des assets PNG.
   * - Production CDN : "https://cdn.example.com"
   * - Dev local      : "/menu-assets" (dossier public Next.js ou serveur Bun)
   */
  assetBase: string;
  /**
   * Classe CSS appliquee au conteneur externe responsive.
   * Utile pour definir width/height (defaut : 100% width, ratio force).
   */
  className?: string;
  /** Style applique au conteneur externe responsive. */
  style?: CSSProperties;
  /**
   * Overrides par NOM d'objet pilotés par la logique Lua du jeu (cf.
   * `menuStateToOverrides` dans lua-host) : visibilité, texte, nombre.
   * Absent → le menu rend son layout statique ; présent → menu INTERACTIF.
   */
  overrides?: Record<string, MenuObjectOverride>;
}

/**
 * Renderer pixel-perfect d'un ecran de menu IEVR.
 *
 * Rendu :
 *  - Conteneur externe : responsive, ratio 16:9 force via aspect-ratio CSS.
 *  - Canvas interne : 1280*720 px absolu, scale via CSS transform.
 *  - Chaque object = un div absolu positionne selon transform G4PKM.
 *  - Les sprites sont des <img> chargees depuis assetBase + sprite.pngUrl.
 *  - Les textes sont rendus avec la police du jeu (nie_main) si disponible.
 *  - Les animations open sont jouees au mount (Web Animations API).
 *
 * @example
 * ```tsx
 * import layout from "@/data/50_title.layout.json";
 * <GameMenu layout={layout} assetBase="https://cdn.example.com" />
 * ```
 */
export const GameMenu = ({ assetBase, className, layout, style, overrides }: GameMenuProps): ReactNode => {
  const outerRef = useRef<HTMLDivElement>(null);
  const scale = useContainerScale(outerRef);

  // Injection @font-face une seule fois au mount
  useEffect(() => {
    injectFontFace(assetBase);
  }, [assetBase]);

  // Tri des objects par drawPriority croissant (valeur haute = au-dessus = rendu en dernier)
  const sorted = layout.objects.toSorted((a, b) => a.drawPriority - b.drawPriority);

  return (
    <div
      ref={outerRef}
      className={className}
      style={{
        aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
        backgroundColor: "#000",
        overflow: "hidden",
        position: "relative",
        width: "100%",
        ...style,
      }}
    >
      {/* Canvas interne 1280*720, centre et scale */}
      <div
        style={{
          height: `${CANVAS_H}px`,
          left: "50%",
          overflow: "visible",
          position: "absolute",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          width: `${CANVAS_W}px`,
        }}
      >
        {sorted.map((obj, i) => (
          <ObjectNode
            key={obj.name}
            obj={obj}
            assetBase={assetBase}
            // Decalage par objet (ordre drawPriority) pour un effet de cascade
            animDelay={i * OPEN_ANIM_STAGGER}
            override={overrides?.[obj.name]}
          />
        ))}
      </div>
    </div>
  );
};
