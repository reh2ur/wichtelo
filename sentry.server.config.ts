// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSentryData } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sampled to protect the event quota.
  tracesSampleRate: 0.1,

  // /einladung/<token> is a bearer credential: scrub URLs, transaction names
  // and breadcrumbs before anything leaves the app.
  beforeSend: (event) => scrubSentryData(event),
  beforeSendTransaction: (event) => scrubSentryData(event),
  beforeBreadcrumb: (breadcrumb) => scrubSentryData(breadcrumb),

  // Turns off collection of data that could identify users. Adjust per category:
  // https://docs.sentry.io/platforms/javascript/configuration/options/#dataCollection
  dataCollection: {
    userInfo: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    httpBodies: [],
    httpHeaders: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    cookies: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
  },
});
