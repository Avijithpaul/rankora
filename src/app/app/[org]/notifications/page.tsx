import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireOrg } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsReadAction } from "@/lib/actions/notifications";
import { cn, formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/content/submit-button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ params }: PageProps<"/app/[org]/notifications">) {
  const { org: slug } = await params;
  const { org, user } = await requireOrg(slug);
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .or(`organization_id.eq.${org.id},organization_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(100);
  const unread = (items ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${unread} unread in ${org.name}`}
        actions={
          unread > 0 && (
            <form action={markNotificationsReadAction}>
              <input type="hidden" name="orgSlug" value={org.slug} />
              <SubmitButton size="sm" variant="secondary">
                Mark all read
              </SubmitButton>
            </form>
          )
        }
      />
      <Card>
        {!items?.length ? (
          <EmptyState icon={Bell} title="No notifications" description="Task assignments, finished audits, usage alerts, plan changes and team changes appear here." className="py-10" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3 text-sm", !n.read_at && "bg-brand-soft/30")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} aria-label={n.read_at ? undefined : "Unread"} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{n.title}</p>
                  {n.body && <p className="text-ink-2">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">{formatDate(n.created_at, { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                {(n.link || !n.read_at) && (
                  <form action={markNotificationsReadAction}>
                    <input type="hidden" name="orgSlug" value={org.slug} />
                    <input type="hidden" name="id" value={n.id} />
                    {n.link && <input type="hidden" name="go" value={n.link} />}
                    <SubmitButton size="sm" variant="ghost">
                      {n.link ? "Open" : "Mark read"}
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
