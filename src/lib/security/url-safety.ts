/**
 * SSRF protection for every server-side request to a user-supplied URL
 * (crawler, PageSpeed proxying, content optimizer URL fetch).
 *
 * Layers:
 *  1. Syntactic validation: http/https only, no credentials, allowed ports,
 *     no IP-literal private hosts, no internal hostnames.
 *  2. DNS validation: every resolved address must be public unicast.
 *  3. Connect-time validation (in safe-fetch.ts): the socket's lookup hook
 *     re-checks the address actually dialled, defeating DNS rebinding.
 */
import ipaddr from "ipaddr.js";

export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".localdomain",
  ".home.arpa",
];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_url"
      | "protocol"
      | "credentials"
      | "port"
      | "hostname"
      | "private_address"
      | "dns_failure",
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** True only for globally routable unicast addresses. */
export function isPublicIp(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let addr = ipaddr.parse(address);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  // ipaddr.js classifies everything that is not public into named ranges
  // (private, loopback, linkLocal, uniqueLocal, carrierGradeNat, reserved,
  // multicast, unspecified, broadcast, 6to4, teredo, rfc6052, ...)
  return addr.range() === "unicast";
}

function isIpLiteral(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  return ipaddr.isValid(h);
}

/**
 * Parse and syntactically validate a URL. Does not touch the network.
 * Accepts bare domains ("example.com") by assuming https.
 */
export function parsePublicUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new UnsafeUrlError("URL is empty or too long", "invalid_url");

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UnsafeUrlError("Not a valid URL", "invalid_url");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError("Only http and https URLs are allowed", "protocol");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed", "credentials");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError("Only standard web ports are allowed", "port");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new UnsafeUrlError("URL has no host", "hostname");

  if (isIpLiteral(hostname)) {
    const ip = hostname.replace(/^\[|\]$/g, "");
    if (!isPublicIp(ip)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed", "private_address");
    return url;
  }

  // Numeric-ish hosts like "2130706433" or "0x7f.1" are interpreted as IPs by
  // the WHATWG parser already; anything left must look like a real DNS name.
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s)) ||
    !hostname.includes(".") ||
    !/^[a-z0-9.-]+$/.test(hostname) ||
    hostname.split(".").some((label) => label.length === 0 || label.length > 63)
  ) {
    throw new UnsafeUrlError("This hostname is not allowed", "hostname");
  }
  return url;
}

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

/** Resolve a hostname and require every address to be public. */
export async function assertPublicHost(hostname: string, lookup: LookupFn): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed", "private_address");
    return [host];
  }
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host);
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}`, "dns_failure");
  }
  if (records.length === 0) throw new UnsafeUrlError(`Could not resolve ${host}`, "dns_failure");
  for (const r of records) {
    if (!isPublicIp(r.address)) {
      throw new UnsafeUrlError(`${host} resolves to a private or reserved address`, "private_address");
    }
  }
  return records.map((r) => r.address);
}

/** Full check: syntax + DNS. */
export async function validatePublicUrl(input: string, lookup: LookupFn): Promise<URL> {
  const url = parsePublicUrl(input);
  await assertPublicHost(url.hostname, lookup);
  return url;
}

/** "https://WWW.Example.com:443/a?b#c" -> "www.example.com" */
export function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

/** Domain stored on websites.domain (no www, lower-case). */
export function registrableDomain(url: URL): string {
  return hostnameOf(url).replace(/^www\./, "");
}
