import type { Metadata } from "next";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteWebsiteAction, updateWebsiteAction } from "@/lib/actions/workspace";
import { WebsiteForm } from "@/components/forms/website-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { CrawlSettingsForm } from "./crawl-settings-form";

export const metadata: Metadata = { title: "Site settings" };

export default async function SiteSettingsPage({ params, searchParams }: PageProps<"/app/[org]/sites/[site]/settings">) {
  const { org: orgSlug, site: siteId } = await params;
  const sp = await searchParams;
  const { website, role } = await requireWebsite(orgSlug, siteId);
  const supabase = await createClient();
  const { data: settings } = await supabase.from("website_settings").select("*").eq("website_id", website.id).maybeSingle();
  const canEdit = roleAtLeast(role, "member") && !website.is_demo;
  const canDelete = roleAtLeast(role, "admin");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Site settings" description={`${website.name} · ${website.domain}`} />

      {!canEdit && (
        <FormMessage tone="info">
          {website.is_demo ? "The demo project is read-only." : "You have view-only access to this website."}
        </FormMessage>
      )}

      <Card>
        <CardHeader title="Website details" description="Name, start URL, market and canonical host." />
        <CardBody>
          <fieldset disabled={!canEdit}>
            <WebsiteForm
              action={updateWebsiteAction}
              orgSlug={orgSlug}
              siteId={website.id}
              submitLabel="Save changes"
              lockUrlHost
              defaults={{
                name: website.name,
                url: website.base_url,
                countryCode: website.country_code,
                languageCode: website.language_code,
                preferredDomain: website.preferred_domain,
              }}
            />
          </fieldset>
        </CardBody>
      </Card>

      {settings && (
        <Card>
          <CardHeader title="Crawl configuration" description="Limits and behaviour of the site crawler for this website." />
          <CardBody>
            <fieldset disabled={!canEdit}>
              <CrawlSettingsForm
                orgSlug={orgSlug}
                siteId={website.id}
                defaults={{
                  maxPages: settings.max_pages,
                  maxDepth: settings.max_depth,
                  crawlDelayMs: settings.crawl_delay_ms,
                  respectRobotsTxt: settings.respect_robots_txt,
                  checkExternalLinks: settings.check_external_links,
                  pagespeedEnabled: settings.pagespeed_enabled,
                  crawlSchedule: settings.crawl_schedule,
                  excludePatterns: settings.exclude_patterns.join("\n"),
                }}
              />
            </fieldset>
          </CardBody>
        </Card>
      )}

      {canDelete && !website.is_demo && (
        <Card className="border-critical/30">
          <CardHeader title="Delete website" description="Permanently removes the website and all of its audits, keywords, integrations and reports." />
          <CardBody>
            {sp.error === "confirm" && (
              <div className="mb-4">
                <FormMessage>The domain you typed did not match.</FormMessage>
              </div>
            )}
            {sp.error === "delete" && (
              <div className="mb-4">
                <FormMessage>The website could not be deleted. Please try again.</FormMessage>
              </div>
            )}
            <form action={deleteWebsiteAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="siteId" value={website.id} />
              <Field label={<>Type <strong>{website.domain}</strong> to confirm</>} htmlFor="confirmDomain" className="flex-1">
                <Input id="confirmDomain" name="confirmDomain" autoComplete="off" required />
              </Field>
              <Button type="submit" variant="danger">
                Delete website
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
