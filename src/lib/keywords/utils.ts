/** Keyword helpers: normalization, classification, clustering, rule-based intent. Pure. */
import type { Intent } from "@/lib/providers/types";

export function normalizeKeyword(k: string): string {
  return k
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidKeyword(k: string): boolean {
  const n = normalizeKeyword(k);
  return n.length >= 1 && n.length <= 200 && /[\p{L}\p{N}]/u.test(n);
}

const QUESTION_WORDS = /^(who|what|when|where|why|how|which|can|does|do|is|are|should|will|could|would)\b/;

export type IdeaType = "question" | "long_tail" | "related";

/** Question if it starts with a question word or ends in "?", long-tail if 4+ words. */
export function ideaType(keyword: string): IdeaType {
  const n = normalizeKeyword(keyword);
  if (QUESTION_WORDS.test(n) || n.endsWith("?")) return "question";
  if (n.split(" ").length >= 4) return "long_tail";
  return "related";
}

/**
 * Rule-based intent for keywords the provider did not classify. Always shown
 * in the UI as "rule-based" so it is never confused with provider data.
 */
export function inferIntent(keyword: string): Intent | null {
  const n = normalizeKeyword(keyword);
  if (/\b(buy|price|prices|cheap|deal|deals|discount|coupon|order|sale|for sale|shop|near me)\b/.test(n)) return "transactional";
  if (/\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives)\b/.test(n)) return "commercial";
  if (/\b(login|log in|sign in|website|official|contact)\b/.test(n)) return "navigational";
  if (QUESTION_WORDS.test(n) || /\b(guide|tutorial|tips|ideas|examples|meaning|definition)\b/.test(n)) return "informational";
  return null;
}

const STOP = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "with", "by", "at", "is", "are", "be", "how", "what", "why",
  "which", "who", "when", "where", "do", "does", "can", "best", "top", "vs", "my", "your", "near", "me", "2024", "2025", "2026",
]);

/**
 * Lightweight clustering: each keyword goes to its most frequent significant
 * token across the set (ties → alphabetical). Deterministic and explainable.
 */
export function clusterKeywords(keywords: string[], seed?: string): Map<string, string[]> {
  const seedTokens = new Set(normalizeKeyword(seed ?? "").split(" "));
  const tokensOf = (k: string) => [...new Set(normalizeKeyword(k).split(" ").filter((t) => t.length > 2 && !STOP.has(t) && !seedTokens.has(t)))];
  const freq = new Map<string, number>();
  for (const k of keywords) for (const t of tokensOf(k)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const clusters = new Map<string, string[]>();
  for (const k of keywords) {
    const toks = tokensOf(k).filter((t) => (freq.get(t) ?? 0) > 1);
    const label = toks.sort((a, b) => (freq.get(b)! - freq.get(a)!) || a.localeCompare(b))[0] ?? "other";
    clusters.set(label, [...(clusters.get(label) ?? []), k]);
  }
  return clusters;
}

export type PositionBucket = "top3" | "top10" | "top20" | "top100" | "none";
export function positionBucket(p: number | null): PositionBucket {
  if (p === null) return "none";
  if (p <= 3) return "top3";
  if (p <= 10) return "top10";
  if (p <= 20) return "top20";
  return "top100";
}

/** Positive = improved (moved up). null when either side is unknown. */
export function positionChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return previous - current;
}
