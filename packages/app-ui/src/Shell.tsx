// SPDX-License-Identifier: Apache-2.0
import type { RouteObject } from "react-router-dom";
import { RouterProvider } from "react-router-dom";
import { Dialogs, Toaster, TooltipProvider } from "@aphrody/m3-primitives";

import { explorerRoutes } from "./router";
import { TabManagerProvider, TabKeyboardHandler, useTabManager } from "./components/TabManager";
import { useTheme } from "./hooks/useTheme";

export interface ShellProps {
  embedded?: boolean;
  routes?: RouteObject[];
}

function ThemeApplier() {
  useTheme();
  return null;
}

function ShellWithTabs({ embedded = false }: { embedded?: boolean }) {
  const { router } = useTabManager();

  return (
    <>
      {!embedded && <ThemeApplier />}
      <RouterProvider router={router} />
    </>
  );
}

export function Shell({ embedded = false, routes }: ShellProps) {
  return (
    <TooltipProvider>
      <TabManagerProvider routes={routes ?? explorerRoutes}>
        <TabKeyboardHandler />
        <ShellWithTabs embedded={embedded} />
      </TabManagerProvider>
      <Dialogs />
      <Toaster />
    </TooltipProvider>
  );
}
