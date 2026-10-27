import { describe, expect, it } from "vitest";
import { documentFromDraft, documentFromHtml } from "@/lib/content/document";
import { analyzeContent, countPhrase, countSyllables, fold, keywordMatch, readability, termCoverage, tokenize, topTerms } from "@/lib/content/analyze";

/** n words as sentences of 12 words each */
const para = (n: number) => Array.from({ length: n }, (_, i) => (i % 12 === 0 ? "The" : i % 12 === 11 ? "trail." : "trail")).join(" ");

const PAGE = `<!doctype html><html lang="en"><head>
<title>Best Hiking Boots for Beginners — 2026 Buyer's Guide</title>
<meta name="description" content="Find the best hiking boots for beginners: how to choose fit, support and waterproofing, plus our tested picks for every budget.">
</head><body>
<nav><a href="/">Home</a><a href="/shop">Shop</a></nav>
<main>
<h1>Best hiking boots for beginners</h1>
<p>Choosing the best hiking boots is the first step for every new hiker. This guide explains fit, support and waterproofing.</p>
<h2>How to choose hiking boots</h2>
<p>Look at ankle support, sole grip and weight. Try boots on in the afternoon when your feet are larger.</p>
<ul><li>Ankle support</li><li>Waterproof membrane</li></ul>
<h4>Skipped level</h4>
<p>Read our <a href="/guides/socks">guide to hiking socks</a> and <a href="https://shop.example/boots">boot reviews</a>. <a href="https://other.example/">click here</a></p>
<img src="a.jpg" alt="Hiking boots on a trail"><img src="b.jpg">
</main>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>`;

describe("tokenize / fold / phrase matching", () => {
  it("tokenizes words, keeps inner apostrophes and hyphens", () => {
    expect(tokenize("Buyer’s guide: two-person TENTS!")).toEqual(["buyer's", "guide", "two-person", "tents"]);
  });
  it("folds simple plurals conservatively", () => {
    expect(fold("boots")).toBe("boot");
    expect(fold("stories")).toBe("story");
    expect(fold("glass")).toBe("glass");
    expect(fold("status")).toBe("status");
  });
  it("counts phrase occurrences", () => {
    expect(countPhrase(["a", "b", "a", "b", "a"], ["a", "b"])).toBe(2);
    expect(countPhrase(["a"], ["a", "b"])).toBe(0);
  });
  it("distinguishes exact and partial keyword matches", () => {
    expect(keywordMatch("Best Hiking Boots", "hiking boot")).toBe("exact");
    expect(keywordMatch("Boots for hiking", "hiking boots")).toBe("partial");
    expect(keywordMatch("Running shoes", "hiking boots")).toBe("none");
    expect(keywordMatch(null, "x")).toBe("none");
  });
  it("estimates syllables", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("hiking")).toBe(2);
    expect(countSyllables("computer")).toBe(3);
  });
});

describe("documentFromHtml", () => {
  const doc = documentFromHtml(PAGE, "https://shop.example/guides/best-hiking-boots");
  it("reads metadata and prefers the <main> region", () => {
    expect(doc.title).toContain("Best Hiking Boots");
    expect(doc.metaDescription).toMatch(/^Find the best/);
    expect(doc.lang).toBe("en");
    expect(doc.text).not.toContain("Privacy");
    expect(doc.headings.map((h) => h.level)).toEqual([1, 2, 4]);
  });
  it("does not mistake one of several <article> cards for the main content", () => {
    const listing = documentFromHtml(
      `<html><body><h1>Books</h1><p>All our books in one place.</p><article><h3>Book one</h3></article><article><h3>Book two</h3></article></body></html>`,
      "https://shop.example/books",
    );
    expect(listing.text).toContain("All our books");
    expect(listing.text).toContain("Book two");
    const single = documentFromHtml(`<html><body><nav>Menu</nav><article><h1>Post</h1><p>Body</p></article></body></html>`, "https://shop.example/post");
    expect(single.text).toBe("Post Body");
  });

  it("classifies internal vs external links and images", () => {
    expect(doc.links.filter((l) => l.internal).map((l) => l.url)).toEqual(["https://shop.example/guides/socks", "https://shop.example/boots"]);
    expect(doc.links.filter((l) => !l.internal)).toHaveLength(1);
    expect(doc.images).toEqual([{ alt: "Hiking boots on a trail" }, { alt: null }]);
    expect(doc.lists).toBe(1);
  });
});

describe("documentFromDraft", () => {
  it("parses Markdown headings, lists, links and images", () => {
    const doc = documentFromDraft(
      {
        title: "Draft title",
        body: "# Main topic\n\nIntro paragraph with a [link](/about) and [ext](https://ext.example/x).\n\n## Section\n- one\n- two\n\n![alt text](i.png)\n",
      },
      "shop.example",
    );
    expect(doc.source).toBe("draft");
    expect(doc.title).toBe("Draft title");
    expect(doc.headings).toEqual([
      { level: 1, text: "Main topic" },
      { level: 2, text: "Section" },
    ]);
    expect(doc.lists).toBe(1);
    expect(doc.paragraphs).toContain("Intro paragraph with a link and ext.");
    expect(doc.links).toEqual([
      { url: "/about", anchor: "link", internal: true },
      { url: "https://ext.example/x", anchor: "ext", internal: false },
    ]);
    expect(doc.images).toEqual([{ alt: "alt text" }]);
  });
  it("accepts HTML fragments and resolves same-site links", () => {
    const doc = documentFromDraft({ body: '<h1>T</h1><p>Hi <a href="https://shop.example/a">a</a> <a href="/b">b</a></p>' }, "shop.example");
    expect(doc.headings).toEqual([{ level: 1, text: "T" }]);
    expect(doc.links.every((l) => l.internal)).toBe(true);
  });
  it("caps very large drafts", () => {
    const doc = documentFromDraft({ body: "word ".repeat(40_000) }, null);
    expect(doc.text.length).toBeLessThanOrEqual(100_000);
  });
});

