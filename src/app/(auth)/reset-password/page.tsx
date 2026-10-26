import type { Metadata } from "next";
import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { FormMessage } from "@/components/ui/form";
import { NewPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the recovery email via /auth/callback, which establishes a short-lived session. */
export default async function ResetPasswordPage() {
  const user = await getUser();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Choose a new password</h1>
      {user ? (
        <>
          <p className="mb-8 mt-1 text-sm text-muted">Setting a new password for {user.email ?? "your account"}.</p>
          <NewPasswordForm afterSuccessHref="/app" />
        </>
      ) : (
        <div className="mt-6 space-y-4">
          <FormMessage>This reset link is invalid or has expired.</FormMessage>
          <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
            Request a new link →
          </Link>
        </div>
      )}
    </>
  );
}
