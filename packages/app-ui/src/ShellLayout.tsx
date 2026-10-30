// SPDX-License-Identifier: Apache-2.0
import { clsx } from "clsx";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "./components/AppSidebar";
import { TabBar, TabNavigationSync } from "./components/TabManager";
import { usePlatform } from "./contexts/PlatformContext";
import { WebContextMenuProvider } from "./contexts/WebContextMenuContext";
import { TopBar, TopBarProvider } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { useMenuCommands } from "./menu-commands";
import { useOpenRequests } from "./use-open-requests";
import { NARROW_QUERY, Rail, RailDrawer, useMediaQuery } from "./rail-drawer";

function ShellLayoutContent() {
  useMenuCommands();
  useOpenRequests();
  const platform = usePlatform();

  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer when leaving the narrow layout (state adjusted during render, not in an effect).
  const [prevNarrow, setPrevNarrow] = useState(narrow);
  if (narrow !== prevNarrow) {
    setPrevNarrow(narrow);
    if (!narrow) setDrawerOpen(false);
  }
  const railWidth = narrow ? 0 : 280;

  return (
    <div
      className={clsx(
        // M3 scaffold: the window is the surface; the navigation drawer sits on surface-container-low
        // beside the content pane.
        "app-shell text-on-surface bg-surface font-plain text-body-medium relative flex h-full min-h-0 select-none flex-col overflow-hidden border border-transparent",
        platform.platform === "tauri" && "rounded-medium",
      )}
    >
      {/* Top fade mask - spans full width beyond the rail */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[37] h-32 bg-gradient-to-b from-surface to-transparent" />

      {narrow && (
        <button
          type="button"
          className="app-rail-trigger text-on-surface hover:bg-on-surface/8 absolute left-1 top-0 z-[70] flex size-12 items-center justify-center rounded-full"
          aria-label="Ouvrir l'historique et les espaces"
          aria-controls="app-rail"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <span className="material-symbol" aria-hidden="true">
            menu
          </span>
        </button>
      )}
      <TopBar sidebarWidth={narrow ? 56 : railWidth} inspectorWidth={0} isPreviewActive={false} />

      <div className="flex flex-1 overflow-hidden">
        {narrow ? (
          <RailDrawer open={drawerOpen} onOpenChange={setDrawerOpen} label="Historique et espaces">
            <AppSidebar isPreviewActive={false} />
          </RailDrawer>
        ) : (
          <Rail expanded label="Historique et espaces">
            <AppSidebar isPreviewActive={false} />
          </Rail>
        )}

        <div
          className="relative z-[38] flex flex-1 flex-col overflow-hidden pt-12"
          inert={(narrow && drawerOpen) || undefined}
        >
          <TabBar />
          <div className="relative flex-1 overflow-hidden">
            <Outlet />
          </div>
        </div>
      </div>

      {/* Command Palette (Ctrl+K / Cmd+K Spotlight unified launcher) */}
      <CommandPalette />
    </div>
  );
}

export function ShellLayout() {
  return (
    <TopBarProvider>
      <WebContextMenuProvider>
        {/* Sync tab navigation with the router */}
        <TabNavigationSync />
        <ShellLayoutContent />
      </WebContextMenuProvider>
    </TopBarProvider>
  );
}
