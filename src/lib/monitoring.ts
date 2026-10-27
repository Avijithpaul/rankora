import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfig } from "@/lib/env";
import type { Json } from "@/lib/supabase/database.types";

const SECRET_KEYS = /token|secret|password|authorization|cookie|api[_-]?key/i;

/** Removes values whose key looks secret, so logs never store credentials. */
export function redact(value: unknown, depth = 0): Json {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  }
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return String(value).slice(0, 200);
}

/**
 * Server-side error/event log for platform monitoring (system_events, service role only).
 * Never throws.
 */
export async function logEvent(level: "info" | "warn" | "error", source: string, message: string, context: Record<string, unknown> = {}) {
  if (level === "error") console.error(`[${source}] ${message}`, context);
  if (!providerConfig().serviceRoleConfigured) return;
  try {
    await createAdminClient()
      .from("system_events")
      .insert({ level, source: source.slice(0, 80), message: message.slice(0, 4000), context: redact(context) });
  } catch (err) {
    console.error("[monitoring] could not record event", err);
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
