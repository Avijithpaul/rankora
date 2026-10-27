"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Marks one or all of the user's notifications read (RLS: only their own rows, only read_at). */
export async function markNotificationsReadAction(formData: FormData) {
  const { org, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if (/^[0-9a-f-]{36}$/i.test(id)) q = q.eq("id", id);
  await q;
  revalidatePath(`/app/${org.slug}`, "layout");
  const go = String(formData.get("go") ?? "");
  // only follow links that point into this organization
  redirect(go.startsWith(`/app/${org.slug}/`) && !/[\r\n]|\/\//.test(go.slice(1)) ? go : `/app/${org.slug}/notifications`);
}
