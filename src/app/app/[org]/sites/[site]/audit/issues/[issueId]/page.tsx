import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireWebsite } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { setIssueStatusAction } from "@/lib/actions/audit";
import { canChangeIssueStatus } from "@/lib/audit/access";
import { RULES_BY_ID } from "@/lib/seo/rules";
import { CATEGORY_LABEL } from "@/lib/audit/labels";
import { formatDate, formatNumber } from "@/lib/utils";
import { Badge, DemoDataBadge, SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Issue" };

const STATUS_TONE = { open: "warning", fixed: "success", ignored: "neutral" } as const;

export default async function IssuePage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/audit/issues/[issueId]">) {
  const { org: orgSlug, site: siteId, issueId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(issueId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;

  const { data: issue } = await supabase.from("seo_issues").select("*").eq("id", issueId).eq("website_id", website.id).maybeSingle();
  if (!issue) notFound();

  const [{ data: pages }, { data: job }] = await Promise.all([
    supabase.from("seo_issue_pages").select("url").eq("issue_id", issue.id).order("url").limit(500),
    supabase
      .from("crawl_jobs")
      .select("id")
      .eq("website_id", website.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const urls = (pages ?? []).map((p) => p.url);
  const { data: crawled } =
    job && urls.length
      ? await supabase.from("crawl_pages").select("id, normalized_url, status_code, title").eq("crawl_job_id", job.id).in("normalized_url", urls.slice(0, 200))
      : { data: [] as { id: string; normalized_url: string; status_code: number | null; title: string | null }[] };
  const pageByUrl = new Map((crawled ?? []).map((c) => [c.normalized_url, c]));
  const rule = RULES_BY_ID.get(issue.rule_id);
  const nextStatus = issue.status === "open" ? "ignored" : issue.status === "ignored" ? "open" : null;
  const canChange = nextStatus !== null && canChangeIssueStatus(role, issue.status, nextStatus) && !website.is_demo;

  return (
    <>
      <Link href={`${base}/audit`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Site Audit
      </Link>
      <PageHeader
        title={issue.title}
        badge={
          <>
            <SeverityBadge severity={issue.severity} />
            <Badge tone={STATUS_TONE[issue.status as keyof typeof STATUS_TONE] ?? "neutral"} className="capitalize">
              {issue.status}
            </Badge>
            {website.is_demo && <DemoDataBadge />}
          </>
        }
        description={`${rule ? CATEGORY_LABEL[rule.category] : "Rule"} · rule ${issue.rule_id}`}
        actions={
          canChange && (
            <form action={setIssueStatusAction}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="issueId" value={issue.id} />
              <input type="hidden" name="status" value={nextStatus!} />
              <Button type="submit" variant="secondary">
                {nextStatus === "ignored" ? "Ignore issue" : "Reopen issue"}
              </Button>
            </form>
          )
        }
      />
      {sp.error && <div className="mb-4"><FormMessage>That status change is not allowed.</FormMessage></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="What's wrong and how to fix it" />
          <CardBody className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-ink">Why it matters</p>
              <p className="mt-1 text-ink-2">{issue.explanation}</p>
            </div>
            <div>
              <p className="font-medium text-ink">Recommended fix</p>
              <p className="mt-1 text-ink-2">{issue.recommendation}</p>
            </div>
            {issue.status === "ignored" && (
              <p className="text-muted">This issue is ignored. It is still detected by audits but stays out of your open issue list.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Timeline" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">First detected</dt>
                <dd>{formatDate(issue.first_detected_at)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Last detected</dt>
                <dd>{formatDate(issue.last_detected_at)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Fixed</dt>
                <dd>{issue.fixed_at ? formatDate(issue.fixed_at) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Affected pages</dt>
                <dd className="tabular">{formatNumber(issue.affected_pages_count)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Affected pages" description={urls.length > 0 && urls.length < issue.affected_pages_count ? `Showing the first ${urls.length}` : undefined} />
        {urls.length === 0 ? (
          <EmptyState
            title={issue.status === "fixed" ? "Fixed in the latest audit" : "Site-wide issue"}
            description={issue.status === "fixed" ? "No pages are affected any more." : "This rule applies to the website as a whole rather than individual pages."}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {urls.map((u) => {
              const p = pageByUrl.get(u);
              return (
                <li key={u} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <Link href={`${base}/pages/${p.id}`} className="block truncate font-medium text-ink hover:text-brand">
                        {u}
                      </Link>
                    ) : (
                      <span className="block truncate text-ink">{u}</span>
                    )}
                    {p?.title && <span className="block truncate text-xs text-muted">{p.title}</span>}
                  </div>
                  {p?.status_code && <Badge tone={p.status_code >= 400 ? "critical" : p.status_code >= 300 ? "warning" : "neutral"}>{p.status_code}</Badge>}
                  {!website.is_demo && (
                    <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="text-muted hover:text-ink" aria-label="Open page in a new tab">
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
