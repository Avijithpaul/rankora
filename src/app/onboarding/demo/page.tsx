import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { listMemberships, requireUser } from "@/lib/auth/dal";
import { createDemoProjectAction } from "@/lib/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";

export const metadata: Metadata = { title: "Demo Project" };

export default async function DemoProjectPage({ searchParams }: PageProps<"/onboarding/demo">) {
  await requireUser("/onboarding/demo");
  const sp = await searchParams;
  const existing = (await listMemberships()).find((m) => m.org.is_demo);
  if (existing) redirect(`/app/${existing.org.slug}`);

  return (
    <>
      <div className="mb-6 grid size-11 place-items-center rounded-xl bg-demo-soft text-demo">
        <FlaskConical className="size-5" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Open the Demo Project</h1>
      <p className="mt-1 text-sm text-muted">
        A separate, read-only workspace filled with sample data so you can explore or present Rankora before connecting a real site.
      </p>
      {sp.error && (
        <div className="mt-6">
          <FormMessage>The Demo Project could not be created. Please try again.</FormMessage>
        </div>
      )}
      <Card className="mt-8">
        <CardBody className="space-y-3 text-sm text-ink-2">
          <p className="flex items-center gap-2 font-medium text-ink">
            What&apos;s inside <Badge tone="demo">Demo Data</Badge>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A fictional store on a reserved <code>.example</code> domain</li>
            <li>A site audit whose score is calculated by the real scoring engine from sample checks</li>
            <li>90 days of sample Search Console and organic traffic figures</li>
            <li>10 tracked keywords with 30 days of sample rank history</li>
          </ul>
          <p className="text-xs text-muted">
            None of it is live analytics. Every screen in the Demo Project shows a Demo Data label, and you can remove the project at any time.
          </p>
        </CardBody>
      </Card>
      <form action={createDemoProjectAction} className="mt-8">
        <Button type="submit">Create Demo Project</Button>
      </form>
    </>
  );
}
