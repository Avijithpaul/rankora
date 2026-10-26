import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/dal";
import { createWebsiteAction } from "@/lib/actions/workspace";
import { WebsiteForm } from "@/components/forms/website-form";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Add website" };

export default async function NewWebsitePage({ params }: PageProps<"/app/[org]/websites/new">) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug, "member");
  if (org.is_demo) redirect(`/app/${slug}/websites`);
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add a website" description={`The site will be added to ${org.name}.`} />
      <Card>
        <CardBody>
          <WebsiteForm action={createWebsiteAction} orgSlug={org.slug} />
        </CardBody>
      </Card>
    </div>
  );
}
