import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { statusTone } from "@/lib/audit/labels";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Pages" };

const PAGE_SIZE = 50;

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

  let query = supabase
    .from("crawl_pages")
    .select("id, normalized_url, fetch_state, status_code, title, word_count, is_indexable, indexability_reason, response_time_ms, inbound_links_count", { count: "exact" })
    .eq("crawl_job_id", job.id)
    .neq("fetch_state", "pending");
  if (q) query = query.ilike("normalized_url", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  if (status === "2xx") query = query.gte("status_code", 200).lt("status_code", 300);
  if (status === "3xx") query = query.gte("status_code", 300).lt("status_code", 400);
  if (status === "4xx") query = query.gte("status_code", 400).lt("status_code", 500);
  if (status === "5xx") query = query.gte("status_code", 500);
  if (status === "failed" || status === "skipped") query = query.eq("fetch_state", status);
  if (indexable === "yes") query = query.eq("is_indexable", true);
  if (indexable === "no") query = query.eq("is_indexable", false);
  const { data: pages, count } = await query.order("depth").order("normalized_url").range((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE - 1);

  // open-issue counts per URL
  const urls = (pages ?? []).map((p) => p.normalized_url);
  const { data: openIssues } = await supabase.from("seo_issues").select("id").eq("website_id", website.id).eq("status", "open");
  const { data: issuePages } =
    urls.length && openIssues?.length
      ? await supabase.from("seo_issue_pages").select("url").in("issue_id", openIssues.map((i) => i.id)).in("url", urls)
      : { data: [] as { url: string }[] };
  const issueCount = new Map<string, number>();
  for (const ip of issuePages ?? []) issueCount.set(ip.url, (issueCount.get(ip.url) ?? 0) + 1);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (patch: Record<string, string>) => `${base}/pages?${new URLSearchParams({ q, status, indexable, page: String(pageNo), ...patch })}`;

  return (
    <>
      <PageHeader title="Pages" description={`${formatNumber(count ?? 0)} URLs from the audit on ${formatDate(job.finished_at)}`} />
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
          <button className="h-10 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">Apply</button>
        </form>
        {!pages?.length ? (
          <EmptyState title="No pages match these filters" className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">URL</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Indexable</th>
                  <th className="px-3 py-2 text-right font-medium">Words</th>
                  <th className="px-3 py-2 text-right font-medium">Inlinks</th>
                  <th className="px-3 py-2 text-right font-medium">Time</th>
                  <th className="px-5 py-2 text-right font-medium">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pages.map((p) => {
                  const path = (() => {
                    try {
                      const u = new URL(p.normalized_url);
                      return u.pathname + u.search;
                    } catch {
                      return p.normalized_url;
                    }
                  })();
                  return (
                    <tr key={p.id} className="hover:bg-surface-2/50">
                      <td className="max-w-[22rem] px-5 py-2.5">
                        <Link href={`${base}/pages/${p.id}`} className="block truncate font-medium text-ink hover:text-brand" title={p.normalized_url}>
                          {path}
                        </Link>
                        <span className="block truncate text-xs text-muted">{p.title ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={statusTone(p.status_code, p.fetch_state)}>{p.fetch_state === "fetched" ? p.status_code : p.fetch_state}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {p.is_indexable === null ? "—" : p.is_indexable ? <span className="text-success">Yes</span> : <span className="text-muted">No · {p.indexability_reason}</span>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(p.word_count)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(p.inbound_links_count)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-muted">{p.response_time_ms !== null ? `${p.response_time_ms} ms` : "—"}</td>
                      <td className="tabular px-5 py-2.5 text-right">
                        <span className={cn(issueCount.get(p.normalized_url) ? "font-medium text-warning" : "text-muted")}>{issueCount.get(p.normalized_url) ?? 0}</span>
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
