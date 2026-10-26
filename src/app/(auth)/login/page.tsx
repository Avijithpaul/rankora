import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/env";
import { FormMessage } from "@/components/ui/form";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null) ?? undefined;
  const notice = sp.error === "confirmation_failed" ? "That confirmation link is invalid or has expired." : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Sign in to your Rankora workspace.</p>
      {!isSupabaseConfigured() && (
        <div className="mb-4">
          <FormMessage tone="info">
            Supabase is not configured yet. Copy <code>.env.example</code> to <code>.env.local</code> and add your project keys.
          </FormMessage>
        </div>
      )}
      <LoginForm next={next} notice={notice} />
    </>
  );
}
