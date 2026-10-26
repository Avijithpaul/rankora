import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { deleteDemoProjectAction } from "@/lib/actions/workspace";
import { RenameOrgForm } from "./rename-form";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrgSettingsPage({ params, searchParams }: PageProps<"/app/[org]/settings">) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org, role } = await requireOrg(slug);
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", org.id)
    .order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name ?? "Unnamed user";

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Organization" description="Workspace details and team members." />
      <Card>
        <CardHeader title="General" />
        <CardBody>
          <RenameOrgForm orgSlug={org.slug} name={org.name} disabled={!roleAtLeast(role, "admin")} />
          <p className="mt-4 text-xs text-muted">
            Workspace URL: <code>/app/{org.slug}</code> (cannot be changed)
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Members" description="Invitations are planned for a later phase." />
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <div>
                <p className="font-medium text-ink">{nameOf(m.user_id)}</p>
                <p className="text-xs text-muted">Joined {formatDate(m.created_at)}</p>
              </div>
              <Badge className="capitalize" tone={m.role === "owner" ? "brand" : "neutral"}>
                {m.role}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
      {org.is_demo && roleAtLeast(role, "owner") && (
        <Card className="border-demo/30">
          <CardHeader title="Remove Demo Project" description="Deletes this demo workspace and all of its sample data. You can create it again later." />
          <CardBody>
            {sp.error === "delete" && (
              <div className="mb-4">
                <FormMessage>The Demo Project could not be removed. Please try again.</FormMessage>
              </div>
            )}
            <form action={deleteDemoProjectAction}>
              <input type="hidden" name="orgSlug" value={org.slug} />
              <Button type="submit" variant="secondary">
                Remove Demo Project
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
