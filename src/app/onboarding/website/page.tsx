import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/dal";
import { createWebsiteAction } from "@/lib/actions/workspace";
import { WebsiteForm } from "@/components/forms/website-form";
import { OnboardingSteps } from "../steps";

export const metadata: Metadata = { title: "Add your website" };

export default async function OnboardingWebsitePage({ searchParams }: PageProps<"/onboarding/website">) {
  const sp = await searchParams;
  const slug = typeof sp.org === "string" ? sp.org : "";
  if (!slug) redirect("/onboarding");
  const { org } = await requireOrg(slug, "member");
  return (
    <>
      <OnboardingSteps current={1} />
      <h1 className="text-2xl font-semibold tracking-tight">Add your first website</h1>
      <p className="mb-8 mt-1 text-sm text-muted">
        We&apos;ll use the country and language to localise rankings and keyword data for <strong>{org.name}</strong>.
      </p>
      <WebsiteForm action={createWebsiteAction} orgSlug={org.slug} onboarding submitLabel="Add website" />
    </>
  );
}
