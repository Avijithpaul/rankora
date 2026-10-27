import { GoogleApiError, toGoogleError } from "./errors";

/** Authorized JSON request to a Google API with timeout and error mapping. */
export async function googleJson<T>(
  url: string,
  accessToken: string,
  opts: { method?: "GET" | "POST"; body?: unknown; api: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${accessToken}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new GoogleApiError(`${opts.api}: ${(e as Error).message}`, "network");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw toGoogleError(res.status, json, opts.api);
  return json as T;
}
