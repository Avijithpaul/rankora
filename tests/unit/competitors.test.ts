import { describe, expect, it } from "vitest";
import { compareSnapshots, failedSnapshot, keywordOverlap, normalizeCompetitorDomain, rankingSummary, snapshotFromPage, snapshotScore } from "@/lib/competitors/compare";
import { parseBacklinks, parseBacklinkSummary, parseRankedKeywords, parseSerp } from "@/lib/providers/dataforseo";
import { parsePage } from "@/lib/crawler/parse-page";
import { getBacklinkProvider } from "@/lib/providers/registry";

describe("normalizeCompetitorDomain", () => {
  it("accepts URLs and bare hosts, strips www and paths", () => {
    expect(normalizeCompetitorDomain("https://www.Rival.com/shoes?x=1", "mine.com")).toEqual({ ok: true, domain: "rival.com" });
    expect(normalizeCompetitorDomain("shop.rival.co.uk", "mine.com")).toEqual({ ok: true, domain: "shop.rival.co.uk" });
  });
  it("rejects own domain, IPs, single labels and garbage", () => {
    expect(normalizeCompetitorDomain("www.mine.com", "mine.com").ok).toBe(false);
    expect(normalizeCompetitorDomain("127.0.0.1", "mine.com").ok).toBe(false);
    expect(normalizeCompetitorDomain("localhost", "mine.com").ok).toBe(false);
    expect(normalizeCompetitorDomain("", "mine.com").ok).toBe(false);
    expect(normalizeCompetitorDomain("http://[::1]/", "mine.com").ok).toBe(false);
  });
});

describe("parseSerp with competitors", () => {
  const serp = [
    {
      item_types: ["organic", "people_also_ask"],
      items: [
        { type: "organic", rank_group: 1, domain: "www.rival.com", url: "https://www.rival.com/a" },
        { type: "paid", rank_group: 1, domain: "other.com", url: "https://other.com/" },
        { type: "organic", rank_group: 2, domain: "mine.com", url: "https://mine.com/x" },
        { type: "organic", rank_group: 3, domain: "blog.rival.com", url: "https://blog.rival.com/b" },
      ],
    },
  ];
  it("finds own and competitor positions in the same SERP, best result per domain", () => {
    const r = parseSerp(serp, "mine.com", 100, ["rival.com", "absent.com", "other.com"]);
    expect(r.position).toBe(2);
    expect(r.competitors).toEqual([
      { domain: "rival.com", position: 1, url: "https://www.rival.com/a" },
      { domain: "absent.com", position: null, url: null },
      { domain: "other.com", position: null, url: null }, // paid results do not count
    ]);
    expect(parseSerp(serp, "mine.com", 100).competitors).toBeUndefined();
  });
});

describe("DataForSEO ranked keywords and backlinks parsing", () => {
  it("parses ranked keywords (documented response shape), organic only", () => {
    const r = parseRankedKeywords([
      {
        total_count: 1234,
        items: [
          { keyword_data: { keyword: "boots", keyword_info: { search_volume: 900, cpc: 1.2 } }, ranked_serp_element: { serp_item: { type: "organic", rank_group: 3, url: "https://r.com/boots" } } },
          { keyword_data: { keyword: "ads" }, ranked_serp_element: { serp_item: { type: "paid", rank_group: 1 } } },
          { keyword_data: { keyword: "no volume", keyword_info: null }, ranked_serp_element: { serp_item: { type: "organic", rank_group: 40, url: null } } },
        ],
      },
    ]);
    expect(r.total).toBe(1234);
    expect(r.items).toEqual([
      { keyword: "boots", position: 3, url: "https://r.com/boots", searchVolume: 900, cpc: 1.2 },
      { keyword: "no volume", position: 40, url: null, searchVolume: null, cpc: null },
    ]);
  });

  it("parses backlinks: rel from dofollow/attributes, type, rank scale, new/lost flags", () => {
    const r = parseBacklinks(
      [
        {
          total_count: 2,
          items: [
            { url_from: "https://x.com/p", domain_from: "X.com", url_to: "https://mine.com/", anchor: " boots ", dofollow: true, item_type: "anchor", domain_from_rank: 47, first_seen: "2026-01-02 00:00:00 +00:00", is_new: true },
            { url_from: "https://y.com/p", url_to: "https://mine.com/b", anchor: "", dofollow: false, attributes: ["sponsored"], item_type: "meta", is_lost: true },
            { url_to: "https://mine.com/" },
          ],
        },
      ],
      100,
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ sourceDomain: "x.com", anchor: "boots", rel: "follow", linkType: "anchor", domainRank: 47, isNew: true, isLost: false });
    expect(r.items[1]).toMatchObject({ sourceDomain: "y.com", anchor: null, rel: "sponsored", linkType: "other", domainRank: null, isLost: true });
  });

  it("parses the summary and leaves missing values null", () => {
    expect(parseBacklinkSummary([{ backlinks: 120, referring_domains: 30, rank: 41 }])).toEqual({
      backlinks: 120, referringDomains: 30, referringMainDomains: null, referringIps: null, brokenBacklinks: null, rank: 41, spamScore: null, firstSeen: null,
    });
  });

  it("backlink provider stays disconnected unless explicitly enabled", () => {
    const before = process.env.BACKLINK_PROVIDER;
    delete process.env.BACKLINK_PROVIDER;
    expect(getBacklinkProvider()).toBeNull();
    process.env.BACKLINK_PROVIDER = before;
  });
});

