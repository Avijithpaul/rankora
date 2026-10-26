import type { Metadata } from "next";
import { listMemberships, requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "@/app/(auth)/auth-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Account settings" };

export default async function AccountPage({ params }: PageProps<"/app/[org]/account">) {
  const { org: slug } = await params;
  const { user } = await requireOrg(slug);
  const supabase = await createClient();
  const [{ data: profile }, memberships] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    listMemberships(),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Account settings" description="Your personal profile and sign-in security." />
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <ProfileForm fullName={profile?.full_name ?? ""} email={user.email} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" description="You stay signed in on this device after changing it." />
        <CardBody>
          <NewPasswordForm submitLabel="Change password" />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Your organizations" />
        <ul className="divide-y divide-line">
          {memberships.map((m) => (
            <li key={m.org.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <span className="font-medium text-ink">
                {m.org.name} {m.org.is_demo && <Badge tone="demo">Demo</Badge>}
              </span>
              <Badge className="capitalize">{m.role}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
