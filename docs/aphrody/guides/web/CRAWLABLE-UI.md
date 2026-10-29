<!-- SPDX-License-Identifier: Apache-2.0 -->

# Crawlable UI: running the gate and what it checks

Status 2026-10-01. Goal: the server-rendered HTML of the m3 packages (`m3/packages`) is easy to
read, navigate and address for the Rust crawler (`aphrody-web crawl`, static HTTP stack, no
JavaScript) and for LLM agents. The product sites need
databases, so the gate renders a deterministic fixture site from the component libraries instead.

## Run it

```sh
# needs an aphrody-web binary with `crawl` (APHRODY_WEB_BIN or target/**/aphrody-web)
bun scripts/audit/web-crawlability.ts [--out FILE] [--update-baseline]
bun scripts/audit/web-crawlability.ts --no-crawl          # HTML analysis only, no engine
bun scripts/audit/web-crawlability.ts --save-fixture DIR  # keep the rendered pages
bun scripts/audit/web-crawlability.ts --from-fixture DIR  # crawl previously saved pages
bun scripts/audit/web-crawlability.ts --seed URL [--allow-private-network]  # audit a live site
bun test scripts/audit/web-crawlability.test.ts           # pure logic, no network, no engine
```

Exit code 0: within the baseline. 1: regression. 2: the audit could not run (for example a
binary without `crawl`). The JSON report (`aphrody-web.crawlability/1`) goes to
`storage.crawlabilityReport` of `tools/config/web.json` (`~/.aphrody/web/reports/crawlability.json`);
the repository is written to only with an explicit `--out`.

## What it does

1. `web-crawlability-pages.tsx` server-renders 8 pages (landing, primitives, forms, explorer, three
   readers, a data page) with `renderToString`, inside the `M3Document` shell of `@aphrody/m3-next`.
2. The pages are served on `127.0.0.1:0` together with `robots.txt`, `sitemap.xml` and `llms.txt`
   (built by the generators of `m3/packages/m3-next/src/crawl.ts`).
3. `aphrody-web crawl --allow-private-network --include-html --include-links --include-markdown`
   follows the links from `/` (sitemaps off, so every page must be reachable through `<a href>`).
4. Each page's HTML is parsed with Bun's HTMLRewriter (no new dependency) and measured.

## Checks (all gap counters must stay at or below the baseline)

| Counter | Meaning |
| --- | --- |
| `imagesMissingAlt` | `<img>` without an `alt` attribute (`alt=""` is decorative and allowed) |
| `unnamedInteractive`, `unlabeledFormControls` | widgets / controls with no accessible name (aria-labelledby, aria-label, label for or wrapping, content, title) |
| `duplicateIds`, `brokenIdRefs` | repeated ids; `for`, `aria-describedby`, `aria-controls`... pointing at a missing id |
| `clickOnlyLinks` | `<a>` without a real href, `href="#"`, `javascript:`, `role=link` without href, `onclick` navigation |
| `emptyCustomElements` | custom elements with no light-DOM text and no declarative shadow DOM |
| `mediaWithoutAlt` | canvas, svg, `role=img`, iframe without a text alternative |
| `invalidJsonLd` | JSON-LD blocks that do not parse or lack `@context` / `@type` |
| `headingSkips`, `emptyHeadings`, `pagesWithoutSingleH1` | one h1, no skipped levels |
| `pagesWithoutSingleMain`, `unnamedNavigations` | exactly one main; every nav named when there are several |
| `pagesWithoutLang/Title/Description/Canonical` | head metadata |
| `unreachablePages`, `metadataMismatches` | pages the crawler could not reach through links; crawler lang/description/canonical differing from the raw HTML |

Per page kind the baseline also requires landmarks (`banner`, `navigation`, `main`, `contentinfo`,
`region`), minimum `data-testid` and `data-m3-component` counts, JSON-LD, internal links and
visible words. The crawler's text coverage (extracted words over visible body words) must stay
above `min.textCoverage`.

## Thresholds

`tools/config/web-crawlability.baseline.json` is a ratchet written by `--update-baseline` from the
measured state: gap maxima are the current values (all 0), hook and word minima carry 10 to 20 %
slack. Review the diff of this file like code; tighten, never loosen without a reason.

## What was changed in the components (additive `data-*` and names only)

- `data-m3-component="<Name>"` on the root element of the primitives (Button, CircleButton,
  Card family, Badge, Divider, Input, TextArea, Label, SearchBar, CheckBox, Switch, Slider, Select,
  Tabs, TabBar, Accordion, Collapsible, Banner, ProgressBar, CircularProgress, Meter, Avatar, Icon,
  ToggleGroup, OptionList), forms (FormItem and each field, FormLabel, FormDescription,
  FormMessage), explorer (GridItem, TagPill, FileThumb, RenameInput) and readers. The attribute is
  written before the props spread, so a consumer can override it.
- Deterministic `data-testid`: `field-<name>` on form fields, `grid-item-<file name>`,
  `manga-reader`, `databook-reader`, `collection-reader`. No random ids anywhere.
- `ProgressBar` and `CircularProgress` had `role="progressbar"` without a name: default
  `aria-label` "Progress" ("Loading" for the pending bar); the circular svg is `aria-hidden`.
  `Meter` names itself from a string `label`.
- m3-forms `FormControl` no longer points `aria-describedby` at a `FormDescription` id that is not
  rendered. `FormItem` scans its own children (host elements, fragments and wrapper components that
  receive children) and keeps the old behavior when a self-closing custom component might render
  one.
- `MangaReader` and `CaptionedReader` roots are `role="region"` labelled with the title.
  `CollectionReader` sets `aria-controls` only while its contents panel is mounted.
- `@aphrody/m3-next` gains `m3SitemapXml`, `m3RobotsTxt`, `m3LlmsTxt` (llmstxt.org) and `m3JsonLd`
  (script-safe JSON-LD) as pure functions with tests.

## Known gaps (not fixed, by design or for lack of time)

- The crawler's extractor treats forms as non-content: the markdown of `/forms` holds only the
  heading and intro. Labels, descriptions and options are in the HTML but not in the markdown.
- Custom listbox `Select` renders its options in a portal that does not exist on the server, so the
  options are not in the initial HTML (the trigger and a hidden input are).
- `CollectionReader` switches chapters with client state (buttons), so only the first chapter is in
  the HTML; `MangaReader` and `CaptionedReader` page by Swiper, so crawlers see the first slides.
- `Icon` renders the Material Symbols ligature name as text inside an `aria-hidden` span; a crawler
  that ignores `aria-hidden` reads "close", "search"... (`ariaHiddenWords` counts them).
- `CardTitle`, `CategoryHeading`, `ScreenHeading` are always `h3`: a page must place them under an
  h2 (no `as` prop; adding one changes the public API).
- Lit / `md-*` wrappers (`@aphrody/m3-react`) are not in the fixture: `@lit-labs/ssr` is not in
  `bun.lock` (only its dependency `@lit-labs/ssr-dom-shim`), and none was added.
- No component manifest generator (`m3-manifest.json`) yet.
