import { createThemeController, META, THEME_IDS, COLORS } from "../src/index.ts";

if (new URLSearchParams(location.search).has("still")) document.documentElement.dataset.still = "";
const ctl = createThemeController({ endpoint: new URLSearchParams(location.search).get("endpoint") });
const q = new URLSearchParams(location.search);
const patch = Object.fromEntries(["theme", "scheme", "accent"].flatMap(k => (q.get(k) ? [[k, q.get(k)]] : [])));
if (Object.keys(patch).length) ctl.set(patch);
const $ = (id: string) => document.getElementById(id)!;
function btn(label: string, pressed: boolean, on: () => void) {
  const b = document.createElement("button");
  b.className = "t-button";
  b.textContent = label;
  b.setAttribute("aria-pressed", String(pressed));
  b.onclick = on;
  return b;
}
function render() {
  const s = ctl.get();
  $("name").textContent = META[s.theme].name;
  $("themes").replaceChildren(...THEME_IDS.map(t => btn(META[t].name, t === s.theme, () => ctl.set({ theme: t }))));
  $("schemes").replaceChildren(...(["auto", "light", "dark"] as const).map(m => btn(m, m === s.scheme, () => ctl.set({ scheme: m }))));
  const scheme = document.documentElement.dataset.scheme as "light" | "dark";
  $("accents").replaceChildren(
    ...META[s.theme].accents.map(a => {
      const sw = document.createElement("button");
      sw.className = "swatch";
      sw.title = a;
      sw.style.background = COLORS[s.theme][scheme][a]!.accent;
      if (a === s.accent) sw.style.outline = "2px solid var(--t-fg)";
      sw.onclick = () => ctl.set({ accent: a });
      return sw;
    }),
  );
}
ctl.subscribe(render);
$("glass").addEventListener("input", e => ctl.set({ transparency: Number((e.target as HTMLInputElement).value) / 100 }));
render();
(globalThis as { __themes?: unknown }).__themes = ctl;
