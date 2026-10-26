import { describe, expect, it, vi } from "vitest";
import { DataForSeo, locationCode, parseOverview, parseRelated, parseSerp, parseSuggestions, unwrap } from "@/lib/providers/dataforseo";
import { ProviderError } from "@/lib/providers/types";
import { demoKeywordProvider } from "@/lib/providers/demo";
import { csvCell, parseCsv, readKeywordImport, toCsv, MAX_IMPORT_ROWS } from "@/lib/keywords/csv";
import { clusterKeywords, ideaType, inferIntent, normalizeKeyword, positionBucket, positionChange } from "@/lib/keywords/utils";

const envelope = (result: unknown[], status = 20000, taskStatus = 20000) => ({
  status_code: status,
  status_message: status === 20000 ? "Ok." : "Error",
  tasks: [{ status_code: taskStatus, status_message: taskStatus === 20000 ? "Ok." : "Task error", result }],
});

describe("DataForSEO adapter", () => {
  it("maps countries to location codes", () => {
    expect(locationCode("US")).toBe(2840);
    expect(locationCode("GB")).toBe(2826);
    expect(locationCode("BD")).toBe(2050);
    expect(() => locationCode("XX")).toThrow(ProviderError);
  });

  it("unwraps envelopes and surfaces errors", () => {
    expect(unwrap(envelope([{ a: 1 }]))).toEqual([{ a: 1 }]);
    expect(() => unwrap(envelope([], 40100))).toThrow(/DataForSEO/);
    expect(() => unwrap(envelope([], 20000, 40501))).toThrow(/Task error/);
  });

  it("parses suggestions with nulls preserved (never invented)", () => {
    const ideas = parseSuggestions([
      {
        items: [
          {
            keyword: "hiking boots women",
            keyword_info: { search_volume: 6600, cpc: 1.23, competition: 0.81, monthly_searches: [{ year: 2026, month: 2, search_volume: 7000 }, { year: 2026, month: 1, search_volume: 6000 }] },
            keyword_properties: { keyword_difficulty: 47 },
            search_intent_info: { main_intent: "commercial" },
          },
          { keyword: "hiking boots obscure", keyword_info: { search_volume: null, cpc: null, competition: null }, keyword_properties: null, search_intent_info: null },
          { keyword_info: { search_volume: 5 } },
        ],
      },
    ]);
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatchObject({ keyword: "hiking boots women", searchVolume: 6600, cpc: 1.23, competition: 0.81, difficulty: 47, intent: "commercial", source: "suggestion" });
    expect(ideas[0].monthlySearches).toEqual([{ month: "2026-01", volume: 6000 }, { month: "2026-02", volume: 7000 }]);
    expect(ideas[1]).toMatchObject({ searchVolume: null, cpc: null, difficulty: null, intent: null });
  });

  it("parses related keywords and overview", () => {
    expect(parseRelated([{ items: [{ keyword_data: { keyword: "trail shoes", keyword_info: { search_volume: 900 } } }] }])[0]).toMatchObject({ keyword: "trail shoes", searchVolume: 900, source: "related" });
    expect(parseOverview([{ items: [{ keyword: "x", search_intent_info: { main_intent: "bogus" } }] }])[0].intent).toBeNull();
    expect(parseOverview([{ items: null }])).toEqual([]);
  });

  it("finds the site's organic position in the SERP (subdomains count, ads don't)", () => {
    const serp = [
      {
        item_types: ["paid", "organic", "people_also_ask", "organic"],
        items: [
          { type: "paid", rank_group: 1, url: "https://www.mysite.com/ad", domain: "www.mysite.com" },
          { type: "organic", rank_group: 1, url: "https://other.com/", domain: "other.com" },
          { type: "organic", rank_group: 2, url: "https://blog.mysite.com/post", domain: "blog.mysite.com" },
        ],
      },
    ];
    expect(parseSerp(serp, "mysite.com", 100)).toEqual({
      position: 2,
      url: "https://blog.mysite.com/post",
      serpFeatures: ["paid", "people_also_ask"],
      checkedDepth: 100,
    });
    expect(parseSerp(serp, "notranking.com", 100).position).toBeNull();
    expect(parseSerp(serp, "mysite.com.evil.com", 100).position).toBeNull();
  });

  it("sends authenticated requests with market parameters", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(envelope([{ items: [{ type: "organic", rank_group: 7, url: "https://a.com/x", domain: "a.com" }] }])), { status: 200 }));
    const dfs = new DataForSeo({ login: "user", password: "pass" }, fetchMock as unknown as typeof fetch);
    const r = await dfs.check({ keyword: "k", countryCode: "DE", languageCode: "de", device: "mobile", engine: "google", domain: "a.com" });
    expect(r.position).toBe(7);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.dataforseo.com/v3/serp/google/organic/live/advanced");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toEqual([{ keyword: "k", location_code: 2276, language_code: "de", device: "mobile", depth: 100 }]);
  });

  it("reports bad credentials and network failures as ProviderError", async () => {
    const unauthorized = new DataForSeo({ login: "u", password: "p" }, (async () => new Response("", { status: 401 })) as unknown as typeof fetch);
    await expect(unauthorized.metrics(["a"], { countryCode: "US", languageCode: "en" })).rejects.toThrow(/credentials/);
    const down = new DataForSeo({ login: "u", password: "p" }, (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    await expect(down.metrics(["a"], { countryCode: "US", languageCode: "en" })).rejects.toMatchObject({ retryable: true });
  });
});

