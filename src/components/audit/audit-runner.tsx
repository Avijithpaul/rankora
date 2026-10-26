"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { JobStatus } from "@/lib/audit/service";

type Status = JobStatus;

const PHASE_LABEL: Record<string, string> = {
  discovery: "Reading robots.txt and sitemaps",
  crawling: "Crawling pages",
  link_check: "Checking external links",
  pagespeed: "Measuring Core Web Vitals",
  analyzing: "Analyzing pages and calculating the score",
  done: "Finished",
};

/**
 * Drives a crawl while the page is open: each POST /tick runs one time-boxed
 * batch on the server and returns the new status. Stops on completion/failure.
 */
export function AuditRunner({ jobId, initial }: { jobId: string; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);
  const [netError, setNetError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let failures = 0;
    async function loop() {
      while (!stopped.current) {
        try {
          const res = await fetch(`/api/crawl-jobs/${jobId}/tick`, { method: "POST", cache: "no-store" });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          failures = 0;
          setNetError(null);
          setS(body);
          if (body.status === "completed" || body.status === "failed" || body.status === "cancelled") {
            router.refresh();
            return;
          }
        } catch (e) {
          failures++;
          setNetError((e as Error).message);
          if (failures >= 5) return;
          await new Promise((r) => setTimeout(r, 3000 * failures));
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    void loop();
    return () => {
      stopped.current = true;
    };
  }, [jobId, router]);

  const total = Math.max(s.maxPages || 0, s.pagesDiscovered || 0, 1);
  const pct = s.phase === "done" ? 100 : Math.min(95, Math.round((s.pagesCrawled / total) * 85) + (s.phase === "analyzing" ? 10 : 0));

  if (s.status === "failed") {
    return (
      <Card className="border-critical/30 p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-critical" aria-hidden />
          <div>
            <p className="font-medium text-ink">The audit failed</p>
            <p className="mt-1 text-sm text-muted">{s.error ?? "Unknown error"}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Audit in progress · {PHASE_LABEL[s.phase] ?? s.phase}</p>
          <p className="tabular mt-0.5 text-sm text-muted">
            {s.pagesCrawled} of up to {s.maxPages || "?"} pages crawled · {s.pagesDiscovered} URLs discovered
          </p>
        </div>
        <span className="tabular text-sm font-medium text-ink">{pct}%</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Keep this page open for the fastest result. If you leave, the background worker continues the crawl when it is configured.
      </p>
      {netError && <p className="mt-2 text-xs text-warning">Connection problem: {netError}. Retrying…</p>}
    </Card>
  );
}
