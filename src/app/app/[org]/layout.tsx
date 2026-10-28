import Link from "next/link";
import { Bell, FlaskConical } from "lucide-react";
import { listMemberships, listWebsites, requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app/sidebar";
import { SiteSwitcher } from "@/components/app/site-switcher";
import { UserMenu } from "@/components/app/user-menu";
import { displayName } from "@/lib/profile";

export default async function OrgLayout({ children, params }: LayoutProps<"/app/[org]">) {
  const { org: slug } = await params;
  const { org, user, role } = await requireOrg(slug);
  const supabase = await createClient();
  const [memberships, sites, { data: admin }, { data: profile }, { count: unread }] = await Promise.all([
    listMemberships(),
    listWebsites(org.id),
    supabase.from("platform_admins").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("full_name, avatar_url, last_organization_id").eq("id", user.id).maybeSingle(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);

  // Remember the last organization used (best-effort).
  if (profile && profile.last_organization_id !== org.id) {
    await supabase.from("profiles").update({ last_organization_id: org.id }).eq("id", user.id);
  }

  return (
    <div className="min-h-dvh">
      <div className="print:hidden">
      <AppSidebar
        orgSlug={org.slug}
        orgName={org.name}
        orgs={memberships.map((m) => ({ slug: m.org.slug, name: m.org.is_demo ? `${m.org.name} (Demo)` : m.org.name }))}
        sites={sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, is_demo: s.is_demo }))}
        isPlatformAdmin={Boolean(admin)}
        hasDemo={memberships.some((m) => m.org.is_demo)}
        planId={org.plan_id}
        isDemoOrg={org.is_demo}
      />
      </div>
      <div className="app-backdrop min-h-dvh lg:pl-64 print:bg-none print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-3 border-b border-line/70 bg-canvas/70 pl-16 pr-4 backdrop-blur-xl sm:pr-6 lg:pl-8">
          <SiteSwitcher
            orgSlug={org.slug}
            canAdd={!org.is_demo}
            sites={sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, is_demo: s.is_demo }))}
          />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/app/${org.slug}/notifications`}
              className="relative grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Bell className="size-5" aria-hidden />
              {unread ? (
                <span className="animate-pop absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
              ) : null}
            </Link>
            <UserMenu
              orgSlug={org.slug}
              orgName={org.name}
              name={displayName(profile?.full_name, user.email)}
              email={user.email}
              avatarUrl={profile?.avatar_url ?? null}
              provider={user.provider}
              role={role}
            />
          </div>
        </header>
        {org.is_demo && (
          <div role="note" className="flex items-center gap-2 border-b border-demo/20 bg-demo-soft px-4 py-2 text-sm text-demo sm:px-6 lg:px-8">
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            <span>
              <strong>Demo Project.</strong> Every number in this workspace is sample <strong>Demo Data</strong> for
              presentations — not live analytics, rankings or audit results.
            </span>
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}
