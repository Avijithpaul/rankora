import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWebsite } from "@/lib/auth/dal";
import { MODULE_BY_SLUG } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PlannedModule } from "@/components/ui/states";

/**
 * Catch-all for site modules that are not built yet. Implemented modules get
 * their own static route folder, which takes precedence over this one.
 */
export async function generateMetadata({ params }: PageProps<"/app/[org]/sites/[site]/[module]">): Promise<Metadata> {
  const { module } = await params;
  return { title: MODULE_BY_SLUG.get(module)?.label ?? "Not found" };
}

export default async function PlannedModulePage({ params }: PageProps<"/app/[org]/sites/[site]/[module]">) {
  const { org, site, module } = await params;
  const mod = MODULE_BY_SLUG.get(module);
  if (!mod || mod.status !== "planned") notFound();
  const { website } = await requireWebsite(org, site);
  return (
    <>
      <PageHeader title={mod.label} description={`${website.name} · ${website.domain}`} />
      <PlannedModule title={mod.label} phase={mod.phase ?? "Roadmap"}>
        <p>{mod.summary}</p>
        <p className="mt-2">
          The database tables and access policies for this module already exist; the UI and data pipeline ship in{" "}
          {mod.phase}. No placeholder numbers are shown in the meantime.
        </p>
      </PlannedModule>
    </>
  );
}
