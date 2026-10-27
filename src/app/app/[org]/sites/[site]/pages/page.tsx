import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { statusTone } from "@/lib/audit/labels";
import { PRESETS, resolveRange } from "@/lib/analytics/ranges";
import { sourceState } from "@/lib/analytics/source";
import { SourceLine } from "@/components/analytics/controls";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Page Explorer" };

const PAGE_SIZE = 50;
const SORTS = [
  { key: "clicks", label: "Most clicks" },
  { key: "impressions", label: "Most impressions" },
  { key: "views", label: "Most views" },
  { key: "position", label: "Best position" },
  { key: "issues", label: "Most issues" },
  { key: "inlinks", label: "Most inlinks" },
  { key: "words", label: "Fewest words" },
  { key: "url", label: "Site structure" },
];

export default async function PagesPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/pages">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const status = typeof sp.status === "string" ? sp.status : "all";
  const indexable = typeof sp.indexable === "string" ? sp.indexable : "all";
  const pageNo = Math.max(1, Number(sp.page) || 1);

  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("id, finished_at")
    .eq("website_id", website.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) {
    return (
      <>
        <PageHeader title="Pages" badge={website.is_demo ? <DemoDataBadge /> : undefined} description="Every URL found by the latest site audit." />
        <Card>
          <EmptyState
            icon={FileText}
            title={website.is_demo ? "The demo has no crawled pages" : "No crawl yet"}
            description={
              website.is_demo
                ? "The Demo Project contains a sample audit only. Add a real website and run an audit to see page-level data."
                : "Run a site audit to list every page with its status, metadata and issues."
            }
            action={!website.is_demo && <ButtonLink href={`${base}/audit`}>Go to Site Audit</ButtonLink>}
          />
        </Card>
      </>
    );
  }

  const range = resolveRange({ range: typeof sp.range === "string" && PRESETS.some((p) => p.key === sp.range) ? sp.range : "28d" });
  const sort = typeof sp.sort === "string" && SORTS.some((x) => x.key === sp.sort) ? sp.sort : "clicks";
  const [{ data: rows }, gsc, ga] = await Promise.all([
    supabase.rpc("page_explorer", {
      p_site: website.id,
      p_job: job.id,
      p_from: range.from,
      p_to: range.to,
      p_search: q || undefined,
      p_status: status,
      p_indexable: indexable,
      p_sort: sort,
      p_limit: PAGE_SIZE,
      p_offset: (pageNo - 1) * PAGE_SIZE,
    }),
    sourceState(website, "google_search_console"),
    sourceState(website, "google_analytics_4"),
  ]);
  const pages = rows ?? [];
  const count = Number(pages[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const qs = (patch: Record<string, string>) => `${base}/pages?${new URLSearchParams({ q, status, indexable, sort, range: range.key, page: String(pageNo), ...patch })}`;
  const hasGsc = gsc.kind === "ready" || gsc.kind === "demo";
  const hasGa = ga.kind === "ready" || ga.kind === "demo";

  return (
    <>
      <PageHeader
        title="Page Explorer"
        description={`${formatNumber(count)} URLs from the audit on ${formatDate(job.finished_at)}, joined with search and traffic data for ${formatDate(range.from)} – ${formatDate(range.to)}.`}
      />
      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Clicks & impressions:</span>
        {hasGsc ? <SourceLine state={gsc} label="Search Console" /> : <Link className="text-brand hover:underline" href={`${base}/integrations`}>Search Console not connected</Link>}
        <span className="ml-2">Views:</span>
        {hasGa ? <SourceLine state={ga} label="GA4" /> : <Link className="text-brand hover:underline" href={`${base}/integrations`}>GA4 not connected</Link>}
      </p>
      <Card>
        <form className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end" role="search">
          <div className="flex-1">
            <label htmlFor="q" className="sr-only">
              Search URLs
            </label>
            <Input id="q" name="q" placeholder="Filter by URL…" defaultValue={q} />
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="all">All statuses</option>
              <option value="2xx">2xx OK</option>
              <option value="3xx">3xx Redirect</option>
              <option value="4xx">4xx Client error</option>
              <option value="5xx">5xx Server error</option>
              <option value="failed">Fetch failed</option>
              <option value="skipped">Skipped</option>
            </Select>
          </div>
          <div>
            <label htmlFor="indexable" className="sr-only">
              Indexability
            </label>
            <Select id="indexable" name="indexable" defaultValue={indexable}>
              <option value="all">Any indexability</option>
              <option value="yes">Indexable</option>
              <option value="no">Not indexable</option>
            </Select>
          </div>
          <div>
            <label htmlFor="sort" className="sr-only">
              Sort
            </label>
            <Select id="sort" name="sort" defaultValue={sort}>
              {SORTS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="range" className="sr-only">
              Date range
            </label>
            <Select id="range" name="range" defaultValue={range.key}>
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <button className="h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">Apply</button>
        </form>
        {!pages?.length ? (
          <EmptyState title="No pages match these filters" className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">URL</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Clicks</th>
                  <th className="px-3 py-2 text-right font-medium">Impr.</th>
                  <th className="px-3 py-2 text-right font-medium">Pos.</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-3 py-2 text-right font-medium">Words</th>
                  <th className="px-3 py-2 text-right font-medium">Inlinks</th>
                  <th className="px-3 py-2 text-right font-medium">Keywords</th>
                  <th className="px-5 py-2 text-right font-medium">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pages.map((p) => {
                  const url = p.url ?? "";
                  const path = (() => {
                    try {
                      const u = new URL(url);
                      return u.pathname + u.search;
                    } catch {
                      return url;
                    }
                  })();
                  const metric = (v: number | null, enabled: boolean) => (!enabled ? <span className="text-muted">—</span> : formatNumber(v ?? 0));
                  return (
                    <tr key={p.page_id} className="hover:bg-surface-2/50">
                      <td className="max-w-[22rem] px-5 py-2.5">
                        <Link href={`${base}/pages/${p.page_id}`} className="block truncate font-medium text-ink hover:text-brand" title={url}>
                          {path}
                        </Link>
                        <span className="block truncate text-xs text-muted">
                          {p.title ?? "—"}
                          {p.is_indexable === false && <> · not indexable ({p.indexability_reason})</>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={statusTone(p.status_code, p.fetch_state ?? "")}>{p.fetch_state === "fetched" ? p.status_code : p.fetch_state}</Badge>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{metric(p.clicks, hasGsc)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{metric(p.impressions, hasGsc)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-muted">{hasGsc && p.avg_position !== null ? Number(p.avg_position).toFixed(1) : "—"}</td>
                      <td className="tabular px-3 py-2.5 text-right">{metric(p.page_views, hasGa)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(p.word_count)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(p.inbound_links)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{p.keywords ? p.keywords : <span className="text-muted">0</span>}</td>
                      <td className="tabular px-5 py-2.5 text-right">
                        <span className={cn(p.open_issues ? "font-medium text-warning" : "text-muted")}>{p.open_issues ?? 0}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <nav className="flex items-center justify-between border-t border-line px-5 py-3 text-sm" aria-label="Pagination">
            <span className="text-muted">
              Page {pageNo} of {totalPages}
            </span>
            <div className="flex gap-2">
              {pageNo > 1 && (
                <Link className="rounded-lg border border-line-strong px-3 py-1.5 hover:bg-surface-2" href={qs({ page: String(pageNo - 1) })}>
                  Previous
                </Link>
              )}
              {pageNo < totalPages && (
                <Link className="rounded-lg border border-line-strong px-3 py-1.5 hover:bg-surface-2" href={qs({ page: String(pageNo + 1) })}>
                  Next
                </Link>
              )}
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
