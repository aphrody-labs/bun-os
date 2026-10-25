// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Checkbox.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { type ComponentProps, forwardRef } from "react";

import { type StateClassName, withClassName } from "./base-ui";

import { Icon } from "./Icon";

/**
 * M3 checkbox anatomy shared by every checkbox here: 18dp container, 2dp corner, 2dp
 * `on-surface-variant` outline when unselected, `primary` fill with an `on-primary` glyph when
 * selected or indeterminate, `error` roles for the error state, a 40dp circular state layer and
 * 38 % opacity when disabled.
 */
const stateLayer = [
  "before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:content-['']",
  "before:transition-colors before:duration-200 before:ease-standard",
  "hover:before:bg-on-surface/8 focus-visible:before:bg-on-surface/10 active:before:bg-primary/10",
];

const focusRing = "outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const styles = cva(
  [
    "relative float-left mr-2 mt-1 size-[18px] shrink-0 cursor-pointer appearance-none rounded-[2px] border-2 border-on-surface-variant bg-transparent align-top",
    "transition-colors duration-200 ease-standard",
    stateLayer,
    focusRing,
    "checked:border-primary checked:bg-primary checked:hover:before:bg-primary/8",
    "indeterminate:border-primary indeterminate:bg-primary",
    // Check glyph (drawn with the ::after box, since a native input has no children).
    "checked:after:absolute checked:after:left-[4px] checked:after:top-[0px] checked:after:h-[10px] checked:after:w-[5px] checked:after:rotate-45 checked:after:border-b-2 checked:after:border-r-2 checked:after:border-on-primary checked:after:content-['']",
    // Indeterminate glyph.
    "indeterminate:after:absolute indeterminate:after:left-[2px] indeterminate:after:top-[6px] indeterminate:after:h-[2px] indeterminate:after:w-[10px] indeterminate:after:bg-on-primary indeterminate:after:content-['']",
    "disabled:cursor-not-allowed disabled:opacity-38",
  ],
  {
    variants: {
      error: {
        true: "border-error checked:border-error checked:bg-error checked:after:border-on-error indeterminate:border-error indeterminate:bg-error indeterminate:after:bg-on-error hover:before:bg-error/8",
      },
    },
  },
);

export interface CheckBoxProps extends ComponentProps<"input">, VariantProps<typeof styles> {}

export const CheckBox = forwardRef<HTMLInputElement, CheckBoxProps>(({ className, error, ...props }, ref) => (
  <input
    {...props}
    type="checkbox"
    data-m3-component="CheckBox"
    ref={ref}
    aria-invalid={error ? true : undefined}
    className={styles({ error, className })}
  />
));

CheckBox.displayName = "CheckBox";

const rootStyles = (error?: boolean) =>
  clsx(
    "group relative flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[2px] border-2 border-on-surface-variant bg-transparent text-on-primary",
    "transition-colors duration-200 ease-standard",
    stateLayer,
    focusRing,
    "data-checked:border-primary data-checked:bg-primary data-checked:hover:before:bg-primary/8",
    "data-indeterminate:border-primary data-indeterminate:bg-primary",
    "data-disabled:cursor-not-allowed data-disabled:opacity-38",
    error &&
      "border-error text-on-error hover:before:bg-error/8 data-checked:border-error data-checked:bg-error data-indeterminate:border-error data-indeterminate:bg-error",
  );

/** Check (checked) or dash (indeterminate), picked from the root's `data-indeterminate`. */
const Glyph = () => (
  <>
    <span className="flex group-data-indeterminate:hidden">
      <Icon name="check" size={18} weight={700} />
    </span>
    <span className="hidden group-data-indeterminate:flex">
      <Icon name="remove" size={18} weight={700} />
    </span>
  </>
);

type BaseRootProps = CheckboxPrimitive.Root.Props;

/**
 * Base UI checkbox props with the Radix value shape kept: `checked` / `defaultChecked` also
 * accept `"indeterminate"` (Base UI's `indeterminate` prop works too).
 */
export interface CheckboxRootProps extends Omit<BaseRootProps, "checked" | "defaultChecked" | "className" | "ref"> {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
  className?: StateClassName<CheckboxPrimitive.Root.State>;
  /** M3 error state (`error` outline and container). */
  error?: boolean;
}

/** Splits the Radix tri-state value into Base UI's `checked` + `indeterminate`. */
function checkedProps({ checked, defaultChecked, indeterminate }: CheckboxRootProps) {
  return {
    checked: checked === undefined ? undefined : checked === true,
    defaultChecked: defaultChecked === undefined ? undefined : defaultChecked === true,
    indeterminate: indeterminate ?? (checked === "indeterminate" || defaultChecked === "indeterminate"),
  };
}

/**
 * Base UI checkbox root with the M3 anatomy. It renders a native `<button>` (as Radix did), so a
 * sibling `<label htmlFor>` pointing at `id` works.
 */
export const CheckboxRoot = forwardRef<HTMLButtonElement, CheckboxRootProps>(
  ({ className, error, checked, defaultChecked, indeterminate, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      nativeButton
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- name comes from the consumer (aria-label, aria-labelledby or associated label)
      render={<button type="button" />}
      aria-invalid={error ? true : undefined}
      data-m3-component="CheckboxRoot"
      className={withClassName(rootStyles(error), className)}
      {...props}
      {...checkedProps({ checked, defaultChecked, indeterminate })}
    />
  ),
);

CheckboxRoot.displayName = "CheckboxRoot";

/** Base UI checkbox indicator; renders the M3 check / dash glyph when given no children. */
export const CheckboxIndicator = forwardRef<HTMLSpanElement, ComponentProps<typeof CheckboxPrimitive.Indicator>>(
  ({ className, children, ...props }, ref) => (
    <CheckboxPrimitive.Indicator
      ref={ref}
      className={withClassName("flex items-center justify-center", className)}
      {...props}
    >
      {children ?? <Glyph />}
    </CheckboxPrimitive.Indicator>
  ),
);

CheckboxIndicator.displayName = "CheckboxIndicator";

export interface RadixCheckboxProps extends CheckboxRootProps {
  label?: string;
  labelClassName?: string;
}

/**
 * Checkbox with an optional trailing label (name kept from upstream; it is Base UI underneath).
 * `className` goes on the row, the label is tied to the control through `name`.
 */
export const RadixCheckbox = ({ className, labelClassName, label, error, ...props }: RadixCheckboxProps) => (
  <div className={clsx("flex items-center", typeof className === "string" && className)}>
    <CheckboxRoot id={props.name} error={error} {...props}>
      <CheckboxIndicator />
    </CheckboxRoot>
    {label && (
      <label
        className={clsx(
          "ml-3 text-body-medium",
          error ? "text-error" : "text-on-surface",
          props.disabled && "opacity-38",
          labelClassName,
        )}
        htmlFor={props.name}
      >
        {label}
      </label>
    )}
  </div>
);
