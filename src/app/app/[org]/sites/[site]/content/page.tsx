import type { Metadata } from "next";
import Link from "next/link";
import { History, Sparkles } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { aiConfig, providerConfig } from "@/lib/env";
import { analyzeContentAction } from "@/lib/actions/content";
import { scoreBand } from "@/lib/seo/scoring";
import { formatDate, formatNumber } from "@/lib/utils";
import { AnalyzeForm } from "@/components/content/analyze-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Content Optimizer" };
export const maxDuration = 60;

const BAND_TONE: Record<"good" | "fair" | "poor", BadgeTone> = { good: "success", fair: "warning", poor: "critical" };

export default async function ContentPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/content">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}/content`;

  const { data: history } = await supabase
    .from("content_analyses")
    .select("id, target_keyword, source_type, source_url, title, score, word_count, ai_suggestions, created_at")
    .eq("website_id", website.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const disabledReason = website.is_demo
    ? "The Demo Project is read-only — add a real website to analyze content."
    : !roleAtLeast(role, "member")
      ? "Viewers can read analyses but not run new ones."
      : !providerConfig().serviceRoleConfigured
        ? "Server is missing SUPABASE_SECRET_KEY."
        : null;
  const ai = aiConfig();

  return (
    <>
      <PageHeader
        title="Content Optimizer"
        description="Check a published page or a draft against a target keyword. Every score is rule-based and explained; nothing is published or changed on your site."
      />
      {sp.deleted && <div className="mb-4"><FormMessage tone="success">Analysis deleted.</FormMessage></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="New analysis" />
          <CardBody>
            <AnalyzeForm
              action={analyzeContentAction}
              orgSlug={orgSlug}
              siteId={siteId}
              domain={website.domain}
              defaults={{ keyword: typeof sp.keyword === "string" ? sp.keyword.slice(0, 120) : "", url: typeof sp.url === "string" ? sp.url.slice(0, 2048) : "" }}
              disabledReason={disabledReason}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="What is analyzed" />
            <CardBody className="space-y-2 text-sm text-ink-2">
              <p>Title and meta description, headings, keyword placement and frequency, content length and structure, internal links, related-term coverage and readability.</p>
              <p className="text-muted">
                Related terms come only from real sources: your saved keywords, your Search Console queries and terms you enter. Readability uses the Flesch formula for English content.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-brand" aria-hidden /> AI suggestions</span>} />
            <CardBody className="space-y-2 text-sm">
              {ai ? (
                <>
                  <Badge tone="success">Connected · {ai.model}</Badge>
                  <p className="text-muted">After an analysis you can request titles, meta descriptions, outlines, FAQs, improvements and internal-link ideas. They are suggestions to review — Rankora never publishes them.</p>
                </>
              ) : (
                <>
                  <Badge>AI provider not connected</Badge>
                  <p className="text-muted">
                    The analysis works without AI. To enable optional suggestions, set <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code> on the server.
                  </p>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Analysis history" description="Stored per website; every member of the organization can see it." />
        {!history?.length ? (
          <EmptyState icon={History} title="No analyses yet" description="Run your first analysis above." className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Keyword</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Words</th>
                  <th className="px-5 py-2 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => {
                  const score = h.score === null ? null : Number(h.score);
                  const hasAi = h.ai_suggestions && Object.keys(h.ai_suggestions as object).length > 0;
                  return (
                    <tr key={h.id} className="hover:bg-surface-2/50">
                      <td className="px-5 py-2.5">
                        <Link href={`${base}/${h.id}`} className="font-medium text-ink hover:text-brand">
                          {h.target_keyword}
                        </Link>
                        {hasAi && <Badge tone="brand" className="ml-2">AI suggestions</Badge>}
                        {h.title && <span className="block max-w-md truncate text-xs text-muted">{h.title}</span>}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2.5 text-xs text-muted" title={h.source_url ?? undefined}>
                        {h.source_type === "draft" ? <Badge>Draft</Badge> : h.source_url}
                      </td>
                      <td className="px-3 py-2.5 text-right">{score === null ? "—" : <Badge tone={BAND_TONE[scoreBand(score).tone]}>{Math.round(score)}</Badge>}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(h.word_count)}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{formatDate(h.created_at, { hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
