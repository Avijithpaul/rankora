import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Minus, X } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { captureHomepageAction, comparePagesAction, refreshCompetitorKeywordsAction, removeCompetitorAction } from "@/lib/actions/competitors";
import { compareSnapshots, keywordOverlap, rankingSummary, snapshotScore, type CheckOutcome, type OverlapRow, type TechnicalSnapshot } from "@/lib/competitors/compare";
import { latestKeywordSnapshot, loadRankingComparison } from "@/lib/competitors/data";
import type { PageSide } from "@/lib/competitors/service";
import { getDomainKeywordProvider, providerStatus } from "@/lib/providers/registry";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Tabs } from "@/components/analytics/controls";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Competitor" };
export const maxDuration = 60;

const TABS = [
  { key: "rankings", label: "Rankings" },
  { key: "overlap", label: "Keyword overlap & gaps" },
  { key: "audit", label: "SEO audit comparison" },
  { key: "content", label: "Content comparison" },
];

function Outcome({ value }: { value: CheckOutcome | "pass" | "warn" | "fail" | "info" }) {
  if (value === "pass") return <Check className="size-4 text-success" aria-label="Pass" />;
  if (value === "fail") return <X className="size-4 text-critical" aria-label="Fail" />;
  if (value === "warn") return <Minus className="size-4 text-warning" aria-label="Needs work" />;
  return <span className="text-xs text-muted">—</span>;
}

const pos = (p: number | null | undefined) => (p === undefined ? <span className="text-muted">not checked</span> : p === null ? <span className="text-muted">&gt;100</span> : `#${p}`);

