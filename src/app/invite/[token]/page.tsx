import type { Metadata } from "next";
import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { providerConfig } from "@/lib/env";
import { findInvitation } from "@/lib/team/invitations";
import { acceptInvitationAction } from "@/lib/actions/team";
import { Logo } from "@/components/brand/logo";
import { SubmitButton } from "@/components/content/submit-button";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getUser();
  const inv = providerConfig().serviceRoleConfigured ? await findInvitation(token) : null;
  const next = encodeURIComponent(`/invite/${token}`);

  let body: React.ReactNode;
  if (!inv || inv.state === "revoked") {
    body = <FormMessage>This invitation link is not valid. Ask the person who invited you for a new one.</FormMessage>;
  } else if (inv.state === "expired") {
    body = <FormMessage>This invitation has expired. Ask for a new one.</FormMessage>;
  } else if (inv.state === "accepted") {
    body = (
      <>
        <FormMessage tone="info">This invitation has already been used.</FormMessage>
        <ButtonLink href="/app">Go to Rankora</ButtonLink>
      </>
    );
  } else {
    // details are only shown to the invited, signed-in address
    const matches = user?.email?.toLowerCase() === inv.email;
    body = (
      <>
        <p className="text-sm text-ink-2">
          You have been invited to join <strong>{matches ? inv.orgName : "an organization"}</strong> on Rankora{matches ? ` as ${inv.role}` : ""}.
        </p>
        {typeof sp.error === "string" && <FormMessage>{sp.error.slice(0, 200)}</FormMessage>}
        {!user ? (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/login?next=${next}`}>Sign in to accept</ButtonLink>
            <ButtonLink href="/register" variant="secondary">
              Create an account
            </ButtonLink>
            <p className="w-full text-xs text-muted">New here? Register with the invited email address, confirm it, then open this link again.</p>
          </div>
        ) : matches ? (
          <form action={acceptInvitationAction}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton>Accept invitation</SubmitButton>
          </form>
        ) : (
          <FormMessage>
            You are signed in as {user.email}, but this invitation was sent to a different address. Sign out and sign in with the invited email.
          </FormMessage>
        )}
      </>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo href="/" />
        </div>
        <Card>
          <CardBody className="space-y-4">
            <h1 className="text-lg font-semibold">Team invitation</h1>
            {body}
          </CardBody>
        </Card>
        <p className="text-center text-xs text-muted">
          <Link href="/" className="hover:text-ink">
            rankora
          </Link>
        </p>
      </div>
    </div>
  );
}
