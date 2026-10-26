import type { Metadata } from "next";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { researchAction, saveResearchAction } from "@/lib/actions/keywords";
import { getKeywordProvider } from "@/lib/providers/registry";
import type { StoredIdea } from "@/lib/keywords/service";
import { clusterKeywords, inferIntent } from "@/lib/keywords/utils";
import { COUNTRIES, LANGUAGES, countryName, languageName } from "@/lib/locales";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormMessage, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { ProviderNotConnected } from "@/components/keywords/provider-not-connected";
import { IntentBadge, KdBadge } from "@/components/keywords/badges";

export const metadata: Metadata = { title: "Keyword Research" };
export const maxDuration = 60;

const TYPES = [
  { key: "all", label: "All ideas" },
  { key: "related", label: "Related" },
  { key: "long_tail", label: "Long-tail" },
  { key: "question", label: "Questions" },
] as const;

const ERRORS: Record<string, string> = {
  invalid: "Enter a seed keyword of at least 2 characters.",
  role: "Viewers cannot run keyword research.",
  demo: "The Demo Project is read-only.",
  rate_limited: "Too many searches in the last hour. Please wait and try again.",
  none_selected: "Select at least one keyword to save.",
};

export default async function KeywordResearchPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/keyword-research">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const provider = getKeywordProvider({ isDemoWebsite: website.is_demo });
  const canSearch = Boolean(provider) && roleAtLeast(role, "member");
  const canSave = canSearch && !website.is_demo;
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const queryId = typeof sp.q === "string" ? sp.q : null;
  const type = (typeof sp.type === "string" ? sp.type : "all") as (typeof TYPES)[number]["key"];
  const sort = typeof sp.sort === "string" ? sp.sort : "volume";

  const [{ data: recent }, { data: groups }, { data: query }] = await Promise.all([
    supabase.from("keyword_research_queries").select("id, seed, country_code, provider, status, created_at").eq("website_id", website.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("keyword_groups").select("id, name").eq("website_id", website.id).eq("kind", "list").order("name"),
    queryId
      ? supabase.from("keyword_research_queries").select("*").eq("id", queryId).eq("website_id", website.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const ideas = ((query?.results ?? []) as unknown as StoredIdea[]) ?? [];
  const isDemoResult = query?.provider === "demo";
  const counts = {
    all: ideas.length,
    related: ideas.filter((i) => i.type === "related").length,
    long_tail: ideas.filter((i) => i.type === "long_tail").length,
    question: ideas.filter((i) => i.type === "question").length,
  };
  const visible = ideas
    .filter((i) => type === "all" || i.type === type)
    .sort((a, b) =>
      sort === "difficulty"
        ? (a.difficulty ?? 999) - (b.difficulty ?? 999)
        : sort === "cpc"
          ? (b.cpc ?? -1) - (a.cpc ?? -1)
          : sort === "keyword"
            ? a.keyword.localeCompare(b.keyword)
            : (b.searchVolume ?? -1) - (a.searchVolume ?? -1),
    );
  const clusterOf = new Map<string, string>();
  for (const [label, kws] of clusterKeywords(ideas.map((i) => i.keyword), query?.seed)) for (const k of kws) clusterOf.set(k, label);
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const errorMessage = typeof sp.message === "string" ? sp.message : errorCode ? ERRORS[errorCode] : null;
  const qs = (patch: Record<string, string>) => `${base}/keyword-research?${new URLSearchParams({ ...(queryId ? { q: queryId } : {}), type, sort, ...patch })}`;

  return (
    <>
      <PageHeader
        title="Keyword Research"
        badge={website.is_demo ? <DemoDataBadge /> : provider ? <Badge tone="success">{provider.name}</Badge> : <ProviderNotConnected what="" compact />}
        description="Find related keywords, long-tail variations and questions, with metrics from your connected data provider."
      />
      <div className="space-y-4">
        {!provider && <ProviderNotConnected what="Keyword research" />}
        {website.is_demo && (
          <FormMessage tone="info">
            Demo Project: results below are generated sample <strong>Demo Data</strong> for presentations — not real search volumes. Saving is disabled.
          </FormMessage>
        )}
        {errorMessage && <FormMessage>{errorMessage}</FormMessage>}

        <Card className="p-4">
          <form action={researchAction} className="grid gap-3 sm:grid-cols-[1fr_12rem_10rem_auto] sm:items-end">
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="siteId" value={siteId} />
            <div>
              <label htmlFor="seed" className="mb-1.5 block text-sm font-medium text-ink-2">
                Seed keyword
              </label>
              <Input id="seed" name="seed" placeholder="e.g. hiking boots" defaultValue={query?.seed ?? ""} required minLength={2} maxLength={80} disabled={!canSearch} />
            </div>
            <div>
              <label htmlFor="countryCode" className="mb-1.5 block text-sm font-medium text-ink-2">
                Country
              </label>
              <Select id="countryCode" name="countryCode" defaultValue={query?.country_code ?? website.country_code} disabled={!canSearch}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="languageCode" className="mb-1.5 block text-sm font-medium text-ink-2">
                Language
              </label>
              <Select id="languageCode" name="languageCode" defaultValue={query?.language_code ?? website.language_code} disabled={!canSearch}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={!canSearch}>
              <Search aria-hidden /> Research
            </Button>
          </form>
          {recent && recent.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              Recent:
              {recent.map((r) => (
                <Link
                  key={r.id}
                  href={`${base}/keyword-research?q=${r.id}`}
                  className={cn("rounded-md border border-line px-2 py-0.5 hover:border-brand/40 hover:text-ink", r.id === queryId && "border-brand/40 bg-brand-soft text-brand-ink", r.status === "failed" && "text-critical")}
                >
                  {r.seed} · {r.country_code}
                  {r.status === "failed" ? " · failed" : ""}
                </Link>
              ))}
            </div>
          )}
        </Card>

        {query?.status === "failed" && <FormMessage>This search failed: {query.error}</FormMessage>}

        {!query ? (
          <Card>
            <EmptyState icon={Search} title="Start with a seed keyword" description="Results include search volume, CPC, competition, keyword difficulty and intent as reported by the provider." />
          </Card>
        ) : query.status === "completed" ? (
          <Card>
            <CardHeader
              title={`Ideas for “${query.seed}”`}
              description={`${countryName(query.country_code)} · ${languageName(query.language_code)} · ${isDemoResult ? "Demo Data" : `source: ${query.provider}`} · ${formatDate(query.created_at, { hour: "2-digit", minute: "2-digit" })}`}
              action={
                <div className="flex items-center gap-2">
                  {isDemoResult && <DemoDataBadge />}
                  <a className={buttonClasses({ variant: "secondary", size: "sm" })} href={`/api/keyword-research/${query.id}/export`}>
                    <Download aria-hidden /> CSV
                  </a>
                </div>
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-2">
              <div className="flex flex-wrap gap-1" role="tablist">
                {TYPES.map((t) => (
                  <Link key={t.key} role="tab" aria-selected={type === t.key} href={qs({ type: t.key })} className={cn("rounded-lg px-3 py-1.5 text-sm", type === t.key ? "bg-brand-soft font-medium text-brand-ink" : "text-muted hover:bg-surface-2")}>
                    {t.label} <span className="tabular text-xs opacity-70">{counts[t.key]}</span>
                  </Link>
                ))}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted">
                Sort:
                {[
                  ["volume", "Volume"],
                  ["difficulty", "Easiest"],
                  ["cpc", "CPC"],
                  ["keyword", "A–Z"],
                ].map(([k, l]) => (
                  <Link key={k} href={qs({ sort: k })} className={cn("rounded px-2 py-1", sort === k ? "bg-surface-2 font-medium text-ink" : "hover:text-ink")}>
                    {l}
                  </Link>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <EmptyState title="No ideas in this view" className="py-10" />
            ) : (
              <form action={saveResearchAction}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="siteId" value={siteId} />
                <input type="hidden" name="queryId" value={query.id} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr className="border-b border-line">
                        <th className="w-10 px-4 py-2" />
                        <th className="px-2 py-2 font-medium">Keyword</th>
                        <th className="px-3 py-2 text-right font-medium">Volume</th>
                        <th className="px-3 py-2 text-right font-medium">KD</th>
                        <th className="px-3 py-2 text-right font-medium">CPC</th>
                        <th className="px-3 py-2 text-right font-medium">Comp.</th>
                        <th className="px-3 py-2 font-medium">Intent</th>
                        <th className="px-4 py-2 font-medium">Cluster</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {visible.slice(0, 300).map((i) => (
                        <tr key={i.keyword} className="hover:bg-surface-2/50">
                          <td className="px-4 py-2">
                            <input type="checkbox" name="keyword" value={i.keyword} aria-label={`Select ${i.keyword}`} disabled={!canSave} className="size-4 accent-[var(--brand)]" />
                          </td>
                          <td className="px-2 py-2 font-medium text-ink">
                            {i.keyword}
                            {i.type !== "related" && <span className="ml-2 text-xs font-normal text-muted">{i.type === "question" ? "question" : "long-tail"}</span>}
                          </td>
                          <td className="tabular px-3 py-2 text-right">{formatNumber(i.searchVolume)}</td>
                          <td className="px-3 py-2 text-right">
                            <KdBadge value={i.difficulty} />
                          </td>
                          <td className="tabular px-3 py-2 text-right">{i.cpc === null ? "—" : `$${i.cpc.toFixed(2)}`}</td>
                          <td className="tabular px-3 py-2 text-right text-muted">{i.competition === null ? "—" : i.competition.toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <IntentBadge intent={i.intent} fallback={inferIntent(i.keyword)} />
                          </td>
                          <td className="px-4 py-2 text-xs text-muted">{clusterOf.get(i.keyword)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canSave && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" name="track" className="size-4 accent-[var(--brand)]" /> Track rankings
                    </label>
                    <Select name="groupId" defaultValue="" className="h-9 w-56" aria-label="Add to group">
                      <option value="">No group</option>
                      {(groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" size="sm">
                      Save selected keywords
                    </Button>
                    <span className="text-xs text-muted">Metrics are saved exactly as returned by {query.provider}.</span>
                  </div>
                )}
              </form>
            )}
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              Blank values (—) mean the provider returned no data for that field. Intent marked “rule-based” is inferred from the keyword text, not provider data.
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
