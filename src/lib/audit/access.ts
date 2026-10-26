/**
 * Authorization for audit operations. Pure rules (unit tested) + the lookup
 * that route handlers use before touching a job with the service role.
 */
import type { OrgRole } from "@/lib/auth/dal";

const RANK: Record<OrgRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export type AuditDenial = "role" | "demo" | "inactive" | null;

/** Who may start / advance an audit for a website. */
export function auditDenial(role: OrgRole, website: { is_demo: boolean; status: string }): AuditDenial {
  if (RANK[role] < RANK.member) return "role";
  if (website.is_demo) return "demo";
  if (website.status !== "active") return "inactive";
  return null;
}

export const DENIAL_MESSAGE: Record<Exclude<AuditDenial, null>, string> = {
  role: "Viewers can see audits but cannot run them.",
  demo: "The Demo Project uses sample data and cannot be crawled.",
  inactive: "This website is paused or archived. Reactivate it to run an audit.",
};

/** Who may change an issue's status (ignore / reopen). */
export function canChangeIssueStatus(role: OrgRole, from: string, to: string): boolean {
  if (RANK[role] < RANK.member) return false;
  return (from === "open" && to === "ignored") || (from === "ignored" && to === "open");
}
