# Rankora — SEO Scoring

Source: `src/lib/seo/rules.ts` (rule catalog) and `src/lib/seo/scoring.ts` (engine).
Tests: `tests/unit/scoring.test.ts`. Current version: `SCORING_VERSION = "2026.10-1"`, stored on every audit.

## Principle

The score is **never an arbitrary number**. It is a weighted average of stored rule checks.
Each `seo_checks` row records the rule, result, severity, weight, rule score, affected/total counts,
explanation and recommendation, so every point of the score can be traced.

## Formula

```
rule_score = 1                        site rule passed
           = 0                        site rule failed
           = 1 − affected / total     page rule (share of pages that pass)

score = 100 × Σ(weight × rule_score) / Σ(weight)     over applicable rules only
```

* **Not applicable** rules (no data, or a provider such as PageSpeed is not configured) are excluded from
  both the numerator and the denominator. A missing integration never raises or lowers the score.
* With zero applicable rules, `possibleWeight = 0` and the UI shows "no score", not 100.
* Category scores (`crawlability`, `on_page`, `links`, …) use the same formula per category.

## Severity and default weights

| Severity (when failed) | Default weight |
|---|---|
| Critical | 10 |
| Warning | 5 |
| Opportunity | 2 |
| Passed | — (rule passed) |

Some rules override the default: `site.robots_blocks_all` = 15, `site.core_web_vitals` = 8, `page.twitter_card` = 1.

## Worked example

| Rule | Weight | Result | Rule score | Earned |
|---|---|---|---|---|
| site.https | 10 | passed | 1.00 | 10.0 |
| page.title_missing | 10 | 5 of 20 pages fail | 0.75 | 7.5 |
| **Total** | **20** | | | **17.5** → score **87.5** |

## Rule catalog (33 rules)

| Category | Rules |
|---|---|
| Security | `site.https` (C), `site.http_redirects_to_https` (W) |
| Crawlability | `site.robots_txt` (W), `site.robots_blocks_all` (C), `site.sitemap` (W), `page.status_4xx_5xx` (C), `page.redirect_chain` (W) |
| Indexability | `page.noindex` (W), `page.canonical` (W), `page.canonical_points_elsewhere` (C) |
| On-page | `page.title_missing` (C), `page.title_length` (O), `page.title_duplicate` (W), `page.meta_description_missing` (W), `page.meta_description_length` (O), `page.meta_description_duplicate` (O), `page.h1_missing` (W), `page.h1_multiple` (O), `page.heading_hierarchy` (O), `page.lang` (O) |
| Content | `page.thin_content` (W, < 250 words), `page.duplicate_content` (W), `page.image_alt` (O) |
| Links | `page.broken_internal_links` (C), `page.broken_external_links` (O), `page.orphan` (W), `page.url_structure` (O) |
| Performance | `page.response_time` (W, > 1 s), `site.core_web_vitals` (W, PageSpeed) |
| Mobile | `page.viewport` (C) |
| Structured data / social | `page.structured_data` (O), `page.open_graph` (O), `page.twitter_card` (O) |

C = critical, W = warning, O = opportunity.

## How each rule is evaluated (analyzer)

Source: `src/lib/audit/analyze.ts` (pure, tested in `tests/unit/analyzer.test.ts` and `tests/unit/crawl-engine.test.ts`).

Page populations:
* **fetched**: every URL the crawler requested (including failures).
* **content pages**: fetched HTML documents that returned 200 without a redirect.
* **indexable pages**: content pages that are not `noindex` and not canonicalised to another URL.

| Rule | Population (total) | Fails when |
|---|---|---|
| `site.https` | site | start URL is not `https://` |
| `site.http_redirects_to_https` | site (HTTPS only) | `http://` version does not end on `https://`; N/A if unreachable |
| `site.robots_txt` | site | `/robots.txt` not 200 plain text |
| `site.robots_blocks_all` | site | `Disallow: /` applies to RankoraBot / `*` |
| `site.sitemap` | site | no valid XML sitemap (robots.txt `Sitemap:`, `/sitemap.xml`, `/sitemap_index.xml`) |
| `site.core_web_vitals` | site | LCP > 2.5 s, CLS > 0.1, INP > 200 ms (field) or TBT > 300 ms (lab proxy); N/A without `PAGESPEED_API_KEY` |
| `page.status_4xx_5xx` | fetched | final status ≥ 400 or fetch failed after retries |
| `page.redirect_chain` | fetched | 2+ redirect hops |
| `page.noindex` | content | `noindex`/`none` in meta robots, googlebot or `X-Robots-Tag` |
| `page.canonical` | content, not noindex | no canonical or unresolvable canonical |
| `page.canonical_points_elsewhere` | content with canonical → another crawled URL | target redirected, not 200, failed or noindex |
| `page.title_missing` | content | no `<title>` text |
| `page.title_length` | content with title | < 30 or > 60 characters |
| `page.title_duplicate` | indexable with title | title shared (case-insensitive) with another indexable page |
| `page.meta_description_*` | content / indexable | missing; < 70 or > 160 characters; duplicated |
| `page.h1_missing` / `page.h1_multiple` | content | no non-empty H1 / more than one H1 |
| `page.heading_hierarchy` | content | a heading level is skipped going deeper (e.g. H1 → H3) |
| `page.lang` | content | no `<html lang>` |
| `page.thin_content` | indexable | < 250 visible words (scripts/styles excluded) |
| `page.duplicate_content` | indexable | identical visible-text hash with another page |
| `page.image_alt` | content with images | any `<img>` without an `alt` attribute (`alt=""` is valid) |
| `page.broken_internal_links` | content with internal links | links to a crawled URL that returned ≥ 400 or failed |
| `page.broken_external_links` | content with checked external links | external target ≥ 400 or unreachable; N/A when external checks are off |
| `page.orphan` | content pages found in the sitemap (not the start URL) | no other crawled page links to it; N/A without a sitemap |
| `page.url_structure` | fetched | uppercase, underscores, > 115 chars, > 2 query params, session IDs, spaces, double slashes |
| `page.response_time` | fetched with timing | crawler-measured response > 1000 ms |
| `page.viewport` | content | no `<meta name="viewport">` |
| `page.structured_data` | indexable | no JSON-LD, microdata or RDFa |
| `page.open_graph` | indexable | missing any of `og:title`, `og:description`, `og:image` |
| `page.twitter_card` | indexable | no `twitter:card` |

Recorded but not scored (shown on page details): nofollow links, images without width/height,
H2 count, meta refresh, internal/external/inbound link counts, crawl depth.

## Score bands

| Score | Band |
|---|---|
| ≥ 85 | Good |
| 60–84.99 | Needs work |
| < 60 | Poor |

## Issues lifecycle

Each failed check becomes an `seo_issues` row keyed by `(website_id, fingerprint)`. Later audits update
`last_detected_at` and affected pages. When a rule passes again the issue becomes `fixed` with `fixed_at`.
Users may set `ignored`. Issues can be converted into `seo_tasks`.

## Changing the scoring

Changing weights or rules is a scoring change: bump `SCORING_VERSION` and update this document.
Historical audits keep the version they were computed with.
