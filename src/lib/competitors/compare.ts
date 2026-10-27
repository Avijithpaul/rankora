/**
 * Competitor comparison logic. Pure and unit tested. Every number comes from a
 * stored observation (a SERP we checked, a provider ranking index snapshot, or
 * a page we fetched). Missing data stays null and is shown as "not checked".
 */
import type { ParsedPage } from "@/lib/crawler/parse-page";
import type { RankedKeyword } from "@/lib/providers/types";
import { normalizeKeyword } from "@/lib/keywords/utils";

export const MAX_COMPETITORS = 10;
export const KEYWORD_SNAPSHOT_TTL_DAYS = 7;

const DOMAIN_RE = /^[a-z0-9.-]{3,253}$/;
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/** Accepts "https://www.rival.com/path", "rival.com" … and returns "rival.com", or an error message. */
export function normalizeCompetitorDomain(input: string, ownDomain: string): { ok: true; domain: string } | { ok: false; message: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, message: "Enter a domain" };
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return { ok: false, message: "Enter a valid domain, e.g. competitor.com" };
  }
  const domain = bare(host);
  if (!DOMAIN_RE.test(domain) || !domain.includes(".") || /^\d+(\.\d+){3}$/.test(domain) || domain.includes(":")) {
    return { ok: false, message: "Enter a public domain name, e.g. competitor.com" };
  }
  if (domain === bare(ownDomain)) return { ok: false, message: "That is your own website" };
  return { ok: true, domain };
}

// ---------------------------------------------------------------------------
// Rankings on tracked keywords (same SERP for everyone)
// ---------------------------------------------------------------------------
export interface TrackedKeywordRow {
  id: string;
  keyword: string;
  searchVolume: number | null;
  /** our latest position; null = not in top 100; undefined = never checked */
  own: number | null | undefined;
  checkedOn: string | null;
}

export interface CompetitorRef {
  id: string;
  domain: string;
}

export type Positions = Map<string, Map<string, number | null>>; // competitorId -> keywordId -> position

export interface RankingSummary {
  competitorId: string;
  checked: number;
  bothRank: number;
  youAhead: number;
  theyAhead: number;
  onlyYou: number;
  onlyThem: number;
  /** visibility share among keywords both were checked for: sum of (101 - position) */
  ownVisibility: number;
  theirVisibility: number;
}

const visibility = (p: number | null | undefined) => (typeof p === "number" ? 101 - p : 0);

export function rankingSummary(keywords: TrackedKeywordRow[], competitors: CompetitorRef[], positions: Positions): RankingSummary[] {
  return competitors.map((c) => {
    const theirs = positions.get(c.id) ?? new Map<string, number | null>();
    const s: RankingSummary = { competitorId: c.id, checked: 0, bothRank: 0, youAhead: 0, theyAhead: 0, onlyYou: 0, onlyThem: 0, ownVisibility: 0, theirVisibility: 0 };
    for (const k of keywords) {
      if (k.own === undefined || !theirs.has(k.id)) continue; // not observed in the same SERP
      const t = theirs.get(k.id)!;
      s.checked++;
      s.ownVisibility += visibility(k.own);
      s.theirVisibility += visibility(t);
      if (k.own !== null && t !== null) {
        s.bothRank++;
        if (k.own < t) s.youAhead++;
        else if (t < k.own) s.theyAhead++;
      } else if (k.own !== null) s.onlyYou++;
      else if (t !== null) s.onlyThem++;
    }
    return s;
  });
}

// ---------------------------------------------------------------------------
// Overlap and gaps from provider ranking-index snapshots
// ---------------------------------------------------------------------------
export interface OverlapRow {
  keyword: string;
  own: number | null;
  theirs: number | null;
  searchVolume: number | null;
  ownUrl: string | null;
  theirUrl: string | null;
}

export interface OverlapResult {
  shared: OverlapRow[];
  /** competitor ranks, you do not (in the provider index) */
  gaps: OverlapRow[];
  /** both rank, competitor is ahead */
  behind: OverlapRow[];
  ownOnly: OverlapRow[];
  stats: { own: number; theirs: number; shared: number; gaps: number; ownOnly: number; overlapRate: number };
}

function index(items: RankedKeyword[]) {
  const m = new Map<string, RankedKeyword>();
  for (const i of items) {
    const k = normalizeKeyword(i.keyword);
    const cur = m.get(k);
    if (!cur || i.position < cur.position) m.set(k, i);
  }
  return m;
}

