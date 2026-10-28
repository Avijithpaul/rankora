import { describe, expect, it } from "vitest";
import { displayName, initialsOf, providerLabel, safeAvatarUrl, toProvider } from "@/lib/profile";

describe("profile helpers", () => {
  it("maps sign-in providers", () => {
    expect(toProvider("google")).toBe("google");
    expect(toProvider("github")).toBe("github");
    expect(toProvider("email")).toBe("email");
    expect(toProvider(undefined)).toBe("email");
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("email")).toBe("Email & password");
  });

  it("only renders https avatar URLs", () => {
    expect(safeAvatarUrl("https://lh3.googleusercontent.com/a/abc=s96-c")).toBe("https://lh3.googleusercontent.com/a/abc=s96-c");
    expect(safeAvatarUrl("http://example.com/a.png")).toBeNull();
    expect(safeAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(safeAvatarUrl("not a url")).toBeNull();
    expect(safeAvatarUrl(null)).toBeNull();
  });

  it("builds initials and display names", () => {
    expect(initialsOf("Avijith Paul")).toBe("AP");
    expect(initialsOf("madonna")).toBe("M");
    expect(initialsOf("avijith.paul136@gmail.com")).toBe("A");
    expect(initialsOf("")).toBe("?");
    expect(displayName("  Avijith Paul ", "a@b.c")).toBe("Avijith Paul");
    expect(displayName(null, "avijith.paul136@gmail.com")).toBe("avijith.paul136");
    expect(displayName(null, null)).toBe("Account");
  });
});
