// SPDX-License-Identifier: MIT
/**
 * `bun:winget`: the Windows Package Manager through its COM/WinRT API (Microsoft.Management.Deployment), in process
 * through bunos_windows.dll (C# Native AOT) instead of parsing winget.exe output. Every operation is asynchronous
 * (a library thread does the COM work); results are structured objects.
 */
import { call, callAsync } from "./native.ts";

export interface WingetSource {
  name: string;
  id: string;
  type: string;
  argument: string;
  origin: string;
  trustLevel: string;
  explicit: boolean;
  lastUpdate: string;
}

export interface WingetPackage {
  id: string;
  name: string;
  /** Default install version in the catalog. */
  version?: string;
  installedVersion?: string;
  source?: string;
  installed: boolean;
  updateAvailable: boolean;
}

export interface WingetDetails {
  id: string;
  name: string;
  version?: string;
  installedVersion?: string;
  publisher?: string;
  author?: string;
  description?: string;
  shortDescription?: string;
  license?: string;
  licenseUrl?: string;
  packageUrl?: string;
  publisherUrl?: string;
  releaseNotesUrl?: string;
  tags?: string[];
  versions: string[];
}

export interface WingetResult {
  action: "install" | "upgrade" | "uninstall";
  id: string;
  status: string;
  ok: boolean;
  rebootRequired?: boolean;
  installerErrorCode?: number;
  uninstallerErrorCode?: number;
  extendedError?: string;
  installedVersion?: string;
}

export interface WingetProgress {
  action: string;
  state: string;
  bytesDownloaded?: number;
  bytesRequired?: number;
  downloadProgress?: number;
  installationProgress?: number;
  uninstallationProgress?: number;
}

export interface QueryOptions {
  /** Source name (`winget`, `msstore`); every configured source when omitted. */
  source?: string;
  limit?: number;
  /** Exact package id instead of a query. */
  id?: string;
  name?: string;
  moniker?: string;
  tag?: string;
}

export interface InstallOptions {
  source?: string;
  version?: string;
  scope?: "user" | "machine";
  location?: string;
  log?: string;
  force?: boolean;
  interactive?: boolean;
  onProgress?: (progress: WingetProgress) => void;
}

export interface WingetStatus {
  activation: "outofproc" | "manual" | "inproc";
  winrtact: string | null;
}

export function status(): WingetStatus {
  return call<WingetStatus>("winget.status");
}

export function sources(): Promise<WingetSource[]> {
  return callAsync<WingetSource[]>("winget.sources");
}

/** Catalog search (Id, name, moniker and tags, like `winget search`). */
export function search(query: string, options: QueryOptions = {}): Promise<WingetPackage[]> {
  return callAsync<WingetPackage[]>("winget.search", { ...options, query });
}

/** Installed packages correlated with the catalogs; `upgradable` keeps those with an update. */
export function list(options: QueryOptions & { query?: string; upgradable?: boolean } = {}): Promise<WingetPackage[]> {
  return callAsync<WingetPackage[]>("winget.list", options);
}

export function show(id: string, options: { source?: string } = {}): Promise<WingetDetails> {
  return callAsync<WingetDetails>("winget.show", { ...options, id });
}

function operation(method: string, id: string, options: InstallOptions): Promise<WingetResult> {
  const { onProgress, ...args } = options;
  return callAsync<WingetResult>(method, { ...args, id }, onProgress as (p: unknown) => void);
}

/** Silent install (agreements accepted) of an exact package id. */
export function install(id: string, options: InstallOptions = {}): Promise<WingetResult> {
  return operation("winget.install", id, options);
}

export function upgrade(id: string, options: InstallOptions = {}): Promise<WingetResult> {
  return operation("winget.upgrade", id, options);
}

export function uninstall(
  id: string,
  options: Omit<InstallOptions, "version" | "scope" | "location"> = {},
): Promise<WingetResult> {
  return operation("winget.uninstall", id, options);
}

export default { status, sources, search, list, show, install, upgrade, uninstall };
