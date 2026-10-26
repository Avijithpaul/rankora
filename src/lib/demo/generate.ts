/**
 * Demo Project dataset for academic presentations.
 *
 * Everything produced here is SAMPLE DATA. It is written only into a demo
 * organization (`organizations.is_demo`), on a demo website (`websites.is_demo`),
 * with `source = 'demo'` / `metrics_source = 'demo'`, and the UI labels it
 * "Demo Data". The audit score is computed by the real scoring engine from the
 * sample rule evaluations below, so the scoring logic is exercised honestly.
 *
 * Values are deterministic (seeded PRNG) so presentations are reproducible.
 */
import { RULES } from "@/lib/seo/rules";
import { computeScore, SCORING_VERSION, type RuleEvaluation } from "@/lib/seo/scoring";

export const DEMO_DOMAIN = "northwind-outdoor.example";
const BASE = `https://www.${DEMO_DOMAIN}`;
const PAGES = 120;
const DAYS = 90;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Affected page counts (out of PAGES) for page rules; site rules: 1 = failed, 0 = passed. */
const DEMO_FAILURES: Record<string, number> = {
  "site.https": 0,
  "site.robots_txt": 0,
  "site.robots_blocks_all": 0,
  "site.sitemap": 0,
  "site.http_redirects_to_https": 0,
  "site.core_web_vitals": 1,
  "page.status_4xx_5xx": 3,
  "page.redirect_chain": 6,
  "page.noindex": 2,
  "page.canonical": 14,
  "page.canonical_points_elsewhere": 0,
  "page.title_missing": 2,
  "page.title_length": 27,
  "page.title_duplicate": 8,
  "page.meta_description_missing": 19,
  "page.meta_description_length": 33,
  "page.meta_description_duplicate": 11,
  "page.h1_missing": 5,
  "page.h1_multiple": 9,
  "page.heading_hierarchy": 22,
  "page.lang": 0,
  "page.thin_content": 17,
  "page.duplicate_content": 4,
  "page.image_alt": 41,
  "page.broken_internal_links": 7,
  "page.broken_external_links": 3,
  "page.orphan": 6,
  "page.url_structure": 12,
  "page.response_time": 10,
  "page.viewport": 0,
  "page.structured_data": 58,
  "page.open_graph": 24,
  "page.twitter_card": 64,
};

const SECTIONS = ["tents", "backpacks", "jackets", "boots", "sleeping-bags", "guides"];

function demoUrl(i: number) {
  if (i === 0) return `${BASE}/`;
  const section = SECTIONS[i % SECTIONS.length];
  return `${BASE}/${section}/${section === "guides" ? "how-to-choose" : "item"}-${i}`;
}

const QUERIES = [
  "best hiking backpack",
  "lightweight tent 2 person",
  "waterproof hiking boots",
  "how to choose a sleeping bag",
  "down jacket vs synthetic",
  "northwind outdoor",
  "camping gear checklist",
  "ultralight backpacking tent",
  "winter hiking jacket",
  "trail running shoes waterproof",
  "sleeping bag temperature rating",
  "backpack sizing guide",
];

const TRACKED = [
  { keyword: "best hiking backpack", start: 14, end: 7, volume: 22000, difficulty: 54 },
  { keyword: "lightweight tent 2 person", start: 9, end: 4, volume: 8100, difficulty: 41 },
  { keyword: "waterproof hiking boots", start: 18, end: 21, volume: 14800, difficulty: 62 },
  { keyword: "how to choose a sleeping bag", start: 6, end: 3, volume: 2900, difficulty: 28 },
  { keyword: "down jacket vs synthetic", start: 23, end: 12, volume: 1900, difficulty: 33 },
  { keyword: "northwind outdoor", start: 1, end: 1, volume: 720, difficulty: 5 },
  { keyword: "camping gear checklist", start: 31, end: 38, volume: 6600, difficulty: 45 },
  { keyword: "ultralight backpacking tent", start: 44, end: 27, volume: 3600, difficulty: 49 },
  { keyword: "winter hiking jacket", start: null, end: 58, volume: 4400, difficulty: 51 },
  { keyword: "sleeping bag temperature rating", start: 11, end: null, volume: 1300, difficulty: 22 },
] as const;

export interface DemoPayload {
  website: { name: string; domain: string; base_url: string; country_code: string; language_code: string };
  audit: {
    scoring_version: string;
    score: number;
    pages_analyzed: number;
    score_breakdown: unknown;
    checks: {
      rule_id: string;
      category: string;
      severity: string;
      result: string;
      weight: number;
      rule_score: number;
      affected_count: number;
      total_count: number;
      explanation: string;
      recommendation: string;
    }[];
  };
  issues: {
    rule_id: string;
    title: string;
    explanation: string;
    recommendation: string;
    severity: string;
    affected_pages_count: number;
    urls: string[];
  }[];
  gsc_daily: { date: string; clicks: number; impressions: number; ctr: number; position: number }[];
  gsc_queries: { date: string; query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  gsc_pages: { date: string; page: string; clicks: number; impressions: number; ctr: number; position: number }[];
  ga_daily: {
    date: string;
    channel: string;
    users: number;
    new_users: number;
    sessions: number;
    engaged_sessions: number;
    page_views: number;
    engagement_rate: number;
  }[];
  keywords: {
    keyword: string;
    search_volume: number;
    difficulty: number;
    target_url: string;
    rankings: { checked_on: string; position: number | null; ranking_url: string | null }[];
  }[];
}

export function buildDemoPayload(today = new Date()): DemoPayload {
  const rand = mulberry32(20261025);
  const day = (offset: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - offset);
    return isoDay(d);
  };

