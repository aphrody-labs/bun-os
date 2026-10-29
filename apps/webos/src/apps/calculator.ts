// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { fend } from "./fend";

/**
 * Calculator over fend (arbitrary precision, units, functions, variables; `fend-wasm`). The field takes a full
 * expression (`5 km to miles`, `sqrt(2)`, `a = 3; a^2`); the keypad only edits that field.
 */
export function calculatorApp(root: HTMLElement) {
  const input = h("input", {
    class: "fld calc-in",
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": "Expression",
    placeholder: "5 km to miles",
  }) as HTMLInputElement;
  const display = h("output", { class: "calc-out", "aria-live": "polite" }, "0");
  const history = h("div", { class: "calc-hist muted" });

  const evaluate = async () => {
    const expr = input.value.trim();
    if (!expr) return;
    const result = await fend(expr);
    if (result.startsWith("Error:")) {
      history.textContent = result.slice("Error:".length).trim();
      return;
    }
    history.textContent = `${expr} =`;
    display.textContent = result;
    input.value = result;
  };
  const press = (k: string) => {
    if (k === "C") {
      input.value = "";
      display.textContent = "0";
      history.textContent = "";
    } else if (k === "⌫") input.value = input.value.slice(0, -1);
    else if (k === "=") void evaluate();
    else input.value += k;
    input.focus();
  };
  const keys = ["C", "(", ")", "⌫", "7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
  const pad = h(
    "div",
    { class: "calc-pad" },
    ...keys.map(k =>
      h("button", { class: `calc-key${/\D/.test(k) && k !== "." ? " op" : ""}`, onclick: () => press(k) }, k),
    ),
  );
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void evaluate();
    } else if (e.key === "Escape") press("C");
  });
  root.append(h("div", { class: "calc" }, history, display, input, pad));
  input.focus();
}
