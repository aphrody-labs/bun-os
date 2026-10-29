// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { activeModal, attachDpad, focusables } from "@aphrody/app-ui/material/adaptive/dpad.ts";
afterEach(() => {
  document.body.innerHTML = "";
});
function button(parent: HTMLElement, label: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.textContent = label;
  node.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 20,
    bottom: 20,
    width: 20,
    height: 20,
    toJSON() {},
  });
  parent.append(node);
  return node;
}
test("D-pad ignores controls hidden or disabled by ancestors", () => {
  const visible = button(document.body, "Visible");
  const hidden = document.createElement("div");
  hidden.setAttribute("aria-hidden", "true");
  document.body.append(hidden);
  button(hidden, "Hidden");
  const inert = document.createElement("div");
  inert.setAttribute("inert", "");
  document.body.append(inert);
  button(inert, "Inert");
  const disabled = document.createElement("fieldset");
  disabled.disabled = true;
  document.body.append(disabled);
  button(disabled, "Disabled fieldset");
  expect(focusables(document).map((element) => element.textContent)).toEqual([
    visible.textContent,
  ]);
});
test("hidden modal containers do not steal the D-pad focus scope", () => {
  const live = document.createElement("section");
  live.setAttribute("aria-modal", "true");
  document.body.append(live);
  const stale = document.createElement("section");
  stale.setAttribute("aria-modal", "true");
  stale.hidden = true;
  document.body.append(stale);
  expect(activeModal(document) === live).toBe(true);
});
test("Back calls a custom dialog's close method and disposal removes the handler", () => {
  const dialog = document.createElement("md-dialog") as HTMLElement & {
    close(): void;
  };
  dialog.setAttribute("open", "");
  let closes = 0;
  dialog.close = () => {
    closes++;
    dialog.removeAttribute("open");
  };
  document.body.append(dialog);
  let backs = 0;
  const dispose = attachDpad({
    onBack: () => {
      backs++;
    },
  });
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(closes).toBe(1);
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(backs).toBe(1);
  dispose();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(backs).toBe(1);
});
