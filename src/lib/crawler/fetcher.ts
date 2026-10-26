import "server-only";
import { DEFAULT_USER_AGENT, safeFetch } from "@/lib/security/safe-fetch";
import { UnsafeUrlError } from "@/lib/security/url-safety";
import type { Fetcher } from "./types";

/**
 * Production fetcher: every request goes through safeFetch (SSRF validation on
 * every hop, connect-time DNS check, timeouts, size cap).
 */
export function createSafeFetcher(userAgent = DEFAULT_USER_AGENT): Fetcher {
  return async (url, opts = {}) => {
    try {
      const r = await safeFetch(url, {
        method: opts.method ?? "GET",
        timeoutMs: opts.timeoutMs ?? 15_000,
        maxBytes: 3 * 1024 * 1024,
        maxRedirects: 5,
        userAgent,
        accept: opts.accept,
      });
      return {
        ok: true,
        status: r.status,
        finalUrl: r.finalUrl,
        redirectChain: r.redirectChain,
        contentType: r.headers.get("content-type"),
        xRobotsTag: r.headers.get("x-robots-tag"),
        contentLength: Number(r.headers.get("content-length")) || null,
        body: r.body,
        truncated: r.truncated,
        responseTimeMs: r.responseTimeMs,
      };
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return { ok: false, error: `Blocked: ${e.message}`, retryable: e.code === "dns_failure", unsafe: e.code !== "dns_failure" };
      }
      const err = e as Error & { cause?: { code?: string } };
      const code = err.cause?.code ?? "";
      const message =
        err.name === "AbortError"
          ? "Request timed out"
          : /redirects/i.test(err.message)
            ? err.message
            : `${code ? `${code}: ` : ""}${err.message || "Network error"}`;
      // timeouts and transient network errors are retried; redirect loops are not
      return { ok: false, error: message, retryable: !/redirects/i.test(err.message) };
    }
  };
}
