import { describe, expect, it } from "vitest";
import {
  UnsafeUrlError,
  assertPublicHost,
  isPublicIp,
  parsePublicUrl,
  registrableDomain,
  validatePublicUrl,
  type LookupFn,
} from "@/lib/security/url-safety";

const fakeDns =
  (map: Record<string, string[]>): LookupFn =>
  async (host) => {
    const addrs = map[host];
    if (!addrs) throw new Error("ENOTFOUND");
    return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::",
  ])("rejects %s", (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])("accepts %s", (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  );
});

describe("parsePublicUrl", () => {
  it("adds https to bare domains", () => {
    expect(parsePublicUrl("example.com").toString()).toBe("https://example.com/");
  });

  it.each([
    ["ftp://example.com", "protocol"],
    ["file:///etc/passwd", "protocol"],
    ["javascript:alert(1)", "protocol"],
    ["gopher://example.com", "protocol"],
    ["https://user:pw@example.com", "credentials"],
    ["https://example.com:22", "port"],
    ["http://localhost", "hostname"],
    ["http://foo.localhost", "hostname"],
    ["http://intranet", "hostname"],
    ["http://printer.local", "hostname"],
    ["http://metadata.google.internal", "hostname"],
    ["http://127.0.0.1", "private_address"],
    ["http://2130706433", "private_address"], // decimal 127.0.0.1
    ["http://0x7f000001", "private_address"],
    ["http://[::1]", "private_address"],
    ["http://169.254.169.254/latest/meta-data", "private_address"],
    ["http://[::ffff:169.254.169.254]", "private_address"],
    ["not a url at all", "invalid_url"],
  ])("rejects %s (%s)", (input, code) => {
    try {
      parsePublicUrl(input);
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as UnsafeUrlError).code).toBe(code);
    }
  });

  it("accepts normal public URLs", () => {
    expect(parsePublicUrl("https://www.example.com/path?q=1").hostname).toBe("www.example.com");
    expect(parsePublicUrl("http://example.co.uk:8080/").port).toBe("8080");
  });
});

describe("DNS validation", () => {
  it("rejects hostnames resolving to private addresses (DNS rebinding style)", async () => {
    const dns = fakeDns({ "evil.example": ["93.184.216.34", "10.0.0.5"] });
    await expect(assertPublicHost("evil.example", dns)).rejects.toMatchObject({ code: "private_address" });
  });

  it("accepts hostnames resolving only to public addresses", async () => {
    const dns = fakeDns({ "good.example": ["93.184.216.34"] });
    await expect(validatePublicUrl("https://good.example", dns)).resolves.toBeInstanceOf(URL);
  });

  it("reports DNS failures", async () => {
    await expect(assertPublicHost("missing.example", fakeDns({}))).rejects.toMatchObject({ code: "dns_failure" });
  });
});

describe("registrableDomain", () => {
  it("strips www and lower-cases", () => {
    expect(registrableDomain(new URL("https://WWW.Example.COM/a"))).toBe("example.com");
  });
});
