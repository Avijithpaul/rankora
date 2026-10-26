import { describe, expect, it } from "vitest";
import { analyzeSite, evaluateCoreWebVitals, type AnalyzerPage } from "@/lib/audit/analyze";
import { RULES } from "@/lib/seo/rules";
import { computeScore } from "@/lib/seo/scoring";
import { parsePageSpeed } from "@/lib/audit/pagespeed";
import { auditDenial, canChangeIssueStatus } from "@/lib/audit/access";

const O = "https://site.example";
function pg(path: string, patch: Partial<AnalyzerPage> = {}): AnalyzerPage {
  return {
    url: `${O}${path}`,
    depth: path === "/" ? 0 : 1,
    fetchState: "fetched",
    statusCode: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html",
    responseTimeMs: 200,
    isIndexable: true,
    title: `A perfectly sized title for page ${path.padEnd(4, "x")}`,
    metaDescription: `A meta description for ${path} that is comfortably longer than seventy characters overall.`,
    h1: ["Heading"],
    headingSkips: 0,
    canonical: `${O}${path}`,
    canonicalInvalid: false,
    noindex: false,
    lang: "en",
    hasViewport: true,
    wordCount: 600,
    contentHash: `hash-${path}`,
    imagesTotal: 1,
    imagesMissingAlt: 0,
    structuredDataTypes: ["WebPage"],
    openGraph: { title: "t", description: "d", image: "i" },
    twitterCard: { card: "summary" },
    foundInSitemap: true,
    ...patch,
  };
}
const goodState = {
  robots: { url: `${O}/robots.txt`, status: 200, found: true, blocksAll: false, sitemaps: [], crawlDelaySeconds: null },
  sitemap: { found: true, sources: [`${O}/sitemap.xml`], urlCount: 2, errors: [] },
  https: { siteIsHttps: true, httpRedirectsToHttps: true },
};
const site = { baseUrl: `${O}/`, state: goodState, checkExternalLinks: false };
const linksBetween = (a: string, b: string) => ({ sourceUrl: `${O}${a}`, targetUrl: `${O}${b}`, isInternal: true, targetStatus: null, targetError: null });

