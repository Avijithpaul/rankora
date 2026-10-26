import * as cheerio from "cheerio";

export interface ParsedSitemap {
  kind: "urlset" | "index" | "unknown";
  /** page URLs (urlset) or child sitemap URLs (index) */
  urls: string[];
}

/** Parse an XML sitemap or sitemap index. Invalid XML yields kind "unknown". */
export function parseSitemap(xml: string, limit = 50_000): ParsedSitemap {
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) return { kind: "unknown", urls: [] };
  const $ = cheerio.load(xml, { xml: true });
  const isIndex = $("sitemapindex").length > 0;
  const locs: string[] = [];
  $(isIndex ? "sitemapindex > sitemap > loc" : "urlset > url > loc").each((_, el) => {
    if (locs.length >= limit) return false;
    const v = $(el).text().trim();
    if (v) locs.push(v);
  });
  return { kind: isIndex ? "index" : "urlset", urls: locs };
}
