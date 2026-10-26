import type { Metadata } from "next";
import Link from "next/link";
import { Download, LineChart, Plus } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { addKeywordsAction } from "@/lib/actions/keywords";
import { getRankProvider } from "@/lib/providers/registry";
import { dueKeywordCount, trackingRoom } from "@/lib/keywords/service";
import { rankMovement, type RankSnapshot } from "@/lib/dashboard/metrics";
import { positionBucket } from "@/lib/keywords/utils";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { DistributionChart, type DistributionPoint } from "@/components/charts/rank-charts";
import { PositionCell } from "@/components/keywords/badges";
import { ProviderNotConnected } from "@/components/keywords/provider-not-connected";
import { RankCheckRunner } from "@/components/keywords/rank-check-runner";

export const metadata: Metadata = { title: "Rank Tracker" };
export const maxDuration = 60;

/** Server-rendered per request, so reading the clock here is intended. */
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

type Movement = "improved" | "dropped" | "new" | "lost" | "unchanged" | "first";

function classify(list: RankSnapshot[]): Movement {
  if (list.length < 2) return "first";
  const [prev, cur] = list.slice(-2);
  if (prev.position === null && cur.position !== null) return "new";
  if (prev.position !== null && cur.position === null) return "lost";
  if (prev.position !== null && cur.position !== null) return cur.position < prev.position ? "improved" : cur.position > prev.position ? "dropped" : "unchanged";
  return "unchanged";
}

const MOVEMENT_LABEL: Record<Movement, string> = { improved: "Improved", dropped: "Dropped", new: "New", lost: "Lost", unchanged: "Unchanged", first: "First check" };