const byOpportunity = (a: OverlapRow, b: OverlapRow) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || (a.theirs ?? 999) - (b.theirs ?? 999) || a.keyword.localeCompare(b.keyword);

export function keywordOverlap(own: RankedKeyword[], theirs: RankedKeyword[]): OverlapResult {
  const o = index(own);
  const t = index(theirs);
  const shared: OverlapRow[] = [];
  const gaps: OverlapRow[] = [];
  const ownOnly: OverlapRow[] = [];
  for (const [k, ti] of t) {
    const oi = o.get(k);
    const row: OverlapRow = { keyword: ti.keyword, own: oi?.position ?? null, theirs: ti.position, searchVolume: ti.searchVolume ?? oi?.searchVolume ?? null, ownUrl: oi?.url ?? null, theirUrl: ti.url };
    (oi ? shared : gaps).push(row);
  }
  for (const [k, oi] of o) {
    if (!t.has(k)) ownOnly.push({ keyword: oi.keyword, own: oi.position, theirs: null, searchVolume: oi.searchVolume, ownUrl: oi.url, theirUrl: null });
  }
  shared.sort(byOpportunity);
  gaps.sort(byOpportunity);
  ownOnly.sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.keyword.localeCompare(b.keyword));
  const behind = shared.filter((r) => r.own !== null && r.theirs !== null && r.theirs < r.own);
  const union = new Set([...o.keys(), ...t.keys()]).size;
  return {
    shared,
    gaps,
    behind,
    ownOnly,
    stats: { own: o.size, theirs: t.size, shared: shared.length, gaps: gaps.length, ownOnly: ownOnly.length, overlapRate: union ? Math.round((shared.length / union) * 1000) / 1000 : 0 },
  };
}

// ---------------------------------------------------------------------------
// Homepage technical snapshot (one page, not a full crawl)
// ---------------------------------------------------------------------------
export interface TechnicalSnapshot {
  url: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
  status: number | null;
  finalUrl: string | null;
  https: boolean | null;
  responseTimeMs: number | null;
  redirects: number;
  robotsTxt: boolean | null;
  sitemap: boolean | null;
  title: string | null;
  metaDescription: string | null;
  h1Count: number | null;
  wordCount: number | null;
  canonical: boolean | null;
  noindex: boolean | null;
  hasViewport: boolean | null;
  lang: string | null;
  structuredData: string[];
  openGraph: boolean | null;
  imagesMissingAlt: number | null;
  internalLinks: number | null;
}

export function snapshotFromPage(
  url: string,
  fetched: { status: number; finalUrl: string; responseTimeMs: number; redirects: number },
  page: ParsedPage,
  extras: { robotsTxt: boolean; sitemap: boolean },
  now = new Date(),
): TechnicalSnapshot {
  return {
    url,
    fetchedAt: now.toISOString(),
    ok: true,
    error: null,
    status: fetched.status,
    finalUrl: fetched.finalUrl,
    https: fetched.finalUrl.startsWith("https://"),
    responseTimeMs: fetched.responseTimeMs,
    redirects: fetched.redirects,
    robotsTxt: extras.robotsTxt,
    sitemap: extras.sitemap,
    title: page.title,
    metaDescription: page.metaDescription,
    h1Count: page.h1.filter(Boolean).length,
    wordCount: page.wordCount,
    canonical: Boolean(page.canonical),
    noindex: page.noindex,
    hasViewport: page.hasViewport,
    lang: page.lang,
    structuredData: page.structuredDataTypes,
    openGraph: Boolean(page.openGraph.title && page.openGraph.description && page.openGraph.image),
    imagesMissingAlt: page.images.missingAlt,
    internalLinks: page.links.filter((l) => l.internal).length,
  };
}

export function failedSnapshot(url: string, error: string, now = new Date()): TechnicalSnapshot {
  return {
    url, fetchedAt: now.toISOString(), ok: false, error, status: null, finalUrl: null, https: null, responseTimeMs: null, redirects: 0,
    robotsTxt: null, sitemap: null, title: null, metaDescription: null, h1Count: null, wordCount: null, canonical: null, noindex: null,
    hasViewport: null, lang: null, structuredData: [], openGraph: null, imagesMissingAlt: null, internalLinks: null,
  };
}

export type CheckOutcome = "pass" | "fail" | "unknown";

