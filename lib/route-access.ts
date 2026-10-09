import type { Route } from "next";

type Access = "protected" | "public" | "guest-only";

// Keep only bare page paths — strip search/hash variants, API/auth handler
// routes, and /einladung (manages its own access, see NON_PAGE_PREFIXES).
type PageRoute = Exclude<
  Extract<Route, `/${string}`>,
  | `${string}?${string}`
  | `${string}#${string}`
  | `/api${string}`
  | `/auth${string}`
  | `/einladung${string}`
>;

// Helper generic forces distributive evaluation over each union member.
type _FirstSegment<T extends string> = T extends `/${infer Head}/${string}`
  ? `/${Head}`
  : T;

// Top-level route groups derived from actual app routes.
// TypeScript errors on ROUTE_ACCESS below if any group is unclassified.
type TopLevelRoute = _FirstSegment<PageRoute>;

const ROUTE_ACCESS = {
  "/": "guest-only",
  "/admin": "protected", // proxy.ts checks SUPER_ADMIN_EMAIL before reaching this
  "/anmelden": "guest-only",
  "/datenschutz": "public",
  "/gruppen": "protected",
  "/impressum": "public",
  "/konto": "protected",
} as const satisfies Record<TopLevelRoute, Access>;

// API and auth callback routes manage their own access — excluded from page-level guard.
// /einladung/ is also excluded: invite pages are public and manage their own auth flow.
const NON_PAGE_PREFIXES = ["/api/", "/auth/", "/einladung/"] as const;

function isNonPagePath(pathname: string): boolean {
  return NON_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Emailed account-deletion link: the HMAC token authenticates it, so it must
// work from another device / without a session.
const PUBLIC_OVERRIDES = ["/konto/delete/confirm"] as const;

function matchRoute(pathname: string): Access | undefined {
  if (isNonPagePath(pathname)) return undefined;
  if (PUBLIC_OVERRIDES.some((p) => pathname === p)) return "public";
  const keys = Object.keys(ROUTE_ACCESS) as (keyof typeof ROUTE_ACCESS)[];
  const match = keys.find(
    (key) =>
      pathname === key || (key !== "/" && pathname.startsWith(key + "/")),
  );
  return match ? ROUTE_ACCESS[match] : undefined;
}

export function isProtectedRoute(pathname: string): boolean {
  if (isNonPagePath(pathname)) return false;
  // Every real top-level page route is forced into ROUTE_ACCESS by the
  // `satisfies Record<TopLevelRoute, Access>` check above, so an unmatched
  // path here is never a real route (typo, bot probe, robots.txt, ...) —
  // pass it through so Next's own routing renders a genuine 404 instead of
  // treating "route doesn't exist" the same as "route needs auth".
  return matchRoute(pathname) === "protected";
}

export function isGuestOnlyRoute(pathname: string): boolean {
  return matchRoute(pathname) === "guest-only";
}
