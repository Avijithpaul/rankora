import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { aiConfig } from "@/lib/env";
import { deleteAnalysisAction, generateAiSuggestionAction } from "@/lib/actions/content";
import { CONTENT_THRESHOLDS, type CheckCategory, type CheckStatus } from "@/lib/content/analyze";
import type { StoredContentResults } from "@/lib/content/service";
import { AI_TASK_LABEL, AI_TASKS, type AiOutput, type AiSuggestionRecord, type AiTask } from "@/lib/ai/types";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { ScoreRing } from "@/components/ui/score-ring";

export const metadata: Metadata = { title: "Content analysis" };
export const maxDuration = 120;

const CATEGORY_LABEL: Record<CheckCategory, string> = {
  metadata: "Metadata",
  headings: "Headings",
  placement: "Keyword placement",
  structure: "Structure",
  length: "Length",
  links: "Links",
  semantic: "Semantic coverage",
  readability: "Readability",
};

const STATUS_ICON: Record<CheckStatus, { icon: typeof Check; cls: string; label: string }> = {
  pass: { icon: Check, cls: "text-success", label: "Pass" },
  warn: { icon: TriangleAlert, cls: "text-warning", label: "Needs work" },
  fail: { icon: X, cls: "text-critical", label: "Fail" },
  info: { icon: Info, cls: "text-muted", label: "Info" },
};

const PRIORITY_TONE: Record<"high" | "medium" | "low", BadgeTone> = { high: "critical", medium: "warning", low: "neutral" };
const SOURCE_LABEL = { saved_keyword: "Saved keyword", search_console: "Search Console", user: "Your term" } as const;

