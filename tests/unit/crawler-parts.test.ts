import { describe, expect, it } from "vitest";
import { blocksEverything, crawlDelaySeconds, isAllowed, parseRobots } from "@/lib/crawler/robots";
import { parseSitemap } from "@/lib/crawler/sitemap";
import { isExcluded, isSameSite, looksLikePage, normalizeUrl, urlStructureProblems } from "@/lib/crawler/url";

describe("normalizeUrl", () => {
  it.each([
    ["HTTPS://Example.COM", "https://example.com/"],
    ["https://example.com:443/a#frag", "https://example.com/a"],
    ["http://example.com:80/a?utm_source=x&id=2", "http://example.com/a?id=2"],
    ["/b/c", "https://example.com/b/c"],
    ["../up", "https://example.com/up"],
  ])("%s -> %s", (input, out) => {
    expect(normalizeUrl(input, "https://example.com/x/")).toBe(out);
  });
  it("rejects non-http schemes", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("site scope and filters", () => {
  it("treats www and apex as the same site but not subdomains", () => {
    expect(isSameSite("https://www.example.com/a", "example.com")).toBe(true);
    expect(isSameSite("http://example.com/a", "www.example.com")).toBe(true);
    expect(isSameSite("https://blog.example.com/", "example.com")).toBe(false);
    expect(isSameSite("https://example.com.evil.com/", "example.com")).toBe(false);
  });
  it("skips assets", () => {
    expect(looksLikePage("https://e.com/a.pdf")).toBe(false);
    expect(looksLikePage("https://e.com/img/x.PNG")).toBe(false);
    expect(looksLikePage("https://e.com/blog/post")).toBe(true);
    expect(looksLikePage("https://e.com/page.html")).toBe(true);
  });
  it("applies glob exclude patterns to path + query", () => {
    expect(isExcluded("https://e.com/cart/1", ["/cart*"])).toBe(true);
    expect(isExcluded("https://e.com/tag/seo", ["/tag/*"])).toBe(true);
    expect(isExcluded("https://e.com/search?q=1", ["/search?*"])).toBe(true);
    expect(isExcluded("https://e.com/blog", ["/cart*"])).toBe(false);
  });
  it("flags URL structure problems", () => {
    expect(urlStructureProblems("https://e.com/good-url")).toEqual([]);
    expect(urlStructureProblems("https://e.com/Bad_URL")).toEqual(["uppercase characters", "underscores instead of hyphens"]);
    expect(urlStructureProblems("https://e.com/a?a=1&b=2&c=3")).toContain("more than 2 query parameters");
  });
});

describe("robots.txt", () => {
  const robots = parseRobots(`
# comment
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: RankoraBot
User-agent: OtherBot
Disallow: /no-rankora

Sitemap: https://example.com/sitemap.xml
`);
  it("parses groups and sitemaps", () => {
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[1].agents).toEqual(["rankorabot", "otherbot"]);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });
  it("uses the most specific group", () => {
    expect(isAllowed(robots, "RankoraBot/1.0", "/no-rankora")).toBe(false);
    // the specific group replaces "*", so /private/ is allowed for RankoraBot
    expect(isAllowed(robots, "RankoraBot/1.0", "/private/x")).toBe(true);
  });
  it("applies longest match, Allow on ties, and wildcards", () => {
    expect(isAllowed(robots, "SomeBot", "/private/x")).toBe(false);
    expect(isAllowed(robots, "SomeBot", "/private/public-page")).toBe(true);
    expect(isAllowed(robots, "SomeBot", "/files/a.pdf")).toBe(false);
    expect(isAllowed(robots, "SomeBot", "/files/a.pdf?x")).toBe(true);
    expect(crawlDelaySeconds(robots, "SomeBot")).toBe(2);
  });
  it("detects a site-wide block, and empty Disallow allows all", () => {
    expect(blocksEverything(parseRobots("User-agent: *\nDisallow: /"), "RankoraBot")).toBe(true);
    expect(blocksEverything(parseRobots("User-agent: *\nDisallow:"), "RankoraBot")).toBe(false);
    expect(isAllowed(null, "x", "/anything")).toBe(true);
  });
});

describe("sitemap", () => {
  it("parses urlsets", () => {
    const s = parseSitemap(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc> https://e.com/a </loc></url><url><loc>https://e.com/b</loc><lastmod>2026-01-01</lastmod></url></urlset>`);
    expect(s).toEqual({ kind: "urlset", urls: ["https://e.com/a", "https://e.com/b"] });
  });
  it("parses sitemap indexes", () => {
    const s = parseSitemap(`<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>`);
    expect(s).toEqual({ kind: "index", urls: ["https://e.com/s1.xml"] });
  });
  it("rejects HTML and respects limits", () => {
    expect(parseSitemap("<html><body>404</body></html>").kind).toBe("unknown");
    const many = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://e.com/${i}</loc></url>`).join("")}</urlset>`;
    expect(parseSitemap(many, 3).urls).toHaveLength(3);
  });
});
