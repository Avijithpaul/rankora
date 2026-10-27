import { describe, expect, it } from "vitest";
import { averagePosition, distribution, highlights, isUnavailable, metric, movers, positionsAt, resolvePeriod, SECTIONS, type ReportSnapshot } from "@/lib/reports/compose";
import { csvExporter, jsonExporter, metricRows, pdfExporter } from "@/lib/reports/export";

const today = new Date("2026-10-28T10:00:00Z");

describe("resolvePeriod", () => {
  it("presets end yesterday and compare with the previous period of equal length", () => {
    expect(resolvePeriod({ type: "overview", preset: "28d" }, today)).toEqual({ from: "2026-09-30", to: "2026-10-27", days: 28, compareFrom: "2026-09-02", compareTo: "2026-09-29", compareMode: "previous" });
    expect(resolvePeriod({ type: "traffic", preset: "7d", compare: "none" }, today)).toMatchObject({ from: "2026-10-21", to: "2026-10-27", compareFrom: null, compareMode: "none" });
    expect(resolvePeriod({ type: "traffic", preset: "7d", compare: "year" }, today)).toMatchObject({ compareFrom: "2025-10-22", compareTo: "2025-10-28" });
  });
  it("validates custom ranges", () => {
    expect(resolvePeriod({ type: "overview", preset: "custom", from: "2026-10-10", to: "2026-10-01" }, today)).toEqual({ error: "The start date must be before the end date" });
    expect(resolvePeriod({ type: "overview", preset: "custom", from: "2024-01-01", to: "2026-01-01" }, today)).toEqual({ error: "Reports cover at most one year" });
    expect(resolvePeriod({ type: "overview", preset: "custom", from: "2026-10-01", to: "2026-12-31" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-27", days: 27 });
    expect(resolvePeriod({ type: "overview", preset: "custom", from: "bad", to: "" }, today)).toEqual({ error: "Enter both dates" });
  });
  it("monthly reports cover a calendar month and compare with the previous month", () => {
    expect(resolvePeriod({ type: "monthly", month: "2026-09" }, today)).toEqual({ from: "2026-09-01", to: "2026-09-30", days: 30, compareFrom: "2026-08-01", compareTo: "2026-08-31", compareMode: "previous" });
    expect(resolvePeriod({ type: "monthly", month: "2026-03" }, today)).toMatchObject({ compareFrom: "2026-02-01", compareTo: "2026-02-28" });
    expect(resolvePeriod({ type: "monthly", month: "2026-10" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-27" });
    expect(resolvePeriod({ type: "monthly", month: "2026-11" }, today)).toEqual({ error: "That month has not started yet" });
    expect(resolvePeriod({ type: "monthly", month: "2026-13" }, today)).toEqual({ error: "Choose a month" });
  });
});

describe("ranking computations", () => {
  const rows = [
    { keyword_id: "a", checked_on: "2026-09-01", position: 12 },
    { keyword_id: "a", checked_on: "2026-10-01", position: 3 },
    { keyword_id: "b", checked_on: "2026-09-01", position: 5 },
    { keyword_id: "b", checked_on: "2026-10-01", position: null },
    { keyword_id: "c", checked_on: "2026-10-01", position: 40 },
    { keyword_id: "a", checked_on: "2026-10-30", position: 1 }, // after the period end
  ];
  const after = positionsAt(rows, "2026-10-27");
  const before = positionsAt(rows, "2026-09-15");
  it("takes the latest position on or before a date", () => {
    expect([...after]).toEqual([["a", 3], ["b", null], ["c", 40]]);
    expect([...before]).toEqual([["a", 12], ["b", 5]]);
  });
  it("buckets positions and averages only ranking keywords", () => {
    expect(distribution(after)).toEqual({ "Top 3": 1, "4–10": 0, "11–20": 0, "21–100": 1, "Not in top 100": 1 });
    expect(averagePosition(after)).toBe(21.5);
    expect(averagePosition(new Map([["x", null]]))).toBeNull();
  });
  it("lists movers only for keywords observed at both dates", () => {
    const m = movers(before, after, new Map([["a", "boots"], ["b", "tents"], ["c", "socks"]]));
    expect(m.improved).toEqual([{ keyword: "boots", from: 12, to: 3 }]);
    expect(m.declined).toEqual([{ keyword: "tents", from: 5, to: null }]);
  });
});

const snapshot = (over: Partial<ReportSnapshot> = {}): ReportSnapshot => ({
  version: 1,
  type: "monthly",
  generatedAt: "2026-10-28T00:00:00Z",
  website: { id: "w", name: "Shop", domain: "shop.example", isDemo: false },
  period: { from: "2026-09-01", to: "2026-09-30", days: 30, compareFrom: "2026-08-01", compareTo: "2026-08-31", compareMode: "previous" },
  audit: {
    source: "crawl",
    audit: { score: 81.4, pagesAnalyzed: 40, createdAt: "2026-09-20T00:00:00Z", critical: 1, warning: 3, opportunity: 2, passed: 27, categories: { technical: 90 } },
    previous: { score: 70, createdAt: "2026-08-20T00:00:00Z" },
    openIssues: [],
    newIssues: 2,
    fixedIssues: 5,
  },
  search: {
    source: "gsc",
    totals: { clicks: metric(1200, 1000), impressions: metric(40000, 38000), ctr: metric(0.03, 0.026), position: metric(14.2, 15) },
    daily: [],
    topQueries: [{ key: "hiking boots", clicks: 300, impressions: 5000, position: 4 }],
    topPages: [],
  },
  traffic: { unavailable: true, reason: "No GA4 organic traffic data for this period." },
  tasks: { source: "tasks", created: 4, completed: 3, open: 2, overdue: 1 },
  highlights: [],
  ...over,
});

describe("highlights", () => {
  it("writes one line per available section from its numbers, skipping missing data", () => {
    const h = highlights(snapshot());
    expect(h).toEqual([
      "SEO health score is 81/100 (previous audit 70), with 1 critical issue.",
      "5 issues were fixed and 2 new issues were detected in the period.",
      "Search Console recorded 1,200 clicks (+20% vs the comparison period).",
      "The top query was “hiking boots” with 300 clicks.",
      "3 SEO tasks were completed; 2 remain open, 1 overdue.",
    ]);
    expect(h.some((l) => /sessions/i.test(l))).toBe(false);
  });
  it("is empty when no section has data", () => {
    expect(highlights({ ...snapshot(), audit: { unavailable: true, reason: "x" }, search: undefined, tasks: undefined })).toEqual([]);
  });
});

describe("exports", () => {
  it("CSV lists metrics with sources and marks demo data", async () => {
    const s = snapshot({ website: { id: "w", name: "Shop", domain: "shop.example", isDemo: true } });
    const f = await csvExporter.render({ id: "r1", title: "Sept report", snapshot: s });
    const text = String(f.body);
    expect(f.filename).toBe("sept-report-DEMO-DATA.csv");
    expect(text).toContain("Monthly SEO Summary (DEMO DATA)");
    expect(text).toContain("Search performance,clicks,1200,1000,0.2,gsc");
    expect(text).toContain("Site audit,Score,81.4,70,,crawl");
    expect(text).not.toContain("Organic traffic");
  });
  it("JSON contains the full snapshot; PDF stays unavailable without a renderer", async () => {
    const f = await jsonExporter.render({ id: "r1", title: "T", snapshot: snapshot() });
    expect(JSON.parse(String(f.body))).toMatchObject({ id: "r1", type: "monthly", website: { domain: "shop.example" } });
    delete process.env.PDF_RENDERER_URL;
    expect(pdfExporter.available()).toBe(false);
    await expect(pdfExporter.render({ id: "r1", title: "T", snapshot: snapshot() })).rejects.toThrow(/PDF_RENDERER_URL/);
  });
  it("metric rows skip unavailable sections", () => {
    expect(metricRows(snapshot()).every((r) => r[0] !== "Organic traffic")).toBe(true);
    expect(isUnavailable(snapshot().traffic)).toBe(true);
  });
  it("every report type maps to at least one section", () => {
    for (const sections of Object.values(SECTIONS)) expect(sections.length).toBeGreaterThan(0);
  });
});

describe("report fixes found by the live check", () => {
  it("uses the latest audit for current periods and the period end for past ones", async () => {
    const { auditCutoff } = await import("@/lib/reports/compose");
    const now = new Date("2026-10-28T10:00:00Z");
    expect(auditCutoff({ to: "2026-10-27" }, now)).toBe("2026-10-28T10:00:00.000Z");
    expect(auditCutoff({ to: "2026-09-30" }, now)).toBe("2026-09-30T23:59:59.999Z");
  });
  it("does not claim 0 improved / 0 declined when the comparison date had no rank data", () => {
    const rankings = {
      source: "dataforseo",
      tracked: 10,
      checkedAt: "2026-09-30",
      comparedAt: null,
      distribution: [{ bucket: "Top 3", current: 3, previous: null }],
      averagePosition: metric(8, null),
      improved: [],
      declined: [],
    };
    const h = highlights({ ...snapshot(), audit: undefined, search: undefined, tasks: undefined, rankings });
    expect(h).toEqual(["3 of 10 tracked keywords rank in the top 10."]);
    expect(highlights({ ...snapshot(), audit: undefined, search: undefined, tasks: undefined, rankings: { ...rankings, comparedAt: "2026-08-31" } })[0]).toMatch(/0 improved and 0 declined/);
  });
});
