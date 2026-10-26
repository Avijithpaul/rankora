"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Runs due rank checks in batches through POST /api/sites/[id]/rank-check
 * until nothing is due, then refreshes the page. Each batch calls the
 * connected provider on the server; nothing is computed in the browser.
 */
export function RankCheckRunner({ siteId, due }: { siteId: string; due: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState(0);
  const [remaining, setRemaining] = useState(due);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    let left = remaining;
    try {
      for (let i = 0; i < 100 && left > 0; i++) {
        const res = await fetch(`/api/sites/${siteId}/rank-check`, { method: "POST", cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setChecked((c) => c + body.checked);
        left = body.remaining;
        setRemaining(left);
        if (body.checked === 0) {
          if (body.errors?.length) throw new Error(body.errors[0]);
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={run} loading={running} disabled={remaining === 0 || running} variant={remaining === 0 ? "secondary" : "primary"}>
        <RefreshCw aria-hidden /> {remaining === 0 ? "All keywords checked today" : `Check ${remaining} keyword${remaining === 1 ? "" : "s"} now`}
      </Button>
      {running && <span className="tabular text-sm text-muted">{checked} checked…</span>}
      {error && <span className="text-sm text-critical">{error}</span>}
    </div>
  );
}