describe("demo provider", () => {
  it("is deterministic and identifies itself as demo", async () => {
    const a = await demoKeywordProvider.ideas("hiking tent", { countryCode: "US", languageCode: "en" });
    const b = await demoKeywordProvider.ideas("hiking tent", { countryCode: "US", languageCode: "en" });
    expect(a).toEqual(b);
    expect(demoKeywordProvider.id).toBe("demo");
    expect(a.length).toBeGreaterThan(10);
  });
});

describe("keyword utils", () => {
  it("normalizes", () => {
    expect(normalizeKeyword("  Hiking   BOOTS​ ")).toBe("hiking boots");
  });
  it("classifies idea types", () => {
    expect(ideaType("how to choose hiking boots")).toBe("question");
    expect(ideaType("best waterproof hiking boots women")).toBe("long_tail");
    expect(ideaType("hiking boots")).toBe("related");
  });
  it("infers intent by rule (or returns null)", () => {
    expect(inferIntent("buy hiking boots")).toBe("transactional");
    expect(inferIntent("best hiking boots 2026")).toBe("commercial");
    expect(inferIntent("how to lace hiking boots")).toBe("informational");
    expect(inferIntent("hiking boots")).toBeNull();
  });
  it("clusters by shared significant tokens", () => {
    const c = clusterKeywords(["waterproof hiking boots", "waterproof boots women", "hiking boots size", "boots size chart"], "boots");
    // "hiking", "waterproof" and "size" each appear twice; ties resolve alphabetically.
    expect(c.get("hiking")).toEqual(["waterproof hiking boots", "hiking boots size"]);
    expect(c.get("waterproof")).toEqual(["waterproof boots women"]);
    expect(c.get("size")).toEqual(["boots size chart"]);
    expect([...c.values()].flat()).toHaveLength(4); // every keyword lands in exactly one cluster
  });
  it("buckets positions and computes change", () => {
    expect([1, 3, 4, 10, 11, 20, 21, 100, null].map(positionBucket)).toEqual(["top3", "top3", "top10", "top10", "top20", "top20", "top100", "top100", "none"]);
    expect(positionChange(4, 9)).toBe(5);
    expect(positionChange(12, 9)).toBe(-3);
    expect(positionChange(null, 9)).toBeNull();
  });
});

describe("CSV", () => {
  it("parses quoted cells, escaped quotes, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿keyword,group\r\n"boots, waterproof","say ""hi"""\r\n\r\nshoes;b\n')).toEqual([
      ["keyword", "group"],
      ["boots, waterproof", 'say "hi"'],
      ["shoes", "b"],
    ]);
  });

  it("imports with header aliases, defaults and validation", () => {
    const r = readKeywordImport(
      "Keyword,Country,Device,Target URL,Group\nhiking boots,GB,mobile,https://a.example/boots,Boots\nbad,XX\n,US\nhiking boots,GB,mobile\njs,US,desktop,javascript:alert(1)\ntent,,tablet\n",
      { countryCode: "US", languageCode: "en" },
    );
    expect(r.rows).toEqual([{ keyword: "hiking boots", countryCode: "GB", languageCode: "en", device: "mobile", targetUrl: "https://a.example/boots", group: "Boots" }]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
  });

  it("imports a bare list without header and caps rows", () => {
    const r = readKeywordImport(Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `kw ${i}`).join("\n"), { countryCode: "US", languageCode: "en" });
    expect(r.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(r.truncated).toBe(true);
  });

  it("never imports metrics columns", () => {
    const r = readKeywordImport("keyword,search_volume,difficulty\nboots,99999,1", { countryCode: "US", languageCode: "en" });
    expect(Object.keys(r.rows[0])).not.toContain("searchVolume");
  });

  it("exports safely (formula injection, quoting, nulls)", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell(-12)).toBe("-12");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["x,y", 1]])).toBe('﻿a,b\r\n"x,y",1\r\n');
  });
});
