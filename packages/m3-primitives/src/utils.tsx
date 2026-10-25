// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/utils.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import React from "react";

const twFactory =
  (element: any) =>
  ([newClassNames]: TemplateStringsArray) =>
    React.forwardRef(({ className, ...props }: any, ref) =>
      React.createElement(element, {
        ...props,
        className: clsx(newClassNames, className),
        ref,
      }),
    );

type ClassnameFactory<T> = (s: TemplateStringsArray) => T;

type TailwindFactory = {
  [K in keyof React.JSX.IntrinsicElements]: ClassnameFactory<
    React.ForwardRefExoticComponent<React.JSX.IntrinsicElements[K]>
  >;
} & {
  <T>(c: T): ClassnameFactory<T>;
};

export const tw = new Proxy((() => {}) as unknown as TailwindFactory, {
  get: (_, property: string) => twFactory(property),
  apply: (_, __, [el]: [React.ReactElement]) => twFactory(el),
});

/**
 * M3 state layer: a `::before` overlay in the element's content color (`currentColor`) at the M3
 * state opacities (hover 8 %, focus 10 %, pressed 10 %). It works on any container color, so a
 * filled button gets `on-primary` over `primary` without a second background utility. The host
 * must be `relative` (included).
 */
export const m3StateLayer = [
  "relative",
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-current before:opacity-0",
  "before:transition-opacity before:duration-200 before:ease-standard",
  "motion-reduce:before:transition-none",
  "hover:before:opacity-8 focus-visible:before:opacity-10 active:before:opacity-10",
  "disabled:before:hidden aria-disabled:before:hidden",
].join(" ");

/** M3 focus indicator: 3 dp `secondary` outline, 2 dp offset, keyboard focus only. */
export const m3FocusRing =
  "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2";
