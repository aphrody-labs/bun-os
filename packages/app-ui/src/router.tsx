// SPDX-License-Identifier: Apache-2.0
// Unified Workstation Router - Chat, Files and Models.
// Zero AI slop, zero dead routes, zero mock data.

import { createBrowserRouter, Navigate } from "react-router-dom";
import { appBasePath } from "./app-base";
import { legacyRouteRedirects } from "./desktop-navigation";
import { CodexChatRoute } from "./codex-chat";
import { ModelsHub } from "./models-hub";
import { GamesRoute } from "./routes/games";
import { StudioRoute } from "./routes/studio";
import { TerminalRoute } from "./routes/terminal/TerminalRoute";
import { AdminRoute } from "./routes/admin";
import { CreatorRoute } from "./routes/creator";
import { FilesRoute } from "./routes/files";
import { Settings } from "./routes/settings";
import { ShellLayout } from "./ShellLayout";
import {
  AppearanceRedirect,
  DocumentsRoute,
  MaterialRoute,
  LegacyShowcaseRedirect,
  ProductHome,
  ProductNotFound,
  TemplatesRoute,
} from "./routes/product";

/**
 * Unified application routes for the Aphrody Shell:
 * - "/": the public Aphrody product home
 * - "/os": the shared desktop/browser file explorer surface
 * - "/explorer": Files surface (Spacedrive file service, mounted by the host)
 * - "/chat": Codex Chat (pixel-perfect Codex parity timeline + composer)
 * - "/models": Local Models Lifecycle & Hardware Telemetry
 * - "/settings": Desktop Preferences & Environment
 */
export const explorerRoutes = [
  {
    path: "/",
    element: <ShellLayout />,
    children: [
      {
        index: true,
        element: <ProductHome />,
      },
      {
        path: "docs/:id?",
        element: <DocumentsRoute />,
      },
      {
        path: "templates/:id?",
        element: <TemplatesRoute />,
      },
      {
        path: "material-3/:page?",
        element: <MaterialRoute />,
      },
      {
        path: "showcase/:page?",
        element: <LegacyShowcaseRedirect />,
      },
      {
        path: "chat",
        element: <CodexChatRoute />,
      },
      {
        path: "codex",
        element: <Navigate to={legacyRouteRedirects.codex} replace />,
      },
      {
        path: "os",
        element: <FilesRoute />,
      },
      {
        path: "explorer",
        element: <FilesRoute />,
      },
      {
        path: "models",
        element: <ModelsHub />,
      },
      {
        path: "games/:core?",
        element: <GamesRoute />,
      },
      {
        path: "terminal",
        element: <TerminalRoute />,
      },
      {
        path: "studio",
        element: <StudioRoute />,
      },
      {
        path: "creator",
        element: <CreatorRoute />,
      },
      {
        path: "admin",
        element: <AdminRoute />,
      },
      {
        path: "favorites",
        element: <Navigate to={legacyRouteRedirects.favorites} replace />,
      },
      {
        path: "files/*",
        element: <FilesRoute />,
      },
      {
        path: "recents",
        element: <Navigate to={legacyRouteRedirects.files} replace />,
      },
      {
        path: "search",
        element: <Navigate to={legacyRouteRedirects.search} replace />,
      },
      {
        path: "tasks",
        element: <Navigate to={legacyRouteRedirects.tasks} replace />,
      },
      {
        path: "settings",
        element: <Settings embedded />,
      },
      {
        path: "settings/appearance",
        element: <AppearanceRedirect />,
      },
      {
        path: "*",
        element: <ProductNotFound />,
      },
    ],
  },
];

/**
 * Router instance for the main desktop interface
 */
export function createExplorerRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(explorerRoutes, { basename: appBasePath() });
}
