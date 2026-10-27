import { NextResponse } from "next/server";
import { authorizeIntegration } from "@/lib/google/integration-access";
import { runSyncTick, STEPS } from "@/lib/google/sync";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** GET: sync status (RLS-scoped). */
export async function GET(_req: Request, ctx: RouteContext<"/api/integrations/[id]/sync">) {
  const { id } = await ctx.params;
  const access = await authorizeIntegration(id, "viewer");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const supabase = await createClient();
  const { data } = await supabase.from("integrations").select("status, sync_state, last_synced_at, last_error").eq("id", id).single();
  return NextResponse.json({ ...data, steps: STEPS[access.integration.provider as keyof typeof STEPS]?.length ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

/** POST: run one time-boxed sync batch for this integration. */
export async function POST(_req: Request, ctx: RouteContext<"/api/integrations/[id]/sync">) {
  const { id } = await ctx.params;
  const access = await authorizeIntegration(id, "member");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "google.sync", p_limit: 120, p_window_seconds: 3600 });
  if (!allowed) return NextResponse.json({ status: "waiting", message: "Too many sync requests. Please wait a few minutes." }, { status: 429 });
  const result = await runSyncTick(id, 40_000);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
