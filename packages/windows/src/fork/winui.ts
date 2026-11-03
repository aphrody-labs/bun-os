// @ts-nocheck -- ported verbatim from the fork, whose src/js modules are loosely typed builtins.
// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun src/js/bun/winui.ts (commit 62fcdb38ec9, MIT, Copyright Oven and contributors) to upstream Bun
// for the Bun OS bun:* modules of @aphrody/windows (src/bun-plugin.ts).
// Relation to ../winui.ts: that module drives the .NET winui-host over JSON lines; this one is the fork API that
// hosts XAML in the Bun process through ./winrt.ts.
// bun:winui: WinUI 3 (Windows App SDK) driven from JavaScript.
//
// The Windows App Runtime framework package is added to the process package graph (Windows 11 dynamic
// dependencies, else the Bootstrap DLL's MddBootstrapInitialize2), its .winmd metadata is read at run time by
// the WinRT core (bun:winrt), and XAML runs on the JS thread as a
// single-threaded apartment. Window messages are pumped from a timer, so JS keeps running between frames and
// XAML callbacks (events, the Application's metadata provider) run synchronously on the JS thread.
const {
  dlopen,
  ptr,
  read,
  toArrayBuffer,
}: Pick<typeof import("bun:ffi"), "dlopen" | "ptr" | "read" | "toArrayBuffer"> = require("bun:ffi");
const { dirname, isAbsolute, join }: typeof import("node:path") = require("node:path");
const { existsSync } = require("node:fs");

const PUBLISHER_ID = "8wekyb3d8bbwe";
const DEFAULT_VERSIONS = ["1.8", "1.7", "1.6", "1.5", "1.4"];
const XAML_NAMESPACE = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
const XAML_X_NAMESPACE = "http://schemas.microsoft.com/winfx/2006/xaml";
const IID_IWINDOWNATIVE = "eecdbf0e-bae9-4cb6-a68e-9598e1cb57bb";
const IID_ICLOSABLE = "30d5a829-7fa4-4026-83bb-d75bae4ea99e";
const PUMP_INTERVAL_MS = 8;
const THEMES: Record<string, number> = { light: 0, dark: 1 };

function winuiError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function ensureWindows() {
  if (process.platform !== "win32") throw winuiError("ERR_WINUI_UNSUPPORTED", "bun:winui is only available on Windows");
}

function wide(value: string) {
  return Buffer.from(value + "\0", "utf16le");
}

function readWide(address: number) {
  if (!address) return "";
  let length = 0;
  while (read.u16(address as any, length * 2) !== 0) length++;
  return Buffer.from(toArrayBuffer(address as any, 0, length * 2)).toString("utf16le");
}

let nativeSymbols: any;
function native() {
  if (nativeSymbols) return nativeSymbols;
  const kernel32 = dlopen("kernel32.dll", {
    LoadLibraryW: { args: ["ptr"], returns: "ptr" },
    GetModuleFileNameW: { args: ["ptr", "ptr", "u32"], returns: "u32" },
  }).symbols;
  const user32 = dlopen("user32.dll", {
    PeekMessageW: { args: ["ptr", "ptr", "u32", "u32", "u32"], returns: "i32" },
    TranslateMessage: { args: ["ptr"], returns: "i32" },
    DispatchMessageW: { args: ["ptr"], returns: "i64" },
    SetWindowPos: { args: ["ptr", "ptr", "i32", "i32", "i32", "i32", "u32"], returns: "i32" },
    GetDpiForWindow: { args: ["ptr"], returns: "u32" },
  }).symbols;
  let dynamicDependencies: any;
  try {
    // Windows 11 (22000+) adds framework packages to an unpackaged process without the Bootstrap DLL.
    dynamicDependencies = dlopen("kernelbase.dll", {
      TryCreatePackageDependency: {
        args: ["ptr", "ptr", "u64", "u32", "u32", "ptr", "u32", "ptr"],
        returns: "i32",
      },
      AddPackageDependency: { args: ["ptr", "i32", "u32", "ptr", "ptr"], returns: "i32" },
    }).symbols;
  } catch {}
  nativeSymbols = { kernel32, user32, dynamicDependencies };
  return nativeSymbols;
}

type Runtime = {
  version: string;
  packageFamilyName: string;
  packageFullName: string | null;
  path: string;
  via: string;
};
let runtimeInfo: Runtime | undefined;

function architecture() {
  // PackageDependencyProcessorArchitectures
  return process.arch === "arm64" ? 0x10 : process.arch === "ia32" ? 0x2 : 0x4;
}

function frameworkPath() {
  const { kernel32 } = native();
  const module = kernel32.LoadLibraryW(wide("Microsoft.ui.xaml.dll"));
  if (!module) return undefined;
  const buffer = new Uint16Array(32768);
  const length = kernel32.GetModuleFileNameW(module, buffer, buffer.length);
  return length ? dirname(Buffer.from(buffer.buffer, 0, length * 2).toString("utf16le")) : undefined;
}

function bootstrapDllCandidates(options: any) {
  const candidates: string[] = [];
  if (typeof options?.bootstrapDll === "string") candidates.push(options.bootstrapDll);
  const name = "Microsoft.WindowsAppRuntime.Bootstrap.dll";
  candidates.push(join(dirname(process.execPath), name), join(process.cwd(), name));
  const { main } = Bun;
  if (typeof main === "string" && isAbsolute(main)) candidates.push(join(dirname(main), name));
  return candidates.filter(path => existsSync(path));
}

function bootstrap(options: any): Runtime {
  if (runtimeInfo) return runtimeInfo;
  ensureWindows();
  const versions: string[] =
    options?.version !== undefined
      ? [String(options.version)]
      : (process.env.BUN_WINUI_VERSION?.split(",") ?? DEFAULT_VERSIONS);
  const { dynamicDependencies } = native();
  const failures: string[] = [];
  for (const version of versions) {
    if (!/^\d+(\.\d+)?$/.test(version)) throw new TypeError(`bun:winui: invalid Windows App SDK version "${version}"`);
    const packageFamilyName = `Microsoft.WindowsAppRuntime.${version}_${PUBLISHER_ID}`;
    if (dynamicDependencies) {
      const id = new BigUint64Array(1);
      let hr = dynamicDependencies.TryCreatePackageDependency(
        null,
        wide(packageFamilyName),
        0n,
        architecture(),
        0, // PackageDependencyLifetimeKind_Process
        null,
        0,
        ptr(id),
      );
      if (hr >= 0) {
        const context = new BigUint64Array(1);
        const fullName = new BigUint64Array(1);
        hr = dynamicDependencies.AddPackageDependency(Number(id[0]), 0, 0, ptr(context), ptr(fullName));
        if (hr >= 0) {
          const path = frameworkPath();
          if (path) {
            runtimeInfo = {
              version,
              packageFamilyName,
              packageFullName: readWide(Number(fullName[0])),
              path,
              via: "dynamic-dependency",
            };
            return runtimeInfo;
          }
        }
      }
      failures.push(`${packageFamilyName}: 0x${(hr >>> 0).toString(16)}`);
    }
    for (const dll of bootstrapDllCandidates(options)) {
      const [major, minor = "0"] = version.split(".");
      const symbols = dlopen(dll, {
        MddBootstrapInitialize2: { args: ["u32", "ptr", "u64", "u32"], returns: "i32" },
      }).symbols;
      const hr = symbols.MddBootstrapInitialize2((Number(major) << 16) | Number(minor), wide(""), 0n, 0);
      const path = hr >= 0 ? frameworkPath() : undefined;
      if (path) {
        runtimeInfo = { version, packageFamilyName, packageFullName: null, path, via: "bootstrap" };
        return runtimeInfo;
      }
      failures.push(`${dll}: 0x${(hr >>> 0).toString(16)}`);
    }
  }
  throw winuiError(
    "ERR_WINUI_RUNTIME_NOT_FOUND",
    `bun:winui: no Windows App Runtime ${versions.join(", ")} could be loaded. Install it with ` +
      `"winget install Microsoft.WindowsAppRuntime.${versions[0]}" (or place Microsoft.WindowsAppRuntime.Bootstrap.dll ` +
      `next to the application).` +
      (failures.length ? ` Attempts: ${failures.join("; ")}` : ""),
  );
}

function loadCore(options: any) {
  if (options?.winrt) return options.winrt;
  return require("./winrt").default;
}

// XAML fragments without a default namespace get the WinUI ones, so `<Button Content="OK"/>` loads.
function withNamespaces(xaml: string) {
  const match = /<([A-Za-z_][\w.:]*)/.exec(xaml.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, ""));
  if (!match) throw new TypeError("bun:winui: the XAML has no root element");
  const rootStart = xaml.indexOf(match[0]);
  const rootEnd = xaml.indexOf(">", rootStart);
  const head = xaml.slice(rootStart, rootEnd);
  let insert = "";
  if (!/\sxmlns\s*=/.test(head)) insert += ` xmlns="${XAML_NAMESPACE}"`;
  if (!/\sxmlns:x\s*=/.test(head) && /\bx:/.test(xaml)) insert += ` xmlns:x="${XAML_X_NAMESPACE}"`;
  if (!insert) return xaml;
  const at = rootStart + match[0].length;
  return xaml.slice(0, at) + insert + xaml.slice(at);
}

let current: Application | null = null;

function shortName(className: string | undefined) {
  return className ? className.slice(className.lastIndexOf(".") + 1) : "";
}

class Element {
  readonly winrt: any;
  readonly className: string;
  readonly #app: Application;

  constructor(app: Application, object: any) {
    this.#app = app;
    this.winrt = object;
    // The runtime class (Button), not the static type of the member that returned it (UIElement).
    let className = object.className;
    try {
      const runtimeName = object.runtimeClassName;
      const { classes, interfaces } = app.winrt.registry;
      // A collection typed IVector<T> reports a base class (DependencyObject) that does not declare its members.
      const typedByInterface = interfaces.has(className) && !classes.has(className);
      if (classes.has(runtimeName) && !typedByInterface) className = runtimeName;
    } catch {}
    this.className = className;
    object.className = className;
  }

  get type() {
    return shortName(this.className);
  }

  get name(): string {
    return this.has("Name") ? this.get("Name") : "";
  }

  has(member: string) {
    const core = this.#app.winrt;
    return !!(core.findMethod(this.className, `get_${member}`) ?? core.findMethod(this.className, member));
  }

  get(property: string) {
    return this.#app.fromWinRT(this.#invoke(`get_${property}`, []));
  }

  set(property: string, value: unknown) {
    this.#invoke(`put_${property}`, [value]);
    return this;
  }

  // Internal code goes through #invokeMethod: builtins compile x.call(...) as Function.prototype.call.
  call(method: string, ...args: unknown[]) {
    return this.#app.fromWinRT(this.#invoke(method, args));
  }

  on(event: string, listener: (sender: Element | null, args: Element | null) => unknown) {
    if (typeof listener !== "function") throw new TypeError("bun:winui: listener must be a function");
    const core = this.#app.winrt;
    const found = core.findMethod(this.className, `add_${event}`);
    if (!found) throw new TypeError(`bun:winui: ${this.className} has no event ${event}`);
    const delegateType = found.method[2][0][2];
    const app = this.#app;
    const handler = core.delegate(delegateType, (sender: any, args: any) =>
      listener(app.fromWinRT(sender), app.fromWinRT(args)),
    );
    let token: bigint;
    try {
      token = core.callMethod(this.winrt, `add_${event}`, handler);
    } catch (error) {
      handler.release();
      throw error;
    }
    const target = this.winrt;
    let removed = false;
    const off = () => {
      if (removed) return;
      removed = true;
      app.handlers.delete(off);
      try {
        if (!app.closed) core.callMethod(target, `remove_${event}`, token);
      } finally {
        handler.release();
      }
    };
    app.handlers.add(off);
    return off;
  }

  append(child: Element | string) {
    const element = typeof child === "string" ? this.#app.load(child) : child;
    this.get("Children").#invokeMethod("Append", [element]);
    return element;
  }

  find(name: string): Element | null {
    return this.#invokeMethod("FindName", [String(name)]) as Element | null;
  }

