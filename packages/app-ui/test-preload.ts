// SPDX-License-Identifier: Apache-2.0
import { mock } from "bun:test";
const domPreload = Symbol.for("@aphrody/app-ui/test-dom-preloaded");
if (!Reflect.get(globalThis, domPreload)) {
  Reflect.set(globalThis, domPreload, true);
  // Load the shared DOM once per Bun test global, before React imports.
  await import("@aphrody/m3-config/test/dom");
}
// Bun's test DOM defaults to `about:blank`; the WebOS app is mounted at `/`.
const testWindow = globalThis.window as Window & { happyDOM?: { setURL(url: string): void } };
testWindow.happyDOM?.setURL("http://localhost/");
const appBase = document.querySelector("base") ?? document.createElement("base");
appBase.href = "/";
if (!appBase.isConnected) document.head.append(appBase);

// Bun's test loader does not run the Bun.build resolver for CommonJS peers.
// Alias the nested workspace's real React to the host copy, as the app bundler does.
for (const name of ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"]) {
  const canonical = import.meta.require(name);
  let nestedPath: string;
  try {
    nestedPath = Bun.resolveSync(name, new URL("../../", import.meta.url).pathname);
  } catch {
    continue; // the nested workspace has no React of its own: nothing to alias
  }
  const hostPath = Bun.resolveSync(name, import.meta.dir);
  if (nestedPath !== hostPath) mock.module(nestedPath, () => ({ ...canonical, default: canonical }));
}
