import { isIP } from "node:net";

/** [network, prefix length] IPv4 ranges that are not public unicast. */
const BLOCKED_V4: [number, number][] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // private
  [0x64400000, 10], // CGNAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, cloud metadata (169.254.169.254)
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // TEST-NET-2
  [0xcb007100, 24], // TEST-NET-3
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved + broadcast
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function isPublicV4(address: string): boolean {
  const n = v4ToInt(address);
  if (n === null) return false;
  return !BLOCKED_V4.some(([net, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= net && n < net + size;
  });
}

/** Expands an IPv6 literal to eight 16-bit groups, or null if malformed. */
function v6Groups(address: string): number[] | null {
  let a = address.split("%")[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    if (n === null) return null;
    a =
      a.slice(0, -dotted[1].length) +
      `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return out.some(Number.isNaN) ? null : out;
}

function isPublicV6(address: string): boolean {
  const g = v6Groups(address);
  if (!g) return false;
  // Only global unicast 2000::/3 qualifies; this already excludes ::, ::1,
  // ::ffff:0:0/96 (v4-mapped), 64:ff9b::/96 (NAT64), fc00::/7, fe80::/10, ff00::/8.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return false; // Teredo
  if (g[0] === 0x2002) return false; // 6to4 embeds arbitrary v4
  return true;
}

/** True only for a publicly routable unicast IPv4/IPv6 literal. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family === 4) return isPublicV4(bare);
  if (family === 6) return isPublicV6(bare);
  return false;
}
