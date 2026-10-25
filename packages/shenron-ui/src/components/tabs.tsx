"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type * as React from "react";

import { cn } from "../lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex flex-wrap items-center gap-2 rounded-xl p-1.5 bg-black/40 border-2 border-black/80",
        className,
      )}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "inline-flex min-h-9 items-center justify-center rounded-lg px-4 py-1.5 text-xs font-sans font-extrabold uppercase tracking-wider text-gray-300 transition-all select-none outline-none cursor-pointer",
        "border-2 border-transparent",
        "hover:border-black/60 hover:text-white hover:bg-white/5",
        "data-active:bg-dbz-orange data-active:text-black data-active:border-black data-active:active:translate-x-px data-active:active:translate-y-px",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      className={cn(
        "mt-4 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/40",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel };
