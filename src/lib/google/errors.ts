/** Normalized Google API failures, so the UI can explain what happened. */
export type GoogleErrorKind =
  | "auth" // token expired / revoked / invalid_grant → reconnect
  | "permission" // the Google account cannot access this property
  | "rate_limited" // 429 / quota
  | "not_found"
  | "bad_request"
  | "server" // 5xx
  | "network"
  | "not_configured";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly kind: GoogleErrorKind,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
  get retryable() {
    return this.kind === "rate_limited" || this.kind === "server" || this.kind === "network";
  }
}

/** Map an HTTP status + Google error body to a GoogleApiError. */
export function toGoogleError(status: number, body: unknown, api: string): GoogleApiError {
  const err = (body as { error?: { message?: string; status?: string } | string; error_description?: string } | null) ?? {};
  const detail =
    typeof err.error === "string"
      ? `${err.error}${err.error_description ? `: ${err.error_description}` : ""}`
      : (err.error?.message ?? `HTTP ${status}`);
  const message = `${api}: ${detail}`.slice(0, 300);
  if (status === 401 || (typeof err.error === "string" && /invalid_grant|invalid_token|unauthorized_client/.test(err.error))) {
    return new GoogleApiError(message, "auth", status);
  }
  if (status === 429 || (typeof err.error === "object" && err.error?.status === "RESOURCE_EXHAUSTED")) return new GoogleApiError(message, "rate_limited", status);
  if (status === 403) return new GoogleApiError(message, "permission", status);
  if (status === 404) return new GoogleApiError(message, "not_found", status);
  if (status >= 500) return new GoogleApiError(message, "server", status);
  return new GoogleApiError(message, "bad_request", status);
}

export const GOOGLE_ERROR_HELP: Record<GoogleErrorKind, string> = {
  auth: "Google access expired or was revoked. Reconnect your Google account.",
  permission: "The connected Google account does not have access to this property. Choose another property or reconnect with an account that has access.",
  rate_limited: "Google's API rate limit was reached. Rankora will retry automatically; try again in a few minutes.",
  not_found: "The selected property no longer exists. Choose another property.",
  bad_request: "Google rejected the request. If this persists, reconnect the integration.",
  server: "Google's API is temporarily unavailable. Rankora will retry.",
  network: "Could not reach Google. Rankora will retry.",
  not_configured: "Google integration is not configured on this server.",
};
