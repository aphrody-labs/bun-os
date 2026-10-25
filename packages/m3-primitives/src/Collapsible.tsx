// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Collapsible.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { clsx } from "clsx";
import { type FC, forwardRef } from "react";

import { type AsChildProp, asChildProps, withClassName } from "./base-ui";
import { Icon } from "./Icon";

export type CollapsibleProps = CollapsiblePrimitive.Root.Props;

/**
 * M3 expansion panel on Base UI. Base UI keeps the panel mounted through its exit transition,
 * so the content expands with `emphasizedDecelerate` (medium4) and collapses with
 * `emphasizedAccelerate` (short4) in plain CSS, from the measured `--collapsible-panel-height`.
 */
const Collapsible: FC<CollapsibleProps> = ({ className, ...props }) => (
  <CollapsiblePrimitive.Root
    className={withClassName("rounded-medium", className)}
    data-m3-component="Collapsible"
    {...props}
  />
);

export interface CollapsibleTriggerProps extends CollapsiblePrimitive.Trigger.Props, AsChildProp {
  /** Trailing `expand_more` indicator that rotates when open. Default `true`. */
  indicator?: boolean;
}

const CollapsibleTrigger = forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ className, children, indicator = true, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <CollapsiblePrimitive.Trigger
        ref={ref}
        className={withClassName(
          clsx(
            "group flex min-h-12 w-full items-center justify-between gap-4 px-4 text-left",
            "rounded-medium text-title-small text-on-surface",
            "transition-colors duration-200 ease-standard hover:bg-on-surface/8 active:bg-on-surface/10",
            "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
            "disabled:cursor-not-allowed disabled:opacity-38 data-disabled:cursor-not-allowed data-disabled:opacity-38",
          ),
          className,
        )}
        render={child.render}
        nativeButton={child.nativeButton}
        {...props}
      >
        {child.render ? undefined : (
          <>
            {children}
            {indicator && (
              <span className="flex shrink-0 text-on-surface-variant transition-transform duration-300 ease-emphasized group-data-panel-open:rotate-180">
                <Icon name="expand_more" size={24} />
              </span>
            )}
          </>
        )}
      </CollapsiblePrimitive.Trigger>
    );
  },
);

CollapsibleTrigger.displayName = "CollapsibleTrigger";

export interface CollapsibleContentProps extends CollapsiblePrimitive.Panel.Props {
  /** Radix name for Base UI `keepMounted`: keep the closed content in the DOM (hidden). */
  forceMount?: boolean;
}

const CollapsibleContent = forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ className, forceMount, keepMounted, ...props }, ref) => (
    <CollapsiblePrimitive.Panel
      ref={ref}
      keepMounted={keepMounted ?? forceMount}
      className={withClassName(
        clsx(
          "h-(--collapsible-panel-height) overflow-hidden opacity-100",
          "transition-[height,opacity]",
          "data-open:duration-400 data-open:ease-emphasized-decelerate",
          "data-closed:duration-200 data-closed:ease-emphasized-accelerate",
          "data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0",
        ),
        className,
      )}
      {...props}
    />
  ),
);

CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