function OverlapTable({ rows, empty }: { rows: OverlapRow[]; empty: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-5 py-2 font-medium">Keyword</th>
            <th className="px-3 py-2 text-right font-medium">Volume</th>
            <th className="px-3 py-2 text-right font-medium">You</th>
            <th className="px-5 py-2 text-right font-medium">Them</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, 200).map((r) => (
            <tr key={r.keyword}>
              <td className="max-w-xs truncate px-5 py-2" title={r.theirUrl ?? r.ownUrl ?? undefined}>
                {r.keyword}
              </td>
              <td className="tabular px-3 py-2 text-right">{r.searchVolume === null ? "—" : formatNumber(r.searchVolume)}</td>
              <td className="tabular px-3 py-2 text-right">{r.own === null ? "—" : `#${r.own}`}</td>
              <td className="tabular px-5 py-2 text-right">{r.theirs === null ? "—" : `#${r.theirs}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CompetitorPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/competitors/[competitorId]">) {
  const { org: orgSlug, site: siteId, competitorId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(competitorId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const { data: competitor } = await supabase.from("competitors").select("*").eq("id", competitorId).eq("website_id", website.id).maybeSingle();
  if (!competitor) notFound();
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "rankings";
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const self = `${base}/competitors/${competitor.id}`;
  const hidden = (
    <>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="competitorId" value={competitor.id} />
    </>
  );

  let body: React.ReactNode = null;

  if (tab === "rankings") {
    const { keywords, positions } = await loadRankingComparison(website, [competitor.id]);
    const theirs = positions.get(competitor.id) ?? new Map<string, number | null>();
    const [s] = rankingSummary(keywords, [competitor], positions);
    const compared = keywords.filter((k) => k.own !== undefined && theirs.has(k.id));
    const rank = providerStatus().rank;
    body = !keywords.length ? (
      <Card>
        <EmptyState title="No tracked keywords" description="Track keywords in Saved Keywords; each rank check also records this competitor's position." action={<Link href={`${base}/keywords`} className="text-brand hover:underline">Go to Saved Keywords</Link>} />
      </Card>
    ) : compared.length === 0 ? (
      <Card>
        <EmptyState
          title="No comparison data yet"
          description={
            rank.connected
              ? "Competitor positions are recorded at the next daily rank check (or use Check now on the Rank Tracker)."
              : "Provider Not Connected — rankings need a SERP provider (DataForSEO). Nothing is estimated."
          }
        />
      </Card>
    ) : (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Keywords compared" value={s.checked} />
          <StatCard label="You rank higher" value={s.youAhead + s.onlyYou} />
          <StatCard label="They rank higher" value={s.theyAhead + s.onlyThem} />
          <StatCard label="Both in top 100" value={s.bothRank} />
          <StatCard label="Visibility share" value={s.ownVisibility + s.theirVisibility ? `${Math.round((s.ownVisibility / (s.ownVisibility + s.theirVisibility)) * 100)}%` : "—"} hint="Your share of (101 − position) points across compared keywords." />
        </div>
        <Card>
          <CardHeader title="Positions on your tracked keywords" description="Both positions come from the same search result page on the same day." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Keyword</th>
                  <th className="px-3 py-2 text-right font-medium">Volume</th>
                  <th className="px-3 py-2 text-right font-medium">You</th>
                  <th className="px-3 py-2 text-right font-medium">{competitor.domain}</th>
                  <th className="px-5 py-2 text-right font-medium">Checked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {keywords.map((k) => {
                  const t = theirs.has(k.id) ? theirs.get(k.id) : undefined;
                  const ahead = typeof k.own === "number" && (t === null || (typeof t === "number" && k.own < t));
                  const behind = typeof t === "number" && (k.own === null || (typeof k.own === "number" && t < k.own));
                  return (
                    <tr key={k.id}>
                      <td className="px-5 py-2">
                        <Link href={`${base}/keywords/${k.id}`} className="hover:text-brand">
                          {k.keyword}
                        </Link>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{k.searchVolume === null ? "—" : formatNumber(k.searchVolume)}</td>
                      <td className={cn("tabular px-3 py-2 text-right", ahead && "font-medium text-success")}>{pos(k.own)}</td>
                      <td className={cn("tabular px-3 py-2 text-right", behind && "font-medium text-critical")}>{pos(t)}</td>
                      <td className="px-5 py-2 text-right text-muted">{k.checkedOn ? formatDate(k.checkedOn) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  if (tab === "overlap") {
    const [own, theirs] = await Promise.all([latestKeywordSnapshot(website, website.domain), latestKeywordSnapshot(website, competitor.domain)]);
    const connected = Boolean(getDomainKeywordProvider());
    const refresh = canEdit && connected && (
      <form action={refreshCompetitorKeywordsAction}>
        {hidden}
        <SubmitButton size="sm" variant="secondary" pendingLabel="Fetching…">
          {own && theirs ? "Refresh (uses cache under 7 days)" : "Fetch ranking keywords"}
        </SubmitButton>
      </form>
    );
    if (!own || !theirs) {
      body = (
        <Card>
          <EmptyState
            title={connected ? "No keyword data yet" : "Provider Not Connected"}
            description={
              connected
                ? `Fetch the organic keywords ${website.domain} and ${competitor.domain} rank for (${website.country_code}) from the provider's ranking index. Uses 2 keyword lookups.`
                : "Keyword overlap and gaps need a keyword data provider (DataForSEO Labs). Rankora does not estimate competitor keywords."
            }
            action={refresh || undefined}
          />
        </Card>
      );
    } else {
      const o = keywordOverlap(own.items, theirs.items);
      body = (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              Source: {own.provider} ranking index · {website.country_code} · fetched {formatDate(theirs.fetched_at)} · up to 1,000 keywords per domain
              {theirs.item_count > theirs.items.length && ` (they rank for ${formatNumber(theirs.item_count)} in total)`}
            </span>
            <span className="ml-auto">{refresh}</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Your keywords" value={formatNumber(o.stats.own)} />
            <StatCard label="Their keywords" value={formatNumber(o.stats.theirs)} />
            <StatCard label="Shared" value={formatNumber(o.stats.shared)} footer={`${Math.round(o.stats.overlapRate * 100)}% overlap`} />
            <StatCard label="Gaps" value={formatNumber(o.stats.gaps)} hint="They rank, you don't (in the provider's index)." />
            <StatCard label="They're ahead" value={formatNumber(o.behind.length)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Keyword gaps" description="Keywords they rank for and you don't — sorted by search volume." />
              <OverlapTable rows={o.gaps} empty="No gaps found." />
            </Card>
            <Card>
              <CardHeader title="Shared keywords where they're ahead" />
              <OverlapTable rows={o.behind} empty="You are ahead on every shared keyword." />
            </Card>
            <Card>
              <CardHeader title="All shared keywords" />
              <OverlapTable rows={o.shared} empty="No shared keywords." />
            </Card>
            <Card>
              <CardHeader title="Only you rank" />
              <OverlapTable rows={o.ownOnly} empty="None." />
            </Card>
          </div>
        </>
      );
    }
  }

  if (tab === "audit") {
    const { data: snap } = await supabase.from("competitor_snapshots").select("id, data, created_at").eq("competitor_id", competitor.id).eq("kind", "homepage").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const capture = canEdit && (
      <form action={captureHomepageAction}>
        {hidden}
        <SubmitButton size="sm" variant="secondary" pendingLabel="Fetching both homepages…">
          {snap ? "Take a new snapshot" : "Compare homepages"}
        </SubmitButton>
      </form>
    );
    if (!snap) {
      body = (
        <Card>
          <EmptyState
            title="No snapshot yet"
            description="Fetches your homepage and theirs right now (plus robots.txt and sitemap) and applies the same 15 checks to both. This is a single-page snapshot, not a full site audit of the competitor."
            action={capture || undefined}
          />
        </Card>
      );
    } else {
      const d = snap.data as unknown as { own: TechnicalSnapshot; theirs: TechnicalSnapshot };
      const checks = compareSnapshots(d.own, d.theirs);
      const ownScore = snapshotScore(checks, "own");
      const theirScore = snapshotScore(checks, "theirs");
      const { data: audit } = await supabase.from("seo_audits").select("score").eq("website_id", website.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      body = (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Snapshot taken {formatDate(snap.created_at, { hour: "2-digit", minute: "2-digit" })} by RankoraBot</span>
            <span className="ml-auto">{capture}</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Your homepage checks" value={ownScore === null ? "—" : `${ownScore}%`} hint="Share of the 15 snapshot checks passed." />
            <StatCard label={`${competitor.domain} checks`} value={theirScore === null ? "—" : `${theirScore}%`} />
            <StatCard label="Your full audit score" value={audit?.score === null || audit?.score === undefined ? "—" : Math.round(Number(audit.score))} hint="Your latest full-site audit; competitors are not crawled in full." />
            <StatCard label="Their response time" value={d.theirs.responseTimeMs === null ? "—" : `${d.theirs.responseTimeMs} ms`} footer={d.own.responseTimeMs === null ? undefined : `yours ${d.own.responseTimeMs} ms`} />
          </div>
          <Card>
            <CardHeader title="Homepage checks" description={`${d.own.finalUrl ?? d.own.url} vs ${d.theirs.finalUrl ?? d.theirs.url}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-medium">Check</th>
                    <th className="px-3 py-2 font-medium">You</th>
                    <th className="px-5 py-2 font-medium">{competitor.domain}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {checks.map((c) => (
                    <tr key={c.id}>
                      <td className="px-5 py-2">{c.label}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <Outcome value={c.own} /> <span className="text-xs text-muted">{c.ownValue}</span>
                        </span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="inline-flex items-center gap-2">
                          <Outcome value={c.theirs} /> <span className="text-xs text-muted">{c.theirValue}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      );
    }
  }

  if (tab === "content") {
    const compareId = typeof sp.compare === "string" && /^[0-9a-f-]{36}$/i.test(sp.compare) ? sp.compare : null;
    const { data: history } = await supabase
      .from("competitor_snapshots")
      .select("id, keyword, url, own_url, data, created_at")
      .eq("competitor_id", competitor.id)
      .eq("kind", "page_compare")
      .order("created_at", { ascending: false })
      .limit(20);
    const current = (compareId ? history?.find((h) => h.id === compareId) : history?.[0]) ?? null;
    const d = current?.data as unknown as { keyword: string; own: PageSide; theirs: PageSide } | undefined;
    body = (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {d ? (
            <Card>
              <CardHeader title={`“${d.keyword}”`} description={`Compared ${formatDate(current!.created_at, { hour: "2-digit", minute: "2-digit" })} with the Content Optimizer rules`} />
              <div className="grid grid-cols-2 gap-3 border-b border-line p-5 text-sm">
                {(["own", "theirs"] as const).map((side) => (
                  <div key={side} className="min-w-0">
                    <div className="text-xs text-muted">{side === "own" ? "Your page" : competitor.domain}</div>
                    <div className="truncate font-medium text-ink" title={d[side].url}>
                      {d[side].title ?? d[side].url}
                    </div>
                    {d[side].error ? (
                      <p className="mt-1 text-xs text-critical">{d[side].error}</p>
                    ) : (
                      <p className="mt-1 text-2xl font-semibold text-ink">
                        {Math.round(d[side].score ?? 0)}
                        <span className="text-sm font-normal text-muted"> / 100 · {formatNumber(d[side].words)} words</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-medium">Check</th>
                    <th className="px-3 py-2 font-medium">You</th>
                    <th className="px-5 py-2 font-medium">Them</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(d.own.checks.length ? d.own.checks : d.theirs.checks).map((c) => {
                    const o = d.own.checks.find((x) => x.id === c.id);
                    const t = d.theirs.checks.find((x) => x.id === c.id);
                    return (
                      <tr key={c.id}>
                        <td className="px-5 py-2">{c.label}</td>
                        <td className="px-3 py-2" title={o?.detail}>
                          <span className="inline-flex items-start gap-2">
                            <Outcome value={o?.status ?? "info"} /> <span className="text-xs text-muted">{o?.detail ?? "—"}</span>
                          </span>
                        </td>
                        <td className="px-5 py-2" title={t?.detail}>
                          <span className="inline-flex items-start gap-2">
                            <Outcome value={t?.status ?? "info"} /> <span className="text-xs text-muted">{t?.detail ?? "—"}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ) : (
            <Card>
              <EmptyState title="No page comparisons yet" description="Pick a keyword, your page and the competitor page that ranks for it." />
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {canEdit && (
            <Card>
              <CardHeader title="Compare two pages" />
              <CardBody>
                <form action={comparePagesAction} className="space-y-3">
                  {hidden}
                  <Field label="Target keyword" htmlFor="keyword">
                    <Input id="keyword" name="keyword" required maxLength={120} defaultValue={d?.keyword} />
                  </Field>
                  <Field label={`Your page (${website.domain})`} htmlFor="ownUrl">
                    <Input id="ownUrl" name="ownUrl" required defaultValue={current?.own_url ?? website.base_url} />
                  </Field>
                  <Field label={`Their page (${competitor.domain})`} htmlFor="theirUrl">
                    <Input id="theirUrl" name="theirUrl" required defaultValue={current?.url ?? `https://${competitor.domain}/`} />
                  </Field>
                  <SubmitButton pendingLabel="Fetching and analyzing…">Compare</SubmitButton>
                </form>
              </CardBody>
            </Card>
          )}
          {(history?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Previous comparisons" />
              <ul className="divide-y divide-line text-sm">
                {history!.map((h) => (
                  <li key={h.id}>
                    <Link href={`${self}?tab=content&compare=${h.id}`} className={cn("block px-5 py-2 hover:bg-surface-2/50", h.id === current?.id && "bg-brand-soft/40")}>
                      <span className="font-medium text-ink">{h.keyword}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatDate(h.created_at)} · {h.url}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Link href={`${base}/competitors`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Competitors
      </Link>
      <PageHeader
        title={competitor.name ?? competitor.domain}
        badge={<Badge>{competitor.domain}</Badge>}
        description={`Competing with ${website.domain} · added ${formatDate(competitor.created_at)}`}
        actions={
          canEdit && (
            <form action={removeCompetitorAction}>
              {hidden}
              <SubmitButton size="sm" variant="ghost">
                Remove
              </SubmitButton>
            </form>
          )
        }
      />
      {typeof sp.error === "string" && (
        <div className="mb-4">
          <FormMessage>{sp.error.slice(0, 300)}</FormMessage>
        </div>
      )}
      {typeof sp.saved === "string" && (
        <div className="mb-4">
          <FormMessage tone="success">{sp.saved.slice(0, 200)}</FormMessage>
        </div>
      )}
      <div className="mb-4">
        <Tabs tabs={TABS} active={tab} href={(k) => `${self}?tab=${k}`} />
      </div>
      {body}
    </>
  );
}
