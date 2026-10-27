/**
 * Shared E2E state. Global setup writes the temporary accounts (test values
 * generated per run, never committed) to test-results/e2e/state.json.
 */
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const STATE_FILE = "test-results/e2e/state.json";

export interface E2EUser {
  id: string;
  email: string;
  password: string;
}

export interface E2EState {
  runId: string;
  owner: E2EUser;
  invitee: E2EUser;
  outsider: E2EUser;
  orgSlug: string;
  orgId: string;
  siteId: string;
  outsiderOrgSlug: string;
}

export const state = (): E2EState => JSON.parse(readFileSync(STATE_FILE, "utf8"));

export async function signIn(page: Page, user: E2EUser) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // users without an organization (e.g. before accepting an invite) land on onboarding
  await page.waitForURL(/\/(app\/|onboarding)/, { timeout: 30_000 });
}

/** No horizontal page scroll (responsive layout check). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(1);
}
