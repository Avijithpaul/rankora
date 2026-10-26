/**
 * Transparent weighted SEO scoring.
 *
 *   rule_score  = 1                       (site rule passed)
 *               = 0                       (site rule failed)
 *               = 1 - affected / total    (page rule, share of pages passing)
 *   score       = 100 * Σ(weight · rule_score) / Σ(weight)   over applicable rules
 *
 * Rules that could not be evaluated (no data, provider not connected) are
 * "not_applicable" and excluded from both numerator and denominator, so a
 * missing integration never silently lowers or inflates the score.
 */
import { RULES_BY_ID, type RuleCategory, type RuleDefinition, type Severity } from "./rules";

export const SCORING_VERSION = "2026.10-1";

export interface RuleEvaluation {
  ruleId: string;
  /** false when the rule could not be evaluated (excluded from the score). */
  applicable: boolean;
  /** Pages (or 1 for site rules) failing the rule. */
  affected: number;
  /** Pages evaluated (or 1 for site rules). */
  total: number;
  /** Affected URLs (sample), stored as issue pages. */
  affectedUrls?: string[];
  details?: Record<string, unknown>;
}

export type CheckResult = "passed" | "failed" | "not_applicable";

export interface ScoredCheck {
  ruleId: string;
  title: string;
  category: RuleCategory;
  result: CheckResult;
  severity: Severity | "passed";
  weight: number;
  ruleScore: number;
  affected: number;
  total: number;
  explanation: string;
  recommendation: string;
  affectedUrls: string[];
  details: Record<string, unknown>;
}

export interface ScoreSummary {
  version: string;
  score: number;
  earnedWeight: number;
  possibleWeight: number;
  byCategory: Record<string, { score: number; earned: number; possible: number }>;
  counts: { critical: number; warning: number; opportunity: number; passed: number; notApplicable: number };
  checks: ScoredCheck[];
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

export function scoreRule(rule: RuleDefinition, ev: RuleEvaluation): ScoredCheck {
  if (ev.affected < 0 || ev.total < 0 || ev.affected > ev.total) {
    throw new Error(`Invalid evaluation for ${rule.id}: affected=${ev.affected} total=${ev.total}`);
  }
  const applicable = ev.applicable && ev.total > 0;
  let ruleScore = 1;
  if (applicable) {
    ruleScore = rule.scope === "site" ? (ev.affected > 0 ? 0 : 1) : 1 - ev.affected / ev.total;
  }
  const result: CheckResult = !applicable ? "not_applicable" : ev.affected > 0 ? "failed" : "passed";
  return {
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    result,
    severity: result === "failed" ? rule.severity : "passed",
    weight: rule.weight,
    ruleScore: round(ruleScore, 4),
    affected: applicable ? ev.affected : 0,
    total: applicable ? ev.total : 0,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    affectedUrls: ev.affectedUrls ?? [],
    details: ev.details ?? {},
  };
}

export function computeScore(evaluations: RuleEvaluation[]): ScoreSummary {
  const seen = new Set<string>();
  const checks = evaluations.map((ev) => {
    if (seen.has(ev.ruleId)) throw new Error(`Duplicate evaluation for ${ev.ruleId}`);
    seen.add(ev.ruleId);
    const rule = RULES_BY_ID.get(ev.ruleId);
    if (!rule) throw new Error(`Unknown SEO rule: ${ev.ruleId}`);
    return scoreRule(rule, ev);
  });

  let earned = 0;
  let possible = 0;
  const byCategory: ScoreSummary["byCategory"] = {};
  const counts = { critical: 0, warning: 0, opportunity: 0, passed: 0, notApplicable: 0 };

  for (const c of checks) {
    if (c.result === "not_applicable") {
      counts.notApplicable++;
      continue;
    }
    counts[c.severity === "passed" ? "passed" : c.severity]++;
    earned += c.weight * c.ruleScore;
    possible += c.weight;
    const cat = (byCategory[c.category] ??= { score: 0, earned: 0, possible: 0 });
    cat.earned += c.weight * c.ruleScore;
    cat.possible += c.weight;
  }
  for (const cat of Object.values(byCategory)) {
    cat.score = cat.possible > 0 ? round((100 * cat.earned) / cat.possible) : 0;
    cat.earned = round(cat.earned, 4);
  }

  return {
    version: SCORING_VERSION,
    // No applicable rules => no score rather than a fake 100.
    score: possible > 0 ? round((100 * earned) / possible) : 0,
    earnedWeight: round(earned, 4),
    possibleWeight: possible,
    byCategory,
    counts,
    checks,
  };
}

export function scoreBand(score: number): { label: string; tone: "good" | "fair" | "poor" } {
  if (score >= 85) return { label: "Good", tone: "good" };
  if (score >= 60) return { label: "Needs work", tone: "fair" };
  return { label: "Poor", tone: "poor" };
}
