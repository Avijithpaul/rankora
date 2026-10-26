import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, Download, FolderPlus, Plus, Trash2, Upload } from "lucide-react";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { addKeywordsAction, bulkKeywordAction, createGroupAction, deleteGroupAction, importKeywordsAction } from "@/lib/actions/keywords";
import { getKeywordProvider } from "@/lib/providers/registry";
import { inferIntent } from "@/lib/keywords/utils";
import { MAX_IMPORT_ROWS } from "@/lib/keywords/csv";
import { cn, formatNumber } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { ProviderNotConnected } from "@/components/keywords/provider-not-connected";
import { IntentBadge, KdBadge, PositionCell } from "@/components/keywords/badges";

export const metadata: Metadata = { title: "Saved Keywords" };
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  role: "Viewers cannot change keywords.",
  demo: "The Demo Project is read-only.",
  none_selected: "Select at least one keyword.",
  none_valid: "No valid keywords were found.",
  no_file: "Choose a CSV file to import.",
  file_too_large: "The file is larger than 1 MB.",
  group_name: "Enter a group name (max 80 characters).",
  group_exists: "A group with that name already exists.",
};

const PAGE_SIZE = 100;

export default async function SavedKeywordsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/keywords">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const base = `/app/${orgSlug}/sites/${siteId}`;
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const provider = getKeywordProvider({ isDemoWebsite: false });
  const str = (k: string, d = "") => (typeof sp[k] === "string" ? (sp[k] as string) : d);
  const q = str("q").trim().slice(0, 100);
  const groupId = str("group");
  const tracked = str("tracked", "all");
  const intent = str("intent", "all");
  const pageNo = Math.max(1, Number(str("page", "1")) || 1);

  const { data: groups } = await supabase.from("keyword_groups").select("id, name, color, keyword_group_members(count)").eq("website_id", website.id).order("name");
  let groupKeywordIds: string[] | null = null;
  if (groupId) {
    const { data } = await supabase.from("keyword_group_members").select("keyword_id").eq("group_id", groupId).limit(10000);
    groupKeywordIds = (data ?? []).map((d) => d.keyword_id);
  }

  let query = supabase
    .from("keywords")
    .select("id, keyword, country_code, language_code, device, search_engine, is_tracked, target_url, search_volume, cpc, difficulty, intent, metrics_source, current_position, previous_position, keyword_group_members(group_id)", { count: "exact" })
    .eq("website_id", website.id);
  if (q) query = query.ilike("normalized_keyword", `%${q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`);
  if (tracked === "yes") query = query.eq("is_tracked", true);
  if (tracked === "no") query = query.eq("is_tracked", false);
  if (intent === "none") query = query.is("intent", null);
  else if (intent !== "all") query = query.eq("intent", intent);
  if (groupKeywordIds) query = query.in("id", groupKeywordIds.length ? groupKeywordIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: rows, count } = await query.order("search_volume", { ascending: false, nullsFirst: false }).order("keyword").range((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE - 1);

  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (patch: Record<string, string>) => `${base}/keywords?${new URLSearchParams({ q, group: groupId, tracked, intent, page: String(pageNo), ...patch })}`;
  const err = str("error");
  const message = str("message") || MESSAGES[err];
  const anyDemoMetrics = (rows ?? []).some((r) => r.metrics_source === "demo");

  return (
    <>
      <PageHeader
        title="Saved Keywords"
        badge={website.is_demo ? <DemoDataBadge /> : undefined}
        description="Keyword lists for this website. Metrics come only from a connected provider."
        actions={
          <a className={buttonClasses({ variant: "secondary" })} href={`/api/sites/${siteId}/keywords/export${groupId ? `?group=${groupId}` : ""}`}>
            <Download aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="space-y-4">
        {!provider && !website.is_demo && <ProviderNotConnected what="Search volume, CPC and difficulty" />}
        {err && message && <FormMessage>{message}</FormMessage>}
        {str("added") && (
          <FormMessage tone="success">
            {str("added")} keyword(s) added{Number(str("skipped")) > 0 ? `, ${str("skipped")} skipped (duplicates or invalid)` : ""}
            {str("truncated") ? `. Only the first ${MAX_IMPORT_ROWS} rows were imported` : ""}.{!err && str("message") ? ` ${str("message")}` : ""}
          </FormMessage>
        )}
        {str("saved") && <FormMessage tone="success">{str("saved")} keyword(s) saved from research.</FormMessage>}
        {str("done") && <FormMessage tone="success">Done.</FormMessage>}

        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {/* Groups */}
          <div className="space-y-4">
            <Card>
              <CardHeader title="Groups" />
              <ul className="p-2 text-sm">
                <li>
                  <Link href={qs({ group: "", page: "1" })} className={cn("flex justify-between rounded-lg px-3 py-1.5 hover:bg-surface-2", !groupId && "bg-brand-soft font-medium text-brand-ink")}>
                    All keywords
                  </Link>
                </li>
                {(groups ?? []).map((g) => (
                  <li key={g.id} className="group flex items-center">
                    <Link href={qs({ group: g.id, page: "1" })} className={cn("flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-1.5 hover:bg-surface-2", groupId === g.id && "bg-brand-soft font-medium text-brand-ink")}>
                      <span className="truncate">{g.name}</span>
                      <span className="tabular text-xs text-muted">{(g.keyword_group_members as unknown as { count: number }[])?.[0]?.count ?? 0}</span>
                    </Link>
                    {canEdit && (
                      <form action={deleteGroupAction}>
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="siteId" value={siteId} />
                        <input type="hidden" name="groupId" value={g.id} />
                        <button className="rounded p-1 text-muted opacity-0 hover:text-critical group-hover:opacity-100 focus:opacity-100" aria-label={`Delete group ${g.name}`} title="Delete group (keywords are kept)">
                          <Trash2 className="size-3.5" />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <form action={createGroupAction} className="flex gap-2 border-t border-line p-3">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="siteId" value={siteId} />
                  <Input name="name" placeholder="New group" className="h-8" maxLength={80} required aria-label="New group name" />
                  <Button size="sm" variant="secondary" aria-label="Create group">
                    <FolderPlus aria-hidden />
                  </Button>
                </form>
              )}
            </Card>

            {canEdit && (
              <Card>
                <details>
                  <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 text-sm font-semibold">
                    <Plus className="size-4" aria-hidden /> Add keywords
                  </summary>
                  <form action={addKeywordsAction} className="space-y-3 border-t border-line p-4">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="siteId" value={siteId} />
                    <Textarea name="keywords" rows={5} placeholder={"one keyword per line"} aria-label="Keywords, one per line" required />
                    <Select name="device" defaultValue="desktop" className="h-9" aria-label="Device">
                      <option value="desktop">Desktop</option>
                      <option value="mobile">Mobile</option>
                    </Select>
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" name="track" className="size-4 accent-[var(--brand)]" /> Track rankings
                    </label>
                    <Button size="sm" type="submit">
                      Add
                    </Button>
                  </form>
                </details>
                <details className="border-t border-line">
                  <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 text-sm font-semibold">
                    <Upload className="size-4" aria-hidden /> Import CSV
                  </summary>
                  <form action={importKeywordsAction} className="space-y-3 border-t border-line p-4">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="siteId" value={siteId} />
                    <input type="file" name="file" accept=".csv,text/csv,text/plain" required className="block w-full text-xs" aria-label="CSV file" />
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" name="track" className="size-4 accent-[var(--brand)]" /> Track rankings
                    </label>
                    <Button size="sm" type="submit">
                      Import
                    </Button>
                    <p className="text-xs text-muted">
                      Columns: <code>keyword</code> (required), <code>country</code>, <code>language</code>, <code>device</code>, <code>target_url</code>, <code>group</code>. Up to {MAX_IMPORT_ROWS} rows. Metric columns are ignored — metrics only come from a provider.
                    </p>
                  </form>
                </details>
              </Card>
            )}
          </div>

          {/* List */}
          <Card>
            <form className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row" role="search">
              <input type="hidden" name="group" value={groupId} />
              <Input name="q" placeholder="Filter keywords…" defaultValue={q} className="h-9" aria-label="Filter keywords" />
              <Select name="tracked" defaultValue={tracked} className="h-9 sm:w-40" aria-label="Tracking">
                <option value="all">All</option>
                <option value="yes">Tracked</option>
                <option value="no">Not tracked</option>
              </Select>
              <Select name="intent" defaultValue={intent} className="h-9 sm:w-44" aria-label="Intent">
                <option value="all">Any intent</option>
                <option value="informational">Informational</option>
                <option value="commercial">Commercial</option>
                <option value="transactional">Transactional</option>
                <option value="navigational">Navigational</option>
                <option value="none">No provider intent</option>
              </Select>
              <Button size="sm" variant="secondary" className="h-9">
                Filter
              </Button>
            </form>

            {!rows?.length ? (
              <EmptyState
                icon={Bookmark}
                title={q || groupId || tracked !== "all" || intent !== "all" ? "No keywords match" : "No saved keywords yet"}
                description="Save ideas from Keyword Research, add them manually, or import a CSV."
                action={<Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={`${base}/keyword-research`}>Open Keyword Research</Link>}
              />
            ) : (
              <form action={bulkKeywordAction}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="siteId" value={siteId} />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr className="border-b border-line">
                        <th className="w-10 px-4 py-2" />
                        <th className="px-2 py-2 font-medium">Keyword</th>
                        <th className="px-3 py-2 font-medium">Market</th>
                        <th className="px-3 py-2 text-right font-medium">Volume</th>
                        <th className="px-3 py-2 text-right font-medium">KD</th>
                        <th className="px-3 py-2 text-right font-medium">CPC</th>
                        <th className="px-3 py-2 font-medium">Intent</th>
                        <th className="px-3 py-2 font-medium">Position</th>
                        <th className="px-4 py-2 font-medium">Groups</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((k) => (
                        <tr key={k.id} className="hover:bg-surface-2/50">
                          <td className="px-4 py-2">
                            <input type="checkbox" name="ids" value={k.id} disabled={!canEdit} aria-label={`Select ${k.keyword}`} className="size-4 accent-[var(--brand)]" />
                          </td>
                          <td className="max-w-[18rem] px-2 py-2">
                            <Link href={`${base}/keywords/${k.id}`} className="block truncate font-medium text-ink hover:text-brand">
                              {k.keyword}
                            </Link>
                            <span className="block truncate text-xs text-muted">{k.target_url ?? (k.is_tracked ? "Tracked · no target URL" : "")}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">
                            {k.country_code} · {k.language_code} · {k.device}
                          </td>
                          <td className="tabular px-3 py-2 text-right">
                            {k.search_volume === null ? <span className="text-muted">—</span> : formatNumber(k.search_volume)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <KdBadge value={k.difficulty} />
                          </td>
                          <td className="tabular px-3 py-2 text-right">{k.cpc === null ? <span className="text-muted">—</span> : `$${Number(k.cpc).toFixed(2)}`}</td>
                          <td className="px-3 py-2">
                            <IntentBadge intent={k.intent} fallback={inferIntent(k.keyword)} />
                          </td>
                          <td className="px-3 py-2">
                            {k.is_tracked ? <PositionCell current={k.current_position} previous={k.previous_position} /> : <span className="text-xs text-muted">Not tracked</span>}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              {((k.keyword_group_members ?? []) as { group_id: string }[]).map((m) => (
                                <Badge key={m.group_id}>{groupName.get(m.group_id)}</Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
                    <Select name="op" defaultValue="track" className="h-9 w-56" aria-label="Bulk action">
                      <option value="track">Start tracking rankings</option>
                      <option value="untrack">Stop tracking</option>
                      <option value="group">Add to group…</option>
                      <option value="ungroup">Remove from group…</option>
                      <option value="metrics" disabled={!provider}>
                        Fetch metrics from provider{provider ? "" : " (not connected)"}
                      </option>
                      <option value="delete">Delete</option>
                    </Select>
                    <Select name="groupId" defaultValue={groupId} className="h-9 w-48" aria-label="Group for bulk action">
                      <option value="">— group —</option>
                      {(groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" type="submit">
                      Apply to selected
                    </Button>
                  </div>
                )}
              </form>
            )}
            {totalPages > 1 && (
              <nav className="flex items-center justify-between border-t border-line px-5 py-3 text-sm" aria-label="Pagination">
                <span className="text-muted">
                  {formatNumber(count)} keywords · page {pageNo} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {pageNo > 1 && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={qs({ page: String(pageNo - 1) })}>Previous</Link>}
                  {pageNo < totalPages && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={qs({ page: String(pageNo + 1) })}>Next</Link>}
                </div>
              </nav>
            )}
            {(website.is_demo || anyDemoMetrics) && (
              <p className="border-t border-line px-5 py-3 text-xs text-demo">Metrics and positions on this page are sample Demo Data.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