export interface SnapshotCheck {
  id: string;
  label: string;
  own: CheckOutcome;
  theirs: CheckOutcome;
  ownValue: string;
  theirValue: string;
}

const yes = (v: boolean | null | undefined): CheckOutcome => (v === null || v === undefined ? "unknown" : v ? "pass" : "fail");
const between = (n: number | null | undefined, min: number, max: number): CheckOutcome => (typeof n === "number" ? (n >= min && n <= max ? "pass" : "fail") : "unknown");

/** Same checks applied to both homepages, so the comparison is like-for-like. */
export function compareSnapshots(own: TechnicalSnapshot, theirs: TechnicalSnapshot): SnapshotCheck[] {
  const rows: [string, string, (s: TechnicalSnapshot) => CheckOutcome, (s: TechnicalSnapshot) => string][] = [
    ["reachable", "Homepage returns 200", (s) => (s.ok ? (s.status === 200 ? "pass" : "fail") : "unknown"), (s) => (s.ok ? String(s.status) : (s.error ?? "error"))],
    ["https", "Served over HTTPS", (s) => yes(s.https), (s) => (s.https === null ? "—" : s.https ? "Yes" : "No")],
    ["speed", "Server response under 1 s", (s) => (typeof s.responseTimeMs === "number" ? (s.responseTimeMs <= 1000 ? "pass" : "fail") : "unknown"), (s) => (s.responseTimeMs === null ? "—" : `${s.responseTimeMs} ms`)],
    ["robots", "robots.txt present", (s) => yes(s.robotsTxt), (s) => (s.robotsTxt === null ? "—" : s.robotsTxt ? "Found" : "Missing")],
    ["sitemap", "XML sitemap found", (s) => yes(s.sitemap), (s) => (s.sitemap === null ? "—" : s.sitemap ? "Found" : "Missing")],
    ["title", "Title 30–60 characters", (s) => (s.ok ? between(s.title?.length ?? 0, 30, 60) : "unknown"), (s) => (s.title ? `${s.title.length} chars` : s.ok ? "Missing" : "—")],
    ["meta", "Meta description 70–160 characters", (s) => (s.ok ? between(s.metaDescription?.length ?? 0, 70, 160) : "unknown"), (s) => (s.metaDescription ? `${s.metaDescription.length} chars` : s.ok ? "Missing" : "—")],
    ["h1", "Exactly one H1", (s) => (s.h1Count === null ? "unknown" : s.h1Count === 1 ? "pass" : "fail"), (s) => (s.h1Count === null ? "—" : String(s.h1Count))],
    ["canonical", "Canonical tag", (s) => yes(s.canonical), (s) => (s.canonical === null ? "—" : s.canonical ? "Yes" : "No")],
    ["indexable", "Indexable (no noindex)", (s) => (s.noindex === null ? "unknown" : s.noindex ? "fail" : "pass"), (s) => (s.noindex === null ? "—" : s.noindex ? "noindex" : "Yes")],
    ["viewport", "Mobile viewport", (s) => yes(s.hasViewport), (s) => (s.hasViewport === null ? "—" : s.hasViewport ? "Yes" : "No")],
    ["lang", "Language declared", (s) => (s.ok ? yes(Boolean(s.lang)) : "unknown"), (s) => s.lang ?? (s.ok ? "Missing" : "—")],
    ["schema", "Structured data", (s) => (s.ok ? yes(s.structuredData.length > 0) : "unknown"), (s) => (s.structuredData.length ? s.structuredData.slice(0, 3).join(", ") : s.ok ? "None" : "—")],
    ["og", "Open Graph title, description, image", (s) => yes(s.openGraph), (s) => (s.openGraph === null ? "—" : s.openGraph ? "Complete" : "Incomplete")],
    ["alt", "All images have alt text", (s) => (s.imagesMissingAlt === null ? "unknown" : s.imagesMissingAlt === 0 ? "pass" : "fail"), (s) => (s.imagesMissingAlt === null ? "—" : `${s.imagesMissingAlt} missing`)],
  ];
  return rows.map(([id, label, test, value]) => ({ id, label, own: test(own), theirs: test(theirs), ownValue: value(own), theirValue: value(theirs) }));
}

export function snapshotScore(checks: SnapshotCheck[], side: "own" | "theirs"): number | null {
  const known = checks.filter((c) => c[side] !== "unknown");
  if (!known.length) return null;
  return Math.round((known.filter((c) => c[side] === "pass").length / known.length) * 100);
}
