// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Tabs.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { clsx } from "clsx";

import { withClassName } from "./base-ui";

export type RootProps = TabsPrimitive.Root.Props;

export const Root = ({ className, ...props }: RootProps) => (
  <TabsPrimitive.Root className={withClassName("flex flex-col", className)} data-m3-component="Tabs" {...props} />
);

export type ContentProps = TabsPrimitive.Panel.Props;

/** Tab panel (Base UI `Tabs.Panel`); `keepMounted` keeps inactive panels in the DOM. */
export const Content = ({ className, ...props }: ContentProps) => (
  <TabsPrimitive.Panel
    className={withClassName(
      "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
      className,
    )}
    data-m3-component="TabsContent"
    {...props}
  />
);

export type ListProps = TabsPrimitive.List.Props;

/**
 * M3 primary tab bar: tabs share the row, 1dp `outline-variant` divider underneath. Arrow keys
 * activate the focused tab (`activateOnFocus`, Radix `activationMode="automatic"`); pass
 * `activateOnFocus={false}` for manual activation.
 */
export const List = ({ className, activateOnFocus = true, ...props }: ListProps) => (
  <TabsPrimitive.List
    activateOnFocus={activateOnFocus}
    className={withClassName("relative flex flex-row items-center border-b border-outline-variant", className)}
    data-m3-component="TabsList"
    {...props}
  />
);

export interface TriggerProps extends TabsPrimitive.Tab.Props {
  /** `md`: M3 baseline 48dp tab. `sm`: 32dp density step for dense toolbars. */
  size?: "sm" | "md";
}

/**
 * M3 primary tab: `label-large`, `on-surface-variant` inactive, `primary` active with a 3dp
 * `primary` indicator (rounded top) and hover / focus / pressed state layers.
 */
export const Trigger = ({ className, size = "md", ...props }: TriggerProps) => (
  <TabsPrimitive.Tab
    className={withClassName(
      clsx(
        "relative -mb-px inline-flex items-center justify-center gap-2 whitespace-nowrap",
        size === "sm" ? "h-8 px-3" : "h-12 px-4",
        "text-label-large text-on-surface-variant outline-none",
        "transition-colors duration-200 ease-standard hover:text-on-surface",
        "data-active:text-primary data-active:hover:text-primary",
        // State layer.
        "before:pointer-events-none before:absolute before:inset-0 before:content-['']",
        "before:transition-colors before:duration-200 before:ease-standard",
        "hover:before:bg-on-surface/8 focus-visible:before:bg-on-surface/10 active:before:bg-on-surface/10",
        "data-active:hover:before:bg-primary/8 data-active:focus-visible:before:bg-primary/10 data-active:active:before:bg-primary/10",
        // Active indicator: 3dp, rounded top corners.
        "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-[3px] after:bg-primary after:opacity-0 after:content-['']",
        "after:transition-opacity after:duration-200 after:ease-standard data-active:after:opacity-100",
        "focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-secondary",
        "data-disabled:pointer-events-none data-disabled:opacity-38",
      ),
      className,
    )}
    data-m3-component="TabsTrigger"
    {...props}
  />
);

export type IndicatorProps = TabsPrimitive.Indicator.Props;

/**
 * Sliding M3 active indicator (Base UI `Tabs.Indicator`): a 3dp `primary` bar that follows the
 * active tab with the emphasized easing. Place it inside `List`; pair it with triggers whose
 * own indicator is hidden (`className="after:hidden"`).
 */
export const Indicator = ({ className, ...props }: IndicatorProps) => (
  <TabsPrimitive.Indicator
    className={withClassName(
      clsx(
        "absolute bottom-0 left-(--active-tab-left) h-[3px] w-(--active-tab-width) rounded-t-[3px] bg-primary",
        "transition-[left,width] duration-300 ease-emphasized",
      ),
      className,
    )}
    {...props}
  />
);