  get children(): Element[] {
    const core = this.#app.winrt;
    if (core.findMethod(this.className, "get_Children")) {
      const collection = core.callMethod(this.winrt, "get_Children");
      return [...core.vector(collection, "Microsoft.UI.Xaml.UIElement")].map(child => new Element(this.#app, child));
    }
    for (const property of ["Child", "Content"]) {
      if (core.findMethod(this.className, `get_${property}`)) {
        const value = this.get(property);
        return value instanceof Element ? [value] : [];
      }
    }
    return [];
  }

  tree(): WinUITreeNode {
    const node: WinUITreeNode = { type: this.type };
    const name = this.name;
    if (name) node.name = name;
    const children = this.children.map(child => child.tree());
    if (children.length) node.children = children;
    return node;
  }

  // The automation peer's Invoke pattern: what a click from a screen reader or UI test does.
  invoke() {
    const ns = this.#app.namespaces;
    const peer = ns["Microsoft.UI.Xaml.Automation.Peers"].FrameworkElementAutomationPeer.CreatePeerForElement(
      this.winrt.as("Microsoft.UI.Xaml.IUIElement"),
    );
    const pattern = peer?.GetPattern(0); // PatternInterface.Invoke
    if (!pattern) throw new TypeError(`bun:winui: ${this.className} cannot be invoked`);
    pattern.as("Microsoft.UI.Xaml.Automation.Provider.IInvokeProvider").Invoke();
  }

  static invoke(element: Element, method: string, args: unknown[]) {
    return element.#invokeMethod(method, args);
  }

  #invokeMethod(method: string, args: unknown[]) {
    return this.#app.fromWinRT(this.#invoke(method, args));
  }

  #invoke(name: string, values: unknown[]) {
    const core = this.#app.winrt;
    const found = core.findMethod(this.className, name);
    if (!found) throw new TypeError(`bun:winui: ${this.className} has no member ${name.replace(/^(get|put)_/, "")}`);
    const inputs = found.method[2].filter((p: any) => p[0] === "in");
    const converted = values.map((value, i) => this.#app.toWinRT(value, inputs[i]?.[1], inputs[i]?.[2]));
    return core.callMethod(this.winrt, name, ...converted);
  }

  toString() {
    return `[${this.className}${this.name ? ` ${this.name}` : ""}]`;
  }
}

type WinUITreeNode = { type: string; name?: string; children?: WinUITreeNode[] };

class Window {
  readonly winrt: any;
  readonly hwnd: number;
  readonly closed: Promise<void>;
  isClosed = false;
  readonly #app: Application;
  #resolveClosed!: () => void;
  #off: () => void;

  constructor(app: Application, options: any) {
    this.#app = app;
    const ns = app.namespaces;
    const [win] = ns["Microsoft.UI.Xaml"].Window.CreateInstance(null);
    win.className = "Microsoft.UI.Xaml.Window";
    this.winrt = win;
    this.closed = new Promise(resolve => (this.#resolveClosed = resolve));
    const core = app.winrt;
    const handler = core.delegate(["TypedEventHandler", "Object", "Microsoft.UI.Xaml.WindowEventArgs"], () =>
      this.#onClosed(),
    );
    const token = win.add_Closed(handler);
    this.#off = () => {
      try {
        if (!app.closed && !this.isClosed) win.remove_Closed(token);
      } finally {
        handler.release();
      }
    };
    const native = core.queryInterface(win.ptr, IID_IWINDOWNATIVE);
    try {
      const out = new BigUint64Array(1);
      core.vfunc(native, 3, ["ptr"])(native, ptr(out));
      this.hwnd = Number(out[0]);
    } finally {
      core.vfunc(native, 2, [])(native);
    }
    if (options?.title !== undefined) this.title = String(options.title);
    if (options?.content !== undefined) this.content = options.content;
    if (options?.width !== undefined || options?.height !== undefined)
      this.resize(options.width ?? 800, options.height ?? 600);
    app.windows.add(this);
    if (options?.activate !== false) this.activate();
  }

  get title(): string {
    return this.winrt.get_Title();
  }

  set title(value: string) {
    this.winrt.put_Title(String(value));
  }

  get content(): Element | null {
    const value = this.winrt.get_Content();
    return value ? new Element(this.#app, value) : null;
  }

  set content(value: Element | string) {
    const element = typeof value === "string" ? this.#app.load(value) : value;
    if (!(element instanceof Element)) throw new TypeError("bun:winui: content must be XAML or an Element");
    this.winrt.put_Content(element.winrt.as("Microsoft.UI.Xaml.IUIElement"));
  }

  find(name: string) {
    return this.content?.find(name) ?? null;
  }

  // Size in device-independent pixels (scaled by the window's DPI).
  resize(width: number, height: number) {
    const { user32 } = native();
    const scale = (user32.GetDpiForWindow(this.hwnd) || 96) / 96;
    // SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    user32.SetWindowPos(this.hwnd, null, 0, 0, Math.round(width * scale), Math.round(height * scale), 0x2 | 0x4 | 0x10);
    return this;
  }

  activate() {
    this.winrt.Activate();
    this.#app.startPump();
    return this;
  }

  close() {
    if (!this.isClosed) this.winrt.Close();
    return this.closed;
  }

  #onClosed() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.#app.windows.delete(this);
    this.#resolveClosed();
    this.#app.windowClosed();
  }

  dispose() {
    this.#off();
  }
}

class Application {
  readonly runtime: Runtime;
  readonly winrt: any;
  readonly namespaces: Record<string, any>;
  readonly windows = new Set<Window>();
  readonly handlers = new Set<() => void>();
  readonly exited: Promise<void>;
  closed = false;
  readonly #options: any;
  #resolveExited!: () => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  #message = new Uint8Array(48);
  // Held for the whole life of the application: XAML calls into the outer object and the metadata provider,
  // and the aggregated inner, manager and dispatcher queue must not be released while XAML runs.
  #keep: any = {};

