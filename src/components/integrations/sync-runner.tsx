"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type Tick = { status: "running" | "done" | "error" | "busy" | "waiting"; step: number; steps: number; message: string | null };

/**
 * Drives a Google sync while the page is open by calling the server one batch
 * at a time. Data is fetched and stored on the server; no tokens or Google
 * responses pass through the browser.
 */
export function SyncRunner({ integrationId, label }: { integrationId: string; label: string }) {
  const router = useRouter();
  const [t, setT] = useState<Tick>({ status: "running", step: 0, steps: 0, message: null });
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    (async () => {
      for (let i = 0; i < 200 && !stop.current; i++) {
        try {
          const res = await fetch(`/api/integrations/${integrationId}/sync`, { method: "POST", cache: "no-store" });
          const body = (await res.json()) as Tick & { error?: string };
          if (!res.ok && res.status !== 429) {
            setT({ status: "error", step: 0, steps: 0, message: body.error ?? `HTTP ${res.status}` });
            break;
          }
          setT(body);
          if (body.status === "done" || body.status === "error") break;
          await new Promise((r) => setTimeout(r, body.status === "waiting" || res.status === 429 ? 20_000 : body.status === "busy" ? 5_000 : 300));
        } catch {
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
      router.refresh();
    })();
    return () => {
      stop.current = true;
    };
  }, [integrationId, router]);

  if (t.status === "done") return <p className="text-sm text-success">{label}: sync complete.</p>;
  if (t.status === "error") return <p className="text-sm text-critical">{label}: {t.message}</p>;
  const pct = t.steps ? Math.round((t.step / t.steps) * 100) : 5;
  return (
    <div aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
        {t.status === "waiting" ? (t.message ?? "Waiting for Google rate limit…") : `Importing ${label} data from Google… ${t.steps ? `${t.step}/${t.steps}` : ""}`}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
