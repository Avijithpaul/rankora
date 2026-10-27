/**
 * A Search Console property may only be attached to a website it belongs to:
 * `sc-domain:example.com` for example.com (or a subdomain website), or a
 * URL-prefix property on the same host (± www).
 */
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

export function gscPropertyMatchesDomain(siteUrl: string, websiteDomain: string): boolean {
  const domain = bare(websiteDomain);
  if (siteUrl.startsWith("sc-domain:")) {
    const prop = bare(siteUrl.slice("sc-domain:".length));
    return domain === prop || domain.endsWith(`.${prop}`);
  }
  try {
    const u = new URL(siteUrl);
    return (u.protocol === "https:" || u.protocol === "http:") && bare(u.hostname) === domain;
  } catch {
    return false;
  }
}
