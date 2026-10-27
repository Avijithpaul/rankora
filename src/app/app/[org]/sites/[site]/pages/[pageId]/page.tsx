import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { THRESHOLDS } from "@/lib/audit/analyze";
import { statusTone } from "@/lib/audit/labels";
import { urlStructureProblems } from "@/lib/crawler/url";
import { addDays, isoDay } from "@/lib/analytics/ranges";
import { sourceState } from "@/lib/analytics/source";
import { pageRecommendations, type SearchMetrics } from "@/lib/content/page-recommendations";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Delta, SourceLine } from "@/components/analytics/controls";
import { Badge, type BadgeTone, SeverityBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Page details" };
export const maxDuration = 30;

const PRIORITY_TONE: Record<"high" | "medium" | "low", BadgeTone> = { high: "critical", medium: "warning", low: "neutral" };

function Metric({ label, value, delta }: { label: string; value: React.ReactNode; delta?: number | null }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular text-lg font-semibold text-ink">{value}</div>
      {delta !== undefined && <Delta value={delta} />}
    </div>
  );
}

type GscRow = { date: string; clicks: number; impressions: number; position: number | null };
type GaRow = { date: string; users: number; sessions: number; page_views: number };

function sumGsc(rows: GscRow[]): SearchMetrics {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const weighted = rows.reduce((n, r) => n + Number(r.position ?? 0) * r.impressions, 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? weighted / impressions : null };
}

const sumGa = (rows: GaRow[]) => ({
  users: rows.reduce((n, r) => n + r.users, 0),
  sessions: rows.reduce((n, r) => n + r.sessions, 0),
  views: rows.reduce((n, r) => n + r.page_views, 0),
});

const change = (now: number | null | undefined, prev: number | null | undefined) => (now == null || !prev ? null : (now - prev) / prev);

/** Last 28 complete days and the 28 before them. */
function windows() {
  const end = addDays(new Date(), -1);
  return { from: isoDay(addDays(end, -27)), prevFrom: isoDay(addDays(end, -55)), to: isoDay(end) };
}

function Row({ label, value, ok, hint }: { label: string; value: React.ReactNode; ok?: boolean | null; hint?: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2.5 text-sm sm:grid-cols-[11rem_1fr]">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        {ok === true && <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="OK" />}
        {ok === false && <X className="mt-0.5 size-4 shrink-0 text-critical" aria-label="Problem" />}
        <span className="min-w-0 break-words text-ink">
          {value ?? <span className="text-muted">—</span>}
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </dd>
    </div>
  );
}

