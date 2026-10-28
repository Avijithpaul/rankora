import { describe, expect, it } from "vitest";
import { buildContactEmail, contactSchema, sendWithResend } from "@/lib/contact";

const cfg = { to: "owner@example.com", from: "Rankora <onboarding@resend.dev>" };

describe("contact form validation", () => {
  it("accepts a valid message and normalises the email", () => {
    const r = contactSchema.safeParse({ name: " Jane ", email: " Jane@Example.COM ", topic: "Product help", message: "How are audits scored?" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ name: "Jane", email: "jane@example.com" });
  });

  it("rejects a missing reply address, unknown topics and too-short messages", () => {
    const r = contactSchema.safeParse({ name: "", email: "not-an-email", topic: "Free money", message: "hi" });
    expect(r.success).toBe(false);
    const fields = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["email", "topic", "message"]));
  });
});

describe("contact email", () => {
  it("replies to the visitor and keeps header fields on one line", () => {
    const p = buildContactEmail({ name: "Eve\r\nBcc: x@evil.test", email: "eve@example.com", topic: "General question", message: "Line 1\nLine 2 is long enough" }, cfg, { site: "https://rankora.test" });
    expect(p.to).toEqual(["owner@example.com"]);
    expect(p.reply_to).toBe("eve@example.com");
    expect(p.subject).not.toMatch(/[\r\n]/);
    expect(p.subject).toBe("[Rankora] General question — Eve Bcc: x@evil.test");
    expect(p.text).toContain("Line 1\nLine 2 is long enough");
    expect(p.text).toContain("Sent from: https://rankora.test/contact");
  });
});

describe("Resend sender", () => {
  it("posts JSON with a bearer token and returns the email id", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "em_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendWithResend({ from: cfg.from, to: [cfg.to], reply_to: "a@b.c", subject: "s", text: "t" }, "re_test", fake);
    expect(r).toEqual({ ok: true, id: "em_123" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(seen!.init.body)).reply_to).toBe("a@b.c");
  });

  it("reports API and network errors without throwing", async () => {
    const rejected = (async () => new Response(JSON.stringify({ name: "validation_error", message: "You can only send testing emails to your own email address" }), { status: 403 })) as unknown as typeof fetch;
    expect(await sendWithResend({ from: "f", to: ["t"], reply_to: "r", subject: "s", text: "t" }, "k", rejected)).toEqual({
      ok: false,
      status: 403,
      error: "You can only send testing emails to your own email address",
    });
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await sendWithResend({ from: "f", to: ["t"], reply_to: "r", subject: "s", text: "t" }, "k", offline)).toEqual({ ok: false, status: 0, error: "offline" });
  });
});
