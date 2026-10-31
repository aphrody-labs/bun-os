declare module "bun:chromium" {
  export interface ConnectOptions {
    /** Connection and command timeout in milliseconds. */
    timeout?: number;
    signal?: AbortSignal;
  }

  export interface LaunchOptions extends ConnectOptions {
    /** Chrome or Chromium executable; discovered automatically when omitted. */
    executable?: string;
    /** Dedicated Chrome user data directory. */
    userDataDir?: string;
    /** Launch without visible browser UI. Defaults to false. */
    headless?: boolean;
    /** Enable browser WebGPU support. Defaults to true. */
    webgpu?: boolean;
    /** Initial HTTP(S) URL or about:blank. */
    url?: string;
    /** Paths to unpacked extensions supported by the selected browser. */
    extensions?: string[];
  }

  /** A Chrome DevTools Protocol connection to a browser or target endpoint. */
  export class ChromiumConnection {
    private constructor();
    readonly closed: boolean;
    /** Send a CDP command, optionally addressing a flattened target session. */
    send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
    /** Probe navigator.gpu in an attached secure target session. */
    gpu(sessionId: string): Promise<{
      available: boolean;
      adapter: boolean;
      fallback: boolean | null;
      info: Record<string, unknown> | null;
    }>;
    /** Subscribe to a CDP event. Returns a function that removes the subscription. */
    on(method: string, callback: (params: Record<string, unknown>, sessionId?: string) => void): () => void;
    /** Close this connection. */
    close(): void;
  }

  export interface ChromiumBrowser {
    readonly endpoint: string;
    readonly connection: ChromiumConnection;
    readonly userDataDir: string;
    readonly process: Bun.Subprocess;
    /** Close the connection and terminate the browser launched by Bun. */
    close(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }

  /** Connect to a Chrome remote debugging endpoint. */
  export function connect(endpoint: string, options?: ConnectOptions): Promise<ChromiumConnection>;
  /** Launch Chrome with a dedicated profile and connect to its debugging endpoint. */
  export function launch(options?: LaunchOptions): Promise<ChromiumBrowser>;
  /** Discover an installed Chrome-compatible executable, or return null. */
  export function findExecutable(): string | null;

  /** Pure manifest helpers. These functions do not install browser extensions or PWAs. */
  export namespace manifests {
    function validateExtension(manifest: Record<string, unknown>): Record<string, unknown>;
    function createExtension(options: Record<string, unknown>): Record<string, unknown>;
    function validateTheme(manifest: Record<string, unknown>): Record<string, unknown>;
    function createTheme(options: Record<string, unknown>): Record<string, unknown>;
    function validatePWA(manifest: Record<string, unknown>): Record<string, unknown>;
    function createPWA(options: Record<string, unknown>): Record<string, unknown>;
  }

  export interface Bookmark {
    id: string;
    name: string;
    url: string;
    /** Folder names from the bookmark root to its containing folder. */
    folder: string[];
  }

  export namespace profiles {
    interface OpenApplicationOptions {
      url: string;
      browser?: "chrome" | "chromium";
      executable?: string;
      userDataDir?: string;
      /** Existing profile directory. openApplication chooses Chrome's last-used profile, then Default. */
      profileDirectory?: string;
    }
    interface OpenApplicationResult {
      pid: number;
      browser: "chrome" | "chromium";
      profileDirectory: string;
      mode: "native-profile-application";
    }
    /** Validate an application command without reading or launching anything. Defaults to Default without metadata. */
    function planApplication(options: OpenApplicationOptions & { executable: string; userDataDir: string }): string[];
    /** Delegate an application window to the browser that owns its profile. No debugger, profile copy or process-tree ownership is introduced. */
    function openApplication(options: OpenApplicationOptions): Promise<OpenApplicationResult>;
    interface ImportSiteOptions {
      view: Bun.WebView;
      /** Explicit connected source browser; no encrypted profile files are read. */
      source: ChromiumConnection;
      /** Reuse an existing source target session; otherwise attach a same-origin page temporarily. */
      sourceSessionId?: string;
      site: string;
      /** Transfer only cookies applicable to the selected site URL. Defaults to true. */
      cookies?: boolean;
      /** Preserve domain cookies only within the selected hostname's subtree. Defaults to host-only scoping. */
      includeSubdomains?: boolean;
      /** Return page targets of exactly the selected origin. Defaults to true. */
      sessions?: boolean;
      /** Navigate only to this explicitly selected source target after cookie acknowledgement. */
      navigate?: string;
      /** Currently unavailable; true rejects before any browser mutation. */
      passwords?: boolean;
      signal?: AbortSignal;
    }
    interface ImportSiteResult {
      site: string;
      cookiesImported: number;
      cookiesRequested: number;
      sessions: { targetId: string; url: string; title: string }[];
      navigated: boolean;
    }
    /** Transfers live site cookies and verifies native readback. Initialize the destination view first; its profile may be shared by other views. */
    function importSite(options: ImportSiteOptions): Promise<ImportSiteResult>;
    interface DiscoveredProfile {
      userDataDir: string;
      directory: string;
      name: string;
      /** The literal Default profile directory. */
      isDefault: boolean;
      /** Matches Local State profile.last_used; may be a different directory. */
      isLastUsed: boolean;
    }
    /** Discover profile metadata on demand. No profile is opened for writing or copied. */
    function discover(options?: { userDataDirs?: readonly string[] }): Promise<DiscoveredProfile[]>;
    /** Existing ownership boundaries; encrypted stores are not exported. */
    function capabilities(): Readonly<{
      discovery: "read-only-metadata";
      bookmarks: "read-only-file";
      storedCookies: "unavailable";
      storedPasswords: "unavailable";
      liveCookies: "requires-connected-browser-site-api";
      liveSessions: "requires-connected-browser-target-api";
    }>;
    /** Read and flatten an explicitly selected Chrome Bookmarks JSON file. */
    function readBookmarks(
      file: string,
      options?: {
        /** HTTP(S) URL. Its hostname is normalized by URL, including IDNA. */
        site?: string;
        /** Include dot-delimited subdomains. Defaults to false. */
        includeSubdomains?: boolean;
      },
    ): Promise<Bookmark[]>;
  }

  export namespace protocol {
    /** Validate an HTTP(S) navigation URL or about:blank. */
    function validateURL(url: string): string;
  }

  const chromium: {
    ChromiumConnection: typeof ChromiumConnection;
    connect: typeof connect;
    launch: typeof launch;
    findExecutable: typeof findExecutable;
    manifests: typeof manifests;
    profiles: typeof profiles;
    protocol: typeof protocol;
  };
  export default chromium;
}
