import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES RLS — use only in server code after an explicit
 * authorization check (e.g. writing crawl results for a job the user owns,
 * storing encrypted OAuth tokens, admin aggregates). Never import from client code.
 */
export function createAdminClient() {
  const env = publicEnv();
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !secret) throw new Error("Supabase service credentials are not configured");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
