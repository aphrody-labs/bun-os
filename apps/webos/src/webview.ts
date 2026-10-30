// SPDX-License-Identifier: Apache-2.0
// WebView policy of the desktop: web content never leaves WebOS. window.open and links that would open a browser
// tab open a WebOS WebView window (own chrome, tabs, history, sandboxed frame) instead.

export function installWebViews(open: (url: string) => void): void {
  const original = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? "" : String(url);
    if (/^(https?:|blob:)/i.test(href)) {
      open(href);
      return null;
    }
    return original(url, target, features);
  }) as typeof window.open;
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^(https?:)$/i.test(a.protocol)) return;
      if (a.target !== "_blank" && a.origin === location.origin) return;
      event.preventDefault();
      open(a.href);
    },
    true,
  );
}
