import type { Metadata } from "next";
import { getEnabledProviders, oauthErrorMessage } from "@/lib/auth/oauth";
import { FormMessage } from "@/components/ui/form";
import { RegisterForm } from "../auth-forms";
import { OAuthButtons } from "../oauth-buttons";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const sp = await searchParams;
  const error = oauthErrorMessage(typeof sp.error === "string" ? sp.error : null);
  const providers = await getEnabledProviders();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mb-8 mt-1 text-sm text-muted">Start auditing your first website in minutes. No card required.</p>
      {error && (
        <div className="mb-4">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
      <OAuthButtons enabled={providers} from="register" next="/onboarding" />
      <RegisterForm />
      <p className="mt-6 text-center text-xs text-muted">
        By continuing with Google or GitHub, Rankora receives your name, email address and profile picture from that account.
      </p>
    </>
  );
}
