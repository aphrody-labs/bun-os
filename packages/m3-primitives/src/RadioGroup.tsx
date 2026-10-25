// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/RadioGroup.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { type StateClassName, withClassName } from "./base-ui";

export interface RootProps extends Omit<RadioGroupPrimitive.Props<string>, "className" | "onValueChange"> {
  className?: StateClassName<RadioGroupPrimitive.State>;
  onValueChange?: (value: string, eventDetails: RadioGroupPrimitive.ChangeEventDetails) => void;
}

/** Base UI radio group (`role="radiogroup"`, roving focus, arrow-key selection, hidden input). */
export const Root = forwardRef<HTMLDivElement, RootProps>(({ className, onValueChange, ...props }, ref) => {
  return (
    <RadioGroupPrimitive
      {...props}
      ref={ref}
      onValueChange={onValueChange && ((value, details) => onValueChange(value as string, details))}
      className={withClassName("space-y-3", className)}
    />
  );
});

Root.displayName = "RadioGroupRoot";

export interface ItemProps extends Omit<Radio.Root.Props<string>, "className"> {
  className?: string;
}

/**
 * An option row with an M3 radio button: 20dp ring (2dp `on-surface-variant`, `primary` when
 * selected), 10dp `primary` dot, 40dp circular state layer, 38 % when disabled. `className`
 * applies to the radio button itself, as upstream.
 */
export const Item = ({ children, className, ...props }: ItemProps) => {
  const id = props.id ?? "radio" + props.value;
  return (
    <div
      className={clsx(
        "flex max-w-sm items-center gap-4 rounded-small border border-outline-variant bg-surface-container-low px-4 py-3",
        "has-data-checked:border-primary",
        props.disabled && "opacity-38",
      )}
    >
      <Radio.Root
        id={id}
        nativeButton
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- name comes from the consumer (aria-label, aria-labelledby or associated label)
        render={<button type="button" />}
        className={clsx(
          "peer relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-on-surface-variant bg-transparent",
          "transition-colors duration-200 ease-standard",
          "data-checked:border-primary",
          // 40dp state layer.
          "before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-['']",
          "before:transition-colors before:duration-200 before:ease-standard",
          "hover:before:bg-on-surface/8 focus-visible:before:bg-on-surface/10 active:before:bg-primary/10",
          "data-checked:hover:before:bg-primary/8 data-checked:focus-visible:before:bg-primary/10",
          "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
          "data-disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <Radio.Indicator className="flex items-center justify-center">
          <span className="size-2.5 rounded-full bg-primary" />
        </Radio.Indicator>
      </Radio.Root>
      <label
        htmlFor={id}
        className="flex-1 cursor-pointer text-body-large text-on-surface peer-data-disabled:cursor-not-allowed"
      >
        {children}
      </label>
    </div>
  );
};
