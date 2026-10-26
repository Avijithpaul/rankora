import { describe, expect, it } from "vitest";
import { newPasswordSchema, organizationSchema, registerSchema, websiteSchema } from "@/lib/validation/schemas";
import { safeNextPath } from "@/lib/auth/redirect";
import { slugify } from "@/lib/utils";

describe("registerSchema", () => {
  it("normalises email and enforces password strength", () => {
    const ok = registerSchema.safeParse({ fullName: "Ada", email: "  ADA@Example.com ", password: "correcthorse9" });
    expect(ok.success && ok.data.email).toBe("ada@example.com");
    expect(registerSchema.safeParse({ fullName: "Ada", email: "a@b.co", password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ fullName: "Ada", email: "a@b.co", password: "nonumbershere" }).success).toBe(false);
  });
});

describe("organizationSchema", () => {
  it("accepts valid slugs matching the DB constraint", () => {
    expect(organizationSchema.safeParse({ name: "Acme", slug: "acme-inc" }).success).toBe(true);
  });
  it.each(["-acme", "acme-", "ac", "Acme Inc", "a_b_c", "x".repeat(49)])("rejects slug %s", (slug) => {
    expect(organizationSchema.safeParse({ name: "Acme", slug }).success).toBe(false);
  });
});

describe("websiteSchema", () => {
  const base = { name: "Site", countryCode: "US", languageCode: "en" };
  it("normalises the URL and strips query/hash", () => {
    const r = websiteSchema.safeParse({ ...base, url: "example.com/blog?x=1#top" });
    expect(r.success && r.data.url.toString()).toBe("https://example.com/blog");
  });
  it.each(["http://localhost:3000", "http://192.168.0.1", "ftp://example.com", "http://[::1]/"])("rejects unsafe URL %s", (url) => {
    expect(websiteSchema.safeParse({ ...base, url }).success).toBe(false);
  });
  it("rejects unknown markets", () => {
    expect(websiteSchema.safeParse({ ...base, url: "example.com", countryCode: "XX" }).success).toBe(false);
  });
});

describe("safeNextPath (open redirect protection)", () => {
  it.each([
    ["/app/acme", "/app/acme"],
    ["/app?x=1", "/app?x=1"],
    ["//evil.com", null],
    ["/\\evil.com", null],
    ["https://evil.com", null],
    ["javascript:alert(1)", null],
    ["/app\r\nSet-Cookie:x", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("slugify", () => {
  it("produces DB-compatible slugs", () => {
    expect(slugify("Ácme  Marketing, Inc.")).toBe("acme-marketing-inc");
  });
});

describe("newPasswordSchema (reset / change password)", () => {
  it("requires matching, strong passwords", () => {
    expect(newPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword1" }).success).toBe(true);
    const mismatch = newPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword2" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0].path).toEqual(["confirmPassword"]);
    expect(newPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" }).success).toBe(false);
  });
});