  // ---- audit, scored by the real engine -----------------------------------
  const evaluations: RuleEvaluation[] = RULES.map((r) => {
    const failed = DEMO_FAILURES[r.id] ?? 0;
    const total = r.scope === "site" ? 1 : PAGES;
    const affected = r.scope === "site" ? Math.min(failed, 1) : failed;
    return {
      ruleId: r.id,
      applicable: true,
      affected,
      total,
      affectedUrls: Array.from({ length: Math.min(affected, 10) }, (_, i) => demoUrl((i * 7 + r.id.length) % PAGES)),
    };
  });
  const summary = computeScore(evaluations);

  const audit: DemoPayload["audit"] = {
    scoring_version: SCORING_VERSION,
    score: summary.score,
    pages_analyzed: PAGES,
    score_breakdown: { byCategory: summary.byCategory, earnedWeight: summary.earnedWeight, possibleWeight: summary.possibleWeight },
    checks: summary.checks.map((c) => ({
      rule_id: c.ruleId,
      category: c.category,
      severity: c.severity,
      result: c.result,
      weight: c.weight,
      rule_score: c.ruleScore,
      affected_count: c.affected,
      total_count: c.total,
      explanation: c.explanation,
      recommendation: c.recommendation,
    })),
  };

  const issues: DemoPayload["issues"] = summary.checks
    .filter((c) => c.result === "failed" && c.severity !== "passed")
    .map((c) => ({
      rule_id: c.ruleId,
      title: c.title,
      explanation: c.explanation,
      recommendation: c.recommendation,
      severity: c.severity,
      affected_pages_count: c.affected,
      urls: [...new Set(c.affectedUrls)],
    }));

  // ---- search console + analytics (90 days, gentle upward trend) ---------------
  const gsc_daily: DemoPayload["gsc_daily"] = [];
  const ga_daily: DemoPayload["ga_daily"] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = day(i);
    const trend = 1 + (DAYS - i) / DAYS / 2; // up to +50% over the period
    const weekday = new Date(date).getUTCDay();
    const weekly = weekday === 0 || weekday === 6 ? 0.82 : 1;
    const noise = 0.9 + rand() * 0.2;
    const impressions = Math.round(5200 * trend * weekly * noise);
    const clicks = Math.round(impressions * (0.031 + rand() * 0.006));
    gsc_daily.push({
      date,
      clicks,
      impressions,
      ctr: Number((clicks / impressions).toFixed(6)),
      position: Number((19.5 - (DAYS - i) * 0.05 + rand()).toFixed(2)),
    });
    const sessions = Math.round(clicks * 1.18);
    const users = Math.round(sessions * 0.86);
    ga_daily.push({
      date,
      channel: "Organic Search",
      users,
      new_users: Math.round(users * 0.71),
      sessions,
      engaged_sessions: Math.round(sessions * 0.63),
      page_views: Math.round(sessions * 2.4),
      engagement_rate: 0.63,
    });
  }

  // ---- query / page breakdown for the last 28 days -----------------------
  const gsc_queries: DemoPayload["gsc_queries"] = [];
  const gsc_pages: DemoPayload["gsc_pages"] = [];
  for (let i = 27; i >= 0; i--) {
    const date = day(i);
    QUERIES.forEach((query, qi) => {
      const impressions = Math.round((900 / (qi + 1.4)) * (0.85 + rand() * 0.3));
      const position = Number((2 + qi * 1.7 + rand() * 1.5).toFixed(2));
      const clicks = Math.round(impressions * Math.max(0.01, 0.28 - position * 0.013));
      gsc_queries.push({ date, query, clicks, impressions, ctr: Number((clicks / impressions).toFixed(6)), position });
    });
    for (let p = 0; p < 10; p++) {
      const page = demoUrl(p === 0 ? 0 : p * 11);
      const impressions = Math.round((1400 / (p + 1.2)) * (0.85 + rand() * 0.3));
      const position = Number((3 + p * 1.9 + rand()).toFixed(2));
      const clicks = Math.round(impressions * Math.max(0.01, 0.25 - position * 0.011));
      gsc_pages.push({ date, page, clicks, impressions, ctr: Number((clicks / impressions).toFixed(6)), position });
    }
  }

  // ---- tracked keywords with 30 daily rank snapshots -----------------------
  const keywords: DemoPayload["keywords"] = TRACKED.map((k, ki) => {
    const target = demoUrl(ki * 11 + 1);
    const rankings: DemoPayload["keywords"][number]["rankings"] = [];
    for (let i = 29; i >= 0; i--) {
      const t = (29 - i) / 29;
      let position: number | null;
      if (k.start === null) position = t < 0.6 ? null : Math.round(k.end + (1 - t) * 20);
      else if (k.end === null) position = t > 0.85 ? null : Math.round(k.start + t * 12);
      else position = Math.max(1, Math.round(k.start + (k.end - k.start) * t + (rand() - 0.5) * 2));
      if (position !== null && position > 100) position = null;
      rankings.push({ checked_on: day(i), position, ranking_url: position === null ? null : target });
    }
    return { keyword: k.keyword, search_volume: k.volume, difficulty: k.difficulty, target_url: target, rankings };
  });

  return {
    website: {
      name: "Northwind Outdoor",
      domain: DEMO_DOMAIN,
      base_url: `${BASE}/`,
      country_code: "US",
      language_code: "en",
    },
    audit,
    issues,
    gsc_daily,
    gsc_queries,
    gsc_pages,
    ga_daily,
    keywords,
  };
}