describe("readability", () => {
  it("computes sentence and paragraph stats; Flesch only for English", () => {
    const doc = documentFromDraft({ body: `${para(60)}\n\n${para(200)}` }, null);
    const en = readability(doc, true);
    expect(en.sentences).toBeGreaterThan(5);
    expect(en.longParagraphs).toBe(1);
    expect(en.fleschReadingEase).not.toBeNull();
    expect(readability(doc, false).fleschReadingEase).toBeNull();
  });
});

describe("termCoverage / topTerms", () => {
  it("marks found and missing terms with their source, deduplicating variants", () => {
    const cov = termCoverage("Waterproof boots need good ankle support.", [
      { term: "ankle support", source: "search_console", weight: 120 },
      { term: "Ankle supports", source: "saved_keyword" },
      { term: "boot sizing", source: "user" },
    ]);
    expect(cov).toEqual([
      { term: "ankle support", source: "search_console", weight: 120, found: true, occurrences: 1 },
      { term: "boot sizing", source: "user", found: false, occurrences: 0 },
    ]);
  });
  it("lists frequent terms and phrases", () => {
    const top = topTerms("hiking boots hiking boots hiking boots for the trail");
    expect(top.slice(0, 2)).toEqual([
      { term: "boots", count: 3 },
      { term: "hiking", count: 3 },
    ]);
    expect(top.some((t) => t.term === "hiking boots")).toBe(true);
  });
});

describe("analyzeContent", () => {
  const doc = documentFromHtml(PAGE, "https://shop.example/guides/best-hiking-boots");
  const r = analyzeContent(doc, { keyword: "hiking boots", terms: [{ term: "ankle support", source: "user" }, { term: "boot sizing", source: "user" }, { term: "hiking boots", source: "user" }] });
  const check = (id: string) => r.checks.find((c) => c.id === id)!;

  it("evaluates metadata and headings", () => {
    expect(check("title_keyword").status).toBe("pass");
    expect(check("meta_keyword").status).toBe("pass");
    expect(check("h1_single").status).toBe("pass");
    expect(check("h1_keyword").status).toBe("pass");
    expect(check("heading_order").status).toBe("warn");
    expect(r.stats.headings).toEqual({ h1: 1, h2: 1, h3plus: 1, skips: 1 });
  });
  it("measures placement, links, images and length", () => {
    expect(check("keyword_intro").status).toBe("pass");
    expect(r.stats.firstOccurrenceWord).toBe(2); // the H1 "Best hiking boots…" is part of the main text
    expect(check("keyword_url").status).toBe("pass");
    expect(check("internal_links").status).toBe("pass");
    expect(check("anchor_text").status).toBe("warn");
    expect(check("image_alt").status).toBe("warn");
    expect(check("word_count").status).toBe("fail");
  });
  it("excludes the keyword itself from related terms and scores coverage", () => {
    expect(r.terms.map((t) => t.term)).toEqual(["ankle support", "boot sizing"]);
    expect(check("semantic_coverage").detail).toMatch(/^1 of 2/);
    expect(check("semantic_coverage").status).toBe("warn");
  });
  it("reports semantic coverage as informational when no terms exist", () => {
    const none = analyzeContent(doc, { keyword: "hiking boots" });
    expect(none.checks.find((c) => c.id === "semantic_coverage")!.status).toBe("info");
  });
  it("produces a weighted 0–100 score and prioritised recommendations", () => {
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    expect(r.recommendations[0].priority).toBe("high");
    expect(r.recommendations.find((x) => x.checkId === "word_count")).toBeDefined();
    expect(r.recommendations.every((x) => x.text.length > 0)).toBe(true);
  });
  it("flags keyword stuffing", () => {
    const stuffed = documentFromDraft({ title: "hiking boots", body: "# hiking boots\n\n" + "hiking boots ".repeat(200) }, null);
    const s = analyzeContent(stuffed, { keyword: "hiking boots" });
    expect(s.checks.find((c) => c.id === "keyword_density")!.status).toBe("fail");
    expect(s.checks.find((c) => c.id === "keyword_density")!.recommendation).toMatch(/stuffing/);
  });
  it("is deterministic", () => {
    expect(analyzeContent(doc, { keyword: "hiking boots" })).toEqual(analyzeContent(doc, { keyword: "hiking boots" }));
  });
  it("does not compute Flesch for non-English websites", () => {
    const de = analyzeContent(doc, { keyword: "hiking boots", language: "de" });
    expect(de.readability.fleschReadingEase).toBeNull();
    expect(de.checks.find((c) => c.id === "reading_ease")!.status).toBe("info");
  });
});