describe("analyzeSite", () => {
  it("evaluates every rule exactly once", () => {
    const evals = analyzeSite([pg("/"), pg("/a")], [linksBetween("/", "/a")], site);
    expect(evals.map((e) => e.ruleId).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  it("a clean site scores 100 on applicable rules", () => {
    const evals = analyzeSite([pg("/"), pg("/a")], [linksBetween("/", "/a"), linksBetween("/a", "/")], site);
    const s = computeScore(evals);
    expect(s.counts.critical + s.counts.warning + s.counts.opportunity).toBe(0);
    expect(s.score).toBe(100);
  });

  it("flags metadata problems with exact affected URLs", () => {
    const pages = [
      pg("/"),
      pg("/short", { title: "Short" }),
      pg("/none", { title: null, metaDescription: null }),
      pg("/dup1", { title: "Same Title Repeated On Two Separate Pages Here" }),
      pg("/dup2", { title: "same title repeated on two separate pages here" }),
    ];
    const by = Object.fromEntries(analyzeSite(pages, [], site).map((e) => [e.ruleId, e]));
    expect(by["page.title_missing"].affectedUrls).toEqual([`${O}/none`]);
    expect(by["page.title_length"].affectedUrls).toEqual([`${O}/short`]);
    expect(by["page.title_duplicate"].affectedUrls?.sort()).toEqual([`${O}/dup1`, `${O}/dup2`]);
    expect(by["page.meta_description_missing"].affected).toBe(1);
    expect(by["page.title_length"].total).toBe(4); // pages without a title are not length-checked
  });

  it("excludes non-indexable pages from duplicate/thin checks", () => {
    const pages = [pg("/"), pg("/thin-noindex", { wordCount: 10, noindex: true, isIndexable: false })];
    const by = Object.fromEntries(analyzeSite(pages, [], site).map((e) => [e.ruleId, e]));
    expect(by["page.thin_content"].affected).toBe(0);
    expect(by["page.noindex"].affectedUrls).toEqual([`${O}/thin-noindex`]);
  });

  it("detects broken internal links and status errors", () => {
    const pages = [pg("/"), pg("/gone", { statusCode: 404, finalStatus: 404, isIndexable: false }), pg("/err", { fetchState: "failed", statusCode: null, finalStatus: null })];
    const links = [linksBetween("/", "/gone"), linksBetween("/", "/err")];
    const by = Object.fromEntries(analyzeSite(pages, links, site).map((e) => [e.ruleId, e]));
    expect(by["page.broken_internal_links"].affectedUrls).toEqual([`${O}/`]);
    expect(by["page.status_4xx_5xx"].affected).toBe(2);
  });

  it("marks rules not applicable instead of guessing", () => {
    const by = Object.fromEntries(
      analyzeSite([pg("/")], [], { baseUrl: `http://site.example/`, state: { robots: goodState.robots }, checkExternalLinks: false }).map((e) => [e.ruleId, e]),
    );
    expect(by["site.https"].affected).toBe(1);
    expect(by["site.http_redirects_to_https"].applicable).toBe(false);
    expect(by["site.sitemap"].applicable).toBe(false);
    expect(by["site.core_web_vitals"].applicable).toBe(false);
    expect(by["page.broken_external_links"].applicable).toBe(false);
    expect(by["page.orphan"].applicable).toBe(false);
  });

  it("finds orphan pages from the sitemap", () => {
    const pages = [pg("/"), pg("/linked"), pg("/orphan")];
    const by = Object.fromEntries(analyzeSite(pages, [linksBetween("/", "/linked")], site).map((e) => [e.ruleId, e]));
    expect(by["page.orphan"].affectedUrls).toEqual([`${O}/orphan`]);
  });

  it("flags a site-wide robots.txt block as critical", () => {
    const state = { ...goodState, robots: { ...goodState.robots, blocksAll: true } };
    const s = computeScore(analyzeSite([pg("/")], [], { ...site, state }));
    const check = s.checks.find((c) => c.ruleId === "site.robots_blocks_all")!;
    expect(check.result).toBe("failed");
    expect(check.severity).toBe("critical");
  });
});

describe("Core Web Vitals", () => {
  const base = { url: "u", strategy: "mobile" as const, performanceScore: 90, lcpMs: 2000, cls: 0.05, tbtMs: 100, inpMs: null, fieldDataAvailable: false, fetchedAt: "" };
  it("passes good values and reports failures", () => {
    expect(evaluateCoreWebVitals(base)).toEqual([]);
    expect(evaluateCoreWebVitals({ ...base, lcpMs: 4200, cls: 0.3 })).toHaveLength(2);
    expect(evaluateCoreWebVitals({ ...base, inpMs: 350 })[0]).toMatch(/INP/);
  });
  it("parses the PageSpeed API response, preferring field data", () => {
    const r = parsePageSpeed("https://site.example/", {
      lighthouseResult: {
        categories: { performance: { score: 0.72 } },
        audits: { "largest-contentful-paint": { numericValue: 3100.4 }, "cumulative-layout-shift": { numericValue: 0.02 }, "total-blocking-time": { numericValue: 250 } },
      },
      loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 } } },
    });
    expect(r).toMatchObject({ performanceScore: 72, lcpMs: 2400, cls: 0.12, tbtMs: 250, inpMs: 180, fieldDataAvailable: true });
  });
});

describe("audit permissions", () => {
  const site = { is_demo: false, status: "active" };
  it("only members and above can run audits on real, active sites", () => {
    expect(auditDenial("viewer", site)).toBe("role");
    expect(auditDenial("member", site)).toBeNull();
    expect(auditDenial("owner", { ...site, is_demo: true })).toBe("demo");
    expect(auditDenial("admin", { ...site, status: "paused" })).toBe("inactive");
  });
  it("issue status: members may only ignore/reopen", () => {
    expect(canChangeIssueStatus("member", "open", "ignored")).toBe(true);
    expect(canChangeIssueStatus("member", "ignored", "open")).toBe(true);
    expect(canChangeIssueStatus("member", "open", "fixed")).toBe(false);
    expect(canChangeIssueStatus("member", "fixed", "open")).toBe(false);
    expect(canChangeIssueStatus("viewer", "open", "ignored")).toBe(false);
  });
});