function AiOutputView({ record }: { record: AiSuggestionRecord }) {
  switch (record.task) {
    case "titles":
    case "meta_descriptions": {
      const o = record.output as AiOutput<"titles">;
      return (
        <ul className="space-y-2">
          {o.suggestions.map((s, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              <p className="text-sm font-medium text-ink">{s.text}</p>
              <p className="mt-1 text-xs text-muted">
                {s.text.length} characters · {s.rationale}
              </p>
            </li>
          ))}
        </ul>
      );
    }
    case "outline": {
      const o = record.output as AiOutput<"outline">;
      return (
        <ol className="space-y-2 text-sm">
          {o.sections.map((s, i) => (
            <li key={i} className={cn(s.level === 3 && "ml-5")}>
              <span className="font-medium text-ink">
                H{s.level}: {s.heading}
              </span>
              <ul className="ml-4 list-disc text-ink-2">
                {s.points.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      );
    }
    case "faqs": {
      const o = record.output as AiOutput<"faqs">;
      return (
        <dl className="space-y-3 text-sm">
          {o.faqs.map((f, i) => (
            <div key={i}>
              <dt className="font-medium text-ink">{f.question}</dt>
              <dd className="text-ink-2">{f.answer}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case "improvements": {
      const o = record.output as AiOutput<"improvements">;
      return (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {o.suggestions.map((s, i) => (
            <li key={i}>
              <span className="font-medium text-ink">{s.area}:</span> <span className="text-ink-2">{s.suggestion}</span>
              <span className="block text-xs text-muted">{s.rationale}</span>
            </li>
          ))}
        </ol>
      );
    }
    case "internal_links": {
      const o = record.output as AiOutput<"internal_links">;
      if (!o.links.length) return <p className="text-sm text-muted">No suitable internal links among the crawled pages.</p>;
      return (
        <ul className="space-y-2 text-sm">
          {o.links.map((l, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              <span className="font-medium text-ink">“{l.anchor_text}”</span> → <span className="break-all text-brand">{l.target_url}</span>
              <span className="block text-xs text-muted">
                {l.placement} · {l.rationale}
              </span>
            </li>
          ))}
        </ul>
      );
    }
  }
}

export default async function AnalysisPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/content/[analysisId]">) {
  const { org: orgSlug, site: siteId, analysisId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  if (!/^[0-9a-f-]{36}$/i.test(analysisId)) notFound();
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}/content`;

  const { data: row } = await supabase.from("content_analyses").select("*").eq("id", analysisId).eq("website_id", website.id).maybeSingle();
  if (!row) notFound();
  const results = row.results as unknown as StoredContentResults;
  const a = results.analysis;
  const ai = (row.ai_suggestions ?? {}) as Partial<Record<AiTask, AiSuggestionRecord>>;
  const aiEnabled = Boolean(aiConfig());
  const canWrite = roleAtLeast(role, "member");
  const byCategory = new Map<CheckCategory, typeof a.checks>();
  for (const c of a.checks) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  const hidden = (
    <>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="analysisId" value={row.id} />
    </>
  );

  return (
    <>
      <Link href={base} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Content Optimizer
      </Link>
      <PageHeader
        title={`“${row.target_keyword}”`}
        badge={row.source_type === "draft" ? <Badge>Draft</Badge> : <Badge tone="brand">Published page</Badge>}
        description={
          <>
            {row.source_url ? <span className="break-all">{row.source_url}</span> : (row.title ?? "Pasted draft")} · analyzed {formatDate(row.created_at, { hour: "2-digit", minute: "2-digit" })} · scoring {row.scoring_version}
          </>
        }
        actions={
          <div className="flex gap-2">
            {row.source_type === "url" && row.source_url && (
              <Link className="h-9 rounded-lg border border-line-strong px-3 py-2 text-sm hover:bg-surface-2" href={`${base}?url=${encodeURIComponent(row.source_url)}&keyword=${encodeURIComponent(row.target_keyword)}`}>
                Re-analyze
              </Link>
            )}
            {canWrite && (
              <form action={deleteAnalysisAction}>
                {hidden}
                <SubmitButton variant="ghost" size="sm">Delete</SubmitButton>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <ScoreRing score={a.score} size={112} />
              <div className="grid flex-1 grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Words", formatNumber(a.stats.words)],
                  ["Keyword uses", `${a.stats.keywordOccurrences} (${(a.stats.keywordDensity * 100).toFixed(1)}%)`],
                  ["Headings", `${a.stats.headings.h1} H1 · ${a.stats.headings.h2} H2 · ${a.stats.headings.h3plus} H3+`],
                  ["Links", `${a.stats.internalLinks} internal · ${a.stats.externalLinks} external`],
                  ["Reading ease", a.readability.fleschReadingEase ?? "n/a"],
                  ["Avg sentence", `${a.readability.avgSentenceWords} words`],
                  ["Paragraphs", a.stats.paragraphs],
                  ["Images", `${a.stats.images} (${a.stats.imagesMissingAlt} no alt)`],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <div className="text-xs text-muted">{k}</div>
                    <div className="font-medium text-ink">{v}</div>
                  </div>
                ))}
              </div>
            </CardBody>
            <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
              Score = weighted share of passed checks (warnings count half; informational checks are not scored). It measures on-page optimisation, not a ranking prediction.
            </p>
          </Card>

          <Card>
            <CardHeader title="Recommendations" description="Ordered by impact. Generated from the checks below — rule-based, not AI." />
            {a.recommendations.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No issues found. Nice work.</p>
            ) : (
              <ol className="divide-y divide-line">
                {a.recommendations.map((r) => (
                  <li key={r.checkId} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <Badge tone={PRIORITY_TONE[r.priority]} className="capitalize">{r.priority}</Badge>
                    <span className="text-ink-2">{r.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {[...byCategory].map(([cat, checks]) => (
            <Card key={cat}>
              <CardHeader title={CATEGORY_LABEL[cat]} />
              <ul className="divide-y divide-line">
                {checks.map((c) => {
                  const s = STATUS_ICON[c.status];
                  return (
                    <li key={c.id} className="flex gap-3 px-5 py-3 text-sm">
                      <s.icon className={cn("mt-0.5 size-4 shrink-0", s.cls)} aria-label={s.label} />
                      <div className="min-w-0">
                        <div className="font-medium text-ink">
                          {c.label} {c.weight > 0 && c.status !== "info" && <span className="text-xs font-normal text-muted">· weight {c.weight}</span>}
                        </div>
                        <div className="text-ink-2">{c.detail}</div>
                        {c.recommendation && <div className="mt-0.5 text-muted">{c.recommendation}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <Card id="ai">
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-brand" aria-hidden /> AI suggestions</span>}
              description="Optional drafts written by an AI model from this analysis. Review and edit before using — nothing is published or changed on your site."
            />
            <CardBody className="space-y-4">
              {typeof sp.ai_error === "string" && <FormMessage>{sp.ai_error.slice(0, 300)}</FormMessage>}
              {!aiEnabled && (
                <p className="text-sm text-muted">
                  <Badge>AI provider not connected</Badge> Set <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code> on the server to enable suggestions. The rule-based analysis above does not need it.
                </p>
              )}
              {AI_TASKS.map((task) => {
                const rec = ai[task];
                return (
                  <section key={task} id={`ai-${task}`} className="rounded-lg border border-line p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{AI_TASK_LABEL[task]}</h3>
                      {rec && (
                        <Badge tone="brand">
                          AI suggestion · {rec.model} · {formatDate(rec.generatedAt, { hour: "2-digit", minute: "2-digit" })}
                        </Badge>
                      )}
                      <div className="ml-auto">
                        {aiEnabled && canWrite && !website.is_demo && (
                          <form action={generateAiSuggestionAction}>
                            {hidden}
                            <input type="hidden" name="task" value={task} />
                            <SubmitButton size="sm" variant="secondary" pendingLabel="Generating…">
                              {rec ? "Regenerate" : "Generate"}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>
                    {rec ? <AiOutputView record={rec} /> : <p className="text-xs text-muted">Not generated yet.</p>}
                  </section>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Related terms" description={`${a.terms.filter((t) => t.found).length} of ${a.terms.length} covered`} />
            {a.terms.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">
                No related terms were available.{" "}
                {!results.termSources.searchConsoleConnected && "Connect Search Console, "}save related keywords, or enter terms when you analyze.
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
                {a.terms.map((t) => (
                  <li key={t.term} className="flex items-center gap-2 px-5 py-2">
                    {t.found ? <Check className="size-4 shrink-0 text-success" aria-label="Covered" /> : <X className="size-4 shrink-0 text-critical" aria-label="Missing" />}
                    <span className="min-w-0 flex-1 truncate">{t.term}</span>
                    <Badge tone={t.source === "search_console" ? "brand" : "neutral"}>{SOURCE_LABEL[t.source]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Internal link opportunities" description="Crawled pages that share words with the keyword and are not linked yet. Rule-based." />
            {results.linkOpportunities.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">None found. Opportunities come from your latest completed site audit.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {results.linkOpportunities.map((o) => (
                  <li key={o.url} className="px-5 py-2">
                    <span className="block truncate text-ink" title={o.url}>{o.title ?? o.url}</span>
                    <span className="block truncate text-xs text-muted">
                      {o.url} · matches: {o.matchedWords.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Metadata as analyzed" />
            <CardBody className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted">Title ({results.document.title?.length ?? 0} / {CONTENT_THRESHOLDS.titleMin}–{CONTENT_THRESHOLDS.titleMax})</div>
                <div className="text-ink">{results.document.title ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Meta description ({results.document.metaDescription?.length ?? 0} / {CONTENT_THRESHOLDS.descriptionMin}–{CONTENT_THRESHOLDS.descriptionMax})</div>
                <div className="text-ink">{results.document.metaDescription ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Heading outline</div>
                <ul className="mt-1 max-h-64 overflow-y-auto text-xs">
                  {results.document.headings.length === 0 && <li className="text-muted">No headings</li>}
                  {results.document.headings.map((h, i) => (
                    <li key={i} style={{ paddingLeft: `${(h.level - 1) * 0.75}rem` }} className="truncate">
                      <span className="text-muted">H{h.level}</span> {h.text || "(empty)"}
                    </li>
                  ))}
                </ul>
              </div>
            </CardBody>
          </Card>

          {a.topTerms.length > 0 && (
            <Card>
              <CardHeader title="Most used terms" />
              <CardBody className="flex flex-wrap gap-1.5">
                {a.topTerms.map((t) => (
                  <Badge key={t.term}>
                    {t.term} · {t.count}
                  </Badge>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