describe("rankingSummary", () => {
  const keywords = [
    { id: "k1", keyword: "a", searchVolume: 100, own: 3, checkedOn: "2026-10-27" },
    { id: "k2", keyword: "b", searchVolume: null, own: null, checkedOn: "2026-10-27" },
    { id: "k3", keyword: "c", searchVolume: 10, own: 8, checkedOn: "2026-10-27" },
    { id: "k4", keyword: "d", searchVolume: 10, own: undefined, checkedOn: null },
  ];
  it("compares only keywords observed in the same SERP", () => {
    const positions = new Map([["c1", new Map<string, number | null>([["k1", 5], ["k2", 7], ["k3", null], ["k4", 1]])]]);
    const [s] = rankingSummary(keywords, [{ id: "c1", domain: "r.com" }], positions);
    expect(s).toEqual({ competitorId: "c1", checked: 3, bothRank: 1, youAhead: 1, theyAhead: 0, onlyYou: 1, onlyThem: 1, ownVisibility: 98 + 93, theirVisibility: 96 + 94 });
  });
  it("reports zero checked when no competitor data exists yet", () => {
    expect(rankingSummary(keywords, [{ id: "c2", domain: "x.com" }], new Map())[0].checked).toBe(0);
  });
});

describe("keywordOverlap", () => {
  const own = [
    { keyword: "Hiking Boots", position: 4, url: "https://m.com/b", searchVolume: 1000, cpc: null },
    { keyword: "boot care", position: 12, url: null, searchVolume: 50, cpc: null },
    { keyword: "hiking boots", position: 9, url: null, searchVolume: 1000, cpc: null }, // duplicate, worse
  ];
  const theirs = [
    { keyword: "hiking boots", position: 2, url: "https://r.com/b", searchVolume: 1000, cpc: null },
    { keyword: "trail shoes", position: 6, url: "https://r.com/t", searchVolume: 3000, cpc: null },
    { keyword: "boot laces", position: 15, url: null, searchVolume: null, cpc: null },
  ];
  it("splits shared, gaps, behind and own-only keywords", () => {
    const r = keywordOverlap(own, theirs);
    expect(r.shared).toEqual([{ keyword: "hiking boots", own: 4, theirs: 2, searchVolume: 1000, ownUrl: "https://m.com/b", theirUrl: "https://r.com/b" }]);
    expect(r.behind.map((x) => x.keyword)).toEqual(["hiking boots"]);
    expect(r.gaps.map((x) => x.keyword)).toEqual(["trail shoes", "boot laces"]); // by volume, unknown volume last
    expect(r.ownOnly.map((x) => x.keyword)).toEqual(["boot care"]);
    expect(r.stats).toEqual({ own: 2, theirs: 3, shared: 1, gaps: 2, ownOnly: 1, overlapRate: 0.25 });
  });
  it("handles empty snapshots", () => {
    expect(keywordOverlap([], []).stats.overlapRate).toBe(0);
  });
});

describe("homepage snapshots", () => {
  const html = `<html lang="en"><head><title>Rival — Hiking boots and trail gear shop</title><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://r.com/"></head><body><h1>Rival</h1><img src="a.png"><a href="/x">x</a></body></html>`;
  const theirs = snapshotFromPage("https://r.com/", { status: 200, finalUrl: "https://r.com/", responseTimeMs: 300, redirects: 0 }, parsePage(html, "https://r.com/"), { robotsTxt: true, sitemap: false });
  const own = failedSnapshot("https://m.com/", "Request timed out");

  it("applies the same checks to both sides and keeps unknowns unknown", () => {
    const checks = compareSnapshots(own, theirs);
    const by = (id: string) => checks.find((c) => c.id === id)!;
    expect(by("reachable")).toMatchObject({ own: "unknown", theirs: "pass", ownValue: "Request timed out" });
    expect(by("title").theirs).toBe("pass");
    expect(by("meta").theirs).toBe("fail");
    expect(by("sitemap").theirs).toBe("fail");
    expect(by("alt")).toMatchObject({ theirs: "fail", theirValue: "1 missing" });
    expect(checks.every((c) => c.own === "unknown")).toBe(true);
    expect(snapshotScore(checks, "own")).toBeNull();
    expect(snapshotScore(checks, "theirs")).toBeGreaterThan(0);
  });
});

describe("task utils", () => {
  it("validates task input and normalises empty fields to null", async () => {
    const { taskSchema } = await import("@/lib/tasks/utils");
    const ok = taskSchema.parse({ title: " Fix title ", priority: "high", status: "todo", assignedTo: "", dueDate: "", pageUrl: "", notes: "" });
    expect(ok).toEqual({ title: "Fix title", priority: "high", status: "todo", assignedTo: null, dueDate: null, pageUrl: null, notes: null });
    expect(taskSchema.safeParse({ title: "x", priority: "urgent", status: "todo" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", priority: "low", status: "done" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", priority: "low", status: "todo", dueDate: "31/12/2026" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", priority: "low", status: "todo", pageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", priority: "low", status: "todo", assignedTo: "not-a-uuid" }).success).toBe(false);
  });
  it("maps severity to priority, detects overdue tasks and completion rate", async () => {
    const { completionRate, isOverdue, priorityFromSeverity } = await import("@/lib/tasks/utils");
    expect(priorityFromSeverity("critical")).toBe("critical");
    expect(priorityFromSeverity("warning")).toBe("medium");
    expect(priorityFromSeverity("opportunity")).toBe("low");
    expect(isOverdue({ status: "todo", due_date: "2026-10-01" }, "2026-10-27")).toBe(true);
    expect(isOverdue({ status: "completed", due_date: "2026-10-01" }, "2026-10-27")).toBe(false);
    expect(isOverdue({ status: "in_progress", due_date: null }, "2026-10-27")).toBe(false);
    expect(completionRate({ todo: 1, in_progress: 1, completed: 2 })).toBe(0.5);
    expect(completionRate({ todo: 0, in_progress: 0, completed: 0 })).toBeNull();
  });
});
