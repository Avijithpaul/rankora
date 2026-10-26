import { describe, expect, it } from "vitest";
import { aggregateTop, rankMovement, relativeChange, topNByDay } from "@/lib/dashboard/metrics";

describe("aggregateTop", () => {
  it("sums per key, weights position by impressions and sorts by clicks", () => {
    const rows = [
      { q: "a", clicks: 10, impressions: 100, position: 2 },
      { q: "a", clicks: 5, impressions: 300, position: 6 },
      { q: "b", clicks: 20, impressions: 200, position: 4 },
    ];
    const top = aggregateTop(rows, (r) => r.q);
    expect(top[0]).toEqual({ key: "b", clicks: 20, impressions: 200, ctr: 0.1, position: 4 });
    expect(top[1].key).toBe("a");
    expect(top[1].clicks).toBe(15);
    expect(top[1].position).toBe(5); // (2*100 + 6*300) / 400
  });

  it("handles zero impressions and missing positions", () => {
    const [r] = aggregateTop([{ clicks: 0, impressions: 0, position: null }], () => "x");
    expect(r.ctr).toBeNull();
    expect(r.position).toBeNull();
  });
});

describe("rankMovement", () => {
  const s = (keyword_id: string, checked_on: string, position: number | null) => ({ keyword_id, checked_on, position });

  it("classifies improved, dropped, new, lost and unchanged", () => {
    const m = rankMovement([
      s("up", "2026-10-01", 9), s("up", "2026-10-02", 4),
      s("down", "2026-10-01", 3), s("down", "2026-10-02", 12),
      s("new", "2026-10-01", null), s("new", "2026-10-02", 40),
      s("lost", "2026-10-01", 15), s("lost", "2026-10-02", null),
      s("same", "2026-10-02", 2), s("same", "2026-10-01", 2), // unsorted input
    ]);
    expect(m).toMatchObject({ improved: 1, dropped: 1, new: 1, lost: 1, unchanged: 1 });
    expect(m.distribution).toEqual({ top3: 1, top10: 1, top20: 1, top100: 1, notRanking: 1 });
  });

  it("does not count movement for keywords with one snapshot", () => {
    const m = rankMovement([s("a", "2026-10-02", 5)]);
    expect(m.improved + m.dropped + m.new + m.lost + m.unchanged).toBe(0);
    expect(m.distribution.top10).toBe(1);
  });
});

describe("topNByDay / relativeChange", () => {
  it("counts top-10 keywords per day", () => {
    expect(
      topNByDay([
        { keyword_id: "a", checked_on: "2026-10-02", position: 3 },
        { keyword_id: "b", checked_on: "2026-10-02", position: 30 },
        { keyword_id: "a", checked_on: "2026-10-01", position: 11 },
      ]),
    ).toEqual([
      { date: "2026-10-01", count: 0 },
      { date: "2026-10-02", count: 1 },
    ]);
  });

  it("returns null change for a zero base", () => {
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(120, 100)).toBeCloseTo(0.2);
  });
});
