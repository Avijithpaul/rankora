import type { Metadata } from "next";
import Link from "next/link";
import { Swords } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { addCompetitorAction } from "@/lib/actions/competitors";
import { MAX_COMPETITORS, rankingSummary } from "@/lib/competitors/compare";
import { loadRankingComparison } from "@/lib/competitors/data";
import { providerStatus } from "@/lib/providers/registry";
import { formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Competitors" };

export default async function CompetitorsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/competitors">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const { data: competitors } = await supabase.from("competitors").select("*").eq("website_id", website.id).order("created_at");
  const list = competitors ?? [];
  const { keywords, positions } = await loadRankingComparison(website, list.map((c) => c.id));
  const summaries = new Map(rankingSummary(keywords, list, positions).map((s) => [s.competitorId, s]));
  const provider = providerStatus().rank;
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const checkedKeywords = keywords.filter((k) => k.own !== undefined).length;

  return (
    <>
      <PageHeader
        title="Competitors"
        description="Compare rankings, keyword overlap, homepage SEO and content with competing domains. Only data that was actually observed is shown."
      />
      {typeof sp.error === "string" && (
        <div className="mb-4">
          <FormMessage>{sp.error.slice(0, 200)}</FormMessage>
        </div>
      )}
      {typeof sp.saved === "string" && (
        <div className="mb-4">
          <FormMessage tone="success">{sp.saved.slice(0, 200)}</FormMessage>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Competitor domains" description={`${list.length} of ${MAX_COMPETITORS}`} />
          {list.length === 0 ? (
            <EmptyState icon={Swords} title="No competitors yet" description="Add the domains you compete with in search results." className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-medium">Domain</th>
                    <th className="px-3 py-2 text-right font-medium">Keywords compared</th>
                    <th className="px-3 py-2 text-right font-medium">You ahead</th>
                    <th className="px-3 py-2 text-right font-medium">They ahead</th>
                    <th className="px-3 py-2 text-right font-medium">Only them</th>
                    <th className="px-5 py-2 text-right font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((c) => {
                    const s = summaries.get(c.id);
                    const none = !s || s.checked === 0;
                    return (
                      <tr key={c.id} className="hover:bg-surface-2/50">
                        <td className="px-5 py-2.5">
                          <Link href={`${base}/competitors/${c.id}`} className="font-medium text-ink hover:text-brand">
                            {c.name ?? c.domain}
                          </Link>
                          {c.name && <span className="block text-xs text-muted">{c.domain}</span>}
                        </td>
                        {none ? (
                          <td colSpan={4} className="px-3 py-2.5 text-right text-xs text-muted">
                            Not compared yet — positions are recorded at the next rank check
                          </td>
                        ) : (
                          <>
                            <td className="tabular px-3 py-2.5 text-right">{s.checked}</td>
                            <td className="tabular px-3 py-2.5 text-right text-success">{s.youAhead + s.onlyYou}</td>
                            <td className="tabular px-3 py-2.5 text-right text-critical">{s.theyAhead + s.onlyThem}</td>
                            <td className="tabular px-3 py-2.5 text-right">{s.onlyThem}</td>
                          </>
                        )}
                        <td className="px-5 py-2.5 text-right text-muted">{formatDate(c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {canEdit && list.length < MAX_COMPETITORS && (
            <Card>
              <CardHeader title="Add competitor" />
              <CardBody>
                <form action={addCompetitorAction} className="space-y-3">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="siteId" value={siteId} />
                  <Field label="Domain" htmlFor="domain" hint="e.g. competitor.com — a URL also works">
                    <Input id="domain" name="domain" required maxLength={253} />
                  </Field>
                  <Field label="Name (optional)" htmlFor="name">
                    <Input id="name" name="name" maxLength={80} />
                  </Field>
                  <SubmitButton>Add competitor</SubmitButton>
                </form>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Where the data comes from" />
            <CardBody className="space-y-2 text-sm text-ink-2">
              <p>
                <strong>Rankings:</strong> each daily rank check reads competitor positions from the same search result page as yours, at no extra cost.{" "}
                {provider.connected ? (
                  <Badge tone="success">{provider.name} connected</Badge>
                ) : (
                  <Badge>Rank provider not connected</Badge>
                )}
              </p>
              <p className="text-muted">{checkedKeywords} tracked keyword{checkedKeywords === 1 ? "" : "s"} have been checked.</p>
              <p>
                <strong>Overlap & gaps:</strong> keyword lists from the provider&apos;s ranking index, cached for 7 days.
              </p>
              <p>
                <strong>Homepage & content:</strong> pages fetched live by RankoraBot (robots.txt respected) and checked with the same rules for both sides.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
