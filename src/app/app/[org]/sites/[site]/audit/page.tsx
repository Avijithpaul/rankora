import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, History, Play, RotateCw, ScanSearch } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createTasksFromIssuesAction } from "@/lib/actions/tasks";
import { createClient } from "@/lib/supabase/server";
import { startAuditAction } from "@/lib/actions/audit";
import { auditDenial, DENIAL_MESSAGE } from "@/lib/audit/access";
import { toStatus } from "@/lib/audit/service";
import { RULES_BY_ID } from "@/lib/seo/rules";
import { CATEGORY_LABEL } from "@/lib/audit/labels";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { AuditRunner } from "@/components/audit/audit-runner";
import { Badge, DemoDataBadge, SeverityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { ScoreRing } from "@/components/ui/score-ring";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Site Audit" };
export const maxDuration = 60;

const FILTERS = [
  { key: "all", label: "All checks" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "opportunity", label: "Opportunity" },
  { key: "passed", label: "Passed" },
  { key: "na", label: "Not applicable" },
] as const;

const ERRORS: Record<string, string> = {
  ...DENIAL_MESSAGE,
  rate_limited: "You have started too many audits in the last hour. Please try again later.",
  config: "Audits are not fully configured on the server yet. Please contact the administrator.",
};

export default async function AuditPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/audit">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const filter = (typeof sp.severity === "string" ? sp.severity : "all") as (typeof FILTERS)[number]["key"];

  const [{ data: audits }, { data: activeJob }, { data: lastJob }] = await Promise.all([
    supabase
      .from("seo_audits")
      .select("id, score, created_at, pages_analyzed, critical_count, warning_count, opportunity_count, passed_count, scoring_version, score_breakdown")
      .eq("website_id", website.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("crawl_jobs")
      .select("id, status, phase, pages_crawled, pages_discovered, settings_snapshot, error, audit_id")
      .eq("website_id", website.id)
      .in("status", ["queued", "running"])
      .maybeSingle(),
    supabase.from("crawl_jobs").select("status, error, finished_at, created_at").eq("website_id", website.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const selectedId = typeof sp.audit === "string" ? sp.audit : audits?.[0]?.id;
  const audit = audits?.find((a) => a.id === selectedId) ?? null;
  const isLatest = audit?.id === audits?.[0]?.id;

  const [{ data: checks }, { data: issues }] = audit
    ? await Promise.all([
        supabase.from("seo_checks").select("*").eq("audit_id", audit.id),
        supabase.from("seo_issues").select("id, rule_id, status").eq("website_id", website.id),
      ])
    : [{ data: [] }, { data: [] }];

  const issueByRule = new Map((issues ?? []).map((i) => [i.rule_id, i]));
  const openIssueIds = (issues ?? []).filter((i) => i.status === "open").map((i) => i.id);
  const { data: openTasks } = openIssueIds.length
    ? await supabase.from("seo_tasks").select("issue_id").eq("website_id", website.id).in("status", ["todo", "in_progress"]).not("issue_id", "is", null)
    : { data: [] as { issue_id: string | null }[] };
  const tasked = new Set((openTasks ?? []).map((t) => t.issue_id));
  const untasked = openIssueIds.filter((id) => !tasked.has(id));
  const canTask = roleAtLeast(role, "member") && !website.is_demo;
  const sevOrder = { critical: 0, warning: 1, opportunity: 2, passed: 3 } as const;
  const all = (checks ?? []).sort(
    (a, b) =>
      (a.result === "not_applicable" ? 9 : sevOrder[a.severity]) - (b.result === "not_applicable" ? 9 : sevOrder[b.severity]) ||
      b.weight * (1 - b.rule_score) - a.weight * (1 - a.rule_score),
  );
  const counts = {
    all: all.length,
    critical: all.filter((c) => c.result === "failed" && c.severity === "critical").length,
    warning: all.filter((c) => c.result === "failed" && c.severity === "warning").length,
    opportunity: all.filter((c) => c.result === "failed" && c.severity === "opportunity").length,
    passed: all.filter((c) => c.result === "passed").length,
    na: all.filter((c) => c.result === "not_applicable").length,
  };
  const visible = all.filter((c) =>
    filter === "all" ? true : filter === "na" ? c.result === "not_applicable" : filter === "passed" ? c.result === "passed" : c.result === "failed" && c.severity === filter,
  );

  const denial = auditDenial(role, website);
  const breakdown = (audit?.score_breakdown ?? {}) as { byCategory?: Record<string, { score: number }> };
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const lastFailed = lastJob?.status === "failed" && (!audits?.[0] || new Date(lastJob.created_at) > new Date(audits[0].created_at));

  return (
    <>
      <PageHeader
        title="Site Audit"
        badge={website.is_demo ? <DemoDataBadge /> : undefined}
        description={`${website.domain} · crawls the site, checks ${RULES_BY_ID.size} rules and scores the results`}
        actions={
          !denial && !activeJob ? (
            <form action={startAuditAction}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="siteId" value={siteId} />
              <Button type="submit">
                {audits?.length ? <RotateCw aria-hidden /> : <Play aria-hidden />}
                {audits?.length ? "Re-run audit" : "Run first audit"}
              </Button>
            </form>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {errorCode && <FormMessage>{ERRORS[errorCode] ?? errorCode.slice(0, 200)}</FormMessage>}
        {denial && denial !== "role" && <FormMessage tone="info">{DENIAL_MESSAGE[denial]}</FormMessage>}
        {lastFailed && !activeJob && <FormMessage>The last audit failed: {lastJob?.error ?? "unknown error"}. You can run it again.</FormMessage>}
        {activeJob &&
          (denial ? (
            <FormMessage tone="info">An audit is running for this website. Results will appear here when it finishes.</FormMessage>
          ) : (
            <AuditRunner jobId={activeJob.id} initial={toStatus(activeJob)} />
          ))}

        {!audit ? (
          !activeJob && (
            <Card>
              <EmptyState
                icon={ScanSearch}
                title="No audit yet"
                description={
                  denial === "role"
                    ? "Ask a member of this organization to run the first audit."
                    : "Run an audit to crawl the website, check every page against the rule catalog and get a weighted SEO score."
                }
              />
            </Card>
          )
        ) : (
          <>
            {!isLatest && (
              <FormMessage tone="info">
                You are viewing an older audit from {formatDate(audit.created_at, { hour: "2-digit", minute: "2-digit" })}.{" "}
                <Link className="font-medium underline" href={`${base}/audit`}>
                  Show latest
                </Link>
              </FormMessage>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader
                  title="SEO health score"
                  description={`${formatNumber(audit.pages_analyzed)} pages · ${formatDate(audit.created_at, { hour: "2-digit", minute: "2-digit" })}`}
                  action={website.is_demo ? <DemoDataBadge /> : <Badge title="Scoring engine version">v{audit.scoring_version}</Badge>}
                />
                <CardBody className="flex items-center gap-6">
                  <ScoreRing score={Number(audit.score)} size={120} />
                  <dl className="grid flex-1 grid-cols-2 gap-3 text-sm">
                    {(["critical", "warning", "opportunity", "passed"] as const).map((s) => (
                      <div key={s}>
                        <dt>
                          <SeverityBadge severity={s} />
                        </dt>
                        <dd className="tabular mt-1 text-lg font-semibold">{audit[`${s}_count`]}</dd>
                      </div>
                    ))}
                  </dl>
                </CardBody>
                <p className="border-t border-line px-5 py-3 text-xs text-muted">
                  Score = weighted average of rule results.{" "}
                  <span title="Each rule earns its weight × (share of pages that pass). Rules that could not be evaluated are excluded.">How is this calculated?</span>
                </p>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="Score by category" />
                <CardBody className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {Object.entries(breakdown.byCategory ?? {})
                    .sort((a, b) => a[1].score - b[1].score)
                    .map(([cat, v]) => (
                      <div key={cat}>
                        <div className="flex justify-between text-sm">
                          <span className="text-ink-2">{CATEGORY_LABEL[cat] ?? cat}</span>
                          <span className="tabular font-medium">{Math.round(v.score)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={cn("animate-grow-x h-full rounded-full", v.score >= 85 ? "bg-success" : v.score >= 60 ? "bg-[#f79009]" : "bg-critical")}
                            style={{ width: `${Math.max(2, v.score)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </CardBody>
              </Card>
            </div>

            {isLatest && (openIssueIds.length > 0 || typeof sp.saved === "string") && (
              <Card className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="text-ink-2">
                  {openIssueIds.length} open issue{openIssueIds.length === 1 ? "" : "s"} · {openIssueIds.length - untasked.length} already in{" "}
                  <Link href={`${base}/tasks`} className="text-brand hover:underline">
                    SEO Tasks
                  </Link>
                </span>
                {typeof sp.saved === "string" && <span className="text-success">{sp.saved.slice(0, 160)}</span>}
                {canTask && untasked.length > 0 && (
                  <form action={createTasksFromIssuesAction} className="ml-auto">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="siteId" value={siteId} />
                    <input type="hidden" name="back" value={`${base}/audit`} />
                    {untasked.map((id) => (
                      <input key={id} type="hidden" name="issueId" value={id} />
                    ))}
                    <Button type="submit" size="sm" variant="secondary">
                      Create {untasked.length} task{untasked.length === 1 ? "" : "s"} from open issues
                    </Button>
                  </form>
                )}
              </Card>
            )}

            <Card>
              <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Filter checks by severity">
                {FILTERS.map((f) => (
                  <Link
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    href={`${base}/audit?${new URLSearchParams({ ...(audit && !isLatest ? { audit: audit.id } : {}), severity: f.key })}`}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-sm",
                      filter === f.key ? "bg-brand-soft font-medium text-brand-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {f.label} <span className="tabular ml-1 text-xs opacity-70">{counts[f.key]}</span>
                  </Link>
                ))}
              </div>
              {visible.length === 0 ? (
                <EmptyState title="Nothing in this filter" description="Try another severity." className="py-10" />
              ) : (
                <ul className="divide-y divide-line">
                  {visible.map((c) => {
                    const rule = RULES_BY_ID.get(c.rule_id);
                    const issue = issueByRule.get(c.rule_id);
                    const details = (c.details ?? {}) as Record<string, unknown>;
                    return (
                      <li key={c.id}>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                            {c.result === "not_applicable" ? <Badge>N/A</Badge> : <SeverityBadge severity={c.severity} />}
                            <span className="min-w-0 flex-1 text-sm font-medium text-ink">{rule?.title ?? c.rule_id}</span>
                            {c.result === "failed" && (
                              <span className="tabular hidden shrink-0 text-xs text-muted sm:inline">
                                {c.total_count > 1 ? `${formatNumber(c.affected_count)} of ${formatNumber(c.total_count)} pages` : "Site-wide"}
                              </span>
                            )}
                            <span className="tabular hidden w-16 shrink-0 text-right text-xs text-muted md:inline" title="Points earned / rule weight">
                              {(c.weight * c.rule_score).toFixed(1)}/{c.weight}
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
                          </summary>
                          <div className="space-y-3 bg-surface-2/40 px-5 py-4 text-sm">
                            <p className="text-ink-2">
                              <span className="font-medium text-ink">Why it matters: </span>
                              {c.explanation}
                            </p>
                            {c.result !== "passed" && (
                              <p className="text-ink-2">
                                <span className="font-medium text-ink">How to fix: </span>
                                {c.recommendation}
                              </p>
                            )}
                            {typeof details.reason === "string" && <p className="text-muted">Not evaluated: {details.reason}</p>}
                            {Array.isArray(details.failures) && details.failures.length > 0 && (
                              <p className="text-muted">Measured: {(details.failures as string[]).join("; ")}</p>
                            )}
                            {Array.isArray(details.sampleUrls) && details.sampleUrls.length > 0 && (
                              <ul className="space-y-0.5 text-xs text-muted">
                                {(details.sampleUrls as string[]).slice(0, 5).map((u) => (
                                  <li key={u} className="truncate">
                                    {u}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {issue && c.result === "failed" && isLatest && (
                              <Link href={`${base}/audit/issues/${issue.id}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                                View all affected pages <ChevronRight className="size-4" aria-hidden />
                              </Link>
                            )}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Audit history" description="Every audit is kept so you can track progress over time." action={<History className="size-4 text-muted" aria-hidden />} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-5 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Score</th>
                      <th className="px-3 py-2 font-medium">Pages</th>
                      <th className="px-3 py-2 font-medium">Critical</th>
                      <th className="px-3 py-2 font-medium">Warning</th>
                      <th className="px-5 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(audits ?? []).map((a, i) => {
                      const prev = audits?.[i + 1];
                      const diff = prev ? Number(a.score) - Number(prev.score) : null;
                      return (
                        <tr key={a.id} className={a.id === audit.id ? "bg-brand-soft/40" : undefined}>
                          <td className="px-5 py-2.5">{formatDate(a.created_at, { hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="tabular px-3 py-2.5 font-medium">
                            {Math.round(Number(a.score))}
                            {diff !== null && Math.abs(diff) >= 0.5 && (
                              <span className={cn("ml-2 text-xs", diff > 0 ? "text-success" : "text-critical")}>
                                {diff > 0 ? "+" : ""}
                                {diff.toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td className="tabular px-3 py-2.5">{formatNumber(a.pages_analyzed)}</td>
                          <td className="tabular px-3 py-2.5">{a.critical_count}</td>
                          <td className="tabular px-3 py-2.5">{a.warning_count}</td>
                          <td className="px-5 py-2.5 text-right">
                            {a.id !== audit.id && (
                              <Link href={`${base}/audit?audit=${a.id}`} className="text-brand hover:underline">
                                View
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
