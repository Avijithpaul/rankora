import "server-only";
import { lookup as dnsLookup } from "node:dns";
import { promisify } from "node:util";
import { Agent, fetch as undiciFetch } from "undici";
import { UnsafeUrlError, assertPublicHost, isPublicIp, parsePublicUrl, type LookupFn } from "./url-safety";

const lookupAll = promisify(dnsLookup);

export const resolveAll: LookupFn = async (hostname) =>
  (await lookupAll(hostname, { all: true, verbatim: true })) as { address: string; family: number }[];

/**
 * undici Agent whose DNS lookup refuses non-public addresses at connect time.
 * This closes the DNS-rebinding gap between validation and connection.
 */
const guardedAgent = new Agent({
  connect: {
    timeout: 10_000,
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        const list = addresses as unknown as { address: string; family: number }[];
        const bad = list.find((a) => !isPublicIp(a.address));
        if (bad || list.length === 0) {
          return callback(new UnsafeUrlError(`${hostname} resolves to a non-public address`, "private_address"), "", 4);
        }
        if ((options as { all?: boolean }).all) {
          return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
        }
        callback(null, list[0].address, list[0].family);
      });
    },
  },
  headersTimeout: 15_000,
  bodyTimeout: 20_000,
});

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
  accept?: string;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Headers;
  redirectChain: { url: string; status: number }[];
  body: string;
  truncated: boolean;
  responseTimeMs: number;
}

export const DEFAULT_USER_AGENT = "RankoraBot/1.0 (+https://rankora.app/bot)";

/**
 * Fetch a user-supplied URL safely: validates every hop, follows redirects
 * manually, enforces timeouts and a body-size cap.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    method = "GET",
    maxRedirects = 5,
    maxBytes = 3 * 1024 * 1024,
    timeoutMs = 20_000,
    userAgent = DEFAULT_USER_AGENT,
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
  } = opts;

  const redirectChain: { url: string; status: number }[] = [];
  let current = parsePublicUrl(input);
  const requestedUrl = current.toString();
  const started = performance.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(current.hostname, resolveAll);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await undiciFetch(current, {
        method,
        redirect: "manual",
        dispatcher: guardedAgent,
        signal: controller.signal,
        headers: { "user-agent": userAgent, accept, "accept-language": "en;q=0.9,*;q=0.5" },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        redirectChain.push({ url: current.toString(), status: res.status });
        await res.body?.cancel();
        const next = new URL(res.headers.get("location")!, current);
        current = parsePublicUrl(next.toString());
        continue;
      }

      let body = "";
      let truncated = false;
      if (method === "GET" && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            truncated = true;
            await reader.cancel();
            break;
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      }

      return {
        requestedUrl,
        finalUrl: current.toString(),
        status: res.status,
        headers: res.headers as unknown as Headers,
        redirectChain,
        body,
        truncated,
        responseTimeMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}
