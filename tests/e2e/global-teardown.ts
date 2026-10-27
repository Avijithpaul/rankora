import { existsSync, rmSync } from "node:fs";
import { adminClient } from "./global-setup";
import { STATE_FILE, state } from "./fixtures";

/** Removes every organization and user created for this run (and the state file with its test passwords). */
export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return;
  const s = state();
  const db = adminClient();
  const users = [s.owner.id, s.invitee.id, s.outsider.id];
  const { data: memberships } = await db.from("organization_members").select("organization_id").in("user_id", users);
  const orgs = [...new Set([s.orgId, ...(memberships ?? []).map((m) => m.organization_id)])];
  for (const id of orgs) await db.from("organizations").delete().eq("id", id);
  for (const id of users) await db.auth.admin.deleteUser(id);
  rmSync(STATE_FILE, { force: true });
}
