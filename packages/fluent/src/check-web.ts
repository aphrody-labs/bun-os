#!/usr/bin/env bun
// Loads web/dist in headless Chrome (playwright-core, the recipe of .github/workflows/wasmos.yml) and checks that the Fluent web components
// are defined, that the Microsoft theme was applied and that the dialog opens. WASMOS_CHROME = Chrome executable.
import { join } from "node:path";

const dist = join(import.meta.dir, "..", "web", "dist");
const server = Bun.serve({
  port: 0,
  fetch(r) {
    const p = new URL(r.url).pathname;
    return new Response(Bun.file(join(dist, p === "/" ? "index.html" : p)));
  },
});
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({
  executablePath: Bun.env.WASMOS_CHROME ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ colorScheme: "light" });
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForFunction(() => customElements.get("fluent-button") && customElements.get("fluent-dialog"));
  const r = await page.evaluate(async () => {
    const dlg = document.querySelector("#dlg") as unknown as { open?: boolean; show(): void };
    document.querySelector<HTMLElement>("#open")!.click();
    await new Promise(r => setTimeout(r, 300));
    return {
      button: !!customElements.get("fluent-button"),
      text: !!customElements.get("fluent-text"),
      brand: getComputedStyle(document.documentElement).getPropertyValue("--colorBrandBackground").trim(),
      buttonFont: getComputedStyle(document.querySelector("fluent-button")!).fontFamily,
      dialogOpen: !!dlg.open,
    };
  });
  console.log(JSON.stringify(r));
  if (!r.button || !r.text || r.brand !== "#0f6cbd" || !r.dialogOpen)
    throw new Error(`web check failed: ${JSON.stringify(r)}`);
} finally {
  await browser.close();
  server.stop();
}
