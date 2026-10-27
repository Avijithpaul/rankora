import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { syncBacklinksAction } from "@/lib/actions/competitors";
import { getBacklinkProvider } from "@/lib/providers/registry";
import type { BacklinkSummary } from "@/lib/providers/types";
import { formatDate, formatNumber } from "@/lib/utils";
import { Tabs } from "@/components/analytics/controls";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Backlinks" };
export const maxDuration = 60;

const TABS = [
  { key: "links", label: "Backlinks" },
  { key: "domains", label: "Referring domains" },
  { key: "anchors", label: "Anchor text" },
  { key: "new", label: "New links" },
  { key: "lost", label: "Lost links" },
];

export default async function BacklinksPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/backlinks">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const provider = getBacklinkProvider();
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "links";
  const canSync = roleAtLeast(role, "member") && !website.is_demo && Boolean(provider);

  const { data: lastSync } = await supabase.from("backlink_syncs").select("*").eq("website_id", website.id).order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const { data: lastOk } = await supabase.from("backlink_syncs").select("*").eq("website_id", website.id).eq("status", "completed").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const summary = (lastOk?.summary ?? null) as (BacklinkSummary & { liveTotal?: number | null; lostTotal?: number | null }) | null;

  const syncButton = canSync && (
    <form action={syncBacklinksAction}>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="siteId" value={siteId} />
      <SubmitButton pendingLabel="Syncing…">{lastOk ? "Sync now" : "Import backlinks"}</SubmitButton>
    </form>
  );

  const header = (
    <>
      <PageHeader
        title="Backlinks"
        description="Links from other websites to yours, as reported by a backlink data provider. Rankora never estimates or invents backlinks."
        actions={syncButton || undefined}
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
    </>
  );

  if (!lastOk) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Link2}
            title={provider ? "No backlink data yet" : "Provider Not Connected"}
            description={
              website.is_demo
                ? "The Demo Project does not include backlink data."
                : provider
                  ? `Import links pointing to ${website.domain} from ${provider.name}. ${lastSync?.status === "failed" ? `Last attempt failed: ${lastSync.error}` : ""}`
                  : "Backlinks, referring domains, anchors and new/lost links need a backlink data provider. Set BACKLINK_PROVIDER=dataforseo with DataForSEO credentials (Backlinks API subscription). No numbers are shown until real data is imported."
            }
            action={syncButton || undefined}
          />
        </Card>
      </>
    );
  }

  let content: React.ReactNode;
  if (tab === "domains") {
    const { data } = await supabase.rpc("backlink_referring_domains", { p_site: website.id, p_limit: 500 });
    content = (
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-5 py-2 font-medium">Domain</th>
            <th className="px-3 py-2 text-right font-medium">Links</th>
            <th className="px-3 py-2 text-right font-medium">Follow</th>
            <th className="px-3 py-2 text-right font-medium">Live</th>
            <th className="px-3 py-2 text-right font-medium">Rank</th>
            <th className="px-5 py-2 text-right font-medium">First seen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(data ?? []).map((d) => (
            <tr key={d.domain}>
              <td className="px-5 py-2">{d.domain}</td>
              <td className="tabular px-3 py-2 text-right">{formatNumber(d.backlinks)}</td>
              <td className="tabular px-3 py-2 text-right">{formatNumber(d.follow)}</td>
              <td className="tabular px-3 py-2 text-right">{formatNumber(d.live)}</td>
              <td className="tabular px-3 py-2 text-right">{d.authority === null ? "—" : Math.round(Number(d.authority))}</td>
              <td className="px-5 py-2 text-right text-muted">{d.first_seen ? formatDate(d.first_seen) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (tab === "anchors") {
    const { data } = await supabase.rpc("backlink_anchors", { p_site: website.id, p_limit: 500 });
    content = (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-5 py-2 font-medium">Anchor text</th>
            <th className="px-3 py-2 text-right font-medium">Live links</th>
            <th className="px-5 py-2 text-right font-medium">Domains</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(data ?? []).map((a) => (
            <tr key={a.anchor}>
              <td className="max-w-md truncate px-5 py-2">{a.anchor}</td>
              <td className="tabular px-3 py-2 text-right">{formatNumber(a.backlinks)}</td>
              <td className="tabular px-5 py-2 text-right">{formatNumber(a.domains)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    let q = supabase.from("backlinks").select("id, source_url, source_domain, target_url, anchor_text, rel, link_type, domain_authority, first_seen_at, last_seen_at, is_new, is_lost").eq("website_id", website.id);
    if (tab === "new") q = q.eq("is_new", true).eq("is_lost", false);
    else if (tab === "lost") q = q.eq("is_lost", true);
    else q = q.eq("is_lost", false);
    const { data } = await q.order(tab === "lost" ? "last_seen_at" : "domain_authority", { ascending: false, nullsFirst: false }).limit(500);
    content = !data?.length ? (
      <EmptyState title={tab === "new" ? "No new links reported" : tab === "lost" ? "No lost links reported" : "No live links"} className="py-10" />
    ) : (
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-5 py-2 font-medium">From</th>
            <th className="px-3 py-2 font-medium">Anchor</th>
            <th className="px-3 py-2 font-medium">To</th>
            <th className="px-3 py-2 text-right font-medium">Rank</th>
            <th className="px-5 py-2 text-right font-medium">{tab === "lost" ? "Last seen" : "First seen"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((b) => (
            <tr key={b.id}>
              <td className="max-w-[16rem] px-5 py-2">
                <a href={b.source_url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-ink hover:text-brand" title={b.source_url}>
                  {b.source_domain}
                </a>
                <span className="mt-0.5 flex gap-1">
                  {b.rel !== "follow" && <Badge>{b.rel}</Badge>}
                  {b.link_type && b.link_type !== "anchor" && <Badge>{b.link_type}</Badge>}
                  {b.is_new && !b.is_lost && <Badge tone="success">new</Badge>}
                  {b.is_lost && <Badge tone="critical">lost</Badge>}
                </span>
              </td>
              <td className="max-w-[12rem] truncate px-3 py-2 text-ink-2">{b.anchor_text ?? <span className="text-muted">(none)</span>}</td>
              <td className="max-w-[14rem] truncate px-3 py-2 text-xs text-muted" title={b.target_url}>
                {b.target_url}
              </td>
              <td className="tabular px-3 py-2 text-right">{b.domain_authority === null ? "—" : Math.round(Number(b.domain_authority))}</td>
              <td className="px-5 py-2 text-right text-muted">{formatDate(tab === "lost" ? b.last_seen_at : b.first_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <>
      {header}
      <p className="mb-3 text-xs text-muted">
        Source: {lastOk.provider} · synced {formatDate(lastOk.synced_at, { hour: "2-digit", minute: "2-digit" })} · {formatNumber(lastOk.rows_stored)} links stored (strongest first; up to 1,000 live and 200 lost)
        {lastSync?.status === "failed" && <span className="ml-2 text-critical">Latest sync failed: {lastSync.error}</span>}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Backlinks" value={formatNumber(summary?.backlinks)} hint="Provider total for the domain" />
        <StatCard label="Referring domains" value={formatNumber(summary?.referringDomains)} />
        <StatCard label="Referring IPs" value={formatNumber(summary?.referringIps)} />
        <StatCard label="Broken backlinks" value={formatNumber(summary?.brokenBacklinks)} />
        <StatCard label="Domain rank" value={summary?.rank === null || summary?.rank === undefined ? "—" : formatNumber(summary.rank)} hint="Provider's own 0–100 scale" />
      </div>
      <Card>
        <div className="px-3 pt-2">
          <Tabs tabs={TABS} active={tab} href={(k) => `${base}/backlinks?tab=${k}`} />
        </div>
        <CardHeader title={TABS.find((t) => t.key === tab)!.label} />
        <div className="overflow-x-auto">{content}</div>
      </Card>
    </>
  );
}
