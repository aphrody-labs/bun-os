// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 Accordion primitive built on Base UI (@base-ui/react/accordion).
"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { type AsChildProp, asChildProps, withClassName } from "./base-ui";
import { Icon } from "./Icon";

export type AccordionRootProps = AccordionPrimitive.Root.Props & {
  variant?: "outlined" | "elevated" | "filled" | "tonal";
};

export const AccordionRoot = forwardRef<HTMLDivElement, AccordionRootProps>(
  ({ className, variant = "outlined", ...props }, ref) => {
    const variantStyles = {
      outlined: "border border-outline-variant divide-y divide-outline-variant rounded-large bg-surface",
      elevated: "rounded-large bg-surface-container-low shadow-elevation-1 divide-y divide-outline-variant/30",
      filled: "rounded-large bg-surface-container divide-y divide-outline-variant/30",
      tonal: "rounded-large bg-secondary-container/40 divide-y divide-outline-variant/30",
    }[variant];

    return (
      <AccordionPrimitive.Root
        ref={ref}
        className={withClassName(clsx("w-full overflow-hidden transition-all duration-200", variantStyles), className)}
        data-m3-component="Accordion"
        {...props}
      />
    );
  },
);
AccordionRoot.displayName = "AccordionRoot";

export type AccordionItemProps = AccordionPrimitive.Item.Props;

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={withClassName(
      "group/item transition-colors duration-200 first:rounded-t-large last:rounded-b-large",
      className,
    )}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

export type AccordionHeaderProps = AccordionPrimitive.Header.Props;

export const AccordionHeader = forwardRef<HTMLHeadingElement, AccordionHeaderProps>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Header ref={ref} className={withClassName("m-0 flex items-center", className)} {...props} />
));
AccordionHeader.displayName = "AccordionHeader";

export interface AccordionTriggerProps extends AccordionPrimitive.Trigger.Props, AsChildProp {
  /** Trailing expand icon. Defaults to true. */
  indicator?: boolean;
}

export const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ className, children, indicator = true, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <AccordionPrimitive.Trigger
        ref={ref}
        className={withClassName(
          clsx(
            "group/trigger flex min-h-14 w-full items-center justify-between gap-4 px-5 text-left",
            "text-title-medium font-medium text-on-surface",
            "transition-colors duration-200 ease-standard hover:bg-on-surface/8 active:bg-on-surface/12",
            "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
            "disabled:cursor-not-allowed disabled:opacity-38 data-disabled:cursor-not-allowed data-disabled:opacity-38",
          ),
          className,
        )}
        render={child.render}
        nativeButton={child.nativeButton}
        data-m3-component="AccordionTrigger"
        {...props}
      >
        {child.render ? undefined : (
          <>
            <span className="flex-1">{children}</span>
            {indicator && (
              <span className="flex shrink-0 text-on-surface-variant transition-transform duration-300 ease-emphasized group-data-panel-open/item:rotate-180">
                <Icon name="expand_more" size={24} />
              </span>
            )}
          </>
        )}
      </AccordionPrimitive.Trigger>
    );
  },
);
AccordionTrigger.displayName = "AccordionTrigger";

export type AccordionPanelProps = AccordionPrimitive.Panel.Props;

export const AccordionPanel = forwardRef<HTMLDivElement, AccordionPanelProps>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Panel
      ref={ref}
      className={withClassName(
        clsx(
          "overflow-hidden text-body-medium text-on-surface-variant",
          "h-[var(--accordion-panel-height)] transition-[height,opacity] duration-300 ease-emphasized",
          "data-[ending-style]:h-0 data-[ending-style]:opacity-0",
          "data-[starting-style]:h-0 data-[starting-style]:opacity-0",
        ),
        className,
      )}
      {...props}
    >
      <div className="px-5 pb-5 pt-1">{children}</div>
    </AccordionPrimitive.Panel>
  ),
);
AccordionPanel.displayName = "AccordionPanel";

export const Accordion = {
  Root: AccordionRoot,
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Panel: AccordionPanel,
};