  constructor(options: any) {
    this.#options = options ?? {};
    this.exited = new Promise(resolve => (this.#resolveExited = resolve));
    this.runtime = bootstrap(options);
    const core = (this.winrt = loadCore(options));
    core.init({ singleThreaded: true });
    const namespaces: Record<string, any> = {};
    for (const file of ["Microsoft.UI.Xaml.winmd", "Microsoft.UI.winmd", "Microsoft.UI.Text.winmd"]) {
      const path = join(this.runtime.path, file);
      if (existsSync(path)) Object.assign(namespaces, core.loadMetadata(path));
    }
    if (!namespaces["Microsoft.UI.Xaml"])
      throw winuiError(
        "ERR_WINUI_RUNTIME_NOT_FOUND",
        `bun:winui: Microsoft.UI.Xaml.winmd not found in ${this.runtime.path}`,
      );
    namespaces["Windows.Foundation"] = core.systemMetadata("Windows.Foundation");
    this.namespaces = namespaces;
    const keep = this.#keep;
    keep.controller = namespaces["Microsoft.UI.Dispatching"].DispatcherQueueController.CreateOnCurrentThread();
    // The Application is composed with a JS outer object implementing IXamlMetadataProvider, which XAML
    // queries to resolve WinUI control types (XamlControlsResources, NumberBox, InfoBar...).
    const provider = (keep.provider =
      namespaces["Microsoft.UI.Xaml.XamlTypeInfo"].XamlControlsXamlMetaDataProvider.activate());
    const forward = (slot: number) => ({
      args: ["ptr", "ptr"],
      fn: (a: number, b: number) => core.vfunc(provider.ptr, slot, ["ptr", "ptr"])(provider.ptr, a, b),
    });
    const outer = (keep.outer = core.comObject([
      { iids: [], methods: [] },
      {
        iids: [core.iidOf("Microsoft.UI.Xaml.Markup.IXamlMetadataProvider")],
        methods: [forward(6), forward(7), forward(8)],
      },
    ]));
    outer.keep(provider);
    const [application, inner] = namespaces["Microsoft.UI.Xaml"].Application.CreateInstance(outer.ptr);
    outer.setInner(inner);
    keep.application = application;
    keep.inner = inner;
    keep.manager = namespaces["Microsoft.UI.Xaml.Hosting"].WindowsXamlManager.InitializeForCurrentThread();
    // DispatcherShutdownMode.OnExplicitShutdown: closing the last window does not stop the XAML dispatcher
    // under JS; exit() shuts it down.
    application.as("Microsoft.UI.Xaml.IApplication3").put_DispatcherShutdownMode(1);
    if (this.#options.theme !== undefined) {
      const theme = THEMES[this.#options.theme];
      if (theme === undefined) throw new TypeError(`bun:winui: theme must be "light" or "dark"`);
      application.put_RequestedTheme(theme);
    }
    if (this.#options.resources !== false) {
      const resources = this.load(`<ResourceDictionary/>`);
      const controls = this.load(`<XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls"/>`);
      Element.invoke(resources.get("MergedDictionaries"), "Append", [controls]);
      application.put_Resources(resources.winrt.as("Microsoft.UI.Xaml.IResourceDictionary"));
    }
    if (typeof this.#options.resources === "string" || Array.isArray(this.#options.resources))
      this.mergeResources(this.#options.resources);
  }

  get application() {
    return new Element(this, this.#keep.application);
  }

  load(xaml: string): Element {
    if (typeof xaml !== "string") throw new TypeError("bun:winui: xaml must be a string");
    const object = this.namespaces["Microsoft.UI.Xaml.Markup"].XamlReader.Load(withNamespaces(xaml));
    return new Element(this, object);
  }

  create(type: string, properties?: Record<string, unknown>): Element {
    if (!/^[A-Za-z_][\w]*(:[A-Za-z_]\w*)?$/.test(type))
      throw new TypeError(`bun:winui: invalid element type "${type}"`);
    const element = this.load(`<${type}/>`);
    for (const [key, value] of Object.entries(properties ?? {})) element.set(key, value);
    return element;
  }

  mergeResources(xaml: string | readonly string[]) {
    const dictionaries = typeof xaml === "string" ? [xaml] : xaml;
    if (!Array.isArray(dictionaries) || dictionaries.some(value => typeof value !== "string"))
      throw new TypeError("bun:winui: resources must be XAML or an array of XAML strings");
    const resources = this.application.get("Resources");
    if (!(resources instanceof Element)) throw new TypeError("bun:winui: application resources are disabled");
    const merged = resources.get("MergedDictionaries");
    for (const source of dictionaries) Element.invoke(merged, "Append", [this.load(source)]);
    return this;
  }

  createWindow(options?: any): Window {
    if (this.closed) throw winuiError("ERR_WINUI_EXITED", "bun:winui: the application has exited");
    return new Window(this, options);
  }

  fromWinRT(value: any): any {
    const core = this.winrt;
    if (!(value instanceof core.WinRTObject)) return value;
    const unboxed = core.unbox(value);
    return unboxed === value ? new Element(this, value) : unboxed;
  }

  toWinRT(value: unknown, kind: string, type: unknown): unknown {
    if (value instanceof Element) return value.winrt;
    if (value instanceof Window) return value.winrt;
    if (kind === "hstring") return value == null ? "" : String(value);
    if (kind === "object" && value !== null && value !== undefined && typeof value !== "object")
      return this.winrt.box(value);
    if (kind === "prim" && typeof value === "boolean" && type !== "bool") return value ? 1 : 0;
    return value;
  }

  pump() {
    const { user32 } = native();
    const message = ptr(this.#message);
    for (let i = 0; i < 1000 && user32.PeekMessageW(message, null, 0, 0, 1 /* PM_REMOVE */); i++) {
      user32.TranslateMessage(message);
      user32.DispatchMessageW(message);
    }
  }

  startPump() {
    if (this.#timer === undefined) this.#timer = setInterval(() => this.pump(), PUMP_INTERVAL_MS);
    this.#timer.ref?.();
  }

  windowClosed() {
    if (this.windows.size !== 0) return;
    if (this.#options.exitOnLastWindowClosed !== false) setImmediate(() => this.windows.size === 0 && this.exit());
    else this.#timer?.unref?.();
  }

  exit() {
    if (this.closed) return this.exited;
    for (const window of Array.from(this.windows)) window.winrt.Close();
    this.pump();
    for (const off of Array.from(this.handlers)) off();
    this.closed = true;
    const core = this.winrt;
    const keep = this.#keep;
    const closable = core.queryInterface(keep.manager.ptr, IID_ICLOSABLE);
    try {
      core.vfunc(closable, 6, [])(closable);
    } finally {
      core.vfunc(closable, 2, [])(closable);
    }
    this.pump();
    try {
      keep.controller.ShutdownQueue();
    } catch {}
    this.pump();
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    if (current === this) current = null;
    this.#resolveExited();
    return this.exited;
  }
}

function start(options?: {
  version?: string;
  resources?: boolean | string | readonly string[];
  theme?: "light" | "dark";
  exitOnLastWindowClosed?: boolean;
  bootstrapDll?: string;
  winrt?: unknown;
}): Application {
  if (options !== undefined && (options === null || typeof options !== "object"))
    throw new TypeError("bun:winui: options must be an object");
  if (current) return current;
  ensureWindows();
  current = new Application(options);
  return current;
}

function isSupported(options?: { version?: string }) {
  if (process.platform !== "win32") return false;
  try {
    bootstrap(options);
    return true;
  } catch {
    return false;
  }
}

function runtime(options?: { version?: string; bootstrapDll?: string }): Runtime {
  return { ...bootstrap(options) };
}

export default {
  isSupported,
  runtime,
  start,
  get app() {
    return current;
  },
  Application,
  Window,
  Element,
};

export { isSupported, runtime, start, Application, Window, Element };
