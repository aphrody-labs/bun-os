// SPDX-License-Identifier: MIT
// Minimal RSS 2.0 reader for archlinux.org/feeds/news and archlinux.org/feeds/packages.

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  published: number;
  description: string;
  categories: string[];
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function text(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1]!;
  return raw.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, m => ENTITIES[m] ?? m).trim();
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? text(m[1]!) : "";
}

export function parseRss(xml: string): FeedItem[] {
  if (!/<rss[\s>]/.test(xml) || !xml.includes("</channel>")) throw new Error("Not an RSS 2.0 document.");
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]!;
    const published = Date.parse(tag(block, "pubDate"));
    const link = tag(block, "link");
    items.push({
      title: tag(block, "title"),
      link,
      guid: tag(block, "guid") || link,
      published: Number.isFinite(published) ? published : 0,
      description: tag(block, "description"),
      categories: [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/g)].map(c => text(c[1]!)),
    });
  }
  return items;
}

/** "kirigami-addons 1.16.0-1 x86_64" -> parts; the feed title carries name, full version and arch. */
export function parsePackageFeedTitle(title: string): { name: string; version: string; arch: string } | null {
  const m = /^(\S+) (\S+) (\S+)$/.exec(title.trim());
  return m ? { name: m[1]!, version: m[2]!, arch: m[3]! } : null;
}
