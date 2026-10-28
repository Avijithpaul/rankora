import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, state } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("public site", () => {
  test("landing, pricing (four plans), project docs and academic demo render", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Rankora/);
    await page.goto("/pricing");
    for (const plan of ["Free", "Starter", "Pro", "Agency"]) await expect(page.getByText(plan, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("150,000 crawled pages / month")).toBeVisible();
    await page.goto("/project");
    await expect(page.getByRole("heading", { name: "How Rankora is built" })).toBeVisible();
    await page.goto("/academic-demo");
    await expect(page.getByRole("heading", { name: /Presenting Rankora/ })).toBeVisible();
    await expect(page.getByText("Demo Data").first()).toBeVisible();
  });

  test("security headers are present", async ({ request }) => {
    const r = await request.get("/");
    expect(r.headers()["x-frame-options"]).toBe("DENY");
    expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    expect(r.headers()["x-powered-by"]).toBeUndefined();
  });

  test("signed-out users are sent to sign-in; APIs answer 401", async ({ page, request }) => {
    const s = state();
    await page.goto(`/app/${s.orgSlug}/billing`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect((await request.get(`/api/reports/00000000-0000-4000-8000-000000000000/export?format=csv`)).status()).toBe(401);
    expect((await request.post(`/api/billing/webhook`, { data: "{}" })).status()).toBe(404); // payments not enabled
  });

  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(state().owner.email);
    await page.locator("#password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("SaaS flows", () => {
  let inviteUrl = "";

  test("owner sees usage, plans and that payments are disabled", async ({ page }) => {
    const s = state();
    await signIn(page, s.owner);
    await page.goto(`/app/${s.orgSlug}/billing`);
    await expect(page.getByText("Usage this month")).toBeVisible();
    await expect(page.getByRole("main").getByText("Starter plan")).toBeVisible();
    await expect(page.getByRole("link", { name: /Starter plan.*Upgrade/ })).toBeVisible(); // sidebar plan widget
    await expect(page.getByRole("progressbar", { name: "Websites" })).toBeVisible();
    await expect(page.getByText(/Online payments are not enabled/)).toBeVisible();
    const upgrade = page.getByRole("button", { name: "Upgrade to Pro" });
    await expect(upgrade).toBeDisabled();
  });

  test("owner invites a teammate and gets a one-time link", async ({ page }) => {
    const s = state();
    await signIn(page, s.owner);
    await page.goto(`/app/${s.orgSlug}/settings`);
    await page.locator("#invite-email").fill(s.invitee.email);
    await page.locator("#invite-role").selectOption("member");
    await page.getByRole("button", { name: "Invite" }).click();
    const link = page.locator("code", { hasText: "/invite/" });
    await expect(link).toBeVisible();
    inviteUrl = new URL((await link.textContent())!.trim()).pathname;
    await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  });

  test("another user cannot see the invitation details or use it", async ({ page }) => {
    const s = state();
    await signIn(page, s.outsider);
    await page.goto(inviteUrl);
    await expect(page.getByText(/sent to a different address/)).toBeVisible();
    await expect(page.getByText("E2E Agency")).toHaveCount(0);
  });

  test("the invitee accepts and joins as member; the link then stops working", async ({ page }) => {
    const s = state();
    await signIn(page, s.invitee);
    await page.goto(inviteUrl);
    await expect(page.getByText(/E2E Agency/)).toBeVisible();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL(new RegExp(`/app/${s.orgSlug}`));
    await page.goto(`/app/${s.orgSlug}/billing`);
    await expect(page.getByText("Only owners and admins can change the plan.")).toBeVisible();
    await page.goto(inviteUrl);
    await expect(page.getByText(/already been used/)).toBeVisible();
  });

  test("owner sees the join notification and activity log, assigns a task", async ({ page }) => {
    const s = state();
    await signIn(page, s.owner);
    await page.goto(`/app/${s.orgSlug}/notifications`);
    await expect(page.getByText(new RegExp(`${s.invitee.email.replace(/[.+]/g, "\\$&")} joined`))).toBeVisible();
    await page.goto(`/app/${s.orgSlug}/settings`);
    await expect(page.getByText("member.joined")).toBeVisible();
    await expect(page.getByText("member.invited")).toBeVisible();

    await page.goto(`/app/${s.orgSlug}/sites/${s.siteId}/tasks`);
    await page.locator("#title").fill(`E2E task ${s.runId}`);
    await page.locator("#assignedTo").selectOption({ label: "E2E invitee" });
    await page.locator("#pageUrl").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(/full URL or a path/)).toBeVisible(); // unsafe URL rejected
    await page.locator("#title").fill(`E2E task ${s.runId}`);
    await page.locator("#assignedTo").selectOption({ label: "E2E invitee" });
    await page.locator("#pageUrl").fill("/pricing");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Task created.")).toBeVisible();
  });

  test("the assignee is notified (bell count) and can open the task", async ({ page }) => {
    const s = state();
    await signIn(page, s.invitee);
    await page.goto(`/app/${s.orgSlug}`);
    await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();
    await page.goto(`/app/${s.orgSlug}/notifications`);
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page.getByRole("heading", { name: `E2E task ${s.runId}` })).toBeVisible();
  });

  test("owner demotes the member to viewer; viewers cannot invite or edit tasks", async ({ page }) => {
    const s = state();
    await signIn(page, s.owner);
    await page.goto(`/app/${s.orgSlug}/settings`);
    await page.getByLabel("Role of E2E invitee").selectOption("viewer");
    await page.getByRole("listitem").filter({ hasText: "E2E invitee" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Role updated.")).toBeVisible();

    await signIn(page, s.invitee);
    await page.goto(`/app/${s.orgSlug}/settings`);
    await expect(page.locator("#invite-email")).toHaveCount(0);
    await page.goto(`/app/${s.orgSlug}/sites/${s.siteId}/tasks`);
    await expect(page.getByRole("heading", { name: "New task" })).toHaveCount(0);
  });

  test("the account menu and profile page show who is signed in", async ({ page }) => {
    const s = state();
    await signIn(page, s.owner);
    await page.goto(`/app/${s.orgSlug}/billing`);
    await page.getByRole("button", { name: /Account menu for E2E owner/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(s.owner.email)).toBeVisible();
    await expect(menu.getByText(/Signed in with/)).toContainText("Email & password");
    await page.screenshot({ path: "test-results/e2e/screens/account-menu.png" });
    await menu.getByRole("menuitem", { name: "Your profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "E2E owner" })).toBeVisible();
    await expect(page.getByText("Member since")).toBeVisible();
    await expect(page.getByText("Sign-in methods")).toBeVisible();
    await page.screenshot({ path: "test-results/e2e/screens/profile.png", fullPage: true });

    // the public site recognises the session too
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Signed in as E2E owner/ })).toBeVisible();
  });

  test("tenants are isolated and /admin is hidden from non-admins", async ({ page }) => {
    const s = state();
    await signIn(page, s.outsider);
    const r = await page.goto(`/app/${s.orgSlug}/sites/${s.siteId}/dashboard`);
    expect(r?.status()).toBe(404);
    expect((await page.goto("/admin"))?.status()).toBe(404);
  });
});

test.describe("responsive layout", () => {
  const VIEWPORTS = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];
  for (const vp of VIEWPORTS) {
    test(`no horizontal scroll on key pages (${vp.name})`, async ({ page }) => {
      const s = state();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const path of ["/", "/pricing", "/academic-demo", "/project", "/login"]) {
        await page.goto(path);
        await expectNoHorizontalScroll(page);
      }
      await signIn(page, s.owner);
      for (const path of [`/app/${s.orgSlug}/sites/${s.siteId}/dashboard`, `/app/${s.orgSlug}/billing`, `/app/${s.orgSlug}/settings`, `/app/${s.orgSlug}/sites/${s.siteId}/tasks`, `/app/${s.orgSlug}/sites/${s.siteId}/reports`, `/app/${s.orgSlug}/notifications`]) {
        await page.goto(path);
        // wait for the real content (not the loading skeleton) before measuring
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: `test-results/e2e/screens/${vp.name}-${path.split("/").filter(Boolean).slice(-1)[0]}.png`, fullPage: false });
      }
    });
  }
});
