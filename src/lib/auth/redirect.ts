/**
 * Only allow same-origin relative paths as post-login redirect targets
 * (prevents open redirects like ?next=//evil.com or ?next=https://evil.com).
 */
export function safeNextPath(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.length > 500 || /[\r\n\t]/.test(value)) return null;
  try {
    const url = new URL(value, "http://rankora.invalid");
    if (url.origin !== "http://rankora.invalid") return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
