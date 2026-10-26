import { describe, expect, it } from "vitest";
import { computeScore, scoreBand } from "@/lib/seo/scoring";
import { RULES, RULES_BY_ID, SEVERITY_WEIGHT } from "@/lib/seo/rules";

describe("rule catalog", () => {
  it("has unique, well-formed ids", () => {
    expect(RULES_BY_ID.size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[a-z0-9_.]{2,64}$/); // matches seo_checks.rule_id check constraint
      expect(r.weight).toBeGreaterThan(0);
      expect(r.explanation.length).toBeGreaterThan(10);
      expect(r.recommendation.length).toBeGreaterThan(10);
    }
  });

  it("derives default weight from severity", () => {
    expect(RULES_BY_ID.get("page.title_missing")!.weight).toBe(SEVERITY_WEIGHT.critical);
    expect(RULES_BY_ID.get("page.open_graph")!.weight).toBe(SEVERITY_WEIGHT.opportunity);
  });
});

describe("computeScore", () => {
  it("scores 100 when every applicable rule passes", () => {
    const s = computeScore([
      { ruleId: "site.https", applicable: true, affected: 0, total: 1 },
      { ruleId: "page.title_missing", applicable: true, affected: 0, total: 20 },
    ]);
    expect(s.score).toBe(100);
    expect(s.counts.passed).toBe(2);
  });

  it("weights page rules by the share of failing pages", () => {
    // title_missing (w10): 5/20 pages fail -> 0.75 ; https (w10) passes -> 1
    const s = computeScore([
      { ruleId: "site.https", applicable: true, affected: 0, total: 1 },
      { ruleId: "page.title_missing", applicable: true, affected: 5, total: 20 },
    ]);
    expect(s.earnedWeight).toBe(17.5);
    expect(s.possibleWeight).toBe(20);
    expect(s.score).toBe(87.5);
    expect(s.counts.critical).toBe(1);
  });

  it("treats site rules as all-or-nothing", () => {
    const s = computeScore([
      { ruleId: "site.https", applicable: true, affected: 1, total: 1 },
      { ruleId: "page.open_graph", applicable: true, affected: 0, total: 3 },
    ]);
    // https w10 -> 0 ; open_graph w2 -> 1 => 2/12
    expect(s.score).toBeCloseTo(16.67, 2);
  });

  it("excludes not-applicable rules from numerator and denominator", () => {
    const withNa = computeScore([
      { ruleId: "page.title_missing", applicable: true, affected: 0, total: 10 },
      { ruleId: "site.core_web_vitals", applicable: false, affected: 0, total: 0 },
    ]);
    expect(withNa.score).toBe(100);
    expect(withNa.counts.notApplicable).toBe(1);
    expect(withNa.checks.find((c) => c.ruleId === "site.core_web_vitals")!.result).toBe("not_applicable");
  });

  it("returns score 0 with possibleWeight 0 when nothing could be evaluated", () => {
    const s = computeScore([{ ruleId: "site.core_web_vitals", applicable: false, affected: 0, total: 0 }]);
    expect(s.possibleWeight).toBe(0);
    expect(s.score).toBe(0);
  });

  it("computes per-category scores", () => {
    const s = computeScore([
      { ruleId: "page.title_missing", applicable: true, affected: 10, total: 10 },
      { ruleId: "page.viewport", applicable: true, affected: 0, total: 10 },
    ]);
    expect(s.byCategory.on_page.score).toBe(0);
    expect(s.byCategory.mobile.score).toBe(100);
  });

  it("rejects unknown rules, duplicates and impossible counts", () => {
    expect(() => computeScore([{ ruleId: "nope", applicable: true, affected: 0, total: 1 }])).toThrow(/Unknown/);
    expect(() =>
      computeScore([
        { ruleId: "site.https", applicable: true, affected: 0, total: 1 },
        { ruleId: "site.https", applicable: true, affected: 0, total: 1 },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => computeScore([{ ruleId: "page.h1_missing", applicable: true, affected: 5, total: 2 }])).toThrow(
      /Invalid/,
    );
  });

  it("is deterministic", () => {
    const input = [
      { ruleId: "page.thin_content", applicable: true, affected: 3, total: 7 },
      { ruleId: "site.sitemap", applicable: true, affected: 1, total: 1 },
    ];
    expect(computeScore(input)).toEqual(computeScore(input));
  });
});

describe("scoreBand", () => {
  it("bands scores", () => {
    expect(scoreBand(90).tone).toBe("good");
    expect(scoreBand(70).tone).toBe("fair");
    expect(scoreBand(30).tone).toBe("poor");
  });
});
