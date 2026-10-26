import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/security/crypto";

const key = randomBytes(32).toString("base64");

describe("token encryption", () => {
  it("round-trips", () => {
    const enc = encryptSecret("ya29.secret-token", key);
    expect(enc).not.toContain("ya29");
    expect(decryptSecret(enc, key)).toBe("ya29.secret-token");
  });

  it("uses a random IV per encryption", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("detects tampering", () => {
    const enc = encryptSecret("value", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("fails with the wrong key or a malformed key", () => {
    const enc = encryptSecret("value", key);
    expect(() => decryptSecret(enc, randomBytes(32).toString("base64"))).toThrow();
    expect(() => encryptSecret("value", "short")).toThrow(/32 bytes/);
    expect(() => encryptSecret("value", "")).toThrow(/not configured/);
  });

  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
