// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 custom ScrollArea primitive built on Base UI (@base-ui/react/scroll-area).
"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { withClassName } from "./base-ui";

export type ScrollAreaRootProps = ScrollAreaPrimitive.Root.Props;

export const ScrollAreaRoot = forwardRef<HTMLDivElement, ScrollAreaRootProps>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={withClassName("relative overflow-hidden", className)} {...props} />
));
ScrollAreaRoot.displayName = "ScrollAreaRoot";

export type ScrollAreaViewportProps = ScrollAreaPrimitive.Viewport.Props;

export const ScrollAreaViewport = forwardRef<HTMLDivElement, ScrollAreaViewportProps>(
  ({ className, ...props }, ref) => (
    <ScrollAreaPrimitive.Viewport
      ref={ref}
      className={withClassName(
        "size-full rounded-[inherit] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary",
        className,
      )}
      {...props}
    />
  ),
);
ScrollAreaViewport.displayName = "ScrollAreaViewport";

export type ScrollAreaScrollbarProps = ScrollAreaPrimitive.Scrollbar.Props;

export const ScrollAreaScrollbar = forwardRef<HTMLDivElement, ScrollAreaScrollbarProps>(
  ({ className, orientation = "vertical", ...props }, ref) => (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      className={withClassName(
        clsx(
          "flex select-none touch-none p-0.5 transition-all duration-200 ease-standard",
          orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent hover:w-3.5",
          orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent hover:h-3.5",
          "data-[hovering]:opacity-100 data-[scrolling]:opacity-100 opacity-60 hover:opacity-100",
        ),
        className,
      )}
      {...props}
    />
  ),
);
ScrollAreaScrollbar.displayName = "ScrollAreaScrollbar";

export type ScrollAreaThumbProps = ScrollAreaPrimitive.Thumb.Props;

export const ScrollAreaThumb = forwardRef<HTMLDivElement, ScrollAreaThumbProps>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Thumb
    ref={ref}
    className={withClassName(
      clsx(
        "relative flex-1 rounded-full bg-outline-variant/60 transition-colors duration-150",
        "hover:bg-outline-variant/90 active:bg-outline",
      ),
      className,
    )}
    {...props}
  />
));
ScrollAreaThumb.displayName = "ScrollAreaThumb";

export type ScrollAreaCornerProps = ScrollAreaPrimitive.Corner.Props;

export const ScrollAreaCorner = forwardRef<HTMLDivElement, ScrollAreaCornerProps>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Corner ref={ref} className={withClassName("bg-transparent", className)} {...props} />
));
ScrollAreaCorner.displayName = "ScrollAreaCorner";

export const ScrollArea = {
  Root: ScrollAreaRoot,
  Viewport: ScrollAreaViewport,
  Scrollbar: ScrollAreaScrollbar,
  Thumb: ScrollAreaThumb,
  Corner: ScrollAreaCorner,
};
