import { PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** Shown wherever provider data would appear but no provider is configured. */
export function ProviderNotConnected({ what, compact = false }: { what: string; compact?: boolean }) {
  if (compact) {
    return (
      <Badge tone="warning" title="Configure DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on the server">
        Provider Not Connected
      </Badge>
    );
  }
  return (
    <Card className="border-warning/30 p-5">
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
          <PlugZap className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">Provider Not Connected</p>
            <Badge tone="warning">No live data</Badge>
          </div>
          <p className="mt-1 text-muted">
            {what} requires an SEO data provider. Rankora never estimates or invents search volumes, difficulty, CPC or Google
            positions, so these fields stay empty until a provider is connected.
          </p>
          <p className="mt-2 text-muted">
            To connect DataForSEO, set <code className="rounded bg-surface-2 px-1">DATAFORSEO_LOGIN</code> and{" "}
            <code className="rounded bg-surface-2 px-1">DATAFORSEO_PASSWORD</code> in the server environment and restart the app.
            You can still save keywords, organize them into groups, and import or export CSV files.
          </p>
        </div>
      </div>
    </Card>
  );
}
