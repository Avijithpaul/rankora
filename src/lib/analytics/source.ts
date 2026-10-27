import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type SourceState =
  | { kind: "demo" }
  | { kind: "not_connected" }
  | { kind: "pending"; integration: Tables<"integrations"> }
  | { kind: "error"; integration: Tables<"integrations"> }
  | { kind: "syncing"; integration: Tables<"integrations"> }
  | { kind: "ready"; integration: Tables<"integrations"> };

/** Where the numbers on an analytics page come from — drives honest empty/error states. */
export async function sourceState(website: Tables<"websites">, provider: "google_search_console" | "google_analytics_4"): Promise<SourceState> {
  if (website.is_demo) return { kind: "demo" };
  const supabase = await createClient();
  const { data: integration } = await supabase.from("integrations").select("*").eq("website_id", website.id).eq("provider", provider).maybeSingle();
  if (!integration || integration.status === "disconnected" || !integration.oauth_connection_id) return { kind: "not_connected" };
  if (integration.status === "error") return { kind: "error", integration };
  if (!integration.external_account_id || integration.status === "pending") return { kind: "pending", integration };
  if (!integration.last_synced_at) return { kind: "syncing", integration };
  return { kind: "ready", integration };
}
