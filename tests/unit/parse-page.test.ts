import { describe, expect, it } from "vitest";
import { parsePage } from "@/lib/crawler/parse-page";

const GOOD = `<!doctype html>
<html lang="en">
<head>
  <title>  Lightweight Hiking Tents for Two People  </title>
  <meta name="description" content="Compare lightweight two-person hiking tents by weight, price and weather protection, with buying advice.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="/tents/two-person">
  <meta property="og:title" content="Two-person tents">
  <meta property="og:description" content="Our picks">
  <meta property="og:image" content="https://shop.example/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":["BreadcrumbList","Thing"]}]}</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/tents/">Tents</a> <a href="#top">Top</a> <a href="mailto:x@y.z">Mail</a></nav>
  <h1>Two-person tents</h1>
  <h2>Ultralight</h2><h3>Budget</h3>
  <p>Some words here about tents and hiking.</p>
  <img src="a.jpg" alt="Tent on a hill" width="10" height="10">
  <img src="b.jpg" alt="">
  <img src="c.jpg">
  <a href="https://other.example/review" rel="nofollow sponsored">Review</a>
  <a href="/tents/two-person#specs">Specs</a>
  <script>var ignored = "these words do not count";</script>
</body></html>`;

describe("parsePage", () => {
  const p = parsePage(GOOD, "https://shop.example/tents/two-person");

  it("extracts title, description, lang, viewport", () => {
    expect(p.title).toBe("Lightweight Hiking Tents for Two People");
    expect(p.metaDescription).toMatch(/^Compare lightweight/);
    expect(p.lang).toBe("en");
    expect(p.hasViewport).toBe(true);
  });

  it("resolves the canonical against the page URL", () => {
    expect(p.canonical).toBe("https://shop.example/tents/two-person");
    expect(p.canonicalInvalid).toBe(false);
  });

  it("reads headings and detects no skipped levels", () => {
    expect(p.h1).toEqual(["Two-person tents"]);
    expect(p.h2Count).toBe(1);
    expect(p.headingLevels).toEqual([1, 2, 3]);
    expect(p.headingSkips).toBe(0);
  });

  it("counts images without alt (empty alt is valid)", () => {
    expect(p.images).toEqual({ total: 3, missingAlt: 1, missingDimensions: 2 });
  });

  it("classifies links, ignores fragments/mailto, and dedupes", () => {
    const urls = p.links.map((l) => l.url);
    expect(urls).toContain("https://shop.example/");
    expect(urls).toContain("https://shop.example/tents/");
    expect(urls.filter((u) => u === "https://shop.example/tents/two-person")).toHaveLength(1);
    expect(urls.some((u) => u.startsWith("mailto"))).toBe(false);
    const ext = p.links.find((l) => l.url === "https://other.example/review")!;
    expect(ext.internal).toBe(false);
    expect(ext.nofollow).toBe(true);
  });

  it("finds structured data types including @graph and arrays", () => {
    expect(p.structuredDataTypes).toEqual(expect.arrayContaining(["Product", "BreadcrumbList", "Thing"]));
  });

  it("reads Open Graph and Twitter tags", () => {
    expect(p.openGraph).toMatchObject({ title: "Two-person tents", image: "https://shop.example/og.png" });
    expect(p.twitterCard.card).toBe("summary_large_image");
  });

  it("counts visible words only (no scripts)", () => {
    expect(p.wordCount).toBeGreaterThan(10);
    expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const withScript = parsePage("<body><p>one two</p><script>three four five</script></body>", "https://a.example/");
    expect(withScript.wordCount).toBe(2);
  });

  it("detects noindex from meta robots and X-Robots-Tag", () => {
    expect(parsePage('<meta name="robots" content="noindex, follow">', "https://a.example/").noindex).toBe(true);
    expect(parsePage("<title>x</title>", "https://a.example/", { xRobotsTag: "noindex" }).noindex).toBe(true);
    expect(parsePage('<meta name="robots" content="none">', "https://a.example/").nofollowPage).toBe(true);
  });

  it("handles a bare/broken document without crashing", () => {
    const bare = parsePage("<div>no head <h3>skip</h3><h1></h1><h3>x</h3>", "https://a.example/");
    expect(bare.title).toBeNull();
    expect(bare.metaDescription).toBeNull();
    expect(bare.canonical).toBeNull();
    expect(bare.lang).toBeNull();
    expect(bare.h1).toEqual([""]);
    expect(bare.headingSkips).toBe(1); // h1 -> h3
  });

  it("respects <base href> and flags unresolvable canonicals", () => {
    const b = parsePage('<base href="https://cdn.example/sub/"><a href="page">x</a><link rel="canonical" href="http://[bad">', "https://a.example/");
    expect(b.links[0].url).toBe("https://cdn.example/sub/page");
    expect(b.canonicalInvalid).toBe(true);
  });
});
