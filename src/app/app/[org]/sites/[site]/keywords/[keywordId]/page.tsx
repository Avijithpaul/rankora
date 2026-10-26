import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { updateKeywordAction } from "@/lib/actions/keywords";
import { inferIntent } from "@/lib/keywords/utils";
import { countryName, languageName } from "@/lib/locales";
import { formatDate, formatNumber } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { PositionChart } from "@/components/charts/rank-charts";
import { IntentBadge, KdBadge } from "@/components/keywords/badges";
import { ProviderNotConnected } from "@/components/keywords/provider-not-connected";

export const metadata: Metadata = { title: "Keyword" };

export default async function KeywordDetailPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/keywords/[keywordId]">) {
  const { org: orgSlug, site: siteId, keywordId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(keywordId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;

  const { data: k } = await supabase.from("keywords").select("*, keyword_group_members(group_id, keyword_groups(name))").eq("id", keywordId).eq("website_id", website.id).maybeSingle();
  if (!k) notFound();
  const { data: history } = await supabase
    .from("keyword_rankings")
    .select("checked_on, position, ranking_url, serp_features, source")
    .eq("keyword_id", k.id)
    .order("checked_on", { ascending: true })
    .limit(400);
  const snaps = history ?? [];
  const isDemo = website.is_demo || k.metrics_source === "demo" || snaps.some((s) => s.source === "demo");
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const trend = (Array.isArray(k.search_volume_trend) ? k.search_volume_trend : []) as { month: string; volume: number }[];
  const groups = ((k.keyword_group_members ?? []) as unknown as { group_id: string; keyword_groups: { name: string } | null }[]).map((m) => m.keyword_groups?.name).filter(Boolean);
  const urlMismatch = k.target_url && k.current_url && k.target_url.replace(/\/$/, "") !== k.current_url.replace(/\/$/, "");
  const change = k.current_position !== null && k.previous_position !== null ? k.previous_position - k.current_position : null;

  return (
    <>
      <Link href={`${base}/keywords`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Saved Keywords
      </Link>
      <PageHeader
        title={k.keyword}
        badge={
          <>
            {k.is_tracked ? <Badge tone="brand">Tracked</Badge> : <Badge>Not tracked</Badge>}
            {isDemo && <DemoDataBadge />}
          </>
        }
        description={`${countryName(k.country_code)} · ${languageName(k.language_code)} · ${k.device} · ${k.search_engine}${groups.length ? ` · groups: ${groups.join(", ")}` : ""}`}
      />
      {sp.saved && <div className="mb-4"><FormMessage tone="success">Saved.</FormMessage></div>}
      {sp.error && <div className="mb-4"><FormMessage>{sp.error === "target_url" ? "Target URL must be a valid http(s) URL." : "Could not save changes."}</FormMessage></div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Current position" value={k.current_position ?? (k.last_checked_on ? "Not in top 100" : "—")} footer={k.last_checked_on ? `Checked ${formatDate(k.last_checked_on)}` : "Never checked"} />
        <StatCard
          label="Previous position"
          value={k.previous_position ?? "—"}
          footer={change === null ? "No comparison yet" : change === 0 ? "No change" : change > 0 ? <span className="text-success">Improved by {change}</span> : <span className="text-critical">Dropped by {-change}</span>}
        />
        <StatCard label="Best position" value={k.best_position ?? "—"} footer={`${snaps.length} snapshot${snaps.length === 1 ? "" : "s"} stored`} />
        <StatCard label="Search volume" value={k.search_volume === null ? "—" : formatNumber(k.search_volume)} footer={k.metrics_source ? (k.metrics_source === "demo" ? <DemoDataBadge /> : `${k.metrics_source} · ${formatDate(k.metrics_fetched_at)}`) : <ProviderNotConnected what="" compact />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Ranking history" description="Daily position snapshots (gaps = not in the top 100)" action={isDemo && snaps.length ? <DemoDataBadge /> : undefined} />
          <CardBody>
            {snaps.length === 0 ? (
              <EmptyState
                title="No ranking history yet"
                description={k.is_tracked ? "Positions are recorded once per day when a rank provider is connected." : "Start tracking this keyword to record daily positions."}
                className="py-10"
              />
            ) : (
              <PositionChart data={snaps.map((s) => ({ date: s.checked_on, position: s.position }))} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Keyword metrics" description={k.metrics_source ? `Source: ${k.metrics_source === "demo" ? "Demo Data" : k.metrics_source}` : "No provider data"} />
          <CardBody>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Keyword difficulty</dt>
                <dd><KdBadge value={k.difficulty} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">CPC</dt>
                <dd className="tabular">{k.cpc === null ? "—" : `$${Number(k.cpc).toFixed(2)}`}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Competition</dt>
                <dd className="tabular">{k.competition === null ? "—" : Number(k.competition).toFixed(2)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">Search intent</dt>
                <dd><IntentBadge intent={k.intent} fallback={inferIntent(k.keyword)} /></dd>
              </div>
            </dl>
            {trend.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-muted">Monthly searches (last {trend.length} months)</p>
                <div className="flex h-16 items-end gap-1" aria-label="Monthly search volume trend">
                  {trend.map((t) => {
                    const max = Math.max(...trend.map((x) => x.volume), 1);
                    return <div key={t.month} title={`${t.month}: ${formatNumber(t.volume)}`} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (t.volume / max) * 100)}%` }} />;
                  })}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Snapshots" description="Most recent first" />
          {snaps.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No snapshots.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Position</th>
                    <th className="px-3 py-2 font-medium">Ranking URL</th>
                    <th className="px-5 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...snaps].reverse().map((s) => (
                    <tr key={s.checked_on}>
                      <td className="px-5 py-2">{formatDate(s.checked_on)}</td>
                      <td className="tabular px-3 py-2 font-medium">{s.position ?? <span className="font-normal text-muted">not in top 100</span>}</td>
                      <td className="max-w-[18rem] truncate px-3 py-2 text-xs text-muted" title={s.ranking_url ?? ""}>
                        {s.ranking_url ?? "—"}
                      </td>
                      <td className="px-5 py-2 text-xs">{s.source === "demo" ? <DemoDataBadge /> : s.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Target page" />
          <CardBody>
            {urlMismatch && (
              <p className="mb-3 flex gap-2 text-xs text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                Google ranks a different URL than your target: {k.current_url}
              </p>
            )}
            <form action={updateKeywordAction} className="space-y-4">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="keywordId" value={k.id} />
              <fieldset disabled={!canEdit} className="space-y-4">
                <Field label="Target URL" htmlFor="targetUrl" hint="The page you want to rank for this keyword.">
                  <Input id="targetUrl" name="targetUrl" defaultValue={k.target_url ?? ""} placeholder={`${website.base_url}…`} />
                </Field>
                <Field label="Notes" htmlFor="notes">
                  <Textarea id="notes" name="notes" defaultValue={k.notes ?? ""} rows={3} maxLength={2000} />
                </Field>
                {canEdit && (
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                )}
              </fieldset>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
