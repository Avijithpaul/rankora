import { redirect } from "next/navigation";
import { listMemberships, requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Entry point after login: pick the last-used (or first) organization. */
export default async function AppIndex() {
  const user = await requireUser("/app");
  const memberships = await listMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("last_organization_id").eq("id", user.id).maybeSingle();
  const preferred = memberships.find((m) => m.org.id === profile?.last_organization_id) ?? memberships[0];
  redirect(`/app/${preferred.org.slug}`);
}
