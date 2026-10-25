// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Switch.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { type StateClassName, withClassName } from "./base-ui";

import { Icon } from "./Icon";

/**
 * M3 switch on Base UI (a native `<button>` with a hidden checkbox input). `md` and `lg` are the M3 baseline (track 52×32dp, handle 16dp off, 24dp on, 28dp
 * pressed); `sm` is a density step (track 40×24dp, handle 12 / 16 / 20dp) for dense desktop rows.
 */
export interface SwitchProps extends VariantProps<typeof switchStyles>, Omit<SwitchPrimitive.Root.Props, "className"> {
  className?: StateClassName<SwitchPrimitive.Root.State>;
  thumbClassName?: string;
  /** Show a `check` icon in the handle when selected (M3 "icons" switch). */
  icons?: boolean;
}

const switchStyles = cva(
  [
    "group relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2",
    "transition-colors duration-200 ease-standard",
    // Unselected: surface-container-highest track, outline border.
    "border-outline bg-surface-container-highest",
    // Selected: primary track.
    "data-checked:border-primary data-checked:bg-primary",
    "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
    "data-disabled:cursor-not-allowed data-disabled:opacity-38",
  ],
  {
    variants: {
      size: {
        sm: "h-6 w-10",
        md: "h-8 w-[52px]",
        lg: "h-8 w-[52px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const thumbStyles = cva(
  [
    "pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full",
    "transition-[left,width,height,background-color] duration-200 ease-standard",
    // Handle colors: outline off, on-primary on; hover darkens as in M3.
    "bg-outline group-hover:bg-on-surface-variant",
    "data-checked:bg-on-primary group-hover:data-checked:bg-primary-container",
    // 40dp state layer centered on the handle.
    "before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-['']",
    "before:transition-colors before:duration-200 before:ease-standard",
    "group-hover:before:bg-on-surface/8 group-focus-visible:before:bg-on-surface/10 group-active:before:bg-on-surface/10",
    "data-checked:group-hover:before:bg-primary/8 data-checked:group-focus-visible:before:bg-primary/10 data-checked:group-active:before:bg-primary/10",
  ],
  {
    variants: {
      size: {
        // Positions are relative to the padding box (inside the 2dp border).
        sm: [
          "left-[4px] size-3 before:size-8",
          "data-checked:left-[18px] data-checked:size-4",
          "group-active:left-[0px] group-active:size-5 data-checked:group-active:left-[16px] data-checked:group-active:size-5",
        ],
        md: [
          "left-[6px] size-4 before:size-10",
          "data-checked:left-[22px] data-checked:size-6",
          "group-active:left-[0px] group-active:size-7 data-checked:group-active:left-[20px] data-checked:group-active:size-7",
        ],
        lg: [
          "left-[6px] size-4 before:size-10",
          "data-checked:left-[22px] data-checked:size-6",
          "group-active:left-[0px] group-active:size-7 data-checked:group-active:left-[20px] data-checked:group-active:size-7",
        ],
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ size, className, thumbClassName, icons, ...props }, ref) => (
    <SwitchPrimitive.Root
      nativeButton
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- name comes from the consumer (aria-label, aria-labelledby or associated label)
      render={<button type="button" />}
      data-m3-component="Switch"
      {...props}
      ref={ref}
      className={withClassName(switchStyles({ size }), className)}
    >
      <SwitchPrimitive.Thumb className={thumbStyles({ size, className: thumbClassName })}>
        {icons && (
          <Icon
            name="check"
            size={size === "sm" ? 12 : 16}
            className="relative text-on-primary-container opacity-0 transition-opacity duration-200 ease-standard group-data-checked:opacity-100"
          />
        )}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  ),
);

Switch.displayName = "Switch";
