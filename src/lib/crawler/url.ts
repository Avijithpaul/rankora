/** URL helpers for the crawler. Pure functions, unit tested. */

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|ref_src)$/i;

const NON_PAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff",
  "pdf", "zip", "gz", "rar", "7z", "tar", "dmg", "exe", "msi", "apk",
  "mp3", "mp4", "m4a", "mov", "avi", "webm", "wav", "ogg",
  "css", "js", "mjs", "json", "xml", "txt", "csv", "woff", "woff2", "ttf", "eot", "otf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
]);

/**
 * Canonical form used for de-duplication:
 * lower-case host, no fragment, no default port, no tracking params,
 * empty path -> "/". Path case and trailing slashes are preserved
 * (they are different URLs on most servers).
 */
export function normalizeUrl(input: string | URL, base?: string | URL): string | null {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input, base) : new URL(input.toString());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  if (!url.pathname) url.pathname = "/";
  return url.toString();
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** Same site = same host ignoring a leading "www." (protocol may differ). */
export function isSameSite(url: string | URL, siteHost: string): boolean {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    return bareHost(u.hostname) === bareHost(siteHost);
  } catch {
    return false;
  }
}

export function fileExtension(pathname: string): string | null {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : null;
}

/** True when the URL path looks like an HTML page rather than an asset/download. */
export function looksLikePage(url: string): boolean {
  try {
    const ext = fileExtension(new URL(url).pathname);
    return !ext || !NON_PAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/** Simple glob for user exclude patterns: "*" = any run of characters. Matches path + query. */
export function matchesPattern(url: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  let target: string;
  try {
    const u = new URL(url);
    target = u.pathname + u.search;
  } catch {
    return false;
  }
  const regex = new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
  return regex.test(target);
}

export function isExcluded(url: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(url, p));
}

/** URL structure problems used by the `page.url_structure` rule. */
export function urlStructureProblems(url: string): string[] {
  const problems: string[] = [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return ["invalid URL"];
  }
  const path = decodeURIComponent(u.pathname);
  if (/[A-Z]/.test(path)) problems.push("uppercase characters");
  if (path.includes("_")) problems.push("underscores instead of hyphens");
  if (url.length > 115) problems.push("longer than 115 characters");
  if ([...u.searchParams.keys()].length > 2) problems.push("more than 2 query parameters");
  if (/(^|[?&])(sessionid|sid|phpsessid|jsessionid)=/i.test(u.search)) problems.push("session ID in URL");
  if (/\s/.test(path) || /%20/.test(u.pathname)) problems.push("spaces in path");
  if (/\/\/+/.test(u.pathname.slice(1))) problems.push("double slashes");
  return problems;
}
