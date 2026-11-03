// Fluent 2 shell for the Bun OS wasm desktop (packages/wasmos): @fluentui/web-components v3 custom elements on the Bun OS
// Fluent skin (Microsoft's recipe, M3 primary palette of the product seed).
import { darkTheme, lightTheme, setTheme } from "./theme.ts";
import "@fluentui/web-components/button.js";
import "@fluentui/web-components/dialog.js";
import "@fluentui/web-components/dialog-body.js";
import "@fluentui/web-components/text.js";
import "@fluentui/web-components/divider.js";

const dark = matchMedia("(prefers-color-scheme: dark)");
const apply = () => setTheme(dark.matches ? darkTheme : lightTheme);
apply();
dark.addEventListener("change", apply);
document
  .querySelector("#open")
  ?.addEventListener("click", () => (document.querySelector("#dlg") as { show(): void }).show());
