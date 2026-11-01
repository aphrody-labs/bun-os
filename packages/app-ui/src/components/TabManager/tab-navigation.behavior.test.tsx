// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, RouterProvider, useLocation } from "react-router-dom";
import { TabManagerProvider } from "./TabManagerContext";
import { TabNavigationSync } from "./TabNavigationSync";
import { useTabManager } from "./useTabManager";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const originalUrl = window.location.href;
const domWindow = window as typeof window & {
  happyDOM: { setURL: (url: string) => void };
};
const originalTabs = localStorage.getItem("sd-tabs-state");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  domWindow.happyDOM.setURL(originalUrl);
  if (originalTabs === null) localStorage.removeItem("sd-tabs-state");
  else localStorage.setItem("sd-tabs-state", originalTabs);
});

function Probe() {
  const location = useLocation();
  const { tabs, activeTabId, createTab, switchTab } = useTabManager();
  const active = tabs.find(tab => tab.id === activeTabId);
  return (
    <>
      <TabNavigationSync />
      <output data-testid="path">{location.pathname + location.search}</output>
      <output data-testid="saved">{active?.savedPath}</output>
      <output data-testid="title">{active?.title}</output>
      <button type="button" id="new-tab" onClick={() => createTab("Templates", "/templates")}>
        New tab
      </button>
      <button type="button" id="first-tab" onClick={() => switchTab(tabs[0].id)}>
        First tab
      </button>
      <Link to="/docs/runtime-architecture?view=full" id="article">
        Article
      </Link>
    </>
  );
}
function RouterHarness() {
  const { router } = useTabManager();
  useEffect(() => () => router.dispose(), [router]);
  return <RouterProvider router={router} />;
}
async function mount(path: string, persisted = false) {
  domWindow.happyDOM.setURL(`http://localhost${path}`);
  if (!persisted) localStorage.removeItem("sd-tabs-state");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <TabManagerProvider routes={[{ path: "*", element: <Probe /> }]}>
        <RouterHarness />
      </TabManagerProvider>,
    ),
  );
}
function text(id: string) {
  return host!.querySelector(`[data-testid="${id}"]`)?.textContent;
}

test("a direct public URL survives startup instead of restoring the initial slash tab", async () => {
  await mount("/docs/runtime-architecture?view=full");
  expect(text("path")).toBe("/docs/runtime-architecture?view=full");
  expect(text("saved")).toBe("/docs/runtime-architecture?view=full");
  expect(text("title")).toBe("Documentation");
});

test("a direct URL also takes precedence over an older persisted active tab", async () => {
  localStorage.setItem(
    "sd-tabs-state",
    JSON.stringify({
      tabs: [
        {
          id: "previous",
          title: "Fichiers",
          savedPath: "/explorer",
          icon: null,
          isPinned: false,
          lastActive: 1,
        },
      ],
      activeTabId: "previous",
      explorerStates: {},
      defaultNewTabPath: "/",
    }),
  );
  await mount("/templates", true);
  expect(text("path")).toBe("/templates");
  expect(text("saved")).toBe("/templates");
  expect(text("title")).toBe("Templates");
});

test("actual tab switches restore saved paths while in-tab links save the new URL", async () => {
  await mount("/docs");
  await act(async () => host!.querySelector<HTMLButtonElement>("#new-tab")!.click());
  expect(text("path")).toBe("/templates");
  await act(async () => host!.querySelector<HTMLButtonElement>("#first-tab")!.click());
  expect(text("path")).toBe("/docs");
  await act(async () => host!.querySelector<HTMLAnchorElement>("#article")!.click());
  expect(text("path")).toBe("/docs/runtime-architecture?view=full");
  expect(text("saved")).toBe("/docs/runtime-architecture?view=full");
});
