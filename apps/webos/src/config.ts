// SPDX-License-Identifier: Apache-2.0
// The one configuration module of the desktop: canonical origin, service hosts and deep-link paths
// (infra/config/routes.catalog.json) and the app map (apps/webos/apps.json). Shell, Worker and build read
// host names, paths and default lists from here, never from literals of their own.
import routes from "../../../infra/config/routes.catalog.json";
import appMap from "../apps.json";

export interface RouteEntry {
  kind: string;
  path?: string;
  keep: boolean;
  passthrough?: boolean;
  role?: string;
}
export interface RouteCatalog {
  origin: string;
  source: string;
  memberPath: string;
  hosts: Record<string, RouteEntry>;
  apps: Record<string, string>;
}
export const ROUTES = routes as RouteCatalog;
export const ORIGIN = ROUTES.origin;

/** App UI route opened as a desktop window (/workspace/<route>). */
export interface WorkspaceRoute {
  id: string;
  route: string;
  name: string;
  icon: string;
  desc: string;
}
export type MemberKind =
  "web" | "native" | "cli" | "server" | "android" | "library" | "example";
export interface MemberConfig {
  kind?: MemberKind;
  desc?: string;
  /** Desktop app or package this member is, opened directly (kind web). */
  opens?: string;
  /** Desktop app or package that is the in-browser counterpart of a native member. */
  related?: string;
  /** Artifact name on the downloads service when it differs from the member id. */
  artifact?: string;
}
export interface WebApp {
  id: string;
  name: string;
  url: string;
  /** Alt+Shift+<letter> opens it (a KeyboardEvent.code). */
  key?: string;
}
interface AppMap {
  workspace: WorkspaceRoute[];
  members: Record<string, MemberConfig>;
  webapps: WebApp[];
  browser: { search: string; bookmarks: [string, string][] };
}
export const APPS = appMap as unknown as AppMap;
export const WORKSPACE_ROUTES = APPS.workspace;
export const DEFAULT_WEBAPPS = APPS.webapps;

/** Registrable domains of the catalogue (aphrody.com, aphrody.app). */
const OWN_DOMAINS = new Set(
  [new URL(ORIGIN).hostname, ...Object.keys(ROUTES.hosts)].map((host) =>
    host.split(".").slice(-2).join("."),
  ),
);
/** Hostnames that belong to Aphrody: the catalogued domains and their subdomains. */
export function ownHost(hostname: string): boolean {
  return [...OWN_DOMAINS].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

/** https origin of the kept service host with this role (for example "downloads"). */
export function serviceOrigin(role: string): string | undefined {
  const host = Object.entries(ROUTES.hosts).find(
    ([, entry]) => entry.keep && entry.role === role,
  )?.[0];
  return host ? `https://${host}` : undefined;
}

/** Public browse URL of a repository path such as apps/webos. */
export const sourceUrl = (path: string) =>
  `${ROUTES.source}/${path.split("/").map(encodeURIComponent).join("/")}`;

const PATH_BY_APP = new Map(
  Object.entries(ROUTES.apps).map(([path, id]) => [id, path]),
);
/** Member windows use the id prefix src: so they never collide with desktop apps or packages. */
export const memberAppId = (member: string) => `src:${member}`;

/** Deep-link path of a desktop app, App UI route, package or monorepo member. */
export function appPath(id: string): string | undefined {
  if (id.startsWith("inv:"))
    return `/inventory/${id.slice(4).split("/").map(encodeURIComponent).join("/")}`;
  if (id.startsWith("src:"))
    return `${ROUTES.memberPath}${encodeURIComponent(id.slice(4))}`;
  return PATH_BY_APP.get(id);
}

/** App opened by a path of the canonical origin ("/pdf/" and "/pdf" are the same). */
export function appForPath(pathname: string): string | undefined {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  const direct = ROUTES.apps[path];
  if (direct) return direct;
  // /inventory opens the Atlas; /inventory/<kind>[/<id>] opens that kind or member (window id inv:<kind>[/<id>]).
  if (path === "/inventory") return "workspace";
  if (path.startsWith("/inventory/")) {
    try {
      return `inv:${decodeURIComponent(path.slice("/inventory/".length))}`;
    } catch {
      return undefined;
    }
  }
  if (path.startsWith(ROUTES.memberPath)) {
    const member = decodeURIComponent(path.slice(ROUTES.memberPath.length));
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(member)) return memberAppId(member);
  }
  return undefined;
}
