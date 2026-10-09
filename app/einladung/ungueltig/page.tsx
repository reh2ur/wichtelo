import { notFound } from "next/navigation";

// Proxy rewrites invalid/expired invite tokens here instead of letting
// app/einladung/[token]/page.tsx call notFound() itself — that page reads
// request-time data (and the root layout's Nav always suspends on the
// session cookie), so by the time its own check runs, Nav's Suspense
// fallback has already started streaming the response and fixed the status
// at 200. This route has zero dynamic dependencies, so Next bakes the 404
// into the build and serves it before anything can stream.
export default function Page() {
  notFound();
}
