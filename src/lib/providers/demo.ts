/**
 * Demo keyword provider — ONLY ever used for websites with `is_demo = true`.
 * Returns deterministic SAMPLE data so the Demo Project can show the research
 * workflow. Every result is labelled "Demo Data" in the UI; the registry never
 * returns this provider for a real website.
 */
import type { KeywordIdea, KeywordMetrics, KeywordProvider } from "./types";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const MODIFIERS = ["best", "cheap", "lightweight", "waterproof", "for beginners", "review", "vs", "2026", "near me", "for women", "for men", "sale"];
const QUESTIONS = ["how to choose", "what is the best", "how much does a", "why buy a", "which"];

function sample(keyword: string, source: KeywordIdea["source"]): KeywordIdea {
  const h = hash(keyword);
  const words = keyword.split(" ").length;
  return {
    keyword,
    source,
    searchVolume: Math.max(10, Math.round(((h % 9000) + 100) / words / 10) * 10),
    cpc: Math.round(((h >> 8) % 400) + 20) / 100,
    competition: ((h >> 4) % 100) / 100,
    difficulty: (h >> 12) % 100,
    intent: keyword.startsWith("how") || keyword.startsWith("what") || keyword.startsWith("why") || keyword.startsWith("which")
      ? "informational"
      : /best|review|vs/.test(keyword)
        ? "commercial"
        : /cheap|sale|buy|near me/.test(keyword)
          ? "transactional"
          : "informational",
    monthlySearches: null,
  };
}

export const demoKeywordProvider: KeywordProvider = {
  id: "demo",
  name: "Demo Data",
  async ideas(seed: string) {
    const s = seed.trim().toLowerCase();
    const list = [s, ...MODIFIERS.map((m) => (m === "vs" ? `${s} vs ${s.split(" ").pop()} alternative` : /^(best|cheap|lightweight|waterproof)$/.test(m) ? `${m} ${s}` : `${s} ${m}`)), ...QUESTIONS.map((q) => `${q} ${s}`)];
    return [...new Set(list)].map((k, i) => sample(k, i % 3 === 0 ? "related" : "suggestion"));
  },
  async metrics(keywords: string[]): Promise<KeywordMetrics[]> {
    return keywords.map((k) => {
      const { source: _s, ...m } = sample(k.toLowerCase(), "related");
      void _s;
      return m;
    });
  },
};
