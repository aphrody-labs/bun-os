// SPDX-License-Identifier: Apache-2.0
// Unified Aphrody UI - Canonical exports for the shell and M3 integration.

// oxlint-disable-next-line import/no-unassigned-import -- feuille de style globale de l'UI (effet de bord voulu)
import "./styles.css";

export { Shell } from "./Shell";
export { FilesRoute, registerFilesSurface } from "./routes/files";
export { ShellLayout } from "./ShellLayout";
export { CommandPalette } from "./CommandPalette";
export { QuickBar } from "./quickbar";
export { explorerRoutes } from "./router";
export type { RouteObject } from "react-router-dom";
export { ErrorBoundary } from "./components/ErrorBoundary";
export { FloatingControls } from "./windows/FloatingControls";
export { Settings } from "./routes/settings";
export { TopBarProvider, TopBarPortal, useTopBar } from "./TopBar";

// Platform abstraction
export type { Platform } from "./contexts/PlatformContext";
export { PlatformProvider, usePlatform } from "./contexts/PlatformContext";

// Context

// Hooks
export { useContextMenu } from "./hooks/useContextMenu";
export type { ContextMenuItem, ContextMenuConfig } from "./hooks/useContextMenu";

// Keybind hooks
export { useKeybind } from "./hooks/useKeybind";
export type { KeybindHandler, UseKeybindOptions } from "./hooks/useKeybind";
export { useKeybindScope, isScopeActive } from "./hooks/useKeybindScope";
export { useKeybindMeta, useKeybindDisplayString } from "./hooks/useKeybindMeta";
export type { KeybindMeta } from "./hooks/useKeybindMeta";


// Keybind utilities
export {
  KEYBINDS,
  getKeybind,
  getAllKeybinds,
  getKeybindsByScope,
  getCurrentPlatform,
  getComboForPlatform,
  toDisplayString,
} from "./util/keybinds";
export type { KeybindId, KeybindScope, KeybindDefinition, KeyCombo } from "./util/keybinds";
