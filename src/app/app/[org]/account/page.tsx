import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, Clock, KeyRound, LogOut, Mail } from "lucide-react";
import { getAccountDetails, listMemberships, requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { NewPasswordForm } from "@/app/(auth)/auth-forms";
import { Avatar } from "@/components/app/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { displayName, providerLabel, type AuthProvider } from "@/lib/profile";
import { formatDate } from "@/lib/utils";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

const PROVIDER_ICON: Record<AuthProvider, string> = { google: "G", github: "GH", email: "@" };

export default async function AccountPage({ params }: PageProps<"/app/[org]/account">) {
  const { org: slug } = await params;
  const { user, org, role } = await requireOrg(slug);
  const supabase = await createClient();
  const [{ data: profile }, memberships, details] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url, created_at").eq("id", user.id).maybeSingle(),
    listMemberships(),
    getAccountDetails(),
  ]);

  const name = displayName(profile?.full_name, user.email);
  const identities = details?.identities.length ? details.identities : [{ provider: user.provider, email: user.email }];
  const hasPassword = identities.some((i) => i.provider === "email");
  const photoSource = identities.find((i) => i.provider !== "email")?.provider;

  return (
    <div className="max-w-4xl space-y-6">
      {/* profile header */}
      <Card className="overflow-hidden">
        <div className="relative h-28 bg-[radial-gradient(120%_140%_at_0%_0%,var(--glow),transparent_60%),linear-gradient(120deg,color-mix(in_srgb,var(--brand)_35%,var(--surface)),var(--surface)_70%)] sm:h-32">
          <div className="hero-glow absolute inset-0 opacity-60" aria-hidden />
        </div>
        <div className="relative px-5 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <Avatar name={name} src={profile?.avatar_url} size={96} className="ring-4 ring-surface" />
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-2xl font-bold tracking-tight text-ink">{name}</h1>
                {user.email && (
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted">
                    <Mail className="size-3.5 shrink-0" aria-hidden /> {user.email}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pb-1">
              <Badge tone="success">
                <CheckCircle2 className="size-3" aria-hidden /> Signed in with {providerLabel(user.provider)}
              </Badge>
              <Badge className="capitalize">
                {role} · {org.name}
              </Badge>
            </div>
          </div>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <CalendarDays className="size-3.5" aria-hidden /> Member since
              </dt>
              <dd className="mt-1 font-medium text-ink">{formatDate(details?.createdAt ?? profile?.created_at)}</dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Clock className="size-3.5" aria-hidden /> Last sign-in
              </dt>
              <dd className="mt-1 font-medium text-ink">
                {details?.lastSignInAt ? formatDate(details.lastSignInAt, { hour: "2-digit", minute: "2-digit" }) : "—"}
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <KeyRound className="size-3.5" aria-hidden /> Organizations
              </dt>
              <dd className="mt-1 font-medium text-ink">{memberships.length}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Personal details" description="Your name is shown to teammates in tasks, invitations and the activity log." />
          <CardBody>
            <ProfileForm fullName={profile?.full_name ?? ""} email={user.email} />
            <p className="mt-4 text-xs text-muted">
              {photoSource
                ? `Your photo comes from your ${providerLabel(photoSource)} account and updates when you sign in again.`
                : "Sign in with Google or GitHub to use that account's photo; otherwise your initials are shown."}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sign-in methods" description="The accounts that can sign in to this Rankora profile." />
          <ul className="divide-y divide-line">
            {identities.map((i) => (
              <li key={`${i.provider}-${i.email}`} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand">{PROVIDER_ICON[i.provider]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{providerLabel(i.provider)}</p>
                  <p className="truncate text-xs text-muted">{i.email ?? user.email ?? "—"}</p>
                </div>
                {i.provider === user.provider && <Badge tone="success">This session</Badge>}
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-line">
            <form action={signOut}>
              <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-critical transition-colors hover:bg-critical/10">
                <LogOut className="size-4" aria-hidden /> Sign out of this device
              </button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={hasPassword ? "Change password" : "Password"}
          description={hasPassword ? "You stay signed in on this device after changing it." : `You sign in with ${providerLabel(user.provider)}, so no password is needed. You can set one to also sign in with your email.`}
        />
        <CardBody>
          <NewPasswordForm submitLabel={hasPassword ? "Change password" : "Set password"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your organizations" description="Workspaces you belong to and your role in each." />
        <ul className="divide-y divide-line">
          {memberships.map((m) => (
            <li key={m.org.id}>
              <Link href={`/app/${m.org.slug}`} className="group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold text-ink-2">{m.org.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {m.org.name} {m.org.is_demo && <Badge tone="demo">Demo</Badge>}
                  {m.org.id === org.id && <span className="ml-2 text-xs font-normal text-muted">current</span>}
                </span>
                <Badge className="capitalize">{m.role}</Badge>
                <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
