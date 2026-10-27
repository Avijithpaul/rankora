import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Member {
  id: string;
  name: string;
  role: string;
}

/** Organization members with display names (RLS: only for members of that organization). */
export async function listMembers(orgId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data: members } = await supabase.from("organization_members").select("user_id, role").eq("organization_id", orgId).order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string | null }[] };
  return (members ?? []).map((m) => ({ id: m.user_id, role: m.role, name: profiles?.find((p) => p.id === m.user_id)?.full_name || "Unnamed user" }));
}
