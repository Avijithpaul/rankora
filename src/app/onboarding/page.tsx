import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { listMemberships, requireUser } from "@/lib/auth/dal";
import { OnboardingSteps } from "./steps";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser("/onboarding");
  const sp = await searchParams;
  const memberships = await listMemberships();
  // Users with a real organization go straight to their workspace unless creating another one.
  if (memberships.some((m) => !m.org.is_demo) && sp.new !== "1") redirect("/app");
  const hasDemo = memberships.some((m) => m.org.is_demo);
  return (
    <>
      <OnboardingSteps current={0} />
      <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
      <p className="mb-8 mt-1 text-sm text-muted">
        Organizations hold your websites, team members, integrations and billing. You can create more later.
      </p>
      <OrganizationForm />
      <div className="mt-10 flex items-start gap-3 rounded-xl border border-demo/20 bg-demo-soft p-4 text-sm">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-demo" aria-hidden />
        <div>
          <p className="font-medium text-ink">Just exploring or presenting?</p>
          <p className="mt-0.5 text-muted">
            {hasDemo ? "Your Demo Project is ready. " : "Open a separate Demo Project filled with clearly labelled sample data. "}
            <Link href={hasDemo ? "/app" : "/onboarding/demo"} className="font-medium text-demo hover:underline">
              {hasDemo ? "Go to Demo Project →" : "Open Demo Project →"}
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
