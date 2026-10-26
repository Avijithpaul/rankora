import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Request-scoped Supabase client acting as the signed-in user.
 * All queries are subject to RLS.
 */
export async function createClient() {
  // Read cookies first: this marks the route as dynamic even when env is missing.
  const cookieStore = await cookies();
  const env = publicEnv();
  if (!env) throw new Error("Supabase is not configured. Copy .env.example to .env.local.");
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
