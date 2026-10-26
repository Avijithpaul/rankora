import { redirect } from "next/navigation";
import { listWebsites, requireOrg } from "@/lib/auth/dal";

export default async function OrgIndex({ params }: PageProps<"/app/[org]">) {
  const { org: slug } = await params;
  const { org } = await requireOrg(slug);
  const sites = await listWebsites(org.id);
  redirect(sites[0] ? `/app/${slug}/sites/${sites[0].id}/dashboard` : `/app/${slug}/websites/new`);
}
