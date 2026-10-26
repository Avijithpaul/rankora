import type { Metadata } from "next";
import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import { listWebsites, requireOrg, roleAtLeast } from "@/lib/auth/dal";
import { countryName, languageName } from "@/lib/locales";
import { formatDate } from "@/lib/utils";
import { Badge, DemoDataBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Websites" };

export default async function WebsitesPage({ params }: PageProps<"/app/[org]/websites">) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  const sites = await listWebsites(org.id);
  const canCreate = roleAtLeast(role, "member") && !org.is_demo;

  return (
    <>
      <PageHeader
        title="Websites"
        description={`Projects in ${org.name}. Each website has its own audits, keywords and integrations.`}
        actions={
          canCreate && (
            <ButtonLink href={`/app/${slug}/websites/new`}>
              <Plus aria-hidden /> Add website
            </ButtonLink>
          )
        }
      />
      <Card>
        {sites.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="No websites yet"
            description="Add a website to start auditing it."
            action={canCreate && <ButtonLink href={`/app/${slug}/websites/new`}>Add website</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-xs font-medium text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Website</th>
                  <th className="px-5 py-3 font-medium">Market</th>
                  <th className="px-5 py-3 font-medium">SEO score</th>
                  <th className="px-5 py-3 font-medium">Last crawl</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sites.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2/60">
                    <td className="px-5 py-3">
                      <Link href={`/app/${slug}/sites/${s.id}/dashboard`} className="font-medium text-ink hover:text-brand">
                        {s.name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {s.domain}
                        {s.is_demo && <DemoDataBadge />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink-2">
                      {countryName(s.country_code)} · {languageName(s.language_code)}
                    </td>
                    <td className="tabular px-5 py-3 text-ink-2">{s.latest_score === null ? "Not audited" : Math.round(s.latest_score)}</td>
                    <td className="px-5 py-3 text-ink-2">{s.last_crawled_at ? formatDate(s.last_crawled_at) : "Never"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={s.status === "active" ? "success" : "neutral"} className="capitalize">
                        {s.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
