/**
 * Zukan order crawler — canonical, shared module.
 *
 * Extrait la logique de crawl de l'ordre officiel des personnages depuis
 * `zukan.inazuma.jp/en/chara_param` (pages paginées). C'est le scraper PROUVÉ en
 * production (cron `ie-crawl/zukan.ts`) : navigation via le navigateur headless
 * `WebCdpPage` d'Aphrody Web (le contenu est rendu côté client, un
 * simple `fetch()` ne suffit pas pour la liste hydratée), puis parsing cheerio
 * avec les sélecteurs éprouvés (`ul.charaListBox`) et la regex CloudFront
 * `cloudfront\.net/1/([^."\s]+)`.
 *
 * ⚠️ CONTRAINTE BARREL : ce module dépend du transport CDP. Il NE DOIT JAMAIS
 * être ré-exporté par `zukan/index.ts` ni `src/index.ts` (le barrel est
 * value-importé en runtime par Azalée → bundle Next cassé). Importer en leaf :
 *   import { crawlZukanOrderPages } from "@aphrody/inagle/zukan/order";
 *
 * Le helper pur `buildOrderMap` est aussi exporté ici pour les
 * scripts qui crawlent en `fetch()` statique (cf. crawl-zukan-order.ts).
 */

import { WebCdpPage, waitForSelector } from "./web-cdp";
import * as cheerio from "cheerio";

/** Regex d'extraction du hash zukan depuis une URL CloudFront (variante prod, avec `\s`). */
export const ZUKAN_HASH_RE = /cloudfront\.net\/1\/([^."\s]+)/;

export const ZUKAN_ORDER_PER_PAGE = 200;
export const ZUKAN_ORDER_MAX_PAGES = 30;

/** Personnage tel qu'extrait du crawl d'ordre (proven prod shape). */
export interface ZukanOrderCharacter {
  id: string;
  name: string;
  zukanHash: string | null;
  position: string;
  element: string;
  game: string;
  order: number;
  /** Surnom affiché sous le nom complet (`.lBox .name .nickname`), ex. "Evans". */
  nickname: string | null;
  /** `ul.basic` : "Elementary School" / "Middle School" / "High School" / "Adult"… (brut, EN). */
  ageGroup: string | null;
  /** `ul.basic` : "Grade 7" / "Grade 8" / "Grade 9" (brut, EN). */
  schoolYear: string | null;
}

export interface CrawlZukanOrderOptions {
  perPage?: number;
  maxPages?: number;
  /** Hook de log (par défaut console.log). */
  log?: (msg: string) => void;
}

async function safeGoto(page: WebCdpPage, url: string, timeout = 30000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      page.goto(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Navigation timeout (${timeout}ms): ${url}`)), timeout);
      }),
    ]);
    if (response.ok === false || (typeof response.status === "number" && response.status >= 400)) {
      throw new Error(`Navigation failed: HTTP ${response.status ?? "unknown"} (${url})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crawl paginé des pages chara_param (EN) via navigateur headless CDP.
 * Retourne la liste ordonnée des personnages (ordre officiel = ordre d'apparition).
 *
 * Rejects failed navigation/rendering, an empty first page and an exhausted
 * page bound. Partial results are never returned after a page error.
 * Database/Redis writes remain owned by the caller.
 */
export async function crawlZukanOrderPages(opts: CrawlZukanOrderOptions = {}): Promise<ZukanOrderCharacter[]> {
  const perPage = opts.perPage ?? ZUKAN_ORDER_PER_PAGE;
  const maxPages = opts.maxPages ?? ZUKAN_ORDER_MAX_PAGES;
  if (!Number.isSafeInteger(perPage) || perPage < 1 || !Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("perPage and maxPages must be positive safe integers");
  }
  const log = opts.log ?? ((m: string) => console.log(m));
  const allCharacters: ZukanOrderCharacter[] = [];
  let globalIndex = 0;
  let complete = false;

  const page = await WebCdpPage.connect();

  try {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `https://zukan.inazuma.jp/en/chara_param/?page=${pageNum}&per_page=${perPage}`;
      log(`[Crawl Zukan] Navigation vers page ${pageNum} : ${url}`);

      try {
        await safeGoto(page, url);
        await waitForSelector(page, "ul.charaListBox", 15000);
        // Attendre le rendu complet côté client des personnages (plus de 2 li)
        try {
          let retries = 24; // 24 * 250ms = 6s max
          while (retries > 0) {
            const count = await page.evaluate<number>('document.querySelectorAll("ul.charaListBox > li").length');
            if (count > 2) break;
            await new Promise(r => setTimeout(r, 250));
            retries--;
          }
        } catch (error) {
          throw new Error("Character rendering failed", { cause: error });
        }

        const html = await page.content();
        const $ = cheerio.load(html);

        const listItems = $("ul.charaListBox > li");
        if (listItems.length === 0) {
          if (pageNum === 1) throw new Error("The first character page is empty");
          complete = true;
          log(`[Crawl Zukan] Page ${pageNum} vide. Fin du crawl.`);
          break;
        }

        listItems.each((_i, el) => {
          const img = $(el).find("img[src*='cloudfront']").first();
          const source = $(el).find("source[srcset*='cloudfront.net/1/']").first();
          const src = img.attr("src") || source.attr("srcset") || "";
          const hashMatch = src.match(ZUKAN_HASH_RE);
          const zukanHash = (hashMatch && hashMatch[1]) || null;

          const name = img.attr("alt")?.trim() || "?";
          const position = $(el).find("dl:has(dt:contains('Position')) dd p").text().trim() || "?";
          const element = $(el).find("dl:has(dt:contains('Element')) dd p").text().trim() || "?";
          const game = $(el).find("dl.appearedWorks dd").text().trim() || "?";
          // `.basic` porte Age Group / School Year / Gender / Character Role — déjà présents
          // dans la même page (SSR, pas besoin d'un crawl séparé de chara_list/chara_param
          // en détail). Seuls Age Group/School Year/le surnom manquaient à l'appel.
          const nickname = $(el).find(".lBox .name .nickname").text().trim() || null;
          const ageGroup = $(el).find(".basic dl:has(dt:contains('Age Group')) dd").text().trim() || null;
          const schoolYear = $(el).find(".basic dl:has(dt:contains('School Year')) dd").text().trim() || null;

          allCharacters.push({
            id: zukanHash || `chara-${globalIndex}`,
            name,
            zukanHash,
            position,
            element,
            game,
            order: globalIndex,
            nickname,
            ageGroup,
            schoolYear,
          });
          globalIndex++;
        });

        log(`[Crawl Zukan] Page ${pageNum} : ${listItems.length} personnages trouvés.`);
        if (listItems.length < perPage) {
          complete = true;
          break;
        }
      } catch (err) {
        throw new Error(`Zukan order crawl failed on page ${pageNum}; partial results were discarded`, {
          cause: err,
        });
      }
    }
  } finally {
    await page.close();
  }

  if (!complete) throw new Error(`Zukan order crawl reached maxPages=${maxPages} before completion`);
  return allCharacters;
}

/**
 * Construit la map `zukanHash → order` à partir d'une liste de personnages
 * ordonnés. Pur (aucune dépendance) — réutilisable par les crawlers statiques.
 */
export function buildOrderMap(characters: { zukanHash: string | null; order: number }[]): Record<string, number> {
  const orderMap: Record<string, number> = {};
  for (const char of characters) {
    if (char.zukanHash) orderMap[char.zukanHash] = char.order;
  }
  return orderMap;
}
