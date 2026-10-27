import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus, Wrench, X } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/paginate";
import type { CrawlState } from "@/lib/crawler/types";
import { evaluateCoreWebVitals, THRESHOLDS } from "@/lib/audit/analyze";
import { formatDate, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Technical SEO" };

function Status({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok === null ? Minus : ok ? Check : X;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className={ok === null ? "size-4 text-muted" : ok ? "size-4 text-success" : "size-4 text-critical"} aria-hidden />
      {label}
    </span>
  );
}

export default async function TechnicalPage({ params }: PageProps<"/app/[org]/sites/[site]/technical">) {
  const { org: orgSlug, site: siteId } = await params;
  const { website } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;

  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("id, state, finished_at, pages_crawled")
    .eq("website_id", website.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) {
    return (
      <>
        <PageHeader title="Technical SEO" description="Crawlability, indexability, redirects and performance." />
        <Card>
          <EmptyState
            icon={Wrench}
            title={website.is_demo ? "No crawl data in the demo" : "No crawl yet"}
            description={website.is_demo ? "Technical details come from a real crawl. Add a real website and run an audit." : "Run a site audit to see robots.txt, sitemap, HTTPS, status code and Core Web Vitals details."}
            action={!website.is_demo && <ButtonLink href={`${base}/audit`}>Go to Site Audit</ButtonLink>}
          />
        </Card>
      </>
    );
  }

  const state = (job.state ?? {}) as CrawlState;
  // page through the crawl (Data API returns at most 1000 rows per request)
  const pages = await selectAll((from, to) =>
    supabase
      .from("crawl_pages")
      .select("id, fetch_state, status_code, is_indexable, indexability_reason, response_time_ms, redirect_chain")
      .eq("crawl_job_id", job.id)
      .neq("fetch_state", "pending")
      .order("id")
      .range(from, to),
  );
  const bucket = (lo: number, hi: number) => pages.filter((p) => p.fetch_state === "fetched" && (p.status_code ?? 0) >= lo && (p.status_code ?? 0) < hi).length;
  const statusDist = [
    { label: "2xx OK", n: bucket(200, 300), tone: "success" as const },
    { label: "3xx Redirect", n: bucket(300, 400), tone: "warning" as const },
    { label: "4xx Client error", n: bucket(400, 500), tone: "critical" as const },
    { label: "5xx Server error", n: bucket(500, 600), tone: "critical" as const },
    { label: "Fetch failed", n: pages.filter((p) => p.fetch_state === "failed").length, tone: "critical" as const },
    { label: "Skipped", n: pages.filter((p) => p.fetch_state === "skipped").length, tone: "neutral" as const },
  ];
  const reasons = new Map<string, number>();
  for (const p of pages) if (p.is_indexable === false) reasons.set(p.indexability_reason ?? "other", (reasons.get(p.indexability_reason ?? "other") ?? 0) + 1);
  const indexableCount = pages.filter((p) => p.is_indexable).length;
  const times = pages.map((p) => p.response_time_ms).filter((t): t is number => t !== null).sort((a, b) => a - b);
  const pct = (q: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(q * times.length))] : null);
  const chains = pages.filter((p) => Array.isArray(p.redirect_chain) && p.redirect_chain.length >= 2).length;
  const psi = state.pagespeed;

  return (
    <>
      <PageHeader title="Technical SEO" description={`From the audit on ${formatDate(job.finished_at)} · ${formatNumber(job.pages_crawled)} URLs`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Crawlability" />
          <CardBody className="space-y-4 text-sm">
            <div>
              <Status ok={state.robots?.found ?? null} label={state.robots?.found ? "robots.txt found" : `robots.txt not available${state.robots?.error ? ` (${state.robots.error})` : ""}`} />
              {state.robots?.blocksAll && <p className="mt-1 text-critical">robots.txt blocks the entire site for crawlers.</p>}
              {state.robots?.crawlDelaySeconds ? <p className="mt-1 text-muted">Crawl-delay: {state.robots.crawlDelaySeconds}s</p> : null}
              {state.robots?.excerpt && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-brand">Show robots.txt</summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{state.robots.excerpt.slice(0, 4000)}</pre>
                </details>
              )}
            </div>
            <div>
              <Status ok={state.sitemap?.found ?? null} label={state.sitemap?.found ? `XML sitemap found · ${formatNumber(state.sitemap.urlCount)} URLs` : "No XML sitemap found"} />
              {state.sitemap?.sources.map((s) => (
                <p key={s} className="mt-1 truncate text-xs text-muted">
                  {s}
                </p>
              ))}
              {state.sitemap?.errors.map((e) => (
                <p key={e} className="mt-1 text-xs text-warning">
                  {e}
                </p>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security" />
          <CardBody className="space-y-3 text-sm">
            <Status ok={state.https?.siteIsHttps ?? website.base_url.startsWith("https:")} label={website.base_url.startsWith("https:") ? "Served over HTTPS" : "Not served over HTTPS"} />
            <div>
              <Status
                ok={state.https?.httpRedirectsToHttps ?? null}
                label={
                  state.https?.httpRedirectsToHttps === true
                    ? "HTTP redirects to HTTPS"
                    : state.https?.httpRedirectsToHttps === false
                      ? "HTTP does not redirect to HTTPS"
                      : "HTTP → HTTPS redirect could not be checked"
                }
              />
              {state.https?.detail && <p className="mt-1 text-xs text-muted">{state.https.detail}</p>}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Status codes" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {statusDist.map((s) => (
                <li key={s.label} className="flex items-center justify-between">
                  <span>{s.label}</span>
                  <Badge tone={s.n === 0 ? "neutral" : s.tone}>{formatNumber(s.n)}</Badge>
                </li>
              ))}
              <li className="flex items-center justify-between border-t border-line pt-2">
                <span>Redirect chains (2+ hops)</span>
                <Badge tone={chains ? "warning" : "neutral"}>{chains}</Badge>
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Indexability" />
          <CardBody>
            <p className="tabular text-2xl font-semibold">
              {formatNumber(indexableCount)} <span className="text-sm font-normal text-muted">of {formatNumber(pages.length)} URLs indexable</span>
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                <li key={r} className="flex justify-between">
                  <span className="text-muted">Not indexable: {r}</span>
                  <span className="tabular">{n}</span>
                </li>
              ))}
            </ul>
            <Link href={`${base}/pages?indexable=no`} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
              View non-indexable pages →
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Server response time" description="Measured by Rankora's crawler (includes network latency)" />
          <CardBody>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {[
                ["Median", pct(0.5)],
                ["90th pct", pct(0.9)],
                ["Slowest", times.at(-1) ?? null],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className={`tabular mt-1 text-lg font-semibold ${typeof v === "number" && v > THRESHOLDS.slowResponseMs ? "text-critical" : ""}`}>
                    {v === null ? "—" : `${v} ms`}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Core Web Vitals" description="Google PageSpeed Insights, mobile, home page" />
          <CardBody className="text-sm">
            {psi && "performanceScore" in psi ? (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Performance", psi.performanceScore === null ? "—" : String(psi.performanceScore)],
                    ["LCP", psi.lcpMs === null ? "—" : `${(psi.lcpMs / 1000).toFixed(1)} s`],
                    ["CLS", psi.cls === null ? "—" : psi.cls.toFixed(2)],
                    [psi.inpMs !== null ? "INP" : "TBT", psi.inpMs !== null ? `${psi.inpMs} ms` : psi.tbtMs === null ? "—" : `${psi.tbtMs} ms`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="tabular mt-1 text-lg font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted">
                  {psi.fieldDataAvailable ? "Real-user (CrUX) field data where available, lab data otherwise." : "Lab data (no real-user data available for this URL)."} Measured{" "}
                  {formatDate(psi.fetchedAt)}.
                </p>
                {evaluateCoreWebVitals(psi).map((f) => (
                  <p key={f} className="mt-1 text-xs text-critical">
                    {f}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-muted">Not measured: {psi && "skipped" in psi ? psi.skipped : "PageSpeed Insights was not run for this audit."}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
