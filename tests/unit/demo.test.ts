import { describe, expect, it } from "vitest";
import { buildDemoPayload, DEMO_DOMAIN } from "@/lib/demo/generate";
import { RULES } from "@/lib/seo/rules";
import { computeScore } from "@/lib/seo/scoring";

describe("demo payload", () => {
  const p = buildDemoPayload(new Date("2026-10-26T00:00:00Z"));

  it("is deterministic", () => {
    expect(buildDemoPayload(new Date("2026-10-26T00:00:00Z"))).toEqual(p);
  });

  it("uses a reserved .example domain that cannot be a real customer site", () => {
    expect(DEMO_DOMAIN.endsWith(".example")).toBe(true);
    expect(p.website.base_url).toContain(DEMO_DOMAIN);
  });

  it("evaluates every rule and its score matches the scoring engine", () => {
    expect(p.audit.checks).toHaveLength(RULES.length);
    const recomputed = computeScore(
      p.audit.checks.map((c) => ({ ruleId: c.rule_id, applicable: c.result !== "not_applicable", affected: c.affected_count, total: c.total_count })),
    );
    expect(recomputed.score).toBe(p.audit.score);
    expect(p.audit.score).toBeGreaterThan(0);
    expect(p.audit.score).toBeLessThan(100);
  });

  it("creates one issue per failed rule", () => {
    expect(p.issues.length).toBe(p.audit.checks.filter((c) => c.result === "failed").length);
  });

  it("stays within the database function's size limits", () => {
    expect(p.gsc_daily.length).toBeLessThanOrEqual(400);
    expect(p.gsc_queries.length).toBeLessThanOrEqual(3000);
    expect(p.gsc_pages.length).toBeLessThanOrEqual(3000);
    expect(p.keywords.length).toBeLessThanOrEqual(50);
  });

  it("has internally consistent metrics", () => {
    for (const d of p.gsc_daily) expect(d.clicks).toBeLessThanOrEqual(d.impressions);
    for (const k of p.keywords) for (const r of k.rankings) if (r.position !== null) expect(r.position).toBeGreaterThanOrEqual(1);
  });
});
