"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signInWithProvider } from "./actions";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.21 7.21 0 0 1 4.9 12c0-.8.14-1.57.37-2.29v-3.1H1.27a12 12 0 0 0 0 10.78l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57v-2.03c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .32.21.7.82.58A12 12 0 0 0 12 .3" />
    </svg>
  );
}

function ProviderButton({ provider, label, enabled, icon }: { provider: string; label: string; enabled: boolean; icon: React.ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("provider") === provider;
  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      disabled={!enabled || pending}
      title={enabled ? undefined : `${label} sign-in is not enabled for this project yet`}
      className={cn(buttonClasses({ variant: "secondary" }), "w-full")}
    >
      {mine ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {label}
      {!enabled && <span className="text-xs font-normal text-muted">(not enabled)</span>}
    </button>
  );
}

/** "Continue with Google / GitHub" for both sign-in and sign-up. */
export function OAuthButtons({
  enabled,
  from,
  next,
}: {
  enabled: { google: boolean; github: boolean };
  from: "login" | "register";
  next?: string;
}) {
  return (
    <div>
      <form action={signInWithProvider} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="from" value={from} />
        {next && <input type="hidden" name="next" value={next} />}
        <ProviderButton provider="google" label="Google" enabled={enabled.google} icon={<GoogleIcon />} />
        <ProviderButton provider="github" label="GitHub" enabled={enabled.github} icon={<GitHubIcon />} />
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-muted" role="separator">
        <span className="h-px flex-1 bg-line" />
        or {from === "register" ? "sign up" : "sign in"} with email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
