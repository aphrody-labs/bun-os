import { useMemo, useSyncExternalStore } from "react";

// Canvas renderers (Konva, 2D canvas, three.js) cannot resolve CSS custom
// properties, so they read the active M3 roles (--md-sys-color-*,
// --md-ext-color-*) as concrete colours through a probe element and re-read
// them whenever the theme on <html> or the OS colour scheme changes.

export type RoleName = string;
export type RoleSpec = RoleName | readonly [RoleName, number];

const probeColor = (role: RoleName): [number, number, number] | null => {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("span");
  const ns = /(^|-)(success|warning)(-|$)/.test(role) ? "ext" : "sys";
  probe.style.color = `var(--md-${ns}-color-${role})`;
  probe.style.display = "none";
  document.documentElement.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const channels = computed.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return null;
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
};

/** The role as an `rgb()`/`rgba()` string a canvas understands. */
export const resolveRoleColor = (role: RoleName, alpha = 1): string => {
  const rgb = probeColor(role);
  if (!rgb) return "transparent";
  const [r, g, b] = rgb.map(Math.round);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// One theme observer shared by every subscriber; `version` changes whenever the
// theme may have changed.
let version = 0;
const listeners = new Set<() => void>();
let stopObserving: (() => void) | null = null;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (!stopObserving) {
    const bump = () => {
      version += 1;
      for (const l of listeners) l();
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    stopObserving = () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopObserving) {
      stopObserving();
      stopObserving = null;
    }
  };
};

const getVersion = () => version;

/**
 * Resolves a set of roles (`{ key: "primary" }` or `{ key: ["primary", 0.08] }`)
 * to canvas colours and keeps them in sync with the active theme.
 */
export const useRoleColors = <K extends string>(spec: Record<K, RoleSpec>): Record<K, string> => {
  const themeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = JSON.stringify(spec);
  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(spec as Record<string, RoleSpec>).map(([name, value]) => {
          const [role, alpha] = typeof value === "string" ? [value, 1] : value;
          return [name, resolveRoleColor(role, alpha)];
        }),
      ) as Record<K, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, themeVersion],
  );
};