export default async function RankTrackerPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/rank-tracker">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role, org } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const provider = getRankProvider();
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const str = (k: string, d = "") => (typeof sp[k] === "string" ? (sp[k] as string) : d);
  const groupId = str("group");
  const device = str("device", "all");
  const movementFilter = str("movement", "all");
  const bucketFilter = str("bucket", "all");

  const since = daysAgo(30);
  const [{ data: keywords }, { data: groups }, { data: ranks }] = await Promise.all([
    supabase
      .from("keywords")
      .select("id, keyword, device, country_code, search_volume, target_url, current_position, previous_position, best_position, current_url, last_checked_on, keyword_group_members(group_id)")
      .eq("website_id", website.id)
      .eq("is_tracked", true)
      .order("current_position", { ascending: true, nullsFirst: false })
      .limit(2500),
    supabase.from("keyword_groups").select("id, name").eq("website_id", website.id).order("name"),
    supabase
      .from("keyword_rankings")
      .select("keyword_id, checked_on, position, source, keywords!inner(website_id, is_tracked)")
      .eq("keywords.website_id", website.id)
      .eq("keywords.is_tracked", true)
      .gte("checked_on", since)
      .order("checked_on")
      .limit(20000),
  ]);

  const all = keywords ?? [];
  const snaps = (ranks ?? []) as unknown as (RankSnapshot & { source: string })[];
  const isDemo = website.is_demo || snaps.some((s) => s.source === "demo");
  const movement = rankMovement(snaps);
  const byKeyword = new Map<string, RankSnapshot[]>();
  for (const s of snaps) byKeyword.set(s.keyword_id, [...(byKeyword.get(s.keyword_id) ?? []), s]);

  // Daily distribution (exclusive buckets) for the chart
  const days = new Map<string, DistributionPoint>();
  for (const s of snaps) {
    const d = days.get(s.checked_on) ?? { date: s.checked_on, top3: 0, top10: 0, top20: 0, top100: 0 };
    const b = positionBucket(s.position);
    if (b !== "none") d[b]++;
    days.set(s.checked_on, d);
  }
  const distribution = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Cumulative bucket counts from current positions
  const cur = all.map((k) => k.current_position).filter((p): p is number => p !== null);
  const top = (n: number) => cur.filter((p) => p <= n).length;

  const filtered = all.filter((k) => {
    if (groupId && !((k.keyword_group_members ?? []) as { group_id: string }[]).some((m) => m.group_id === groupId)) return false;
    if (device !== "all" && k.device !== device) return false;
    if (movementFilter !== "all" && classify(byKeyword.get(k.id) ?? []) !== movementFilter) return false;
    if (bucketFilter !== "all") {
      const p = k.current_position;
      const ok =
        bucketFilter === "top3" ? p !== null && p <= 3 : bucketFilter === "top10" ? p !== null && p <= 10 : bucketFilter === "top20" ? p !== null && p <= 20 : bucketFilter === "top100" ? p !== null : p === null;
      if (!ok) return false;
    }
    return true;
  });

  const [due, room] = await Promise.all([provider && canEdit ? dueKeywordCount(website.id) : Promise.resolve(0), canEdit ? trackingRoom(org.id, org.plan_id) : Promise.resolve(null)]);
  const msg = str("message");

  return (
    <>
      <PageHeader
        title="Rank Tracker"
        badge={isDemo ? <DemoDataBadge /> : provider ? <Badge tone="success">{provider.name}</Badge> : <ProviderNotConnected what="" compact />}
        description={`Daily Google positions for ${website.domain}, by country and device.`}
        actions={
          <a className={buttonClasses({ variant: "secondary" })} href={`/api/sites/${siteId}/keywords/export?tracked=1`}>
            <Download aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="space-y-4">
        {!provider && !website.is_demo && <ProviderNotConnected what="Rank tracking" />}
        {website.is_demo && (
          <FormMessage tone="info">
            Demo Project: positions below are pre-generated sample <strong>Demo Data</strong>. No live rank checks are performed.
          </FormMessage>
        )}
        {msg && <FormMessage>{msg}</FormMessage>}
        {str("added") && <FormMessage tone="success">{str("added")} keyword(s) added to tracking.</FormMessage>}
        {provider && canEdit && all.length > 0 && <RankCheckRunner siteId={siteId} due={due} />}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <StatCard label="Tracked" value={formatNumber(all.length)} footer={room ? `${room.used}/${room.limit} on your plan` : undefined} />
          <StatCard label="Top 3" value={top(3)} />
          <StatCard label="Top 10" value={top(10)} />
          <StatCard label="Top 20" value={top(20)} />
          <StatCard label="Top 100" value={top(100)} />
          <StatCard label="Improved" value={<span className="text-success">{movement.improved}</span>} footer="vs previous check" />
          <StatCard label="Dropped" value={<span className="text-critical">{movement.dropped}</span>} footer="vs previous check" />
          <StatCard label="New / Lost" value={<span><span className="text-opportunity">{movement.new}</span> / <span className="text-warning">{movement.lost}</span></span>} footer="entered / left top 100" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Ranking distribution" description="Tracked keywords per position range, last 30 days" action={isDemo && distribution.length ? <DemoDataBadge /> : undefined} />
            <CardBody>
              {distribution.length === 0 ? (
                <EmptyState icon={LineChart} title="No ranking history yet" description={provider ? "Run a rank check to record today's positions." : "History appears once a rank provider is connected."} className="py-10" />
              ) : (
                <DistributionChart data={distribution} />
              )}
            </CardBody>
          </Card>
          {canEdit ? (
            <Card>
              <CardHeader title="Track keywords" description={`${website.country_code} · ${website.language_code} by default`} />
              <CardBody>
                <form action={addKeywordsAction} className="space-y-3">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="siteId" value={siteId} />
                  <input type="hidden" name="track" value="on" />
                  <input type="hidden" name="back" value={`${base}/rank-tracker`} />
                  <Textarea name="keywords" rows={5} placeholder="one keyword per line" aria-label="Keywords to track, one per line" required />
                  <Select name="device" defaultValue="desktop" className="h-9" aria-label="Device">
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                  </Select>
                  <Button size="sm" type="submit">
                    <Plus aria-hidden /> Start tracking
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Movement" />
              <CardBody className="text-sm text-muted">Improved, dropped, new and lost compare each keyword&apos;s latest check with its previous one.</CardBody>
            </Card>
          )}
        </div>

        <Card>
          <form className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row" role="search">
            <Select name="group" defaultValue={groupId} className="h-9 sm:w-48" aria-label="Group">
              <option value="">All groups</option>
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select name="device" defaultValue={device} className="h-9 sm:w-36" aria-label="Device">
              <option value="all">All devices</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </Select>
            <Select name="bucket" defaultValue={bucketFilter} className="h-9 sm:w-40" aria-label="Position range">
              <option value="all">Any position</option>
              <option value="top3">Top 3</option>
              <option value="top10">Top 10</option>
              <option value="top20">Top 20</option>
              <option value="top100">Top 100</option>
              <option value="none">Not ranking</option>
            </Select>
            <Select name="movement" defaultValue={movementFilter} className="h-9 sm:w-40" aria-label="Movement">
              <option value="all">Any movement</option>
              {(["improved", "dropped", "new", "lost", "unchanged"] as const).map((m) => (
                <option key={m} value={m}>
                  {MOVEMENT_LABEL[m]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" className="h-9">
              Filter
            </Button>
          </form>
          {filtered.length === 0 ? (
            <EmptyState
              icon={LineChart}
              title={all.length === 0 ? "No tracked keywords" : "No keywords match these filters"}
              description={all.length === 0 ? "Add keywords above, or start tracking from Saved Keywords or Keyword Research." : undefined}
              action={all.length > 0 ? <Link href={`${base}/rank-tracker`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Clear filters</Link> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-medium">Keyword</th>
                    <th className="px-3 py-2 font-medium">Position</th>
                    <th className="px-3 py-2 text-right font-medium">Previous</th>
                    <th className="px-3 py-2 text-right font-medium">Best</th>
                    <th className="px-3 py-2 font-medium">Movement</th>
                    <th className="px-3 py-2 text-right font-medium">Volume</th>
                    <th className="px-5 py-2 font-medium">Ranking URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((k) => {
                    const m = classify(byKeyword.get(k.id) ?? []);
                    return (
                      <tr key={k.id} className="hover:bg-surface-2/50">
                        <td className="max-w-[16rem] px-5 py-2.5">
                          <Link href={`${base}/keywords/${k.id}`} className="block truncate font-medium text-ink hover:text-brand">
                            {k.keyword}
                          </Link>
                          <span className="text-xs text-muted">
                            {k.country_code} · {k.device} · {k.last_checked_on ? `checked ${formatDate(k.last_checked_on)}` : "not checked yet"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <PositionCell current={k.current_position} previous={k.previous_position} />
                        </td>
                        <td className="tabular px-3 py-2.5 text-right text-muted">{k.previous_position ?? "—"}</td>
                        <td className="tabular px-3 py-2.5 text-right">{k.best_position ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={m === "improved" ? "success" : m === "dropped" ? "critical" : m === "new" ? "opportunity" : m === "lost" ? "warning" : "neutral"}>{MOVEMENT_LABEL[m]}</Badge>
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">{formatNumber(k.search_volume)}</td>
                        <td className={cn("max-w-[16rem] truncate px-5 py-2.5 text-xs", k.target_url && k.current_url && k.target_url !== k.current_url ? "text-warning" : "text-muted")} title={k.current_url ?? ""}>
                          {k.current_url ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            Positions are organic results only (ads excluded), checked to depth 100 once per day. {isDemo ? "This page shows sample Demo Data." : provider ? `Source: ${provider.name}.` : "No provider connected — no positions are shown."}
          </p>
        </Card>
      </div>
    </>
  );
}