export default async function PageDetail({ params }: PageProps<"/app/[org]/sites/[site]/pages/[pageId]">) {
  const { org: orgSlug, site: siteId, pageId } = await params;
  const { website } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;

  const { data: p } = await supabase.from("crawl_pages").select("*").eq("id", pageId).eq("website_id", website.id).maybeSingle();
  if (!p) notFound();

  const [{ data: outLinks }, { data: inLinks }, { data: issueRows }] = await Promise.all([
    supabase.from("crawl_links").select("target_url, is_internal, is_nofollow, anchor_text, target_status, target_error").eq("source_page_id", p.id).limit(300),
    supabase
      .from("crawl_links")
      .select("source_page_id, anchor_text, crawl_pages!crawl_links_source_page_id_organization_id_fkey(normalized_url)")
      .eq("crawl_job_id", p.crawl_job_id)
      .eq("target_url", p.normalized_url)
      .neq("source_page_id", p.id)
      .limit(100),
    supabase.from("seo_issue_pages").select("issue_id, seo_issues!inner(id, title, severity, status, website_id)").eq("url", p.normalized_url).eq("seo_issues.website_id", website.id),
  ]);

  const { from, prevFrom, to } = windows();
  let path = "/";
  try {
    path = new URL(p.normalized_url).pathname || "/";
  } catch {
    /* keep "/" */
  }
  const [gscState, gaState, { data: gscRows }, { data: gaRows }, { data: targeted }, { data: ranking }] = await Promise.all([
    sourceState(website, "google_search_console"),
    sourceState(website, "google_analytics_4"),
    supabase.from("search_console_pages").select("date, clicks, impressions, position").eq("website_id", website.id).eq("page", p.normalized_url).gte("date", prevFrom).lte("date", to),
    supabase.from("analytics_pages").select("date, users, sessions, page_views").eq("website_id", website.id).eq("page_path", path).eq("is_landing", false).gte("date", prevFrom).lte("date", to),
    supabase.from("keywords").select("id, keyword, current_position, target_url, current_url").eq("website_id", website.id).eq("target_url", p.normalized_url).limit(50),
    supabase.from("keywords").select("id, keyword, current_position, target_url, current_url").eq("website_id", website.id).eq("current_url", p.normalized_url).limit(50),
  ]);
  const hasGsc = gscState.kind === "ready" || gscState.kind === "demo";
  const hasGa = gaState.kind === "ready" || gaState.kind === "demo";
  const gscNow = hasGsc ? sumGsc((gscRows ?? []).filter((r) => r.date >= from)) : null;
  const gscPrev = hasGsc ? sumGsc((gscRows ?? []).filter((r) => r.date < from)) : null;
  const gaNow = hasGa ? sumGa((gaRows ?? []).filter((r) => r.date >= from)) : null;
  const gaPrev = hasGa ? sumGa((gaRows ?? []).filter((r) => r.date < from)) : null;
  const keywords = [...(targeted ?? []), ...(ranking ?? [])].filter((k, i, all) => all.findIndex((x) => x.id === k.id) === i);

  const d = (p.details ?? {}) as Record<string, unknown>;
  const og = (p.open_graph ?? {}) as Record<string, string>;
  const tw = (p.twitter_card ?? {}) as Record<string, string>;
  const chain = (Array.isArray(p.redirect_chain) ? p.redirect_chain : []) as { url: string; status: number }[];
  const urlProblems = urlStructureProblems(p.normalized_url);
  const titleLen = p.title?.length ?? 0;
  const descLen = p.meta_description?.length ?? 0;
  const issues = (issueRows ?? [])
    .map((r) => r.seo_issues as unknown as { id: string; title: string; severity: "critical" | "warning" | "opportunity"; status: string })
    .filter((i) => i.status === "open");
  const brokenOut = (outLinks ?? []).filter((l) => (l.target_status ?? 0) >= 400 || l.target_error);
  const recs = pageRecommendations(
    {
      isIndexable: p.is_indexable,
      statusCode: p.status_code,
      depth: p.depth,
      title: p.title,
      metaDescription: p.meta_description,
      h1Count: p.h1.filter(Boolean).length,
      wordCount: p.word_count,
      inboundLinks: p.inbound_links_count,
      openIssues: issues.length,
      targetKeywords: keywords.length,
    },
    gscNow,
    gaNow?.views ?? null,
  );
  const primaryKeyword = keywords.find((k) => k.target_url === p.normalized_url) ?? keywords[0];
  const optimizeHref = `${base}/content?url=${encodeURIComponent(p.normalized_url)}${primaryKeyword ? `&keyword=${encodeURIComponent(primaryKeyword.keyword)}` : ""}`;

  return (
    <>
      <Link href={`${base}/pages`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Pages
      </Link>
      <PageHeader
        title={p.title ?? "(no title)"}
        badge={<Badge tone={statusTone(p.status_code, p.fetch_state)}>{p.fetch_state === "fetched" ? p.status_code : p.fetch_state}</Badge>}
        description={
          <a href={p.normalized_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all hover:text-brand">
            {p.normalized_url} <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
        }
        actions={
          p.fetch_state === "fetched" && !website.is_demo ? (
            <ButtonLink href={optimizeHref} variant="secondary" size="sm">
              Optimize content
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Search performance" description="Last 28 days vs previous 28" action={hasGsc ? <SourceLine state={gscState} label="Search Console" /> : undefined} />
          {gscNow ? (
            <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Metric label="Clicks" value={formatNumber(gscNow.clicks)} delta={change(gscNow.clicks, gscPrev?.clicks)} />
              <Metric label="Impressions" value={formatNumber(gscNow.impressions)} delta={change(gscNow.impressions, gscPrev?.impressions)} />
              <Metric label="CTR" value={gscNow.ctr === null ? "—" : `${(gscNow.ctr * 100).toFixed(1)}%`} />
              <Metric label="Avg. position" value={gscNow.position === null ? "—" : gscNow.position.toFixed(1)} />
            </CardBody>
          ) : (
            <CardBody className="text-sm text-muted">
              Search Console is not connected for this website.{" "}
              <Link href={`${base}/integrations`} className="text-brand hover:underline">
                Connect it
              </Link>{" "}
              to see clicks and impressions for this URL.
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Traffic" description="Last 28 days vs previous 28" action={hasGa ? <SourceLine state={gaState} label="GA4" /> : undefined} />
          {gaNow ? (
            <CardBody className="grid grid-cols-3 gap-3 text-sm">
              <Metric label="Views" value={formatNumber(gaNow.views)} delta={change(gaNow.views, gaPrev?.views)} />
              <Metric label="Sessions" value={formatNumber(gaNow.sessions)} delta={change(gaNow.sessions, gaPrev?.sessions)} />
              <Metric label="Users" value={formatNumber(gaNow.users)} delta={change(gaNow.users, gaPrev?.users)} />
            </CardBody>
          ) : (
            <CardBody className="text-sm text-muted">
              GA4 is not connected for this website.{" "}
              <Link href={`${base}/integrations`} className="text-brand hover:underline">
                Connect it
              </Link>{" "}
              to see page views for {path}.
            </CardBody>
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="Recommendations" description="Rule-based, from the crawl plus connected search and traffic data. Each item states the numbers behind it." />
        {recs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No recommendations for this page.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recs.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <Badge tone={PRIORITY_TONE[r.priority]} className="capitalize">
                  {r.priority}
                </Badge>
                <span>
                  <span className="font-medium text-ink">{r.title}</span>
                  <span className="block text-ink-2">{r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Metadata" />
            <CardBody className="py-1">
              <dl className="divide-y divide-line">
                <Row
                  label="Title"
                  value={p.title}
                  ok={p.title ? titleLen >= THRESHOLDS.titleMin && titleLen <= THRESHOLDS.titleMax : false}
                  hint={p.title ? `${titleLen} characters (recommended ${THRESHOLDS.titleMin}–${THRESHOLDS.titleMax})` : "Missing"}
                />
                <Row
                  label="Meta description"
                  value={p.meta_description}
                  ok={p.meta_description ? descLen >= THRESHOLDS.descriptionMin && descLen <= THRESHOLDS.descriptionMax : false}
                  hint={p.meta_description ? `${descLen} characters (recommended ${THRESHOLDS.descriptionMin}–${THRESHOLDS.descriptionMax})` : "Missing"}
                />
                <Row label="H1" value={p.h1.length ? p.h1.map((h, i) => <span key={i} className="block">{h || "(empty)"}</span>) : null} ok={p.h1.filter(Boolean).length === 1} hint={`${p.h1.length} H1 · ${p.h2_count ?? 0} H2`} />
                <Row label="Heading order" value={Array.isArray(d.headingLevels) ? (d.headingLevels as number[]).slice(0, 30).map((l) => `H${l}`).join(" → ") : null} ok={Number(d.headingSkips ?? 0) === 0} />
                <Row label="Canonical" value={p.canonical_url} ok={Boolean(p.canonical_url)} hint={p.canonical_url && p.canonical_url !== p.normalized_url ? "Points to a different URL" : undefined} />
                <Row label="Robots" value={[p.robots_meta, p.x_robots_tag && `X-Robots-Tag: ${p.x_robots_tag}`].filter(Boolean).join(" · ") || "index, follow (default)"} />
                <Row label="Indexable" value={p.is_indexable ? "Yes" : p.is_indexable === false ? `No — ${p.indexability_reason}` : null} ok={p.is_indexable} />
                <Row label="Language" value={p.lang} ok={Boolean(p.lang)} />
                <Row label="Viewport" value={p.has_viewport ? "Present" : p.has_viewport === false ? "Missing" : null} ok={p.has_viewport} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Content & media" />
            <CardBody className="py-1">
              <dl className="divide-y divide-line">
                <Row label="Word count" value={formatNumber(p.word_count)} ok={p.word_count === null ? null : p.word_count >= THRESHOLDS.thinContentWords} hint={`Thin content below ${THRESHOLDS.thinContentWords} words`} />
                <Row label="Images" value={p.images_count === null ? null : `${p.images_count} images · ${p.images_missing_alt ?? 0} without alt`} ok={p.images_count ? (p.images_missing_alt ?? 0) === 0 : null} />
                <Row label="Images without size" value={d.imagesMissingDimensions !== undefined ? String(d.imagesMissingDimensions) : null} hint="width/height attributes help prevent layout shift" />
                <Row label="Structured data" value={p.structured_data_types.length ? p.structured_data_types.join(", ") : null} ok={p.structured_data_types.length > 0} />
                <Row label="Open Graph" value={Object.keys(og).length ? Object.entries(og).slice(0, 5).map(([k, v]) => <span key={k} className="block truncate">og:{k} = {v}</span>) : null} ok={Boolean(og.title && og.description && og.image)} />
                <Row label="Twitter card" value={tw.card ?? null} ok={Boolean(tw.card)} />
                <Row label="URL structure" value={urlProblems.length ? urlProblems.join(", ") : "Clean"} ok={urlProblems.length === 0} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Outgoing links" description={`${p.internal_links_count ?? 0} internal · ${p.external_links_count ?? 0} external · ${brokenOut.length} broken`} />
            {(outLinks ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No links found on this page.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
                {(outLinks ?? []).map((l, i) => (
                  <li key={i} className="flex items-center gap-2 px-5 py-2">
                    <Badge tone={l.is_internal ? "brand" : "neutral"}>{l.is_internal ? "Internal" : "External"}</Badge>
                    {l.is_nofollow && <Badge>nofollow</Badge>}
                    <span className="min-w-0 flex-1 truncate" title={l.target_url}>
                      {l.anchor_text ? <span className="text-ink">{l.anchor_text} </span> : null}
                      <span className="text-muted">{l.target_url}</span>
                    </span>
                    {(l.target_status ?? 0) >= 400 || l.target_error ? <Badge tone="critical">{l.target_status ?? "error"}</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Target keywords" description="Saved keywords that target or currently rank with this URL" />
            {keywords.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">
                None yet. Set a target URL on a{" "}
                <Link href={`${base}/keywords`} className="text-brand hover:underline">
                  saved keyword
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {keywords.map((k) => (
                  <li key={k.id}>
                    <Link href={`${base}/keywords/${k.id}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-2/50">
                      <span className="min-w-0 flex-1 truncate">{k.keyword}</span>
                      {k.target_url === p.normalized_url && <Badge tone="brand">target</Badge>}
                      {k.current_url === p.normalized_url && <Badge tone="success">ranking</Badge>}
                      <span className="tabular text-xs text-muted">{k.current_position ? `#${k.current_position}` : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Open issues on this page" />
            {issues.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No open issues reference this page.</p>
            ) : (
              <ul className="divide-y divide-line">
                {issues.map((i) => (
                  <li key={i.id}>
                    <Link href={`${base}/audit/issues/${i.id}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-2/50">
                      <SeverityBadge severity={i.severity} />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Fetch" />
            <CardBody className="py-1">
              <dl className="divide-y divide-line">
                <Row label="Response time" value={p.response_time_ms !== null ? `${p.response_time_ms} ms` : null} ok={p.response_time_ms === null ? null : p.response_time_ms <= THRESHOLDS.slowResponseMs} />
                <Row label="Content type" value={p.content_type} />
                <Row label="Depth" value={`${p.depth} click${p.depth === 1 ? "" : "s"} from start`} />
                <Row label="Found via" value={[p.found_via_link && "internal links", p.found_in_sitemap && "sitemap"].filter(Boolean).join(" + ") || "start URL"} />
                <Row label="Inbound links" value={formatNumber(p.inbound_links_count)} ok={p.depth === 0 ? null : (p.inbound_links_count ?? 0) > 0} />
                <Row label="Attempts" value={String(p.attempts)} />
                {p.fetch_error && <Row label="Error" value={p.fetch_error} ok={false} />}
                {p.skip_reason && <Row label="Skipped" value={p.skip_reason} />}
                <Row label="Crawled" value={formatDate(p.crawled_at, { hour: "2-digit", minute: "2-digit" })} />
              </dl>
            </CardBody>
          </Card>
          {chain.length > 0 && (
            <Card>
              <CardHeader title="Redirect chain" description={`${chain.length} hop${chain.length > 1 ? "s" : ""}`} />
              <ol className="space-y-1 px-5 py-3 text-xs">
                {chain.map((h, i) => (
                  <li key={i} className="break-all">
                    <Badge tone="warning">{h.status}</Badge> {h.url}
                  </li>
                ))}
                <li className="break-all">
                  <Badge tone="success">final</Badge> {p.final_url}
                </li>
              </ol>
            </Card>
          )}
          <Card>
            <CardHeader title="Linked from" description={`${inLinks?.length ?? 0} crawled page${inLinks?.length === 1 ? "" : "s"}`} />
            <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
              {(inLinks ?? []).map((l, i) => {
                const src = (l.crawl_pages as unknown as { normalized_url: string } | null)?.normalized_url;
                return (
                  <li key={i} className="px-5 py-2">
                    <Link href={`${base}/pages/${l.source_page_id}`} className={cn("block truncate hover:text-brand")}>
                      {src ?? l.source_page_id}
                    </Link>
                    {l.anchor_text && <span className="block truncate text-xs text-muted">“{l.anchor_text}”</span>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
