import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
  ])("accepts public %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2001:db8::1",
    "2001::1",
    "not-an-ip",
    "",
    "1.2.3",
    "999.1.1.1",
  ])("rejects %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("accepts bracketed IPv6 literals as URL hostnames appear", () => {
    expect(isPublicAddress("[2606:4700:4700::1111]")).toBe(true);
    expect(isPublicAddress("[::1]")).toBe(false);
  });
});
