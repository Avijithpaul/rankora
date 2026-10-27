/**
 * Semantic term sources and internal-link opportunities. Pure selection logic;
 * the service feeds it rows from the database. Every term keeps its source so
 * the UI can show where it came from — nothing is generated or estimated here.
 */
import { fold, significantTokens, tokenize, type SemanticTerm } from "./analyze";
import type { ContentDocument } from "./document";

export const MAX_TERMS = 40;

const shareToken = (a: string[], b: string[]) => a.some((t) => b.includes(t));

/** Saved keywords of the same website that share a significant word with the target keyword. */
export function termsFromSavedKeywords(keyword: string, saved: string[], limit = 15): SemanticTerm[] {
  const kw = significantTokens(keyword);
  return saved
    .filter((k) => shareToken(significantTokens(k), kw))
    .slice(0, limit)
    .map((term) => ({ term, source: "saved_keyword" as const }));
}

/** Real Search Console queries containing a keyword word, ordered by impressions. */
export function termsFromSearchConsole(keyword: string, rows: { key: string; impressions: number | null }[], limit = 20): SemanticTerm[] {
  const kw = significantTokens(keyword);
  return rows
    .filter((r) => r.key && shareToken(significantTokens(r.key), kw))
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, limit)
    .map((r) => ({ term: r.key, source: "search_console" as const, weight: r.impressions }));
}

/** Terms typed by the user: one per line or comma separated. */
export function parseUserTerms(input: string | null | undefined, limit = 30): SemanticTerm[] {
  const seen = new Set<string>();
  const out: SemanticTerm[] = [];
  for (const raw of (input ?? "").split(/[\n,;]+/)) {
    const term = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    const key = tokenize(term).map(fold).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ term, source: "user" });
    if (out.length >= limit) break;
  }
  return out;
}

/** User terms first (explicit intent), then Search Console, then saved keywords. */
export function mergeTerms(...lists: SemanticTerm[][]): SemanticTerm[] {
  const seen = new Set<string>();
  const out: SemanticTerm[] = [];
  for (const t of lists.flat()) {
    const key = tokenize(t.term).map(fold).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, MAX_TERMS);
}

export interface CrawledPageRef {
  url: string;
  title: string | null;
  h1: string[];
  inbound: number | null;
}

export interface LinkOpportunity {
  url: string;
  title: string | null;
  matchedWords: string[];
  inbound: number | null;
}

/**
 * Rule-based internal-link opportunities: crawled pages whose URL, title or H1
 * share words with the keyword and that the content does not link to yet.
 */
export function linkOpportunities(keyword: string, pages: CrawledPageRef[], doc: ContentDocument, limit = 10): LinkOpportunity[] {
  const kw = significantTokens(keyword);
  const linked = new Set(doc.links.map((l) => l.url.replace(/\/$/, "")));
  const self = doc.url?.replace(/\/$/, "");
  const out: LinkOpportunity[] = [];
  for (const p of pages) {
    const u = p.url.replace(/\/$/, "");
    if (u === self || linked.has(u)) continue;
    let path = p.url;
    try {
      path = new URL(p.url).pathname;
      if (linked.has(new URL(p.url).pathname.replace(/\/$/, ""))) continue; // draft links are often relative
    } catch {
      /* keep full url */
    }
    const words = new Set(significantTokens(`${path.replace(/[-_/]+/g, " ")} ${p.title ?? ""} ${p.h1.join(" ")}`));
    const matched = kw.filter((t) => words.has(t));
    if (matched.length) out.push({ url: p.url, title: p.title, matchedWords: matched, inbound: p.inbound });
  }
  return out.sort((a, b) => b.matchedWords.length - a.matchedWords.length || (b.inbound ?? 0) - (a.inbound ?? 0) || a.url.localeCompare(b.url)).slice(0, limit);
}
